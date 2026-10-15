import PropTypes from 'prop-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { reloadToLogin } from '../utils/authRedirect';
import { StaffSessionContext } from '../context/StaffSessionContext';
import { supabase, withTimeout } from '../services/supabase';
import {
    getAssuranceLevels,
    isPrivilegedRole,
    isHirayaRole,
    roleOf as supabaseRoleOf,
    fetchAuthoritativeRole,
    wasAal2JustConfirmed,
    signOutSupabase,
} from '../services/supabaseMfa';


// One Supabase session step (read / refresh / role) may take at most this long.
const SESSION_STEP_TIMEOUT_MS = 10000;

export const normalizeRole = (raw) =>
    String(raw || '')
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

const resolveRole = (user) => {
    if (!user || typeof user !== 'object') return '';
    const raw =
        user.app_metadata?.role ??
        user.user_metadata?.role ??
        user.role_name ??
        (Array.isArray(user.roles) ? user.roles[0] : user.roles) ??
        (user.is_admin || user.isAdmin ? 'admin' : '') ??
        (isHirayaRole(user.role) ? user.role : '');
    return normalizeRole(raw);
};

export const resolveSupabaseRole = (user) => supabaseRoleOf(user) || resolveRole(user);

/** True when this browser still holds a Supabase session (sb-<ref>-auth-token). */
export const hasStoredSupabaseSession = () => {
    try {
        return Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key));
    } catch {
        return false;
    }
};

const SessionGate = ({ label }) => (
    <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-[11px] uppercase tracking-[0.35em] text-hiraya-ink">
            {label}
        </div>
    </div>
);

SessionGate.propTypes = {
    label: PropTypes.string.isRequired,
};

/*
 * RECOVERABLE STATE instead of an endless spinner or a bounce to /login.
 * Shown when the session is still stored on this device but could not be
 * CONFIRMED (the sign-in service timed out / the network dropped). Nothing is
 * granted: the console only opens after a successful re-check.
 */
const SessionProblem = ({ onRetry }) => {
    const { beginSignOut } = useAuth();
    const [busy, setBusy] = useState(false);

    // A staff sign-out like the console's: "Signing out..." first, then ONE
    // full page load of /login (see utils/authRedirect.js).
    const signInAgain = async () => {
        setBusy(true);
        beginSignOut();
        try {
            await withTimeout(signOutSupabase(), SESSION_STEP_TIMEOUT_MS);
        } catch {
            /* the local session is cleared by the next sign-in anyway */
        }
        reloadToLogin();
    };

    return (
        <div className="flex min-h-screen items-center justify-center px-6">
            <div role="alert" className="card-raised w-full max-w-md space-y-4 rounded-[24px] p-6 text-center sm:p-8">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink">
                    We couldn&apos;t confirm your staff session
                </p>
                <p className="text-sm leading-relaxed text-hiraya-ink-muted">
                    The sign-in service didn&apos;t respond in time. Your session is still saved on this device —
                    try again, or sign in again if it keeps happening.
                </p>
                <div className="flex flex-col justify-center gap-3 sm:flex-row">
                    <button type="button" onClick={onRetry} disabled={busy} className="btn-primary min-h-[44px] cursor-pointer rounded-full">
                        Try again
                    </button>
                    <button type="button" onClick={signInAgain} disabled={busy} className="btn-secondary min-h-[44px] cursor-pointer rounded-full">
                        Sign in again
                    </button>
                </div>
            </div>
        </div>
    );
};

SessionProblem.propTypes = {
    onRetry: PropTypes.func.isRequired,
};

/*
 * THE LEVEL IS ONLY AN ANSWER FOR THE USER IT WAS LOADED FOR, AND A STALE aal1
 * IS NOT AN ANSWER AT ALL.
 *
 * This used to keep one `{ loading, currentLevel }` and reset it from an effect.
 * The first render has no Supabase user yet, so the effect stored
 * `{ loading: false, currentLevel: null }`. When the user arrived, the guard
 * rendered ONCE before the effect could start the real fetch — it read
 * "not loading, not aal2" and redirected a verified superadmin to /login. The
 * 15-second grace window hid this right after a code was typed, but never on a
 * refresh or a slow role lookup.
 *
 * The result is now stamped with the user id it belongs to, and anything not
 * stamped for the CURRENT user is reported as still loading.
 *
 * The retry below covers the remaining case: GoTrue answers `aal1` from a
 * cached view moments after `mfa.verify()` issued the aal2 token. `getAssurance
 * Levels` already prefers the token's own claim, but if BOTH sources say aal1
 * inside the grace window we ask again rather than acting on the first stale
 * answer — that stale read was the other half of the redirect back to /login.
 */
