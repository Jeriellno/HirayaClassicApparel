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
    const [loading, setLoading] = useState(true);
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
     * Registers the account.
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

        // 1. Burahin agad ang local storage para instant UI response
        clearStoredSession();
        setUser(null);

        // 2. Itapon ang mga naka-cache na query (cart, orders, notifications).
        //    Without this the NEXT sign-in would briefly render the previous
        //    account's data straight out of the react-query cache.
        queryClient.clear();

        try {
            // 3. Subukang tawagin ang backend sa background
            await api.post('/logout');
        } catch (err) {
            console.warn('Backend logout endpoint skipped or unreachable:', err);
        } finally {
            // 4. In-app navigation, `replace` so Back does not return to a page
            //    that will only bounce straight back here. See the note on
            //    `logoutStarted` for why this is no longer a full page load.
            navigate('/login', { replace: true });
        }
    };

    return (
        <AuthContext.Provider
            value={{ user, login, register, logout, loading, updateUser, refreshUser, checkUser }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);