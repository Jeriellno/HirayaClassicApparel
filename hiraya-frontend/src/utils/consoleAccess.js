/**
 * WHO GOES WHERE, AND WHO MAY SEE WHICH PART OF THE CONSOLE.
 *
 * THIS IS THE WHOLE THREE-ROLE LOGIC, IN ONE FILE.
 * -------------------------------------------------------------------------
 * Hiraya has exactly ONE sign-in form (`/login`) for all three roles. What the
 * form does after the password is verified depends on the ROLE, and the role is
 * the only input to that decision:
 *
 *     superadmin  ->  6-digit TOTP  ->  /superadmin  (full console)
 *     admin       ->  6-digit TOTP  ->  /superadmin  (two sections only)
 *     user        ->  no second factor  ->  /home
 *
 * So this file answers two questions, and it is the only place that does:
 *
 *   roleHome()          where does this role land after signing in?
 *   SECTIONS_BY_ROLE    once they are inside, what may they open?
 *
 * Whether a role owes a second factor is NOT decided here: that is answered by
 * the backend in its `/login` response (`mfa_required`), because only the server
 * can know whether this account actually has an authenticator enrolled. The
 * client follows the answer rather than re-deriving it.
 *
 * The old design had two doors (`/login` for customers, `/admin/login` for
 * staff) and two consoles (`/admin` rendering MainDashboard, `/superadmin`
 * rendering the real one) — four moving parts to keep in agreement, and no
 * single place where a role's reach was written down. That is what this file
 * replaces.
 *
 * THE POLICY
 * ----------
 *   admin       — the day-to-day work: the catalogue it sells from, and the
 *                 orders that come out of it. Nothing else.
 *   superadmin  — the whole system, including the surfaces that change
 *                 global state (settings, audit trail, exports) and the ones
 *                 that provision other admins.
 *
 * This is AUTHORIZATION, not authentication. It presumes the caller is ALREADY
 * known and correctly identified; it only decides what that identity may reach.
 * Deciding *who* they are is the login/QR flow's job.
 *
 * HOW IT IS ENFORCED
 * ------------------
 * This map hides sections. It is not the security boundary — the backend is.
 * Every endpoint in here is independently gated by `admin` or `superadmin`
 * middleware server-side, so a determined admin who hand-edits the frontend to
 * reveal a hidden tab gets 403s from the API, not data. Hiding is for honesty
 * (don't offer what cannot be used); the middleware is the lock.
 *
 * `resolveSection` is what makes the restriction ENFORCED rather than merely
 * displayed: it is not just the sidebar that filters, the tab body is resolved
 * through the same allow-list, so a hand-edited url naming a superadmin-only
 * section lands on the first permitted one instead of rendering it.
 */

/** Every section id in the console, in sidebar order. */
export const ALL_SECTIONS = [
    'dashboard',
    'inventory',
    'orders',
    'customers',
    'feedback',
    'admins',
    'audit-logs',
    'settings',
    'manual',
    'support',
];

/**
 * SECTIONS THAT ARE NOW SUB-TABS OF ANOTHER SECTION.
 *
 * `api-status` + `api-keys` were two sidebar rows about the same subject (the
 * external keys), and `analytics` was a general-overview screen sitting apart
 * from the other general-overview screen (the Dashboard). Both pairs collapse:
 *
 *     api-status  ->  api        (sub-tab 'status')
 *     api-keys    ->  api        (sub-tab 'keys')
 *     analytics   ->  dashboard  (sub-tab 'analytics')
 *
 * THE IDS ARE KEPT AS ALIASES RATHER THAN DELETED, AND THAT IS THE POINT. A tab
 * id is reachable from three directions that a rename would silently break:
 *
 *   1. `resolveSection` — the allow-list check, which would fall back to the
 *      first permitted section and land a returning visitor on the wrong screen;
 *   2. a section resolved from a stale link or an in-app `setActiveTab` call;
 *   3. anything persisted or bookmarked as `activeTab === 'api-keys'`.
 *
 * Resolving the old id to its new HOME means every one of those still works, and
 * it costs one lookup. A section removed outright would have to fail closed
 * instead, which is the correct behaviour for an unknown id but wrong for one
 * that simply moved.
 */
export const SECTION_ALIASES = {
    'analytics': 'dashboard',
    // "Today's Work" was folded into the Dashboard's work-queue card.
    'overview': 'dashboard',
    // Stock History is now a sub-tab of Audit Logs.
    'stock-history': 'audit-logs',
};