const useAal = ({ requireAal2, userKey }) => {
    const [state, setState] = useState({ key: null, currentLevel: null, nextLevel: null, error: false });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!requireAal2) return undefined;

        let cancelled = false;

        const read = async () => {
            const levels = await withTimeout(getAssuranceLevels(), SESSION_STEP_TIMEOUT_MS * 2);
            if (cancelled) return;

            if (levels.currentLevel === 'aal1' && wasAal2JustConfirmed()) {
                for (let attempt = 0; attempt < 4; attempt += 1) {
                    await new Promise((resolve) => setTimeout(resolve, 300));
                    if (cancelled) return;
                    const again = await getAssuranceLevels();
                    if (again.currentLevel === 'aal2') {
                        if (!cancelled) {
                            setState({ key: userKey, currentLevel: 'aal2', nextLevel: again.nextLevel, error: false });
                        }
                        return;
                    }
                }
            }

            if (!cancelled) {
                setState({ key: userKey, currentLevel: levels.currentLevel, nextLevel: levels.nextLevel, error: false });
            }
        };

        read().catch((error) => {
            /*
             * getAssuranceLevels already retried; the level could not be READ.
             * That is not the same as "aal1": it used to redirect a verified
             * staff member to /login. Report it as an error the user can retry.
             */
            console.warn('[ProtectedRoute] assurance level check failed:', error?.message);
            if (!cancelled) setState({ key: userKey, currentLevel: null, nextLevel: null, error: true });
        });

        return () => {
            cancelled = true;
        };
    }, [requireAal2, userKey, attempt]);

    const retry = useCallback(() => {
        setState({ key: null, currentLevel: null, nextLevel: null, error: false });
        setAttempt((n) => n + 1);
    }, []);

    if (!requireAal2) return { loading: false, currentLevel: null, nextLevel: null, error: false, retry };
    if (state.key !== userKey) return { loading: true, currentLevel: null, nextLevel: null, error: false, retry };
    return { loading: false, currentLevel: state.currentLevel, nextLevel: state.nextLevel, error: state.error, retry };
};

