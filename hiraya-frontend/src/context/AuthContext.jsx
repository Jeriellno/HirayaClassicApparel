import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import api, { getAuthToken, clearStoredSession, parseApiError } from '../api/axios';

const AuthContext = createContext();

/** Safely JSON-parses a stored user without throwing on corrupt data. */
const readStoredUser = () => {
    try {
        const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
        return raw ? normalizeUser(JSON.parse(raw)) : null;
    } catch (error) {
        console.error('Failed to parse local user session:', error);
        return null;
    }
};

/**
 * Guarantees the user object always exposes a usable `role` string.
 */
const normalizeUser = (userData) => {
    if (!userData || typeof userData !== 'object') return userData ?? null;

    const role =
        userData.role ??
        userData.role_name ??
        (Array.isArray(userData.roles) ? userData.roles[0] : userData.roles) ??
        (userData.is_admin || userData.isAdmin ? 'admin' : 'user');

    return { ...userData, role: String(role || 'user') };
};

/**
 * Persists the session based on storage tier.
 */
const persistSession = (token, userData, remember = true) => {
    const target = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;

    other.removeItem('token');
    other.removeItem('user');

    if (token) target.setItem('token', token);
    if (userData) target.setItem('user', JSON.stringify(userData));
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(readStoredUser);
    /*
     * OPTIMISTIC START. With a stored token AND user, the app renders at once
     * and `checkUser` confirms the session in the background (a 401 still signs
     * the user out). Blocking every page on GET /user cost 4-6 s on the
     * single-threaded dev server — the whole app sat on "Loading your session"
     * and every page request (e.g. Personalized for You) queued behind it.
     */
    // Only a token WITHOUT a cached user has to wait for GET /user; a guest
    // (no token) is already known to be signed out, so nothing flashes first.
    const [loading, setLoading] = useState(() => Boolean(getAuthToken()) && !readStoredUser());
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    /*
     * LOGOUT MUST LAND IN ONE NAVIGATION, NOT TWO.
     *
     * `logout()` used to finish with `window.location.href = '/login'`, a FULL page
     * load, on top of the `setUser(null)` it had already done. That produced the
     * double refresh everybody saw: React re-rendered, the router's `ProtectedRoute`
     * found no user and issued its own `<Navigate to="/login" replace />`, and then
     * the hard navigation landed anyway — a second document load of a SPA, throwing
     * away the bundle it had just booted and re-running every module.
     *
     * The state change is ALREADY enough to send the user to /login: `ProtectedRoute`
     * is what decides the destination, and doing it in one place means the guards and
     * the logout can never disagree about where "signed out" lives. So this navigates
     * in-app and nothing more. The `ref` is the second half of the fix — a second
     * click (or a re-render that fires the effect again) used to be able to kick off
     * the same teardown twice, doubling the request and the redirect.
     */
    const logoutStarted = useRef(false);

    /**
     * Verifies the stored token against /api/user on app refresh.
     * SILENTLY keeps cached session during server queue timeouts (ECONNABORTED).
     */
    const checkUser = useCallback(async () => {
        let token = getAuthToken();

        // The latch guards ONE teardown. On a boot where nobody is signed in there
        // is no teardown to guard, so re-arm it here rather than letting a stale
        // `true` from a previous session in this tab make a later logout a no-op.
        logoutStarted.current = false;

        if (!token) {
            /*
             * NO AUTO-LOGIN, and this is deliberate.
             *
             * This branch used to attempt a silent local sign-in for the admin
             * console (devAdminAutoLogin), so the console could open itself with
             * a session nobody had asked for. Combined with BYPASS_ADMIN_AUTH on
             * the client and the removed token gate on the server, that made the
             * console reachable by anyone who opened the URL — a customer, a bot,
             * anybody.
             *
             * The only way into the console now is an explicit sign-in, and a
             * superadmin additionally has to pass TOTP. If there is no token,
             * the correct answer is "nobody is signed in" — which is what the
             * router turns into a redirect to /login.
             */
            setUser(null);
            clearStoredSession();
            setLoading(false);
            return null;
        }

        try {
            const res = await api.get('/user');
            const freshUser = normalizeUser(res.data?.user ?? res.data);
            setUser(freshUser);
            persistSession(token, freshUser, !!localStorage.getItem('token'));
            return freshUser;
        } catch (err) {
            const { status, isTimeout, isNetworkError } = parseApiError(err);

            // 1. TIMEOUT O SERVER QUEUE (php artisan serve delays):
            if (isTimeout || isNetworkError) {
                console.warn('⚡ Auth check timed out due to server queue. Retaining local session.');
                return readStoredUser();
            }

            // 2. TOTOONG AUTH REJECTION (401/403 Expired o Invalid Token):
            if (status === 401 || status === 403) {
                setUser(null);
                clearStoredSession();
                return null;
            }

            // 3. Ibang 5xx Server Errors
            console.warn(`Auth verification skipped (Status: ${status}). Retaining local session.`);
            return readStoredUser();
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        checkUser();
    }, [checkUser]);

    /**
     * Signs in — for EVERY role.
     *
     * Customers come back with `{ token, user }` and a Sanctum session. Staff
     * come back with `{ mfa_required: true, role }` and NO token: the session
     * that opens the console has to carry a Supabase `aal2` claim, so Login.jsx
     * finishes the handshake there. That is a branch in the response body, not
     * an error and not a redirect to a second form — there is only one form.
     */
    const login = async (credentials) => {
        const { remember, ...payload } = credentials || {};

        try {
            const res = await api.post('/login', payload);
            const { token } = res.data || {};
            const userData = normalizeUser(res.data?.user);

            /*
             * A PRIVILEGED ACCOUNT: no token is issued. Persist nothing and do not
             * treat this as a signed-in customer — the caller completes aal2
             * first. This used to be a 403 with a `staff_door` pointer; the branch
             * stays, but as a success case, because a correct password on a staff
             * account is the FIRST STEP of a sign-in, not a failure.
             */
            if (res.data?.mfa_required) {
                setUser(null);
                clearStoredSession();
                return res;
            }
            if (!token) {
                const tokenError = new Error(
                    'Sign-in succeeded but no session token was returned. Please try again.',
                );
                tokenError.status = 0;
                tokenError.errors = {};
                throw tokenError;
            }

            persistSession(token, userData, remember !== false);
            setUser(userData || null);

            /*
             * Re-arm the logout latch. It exists only to stop ONE click from tearing
             * the session down twice, and `AuthProvider` sits above the router — it
             * stays mounted across /login, so without this reset the NEXT sign-out in
             * the same tab would return early and appear to do nothing at all.
             */
            logoutStarted.current = false;

            return res;
        } catch (error) {
            if (error?.isAuthError) throw error;

            const { message, errors, status } = parseApiError(error);

            const normalised = new Error(message);
            normalised.isAuthError = true;
            normalised.status = status;
            normalised.errors = errors;

            throw normalised;
        }
    };

    /**
     * Registers the account — STEP 1. New sign-ups answer 202
     * `{ verification_required, email }`: no account exists yet until the
     * Gmail code is verified (see verifyRegistration).
     */
    const register = async (formData) => {
        const res = await api.post('/register', formData);
        const { token } = res.data || {};
        const userData = normalizeUser(res.data?.user);

        if (token) {
            persistSession(token, userData, true);
            setUser(userData || null);
            logoutStarted.current = false;
        }

        return res;
    };

    /**
     * STEP 2 of sign-up: the 6-digit code from the Gmail inbox. The account is
     * created (already verified) and signed in by the server.
     */
    const verifyRegistration = async (email, code) => {
        const res = await api.post('/register/verify', { email, code });
        const { token } = res.data || {};
        const userData = normalizeUser(res.data?.user);
        if (token) {
            persistSession(token, userData, true);
            setUser(userData || null);
            logoutStarted.current = false;
        }
        return res;
    };

    /**
     * End the session LOCALLY after the server already revoked it (e.g. the
     * account was just deleted). Clears React state too, so the route guards
     * do not keep treating the visitor as signed in.
     */
    const endSession = (redirectTo = '/login', state = undefined) => {
        clearStoredSession();
        setUser(null);
        queryClient.clear();
        logoutStarted.current = false;
        navigate(redirectTo, { replace: true, state });
    };

    const updateUser = (updatedData) => {
        setUser((prevUser) => {
            const newUser = { ...prevUser, ...updatedData };
            persistSession(getAuthToken(), newUser, !!localStorage.getItem('token'));
            return newUser;
        });
    };

    /**
     * Force-refresh the authenticated user from the backend.
     */
    const refreshUser = async () => {
        try {
            const res = await api.get('/user');
            const freshUser = normalizeUser(res.data?.user ?? res.data);
            setUser(freshUser);
            persistSession(getAuthToken(), freshUser, !!localStorage.getItem('token'));
            return freshUser;
        } catch (err) {
            const { isTimeout, isNetworkError } = parseApiError(err);
            if (!isTimeout && !isNetworkError) {
                console.error('Failed to refresh user:', err);
            }
            return null;
        }
    };

    /**
     * Guarantees non-blocking local session destruction before network call.
     */
    const logout = async () => {
        if (logoutStarted.current) return;
        logoutStarted.current = true;

        /*
         * CAPTURE THE TOKEN FIRST, NAVIGATE IMMEDIATELY, REVOKE IN THE BACKGROUND.
         *
         * The old order cleared storage and THEN called /logout, so that request
         * went out with no token: the server never revoked it (401) and the 401
         * handling could fire on the way out. It also awaited the network before
         * navigating, while `setUser(null)` had already made the route guards
         * redirect — two navigations, which read as a lag/flicker on logout.
         */
        const token = getAuthToken();

        clearStoredSession();
        setUser(null);
        // Drop cached cart/orders/notifications so the next account never sees them.
        queryClient.clear();
        navigate('/login', { replace: true });

        if (token) {
            api.post('/logout', null, { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 })
                .catch((err) => console.warn('Backend logout skipped or unreachable:', err?.message));
        }
    };

    return (
        <AuthContext.Provider
            value={{ user, login, register, verifyRegistration, endSession, logout, loading, updateUser, refreshUser, checkUser }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);