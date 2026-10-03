import { Fragment, useState } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import {
  LayoutDashboard,
  Shirt,
  Package,
  MessageSquare,
  Sliders,
  Users,
  UserCog,
  History,
  LogOut,
  Menu,
  X,
  BookOpen,
  LifeBuoy,
  KeyRound,
} from 'lucide-react';
import ChangePasswordForm from './ChangePasswordForm';
import logoImg from '../../assets/logo.png';


/*
 * "Canvas Assets" and "AI Stylist Config" were REMOVED.
 *
 * Both were write-only subsystems: their tables (canvas_assets, ai_rules) had a
 * controller that stored rows and no reader anywhere in the application. The
 * try-on pipeline never consulted either, so uploading a cutout or building a
 * pairing rule changed nothing a customer would ever see. A control that looks
 * live but is inert is worse than no control at all, so the tabs — and their
 * backend — are gone rather than left in place as decoration.
 *
 * "Orders" and "Customers" REPLACED them: real surfaces the highest-privilege
 * role needs and previously had no access to at all.
 *
 * A plain admin sees only two of these (Inventory, Orders) — both in MAIN — so
 * the grouping is invisible to them; the sidebar simply has one heading.
 * `navLinks` is filtered BEFORE grouping (see SuperAdmin.jsx), so an empty group
 * never renders its heading.
 */
/*
 * GROUPED BY HOW OFTEN A SECTION IS ACTUALLY USED — not alphabetically, and not
 * by the order the features happened to be built. MAIN is the console's working
 * week, ANALYTICS is what you check on it, ENGAGEMENT is the inbox, and
 * ADMINISTRATION is the surface that changes the system itself. A section's
 * group is declared ON the section, so there is one place to move a tab between
 * groups and no second list to keep in step.
 */
export const superAdminNavLinks = [
  { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, group: 'MAIN' },
  { id: 'inventory', name: 'Inventory Management', icon: Shirt, group: 'MAIN' },
  { id: 'orders', name: 'Orders Management', icon: Package, group: 'MAIN' },
  { id: 'customers', name: 'Customers Management', icon: Users, group: 'MAIN' },
  { id: 'feedback', name: 'Product Reviews', icon: MessageSquare, group: 'MAIN' },
  { id: 'admins', name: 'Admin Management', icon: UserCog, group: 'ADMINISTRATION' },
  { id: 'audit-logs', name: 'Audit Logs', icon: History, group: 'ADMINISTRATION' },
  { id: 'settings', name: 'System Settings', icon: Sliders, group: 'ADMINISTRATION' },
  { id: 'manual', name: 'User Manual', icon: BookOpen, group: 'HELP' },
  { id: 'support', name: 'Contact Support', icon: LifeBuoy, group: 'HELP' },
];

/**
 * SUB-TABS — the second level inside a section.
 *
 * "API & AI Status" and "API Key Manager" are two views of ONE subject: the
 * external keys the platform depends on. One row that lands on a Status view
 * with a Keys tab beside it shows the answer to "how are the keys" and the door
 * to "change one" in the same glance. Both hit endpoints in the SAME backend
 * middleware group, so this merges two screens that were already one privilege.
 *
 * `analytics` is NOT listed here: Canvas Analytics folds into the Dashboard as
 * the 'analytics' sub-tab.
 */
export const SECTION_SUBTABS = {
  // Stock changes are an audit trail too: they live under Audit Logs.
  'audit-logs': [
    { id: 'activity', name: 'Activity Log' },
    { id: 'stock', name: 'Stock History' },
  ],
};

/*
 * Sub-tabs a ROLE is offered. The Admin console keeps Audit Logs > Stock History
 * only: the Activity Log panel is a Super Admin view. (Audit logging itself and
 * its stored history are unchanged — this only decides what is shown.)
 */
const SUBTABS_HIDDEN_FOR_ROLE = {
  admin: { 'audit-logs': ['activity'] },
};

export const subtabsFor = (section, role) => {
  const hidden = SUBTABS_HIDDEN_FOR_ROLE[role]?.[section] || [];
  return (SECTION_SUBTABS[section] || []).filter((sub) => !hidden.includes(sub.id));
};

/** The group headings and their order. */
export const NAV_GROUPS = ['MAIN', 'ADMINISTRATION', 'HELP'];

/** HOW MANY SECTIONS EACH ROLE IS OFFERED — shown next to the console title. */
const ROLE_LABEL = {
  admin: 'Admin Level',
  superadmin: 'Super Admin Level',
};