const useSupabaseIdentity = (enabled) => {
    const [state, setState] = useState({ loading: enabled, user: null, role: '', error: false });
    const userIdRef = useRef(null);

    const load = useCallback(async () => {
        setState((current) => ({ ...current, loading: true, error: false }));
        try {
            // A transient failure (a token refresh racing a page reload) is
            // retried before it can be read as "signed out".
            let data = null;
            let lastError = null;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
                const result = await withTimeout(supabase.auth.getSession(), SESSION_STEP_TIMEOUT_MS);
                if (!result.error) {
                    data = result.data;
                    lastError = null;
                    break;
                }
                lastError = result.error;
            }
            if (lastError) throw lastError;

            /*
             * A SESSION THAT IS BRIEFLY ABSENT IS NOT "SIGNED OUT".
             * -----------------------------------------------
             * `getSession()` reads from local storage and revalidates with GoTrue.
             * Right after `mfa.verify()` the client rewrites the session (and
             * `verifyMfaChallenge` explicitly calls `refreshSession()`), so a read
             * that lands inside that window can come back with no session at all.
             *
             * This used to report `user: null` on that one read, which is
             * indistinguishable from a real sign-out — and the guard's answer to
             * `user: null` is `<Navigate to="/login" replace />`. That is the
             * bounce: a superadmin who had just paid for a 6-digit code was sent
             * back to the form that asks for one, with nothing on screen saying
             * why, and typing the password again reproduced it forever.
             *
             * So a missing session is only believed after a second look. Inside
             * the aal2 grace window — the same window that says a code was just
             * accepted — we retry briefly and keep showing the "Verifying
             * Session..." gate instead of redirecting. The user stays on a spinner
             * for a moment rather than being logged out; a genuine sign-out never
             * reaches this path because sign-out clears the window first
             * (`signOutSupabase` calls `__resetAal2Grace`).
             */
            let user = data?.session?.user ?? null;

            // Also after a page reload: the grace window is in-memory and resets,
            // but a session still in storage is mid-refresh, not signed out.
            if (!user && (wasAal2JustConfirmed() || hasStoredSupabaseSession())) {
                for (let attempt = 0; attempt < 6 && !user; attempt += 1) {
                    await new Promise((resolve) => setTimeout(resolve, 250));
                    const retry = await withTimeout(supabase.auth.getSession(), SESSION_STEP_TIMEOUT_MS);
                    user = retry?.data?.session?.user ?? null;
                }
            }

            /*
             * THE ROLE LOOKUP MUST NOT BE ABLE TO DESTROY THE SESSION.
             * ------------------------------------------------------
             * This used to be one try block covering BOTH the session read and
             * the role lookup, so a failure in the SECOND step — a network blip,
             * a RLS refusal, or the ReferenceError that lived inside
             * `fetchAuthoritativeRole` — fell into the same catch and set
             * `user: null`.
             *
             * That produced a bounce loop with no error message anywhere: the
             * staff member had a valid aal2 session and a freshly accepted 6-digit
             * code, but the guard read them as signed out and sent them back to
             * /login, which asked for the code they had just paid for.
             *
             * A missing role is recoverable — it only costs a redirect to
             * `forbiddenRedirect` — so it is read separately and degrades on its
             * own. Only a failure to establish WHO the user is may report nobody.
             */
            let role = '';
            if (user) {
                try {
                    role = await withTimeout(fetchAuthoritativeRole(user), SESSION_STEP_TIMEOUT_MS);
                } catch (lookupError) {
                    console.warn('[ProtectedRoute] role lookup failed:', lookupError);
                }

                /*
                 * A ROLE THAT DISAPPEARED IS NOT THE SAME AS "NOT AN ADMIN".
                 *
                 * `fetchAuthoritativeRole` reads the `users` table, and that read is
                 * behind RLS. If the read is refused or returns nothing, the fallback
                 * is the JWT's own claims — and Supabase writes NO `app_metadata.role`
                 * for these accounts (see the comment in supabaseMfa.js), so the
                 * honest answer comes back as ''.
                 *
                 * '' then failed the `allowedRoles` check, and the guard sent the
                 * staff member to `forbiddenRedirect`. For an admin that is the
                 * second bounce in the same sign-in: not aal2, then not privileged.
                 *
                 * A role that is missing while the session IS aal2 is therefore
                 * treated as an unresolved read, not a denial: keep waiting for the
                 * authoritative value rather than deciding the worst thing on a
                 * failed lookup. This grants nothing — RLS still refuses every query,
                 * and the backend still refuses every aal1 request. It only stops a
                 * transient read from being answered with a redirect.
                 */
                if (!role) {
                    for (let attempt = 0; attempt < 4 && !role; attempt += 1) {
                        await new Promise((resolve) => setTimeout(resolve, 300));
                        try {
                            role = await withTimeout(fetchAuthoritativeRole(user), SESSION_STEP_TIMEOUT_MS);
                        } catch {
                            /* keep waiting; the loop bound ends it */
                        }
                    }
                }
            }

            userIdRef.current = user?.id ?? null;
            setState({ loading: false, user, role, error: false });
        } catch (error) {
            /*
             * COULD NOT CONFIRM != SIGNED OUT.
             * A timeout / network failure while a session is still stored on
             * this device used to be answered with `user: null` — a redirect to
             * /login for a staff member whose session was fine. It is now an
             * error state with a retry. No stored session = genuinely signed out.
             */
            console.warn('[ProtectedRoute] session check failed:', error?.message);
            userIdRef.current = null;
            setState({ loading: false, user: null, role: '', error: hasStoredSupabaseSession() });
        }
    }, []);

    useEffect(() => {
        if (enabled) load();
    }, [enabled, load]);

    /*
     * FOLLOW SIGN-IN / SIGN-OUT, INCLUDING FROM OTHER TABS.
     * The check above ran once on mount, so a sign-out (or a different staff
     * member signing in) in another tab left this guard holding a stale
     * answer. Supabase broadcasts those events across tabs; react to them.
     * The re-check is deferred out of the callback, as Supabase recommends.
     */
    useEffect(() => {
        if (!enabled) return undefined;
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                userIdRef.current = null;
                setState({ loading: false, user: null, role: '', error: false });
            } else if (event === 'SIGNED_IN' && session?.user?.id && session.user.id !== userIdRef.current) {
                setTimeout(load, 0);
            }
        });
        return () => data?.subscription?.unsubscribe();
    }, [enabled, load]);

    return { ...state, retry: load };
};

