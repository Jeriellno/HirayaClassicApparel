import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { getAuthToken, clearStoredSession, parseApiError } from '../api/axios';
import { devAdminAutoLogin } from '../utils/devAdminAutoLogin';

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

    /**
     * Verifies the stored token against /api/user on app refresh.
     * SILENTLY keeps cached session during server queue timeouts (ECONNABORTED).
     */
    const checkUser = useCallback(async () => {
        let token = getAuthToken();

        if (!token) {
            /*
             * DEV CONVENIENCE: on the admin console there is no session to
             * restore, so a local auto-login is attempted before giving up.
             * It performs a REAL `/api/login` and stores the token, so the
             * admin API works exactly as after a manual sign-in — the backend
             * gate is not weakened. No-op outside a Vite dev build.
             */
            const devUser = await devAdminAutoLogin(api, persistSession);

            if (devUser) {
                setUser(normalizeUser(devUser));
                setLoading(false);
                return normalizeUser(devUser);
            }

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
     * Signs the customer in.
     */
    const login = async (credentials) => {
        const { remember, ...payload } = credentials || {};

        try {
            const res = await api.post('/login', payload);
            const { token } = res.data || {};
            const userData = normalizeUser(res.data?.user);

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
        // 1. Burahin agad ang local storage para instant UI response
        clearStoredSession();
        setUser(null);

        try {
            // 2. Subukang tawagin ang backend sa background
            await api.post('/logout');
        } catch (err) {
            console.warn('Backend logout endpoint skipped or unreachable:', err);
        } finally {
            // 3. I-force redirect pabalik sa login
            window.location.href = '/login';
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