/*
 * ============================================================================
 * THE CONSOLE FRAME — "Vintage Atelier", neumorphic
 * ============================================================================
 *
 *   SIDEBAR   a floating navy panel lifted off the page on the dark
 *             neumorphic light; the active section is a cream pill that
 *             glides between rows (a shared layoutId). Below `md` it becomes a
 *             drawer behind a menu button instead of covering the content.
 *   HEADER    a floating frosted-cream bar: title, live badge, role, exit.
 *   GROUND    the cream canvas with a soft ambient glow — a navy wash at the
 *             top-left, a warm cream light at the top-right, a slate haze at
 *             the foot — so the raised panels have light to sit in.
 *
 * Presentation only: the nav data, the grouping, the sub-tab rules and every
 * callback are exactly the ones this layout has always received.
 */
const SuperadminLayout = ({
  activeTab,
  setActiveTab,
  onLogout,
  role = 'superadmin',
  navLinks = superAdminNavLinks,
  activeSubTab,
  setActiveSubTab,
  canSignOut = true,
  headerExtra = null,
  children,
}) => {
  // Mobile drawer — pure UI state.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  /*
   * RENDER THE SIDEBAR AS GROUPS OF SECTIONS.
   *
   * `navLinks` arrives ALREADY FILTERED by role (see SuperAdmin.jsx). Grouping
   * happens here, after the filter, so an empty group never produces a heading.
   * A link with no group joins "UNGROUPED" (never an invented "MAIN"), so a
   * forgotten `group` is a visible label rather than a silently mis-sorted row.
   */
  const groupedNav = navLinks.reduce((groups, link) => {
    const key = link.group || 'UNGROUPED';
    const existing = groups.find((g) => g.key === key);

    if (existing) {
      existing.items.push(link);
    } else {
      groups.push({ key, items: [link] });
    }

    return groups;
  }, []);

  // Declared order first; any group discovered outside NAV_GROUPS goes last.
  const ORDER = [...NAV_GROUPS].reduce((acc, key, index) => ({ ...acc, [key]: index }), {});
  groupedNav.sort((a, b) => (ORDER[a.key] ?? 99) - (ORDER[b.key] ?? 99));

  const subtabs = subtabsFor(activeTab, role);

  /*
   * WHICH GROUP OWNS THE ACTIVE SECTION — the ONLY group allowed to show its
   * sub-tabs, so they are never repeated under every heading.
   */
  const activeNavEntry = navLinks.find((link) => link.id === activeTab);

  const chooseSection = (id) => {
    setActiveTab(id);
    setDrawerOpen(false);
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="relative min-h-screen font-sans text-hiraya-ink">
      {/* THE GROUND — cream canvas with an ambient glow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-cream-100 bg-[radial-gradient(55%_45%_at_18%_0%,rgba(29,44,69,0.12),transparent_70%),radial-gradient(40%_40%_at_100%_12%,rgba(211,192,156,0.35),transparent_70%),radial-gradient(55%_45%_at_60%_105%,rgba(67,65,62,0.10),transparent_70%)]"
      />

      {/* Mobile scrim behind the open drawer. */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 cursor-default bg-navy-950/40 backdrop-blur-sm md:hidden"
          />
        )}
      </AnimatePresence>

      {/* ---- SIDEBAR — a floating navy panel ---- */}
      <aside
        className={`theme-locked fixed inset-y-3 left-3 z-50 flex w-64 flex-col overflow-hidden rounded-[26px] bg-[linear-gradient(180deg,#1D2C45_0%,#152036_42%,#0D1524_100%)] text-cream-100 shadow-[10px_14px_34px_-10px_rgba(13,21,36,0.65),-6px_-6px_16px_rgba(255,255,255,0.6)] ring-1 ring-cream-50/10 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1.5rem)]'
        }`}
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full border border-cream-50/[0.07]" />
        <div aria-hidden="true" className="vintage-grain pointer-events-none absolute inset-0 opacity-25 mix-blend-soft-light" />

        {/* Brand block */}
        <div className="relative flex items-center gap-3 px-5 pb-5 pt-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cream-50/10 shadow-[inset_0_1px_0_rgba(247,242,231,0.12)]">
            <img src={logoImg} alt="" className="h-8 w-8 object-contain" />
          </span>
          <div className="min-w-0">
            <p className="font-serif text-lg font-semibold leading-none tracking-[0.1em]">HIRAYA</p>
            <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.24em] text-cream-400">
              {navLinks.length === superAdminNavLinks.length ? 'Control Panel' : 'Your Sections'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-cream-300 hover:bg-cream-50/10 hover:text-cream-50 md:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative mx-5 h-px bg-cream-50/10" />

        {/* Groups */}
        <nav aria-label="Console sections" className="relative flex-1 space-y-5 overflow-y-auto px-3 py-5 scrollbar-none">
          {groupedNav.map((group) => (
            <div key={group.key}>
              <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-cream-400/80">
                {group.key}
              </p>
              <div className="flex flex-col gap-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <Fragment key={item.id}>
                    <button
                      onClick={() => chooseSection(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`group relative flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[12px] font-medium transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100/60 ${
                        isActive ? 'text-navy-950' : 'text-cream-300 hover:bg-cream-50/[0.06] hover:text-cream-50'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="console-nav-pill"
                          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                          className="absolute inset-0 rounded-2xl bg-cream-100 shadow-[0_10px_22px_-10px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.8)]"
                        />
                      )}
                      <span
                        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 ${
                          isActive ? 'bg-navy-900 text-cream-100' : 'bg-cream-50/[0.06] text-cream-300 group-hover:text-cream-50'
                        }`}
                      >
                        <Icon size={15} />
                      </span>
                      <span className="relative truncate">{item.name}</span>
                    </button>
                {isActive && subtabs.length > 0 && (
                    <div className="mb-1 ml-7 mt-1 flex flex-col gap-0.5 border-l border-cream-50/15 pl-3">
                      {subtabs.map((sub) => {
                        const isSubActive = activeSubTab === sub.id;
                        return (
                          <button
                            key={sub.id}
                            onClick={() => setActiveSubTab?.(sub.id)}
                            aria-current={isSubActive ? 'page' : undefined}
                            className={`w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                              isSubActive
                                ? 'bg-cream-50/10 font-semibold text-cream-50'
                                : 'text-cream-400 hover:text-cream-50'
                            }`}
                          >
                            {sub.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                    </Fragment>
                  );
                })}

                {/*
                  * THE SECOND LEVEL — only under the ACTIVE section, and only in
                  * the group that section belongs to (the group guard is what
                  * stops the sub-tabs repeating under every heading).
                  */}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — the role, pressed into the panel. */}
        <div className="relative m-3 rounded-2xl bg-navy-950/60 px-4 py-3 shadow-[inset_2px_2px_6px_rgba(0,0,0,0.45),inset_-2px_-2px_6px_rgba(54,74,106,0.18)]">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-cream-400">Signed in at</p>
          <p className="mt-0.5 text-[11px] font-semibold text-cream-100">{ROLE_LABEL[role] ?? 'Admin Level'}</p>
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="mt-2 flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cream-300 hover:text-cream-50"
          >
            <KeyRound size={11} /> Change password
          </button>
        </div>
      </aside>

      {/* ---- HEADER — a floating frosted bar ---- */}
      <header className="fixed left-3 right-3 top-3 z-30 flex items-center justify-between gap-3 rounded-[22px] bg-cream-50/75 px-4 py-3 shadow-glass ring-1 ring-cream-50/80 backdrop-blur-xl sm:px-6 md:left-[calc(16rem+1.5rem)]">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="btn-icon h-10 w-10 shrink-0 rounded-full md:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate font-serif text-sm uppercase tracking-[0.12em] text-navy-900 sm:text-base">
                {activeNavEntry?.name ?? 'Control Panel'}
              </h1>
            </div>
            <span className="mt-0.5 inline-block text-[9px] font-medium uppercase tracking-[0.14em] text-charcoal-500">
              {ROLE_LABEL[role] ?? 'Admin Level'}
            </span>
          </div>
        </div>

        {/*
         * "Exit Console" CLOSES THE SUPABASE SESSION. /admin is behind
         * ProtectedRoute (staff role + aal2), so every user of this layout IS
         * signed in and must be able to sign out.
         */}
        <div className="flex shrink-0 items-center gap-2">
        {headerExtra}
        {canSignOut && (
          <button
            onClick={onLogout}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-red-600/30 bg-red-500/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-700 transition-colors hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600/50"
          >
            <LogOut size={14} /> <span className="hidden sm:inline">Exit Console</span>
          </button>
        )}
        </div>
      </header>

      {/* Page content — offset by the floating sidebar on md+. */}
      {passwordOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-950/45 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm rounded-[22px] bg-hiraya-surface p-5 shadow-2xl ring-1 ring-cream-50/80">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-serif text-lg uppercase tracking-[0.05em] text-navy-900">Change password</h3>
              <button type="button" onClick={() => setPasswordOpen(false)} aria-label="Close" className="cursor-pointer rounded-lg p-1 hover:bg-cream-200"><X size={16} /></button>
            </div>
            <ChangePasswordForm />
          </div>
        </div>
      )}

      <main className="px-3 pb-12 pt-28 sm:px-6 md:pl-[calc(16rem+2.5rem)] md:pr-8">
        <div className="mx-auto w-full max-w-[1280px]">{children}</div>
      </main>
    </div>
    </MotionConfig>
  );
};

SuperadminLayout.propTypes = {
  activeTab: PropTypes.string,
  setActiveTab: PropTypes.func.isRequired,
  onLogout: PropTypes.func,
  role: PropTypes.string,
  navLinks: PropTypes.array,
  activeSubTab: PropTypes.string,
  setActiveSubTab: PropTypes.func,
  canSignOut: PropTypes.bool,
  headerExtra: PropTypes.node,
  children: PropTypes.node,
};

export default SuperadminLayout;