const ProtectedRoute = ({
    children,
    requiredRole,
    allowedRoles,
    requireAal2 = false,
    verifyRedirect = '/login',
    loginRedirect = '/login',
    forbiddenRedirect = '/home',
    unauthorizedRedirect = '/login',
}) => {
    const { user, loading } = useAuth();
    const location = useLocation();
    // Only the console (requireAal2) reads the Supabase session at all.
    const supabaseIdentity = useSupabaseIdentity(requireAal2);

    const identity = requireAal2
        ? { user: supabaseIdentity.user, loading: supabaseIdentity.loading }
        : { user, loading };

    const aal = useAal({
        requireAal2: requireAal2 && Boolean(identity.user),
        userKey: identity.user?.id ?? null,
    });

    // 1. Session Loading State
    if (identity.loading) return <SessionGate label="Verifying Session..." />;

    // 1b. Stored session that could not be confirmed: recoverable, not a redirect.
    if (requireAal2 && supabaseIdentity.error) return <SessionProblem onRetry={supabaseIdentity.retry} />;

    // 2. Unauthenticated check
    if (!identity.user) {
        return (
            <Navigate
                to={requireAal2 ? loginRedirect : unauthorizedRedirect}
                replace
                state={{ from: location.pathname }}
            />
        );
    }

    // 3. Role Authorization check
    const required = allowedRoles
        ? allowedRoles.map(normalizeRole)
        : requiredRole
            ? [normalizeRole(requiredRole)]
            : null;

    if (required && required.length > 0) {
        const role = requireAal2
            ? supabaseIdentity.role || resolveRole(identity.user)
            : resolveRole(identity.user);

        const satisfied =
            required.includes(role) || (role === 'superadmin' && required.includes('admin'));

        if (!satisfied) return <Navigate to={forbiddenRedirect} replace />;
    }

    /*
     * 4. AAL2 Verification check.
     *
     * The aal1 -> aal2 ELEVATION NOW HAPPENS INSIDE /login, NOT ON ITS OWN ROUTE.
     *
     * `verifyRedirect` used to point at `/admin/verify-2fa`, a separate screen that
     * existed only so a staff member arriving some other way (bookmark, refresh
     * mid-challenge) could answer a code. With one login form that state is a
     * `step` inside it, so a console route that is not yet aal2 belongs back at
     * the sign-in form — the only place a challenge can be opened and the only
     * place the password can be re-checked. `from` is carried so a completed
     * sign-in returns here rather than to the role's default landing page.
     */
    const effectiveRole = requireAal2
        ? supabaseIdentity.role || resolveRole(identity.user)
        : resolveRole(identity.user);
    const needsAal2 = requireAal2 && isPrivilegedRole(effectiveRole);

    if (needsAal2) {
        if (aal.loading) return <SessionGate label="Verifying Second Factor..." />;
        if (aal.error) return <SessionProblem onRetry={aal.retry} />;

        const isAal2 = aal.currentLevel === 'aal2' || wasAal2JustConfirmed();

        if (!isAal2 && location.pathname !== verifyRedirect) {
            return (
                <Navigate
                    to={verifyRedirect}
                    replace
                    state={{ from: location.pathname }}
                />
            );
        }
    }

    const content = children ?? <Outlet />;
    return requireAal2
        ? <StaffSessionContext.Provider value={{ role: effectiveRole }}>{content}</StaffSessionContext.Provider>
        : content;
};

ProtectedRoute.propTypes = {
    children: PropTypes.node,
    requiredRole: PropTypes.string,
    allowedRoles: PropTypes.arrayOf(PropTypes.string),
    requireAal2: PropTypes.bool,
    verifyRedirect: PropTypes.string,
    loginRedirect: PropTypes.string,
    forbiddenRedirect: PropTypes.string,
    unauthorizedRedirect: PropTypes.string,
};

export default ProtectedRoute;  