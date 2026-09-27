import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Normalizes any role value the API may hand us into a comparable token:
 *   'Admin' | 'ROLE_ADMIN' | 'super_admin' | 'super-admin'  -> 'admin' / 'superadmin'
 *
 * The backend stores a plain VARCHAR role ('user' | 'admin'), but being
 * tolerant here means a future `super_admin` (or an `is_admin` boolean) can
 * never silently lock a valid admin out of the console.
 */
export const normalizeRole = (raw) =>
    String(raw || '')
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

/**
 * TEMPORARY ADMIN ACCESS SWITCH — ⚠️ DEVELOPMENT ONLY ⚠️
 *
 * When `true`, every admin/superadmin gate short-circuits to allow access, so
 * http://localhost:5173/admin loads the console with NO login and NO role
 * check. It ONLY unlocks the UI shell — the backend still gates /api/admin/*
 * with `auth:sanctum` + `admin`, so while the bypass is on the console comes up
 * looking healthy and every request silently 401s (no token is attached).
 *
 * WHY THIS IS `false` (was `true` — that is what broke "Add New Garment").
 *
 * With the bypass ON, /admin renders its whole UI shell with NO login and NO
 * token, but every call it then makes still hits the backend, which DOES gate
 * /api/admin/* with `auth:sanctum` + `admin` (routes/api.php). With no token
 * attached, the console comes up looking perfectly healthy and every request
 * quietly fails:
 *
 *   GET  /api/admin/orders                -> 401 Unauthenticated
 *   POST /api/admin/products/analyze-image -> 401 Unauthenticated
 *
 * That is the reported symptom: the admin "Add New Garment" modal opens and
 * the AI auto-fill (analyze-image) / background cut-out never runs, so the
 * product keeps the ORIGINAL photo. The UI gate was lifted, the API gate was
 * not — the two disagreed.
 *
 * `false` re-arms the strict `role === 'admin'` / `role === 'superadmin'` check
 * and the signed-out -> /login redirect, so the console is only ever reachable
 * WITH a real session token — the same one the API demands. Set to `true` ONLY
 * when you deliberately want an unauthenticated shell for pure UI work (the
 * API calls will 401 while it is on).
 *
 * ⚠️ CURRENTLY `true` — DEVELOPER REQUEST.
 *
 * It was set to `true` so that http://localhost:5173/admin and /superadmin open
 * straight from the URL bar WITHOUT a login, on request (the strict gate was
 * blocking local access to the console).
 *
 * NO MORE 401s (temporary): the backend token gate on the Super Admin console
 * routes was ALSO removed for development (see hiraya-backend/routes/api.php),
 * so /api/admin/* now answers without a bearer token. The console is fully
 * usable from the URL bar with no login.
 *
 * RESTORE TOGETHER: set this back to `false` AND re-add
 * ->middleware(['auth:sanctum', 'superadmin']) on the admin groups in
 * routes/api.php before shipping.
 *
 * SET BACK TO `false` BEFORE SHIPPING. This is a local-development affordance and
 * must not reach production, where it would expose the admin shell to anyone who
 * guesses the URL.
 */
export const BYPASS_ADMIN_AUTH = true;

/** Reads the effective role from every shape login may return. */
const resolveRole = (user) => {
    if (!user || typeof user !== 'object') return '';
    const raw =
        user.role ??
        user.role_name ??
        (Array.isArray(user.roles) ? user.roles[0] : user.roles) ??
        (user.is_admin || user.isAdmin ? 'admin' : '');
    return normalizeRole(raw);
};

/** Full-screen Gold & Black gate shown while the session is being verified. */
const SessionGate = ({ label }) => (
    <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="animate-pulse text-[11px] uppercase tracking-[0.35em] text-hiraya-ink">
            {label}
        </div>
    </div>
);

/**
 * ProtectedRoute — route authorization primitive.
 *
 * Supports three modes:
 *   - Unauthenticated guard:   <ProtectedRoute /> or <ProtectedRoute><Page/></ProtectedRoute>
 *   - Role guard:              <ProtectedRoute requiredRole="admin" />
 *   - Role list guard:         <ProtectedRoute allowedRoles={['admin', 'superadmin']} />
 *
 * When used as a layout route (the recommended pattern for admin trees) it
 * renders an <Outlet/>; when given `children` it renders those instead, so the
 * existing inline-wrapped routes keep working unchanged.
 *
 * `forbiddenRedirect` controls where a signed-in-but-unauthorized user lands
 * (defaults to /shop, per the shared-gateway role-routing model).
 */
const ProtectedRoute = ({
    children,
    requiredRole,
    allowedRoles,
    forbiddenRedirect = '/shop',
    unauthorizedRedirect = '/login',
}) => {
    const { user, loading } = useAuth();
    const location = useLocation();

    // 0. TEMPORARY ADMIN BYPASS — when enabled, ANY role-gated route renders
    //    its children immediately, regardless of session or role. This is what
    //    lets /admin and /superadmin load straight from the URL bar.
    //    Remove this block (or set BYPASS_ADMIN_AUTH = false) to re-arm the
    //    auth + role gates below.
    const isRoleGated = Boolean(requiredRole) || Boolean(allowedRoles?.length);
    if (BYPASS_ADMIN_AUTH && isRoleGated) {
        return children ?? <Outlet />;
    }

    // 1. Session still resolving — never make an access decision yet.
    if (loading) return <SessionGate label="Verifying Session..." />;

    // 2. Not signed in — bounce to login, remembering where they wanted to go.
    if (!user) {
        return <Navigate to={unauthorizedRedirect} replace state={{ from: location.pathname }} />;
    }

    // 3. Role gate. Both props are accepted; `allowedRoles` wins if provided.
    const required = allowedRoles
        ? allowedRoles.map(normalizeRole)
        : requiredRole
            ? [normalizeRole(requiredRole)]
            : null;

    if (required && required.length > 0) {
        const role = resolveRole(user);

        // superadmin implicitly satisfies an 'admin' requirement.
        const satisfied =
            required.includes(role) || (role === 'superadmin' && required.includes('admin'));

        if (!satisfied) return <Navigate to={forbiddenRedirect} replace />;
    }

    return children ?? <Outlet />;
};

/**
 * AdminRoute — the pre-wired admin gate used by every /admin/* route.
 *
 * It is a thin, opinionated wrapper around ProtectedRoute so the routing table
 * never has to repeat the policy:
 *   - signed out  -> /login   (remembering where they were headed)
 *   - signed in but not admin/superadmin -> /shop (never a blank screen)
 *
 * `allowedRoles` is fixed here deliberately: admin-only surfaces should not be
 * able to weaken the rule by passing different props at the call site.
 */
export const AdminRoute = ({ children }) => (
    <ProtectedRoute allowedRoles={['admin', 'superadmin']} forbiddenRedirect="/shop">
        {children}
    </ProtectedRoute>
);

export default ProtectedRoute;