/** The sub-tab an aliased section should OPEN ON, so 'api-keys' lands on Keys. */
export const ALIASED_SUBTAB = {
    'analytics': 'analytics',
    'stock-history': 'stock',
};

/** Resolves a possibly-stale section id to the section that now hosts it. */
export const resolveSectionAlias = (sectionId) =>
    SECTION_ALIASES[sectionId] ?? sectionId;

/**
 * Section ids each role may open.
 *
 * `admin` is deliberately two entries and not "everything except the scary
 * bits": an explicit allow-list means a section added later is invisible to an
 * ordinary admin by default, rather than appearing because someone forgot to
 * think about it. Deny-lists leak silently; allow-lists fail closed.
 */
export const SECTIONS_BY_ROLE = {
    /*
     * Staff run the shop floor: the analytics dashboard (with its work queue),
     * the catalogue, orders, customers and their feedback, plus the User
     * Manual and Contact Support.
     *
     * `audit-logs` opens for an admin in a LIMITED form (customer-area rows,
     * masked). Customers, Admin Management and System Settings are
     * superadmin-only.
     */
    // Customer Management was REMOVED from the Admin panel (superadmin only;
    // the API refuses admins too). Inventory stays, but read/stock-only for an
    // admin — Add / Edit / Delete Product are superadmin-only (UI + API).
    admin: ['dashboard', 'inventory', 'orders', 'feedback', 'audit-logs', 'manual', 'support'],
    superadmin: ALL_SECTIONS,
};

/** Normalizes any role spelling into `admin` / `superadmin`, or '' if neither. */
export const normalizeRole = (raw) => {
    const token = String(raw || '')
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

    if (token === 'admin') return 'admin';
    if (token === 'superadmin') return 'superadmin';
    return '';
};

/**
 * The console role for a SIGNED-IN USER, defaulting to the most restrictive when
 * unknown.
 *
 * This takes the whole user object, not a role string. It is a one-argument
 * function and the name says what the argument is, which is exactly why it was
 * worth pinning down: a caller that already had the role in hand and passed
 * `resolveConsoleRole(user.role)` got `undefined` back, because the function
 * then went looking for `.role` on that string. Silent, and it emptied the
 * sidebar for a correctly-authenticated superadmin.
 */
export const resolveConsoleRole = (user) => normalizeRole(user?.role ?? user?.role_name);

/** Section ids available to a role. Unknown roles get nothing. */
export const sectionsForRole = (role) => SECTIONS_BY_ROLE[normalizeRole(role)] ?? [];

/** May this role open this section? */
export const canAccessSection = (role, sectionId) =>
    sectionsForRole(role).includes(sectionId);

/**
 * The section a role should actually be ON, given what it asked for.
 *
 * A role is only ever shown sections it may open, so an id it cannot reach is
 * either a stale link or a hand-edited url. Falling back to the FIRST permitted
 * section keeps the console on a real screen instead of a blank one.
 */
export const resolveSection = (role, requested) => {
    const allowed = sectionsForRole(role);
    /*
     * RESOLVE THE ALIAS BEFORE THE ALLOW-LIST TEST, not after.
     *
     * `api-keys` is no longer in the allow-list (it is part of `api`), so
     * testing it first would reject a perfectly valid old id and bounce the
     * visitor to the first section instead of the one they asked for. Mapping it
     * to `api` first means the allow-list still decides — and a customer, who
     * may open neither, is still refused.
     */
    const target = resolveSectionAlias(requested);
    if (allowed.includes(target)) return target;
    return allowed[0] ?? null;
};

/**
 * WHERE A SIGNED-IN USER BELONGS — the post-login destination for a role.
 *
 * THE SINGLE SOURCE OF TRUTH FOR "WHERE DOES THIS ROLE GO".
 *
 *   superadmin -> /superadmin   the full console
 *   admin      -> /superadmin   the same console, fewer sections
 *   anyone else -> /home        the storefront landing page
 *
 * BOTH ADMIN ROLES LAND ON `/superadmin` DELIBERATELY. They are one application:
 * what differs is which sections the sidebar offers, not which app loads.
 * Splitting them onto different URLs would only recreate the two-admin-surfaces
 * problem this file exists to end.
 *
 * This used to be written twice — once in Login.jsx and once inline in App.jsx's
 * GuestRoute — and the two copies disagreed. Both now call this.
 *
 * @param {object|null} user  the authenticated user (or just a role string)
 */
export const roleHome = (user) => {
    const role = normalizeRole(
        typeof user === 'string' ? user : user?.role ?? user?.role_name,
    );

    if (role === 'admin' || role === 'superadmin') return '/superadmin';
    return '/home';
};
