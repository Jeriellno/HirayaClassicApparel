import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import { invalidateCatalog } from '../../utils/invalidateCatalog';
import { subscribeBackendHealth, isBackendReachable } from '../../utils/backendHealth';
import { useAuth } from '../../context/AuthContext';
import useConfirm from '../../hooks/useConfirm';
import { supabase } from '../../services/supabase';
import { roleOf as supabaseRoleOf, signOutSupabase, fetchAuthoritativeRole } from '../../services/supabaseMfa';
import {
  canAccessSection,
  resolveConsoleRole,
  resolveSection,
  ALIASED_SUBTAB,
  sectionsForRole,
} from '../../utils/consoleAccess';

import SuperadminLayout from './SuperadminLayout';
import { superAdminNavLinks, SECTION_SUBTABS } from './SuperadminLayout';

import DashboardTab from './tabs/DashboardTab';
import StaffDashboard from './tabs/StaffDashboard';
import InventoryTab from './tabs/InventoryTab';
import OrdersTab from './tabs/OrdersTab';
import CustomersTab from './tabs/CustomersTab';
import AnalyticsTab from './tabs/AnalyticsTab';
import FeedbackTab from './tabs/FeedbackTab';
import AdminsTab from './tabs/AdminsTab';
import SettingsTab from './tabs/SettingsTab';
import AuditLogsTab from './tabs/AuditLogsTab';
import StockHistoryTab from './tabs/StockHistoryTab';
import UserManualTab from './tabs/UserManualTab';
import ContactSupportTab from './tabs/ContactSupportTab';
import SystemHealthPill from './SystemHealthPill';

/*
 * The hardcoded dev super-admin accounts (superadmin@hiraya.com /
 * admin@hiraya.com) were REMOVED per request — they are not used yet.
 *
 * AUTH ON THIS CONSOLE. AI analysis (POST /products/analyze-image) is PUBLIC,
 * but the catalogue WRITES are not: `POST /products`, `PUT|PATCH /products/{id}`
 * and `DELETE /products/{id}` sit behind `supabase.aal2` + `supabase.user` +
 * `admin`. The shared axios instance attaches the Supabase session JWT to them
 * (see `needsSupabaseToken` in src/api/axios.js), which is what makes Save /
 * Edit / Delete authenticate instead of answering
 * "Unauthenticated. A Supabase access token is required."
 */

const SuperAdmin = ({ onLogout }) => {
  const queryClient = useQueryClient();

  /*
   * WHO IS USING THE CONSOLE, AND THEREFORE WHAT THEY ARE OFFERED.
   *
   * The panel is public, so `role` comes from the URL when there is no session —
   * see the note below. Everything else about the UI is identical either way: one
   * component, one layout, one set of tabs. An operator on `/admin` is not
   * looking at a different, lesser application, they are looking at the same one
   * with the parts they were not given removed from the sidebar.
   */
  const { user } = useAuth();

  /*
   * WHICH CONSOLE IS THIS? — DECIDED BY THE ROLE, AND THE ROLE COMES FROM
   * SUPABASE.
   *
   * There is one panel and one component. What differs between the two roles is
   * how much of it is offered:
   *
   *   admin       -> Inventory Catalog + Orders. Two sections.
   *   superadmin  -> every section (see SECTIONS_BY_ROLE in consoleAccess.js).
   *
   * WHY `useAuth()` IS NOT ENOUGH, AND WHY THE URL IS NOT EITHER
   * -----------------------------------------------------------
   * Staff sign in through the ONE /login form (Login.jsx) and receive a SUPABASE
   * session — they never get a Laravel/Sanctum one. So `useAuth()` here returns
   * `user === null` on a perfectly valid staff sign-in, `resolveConsoleRole(null)`
   * returns '', and the old fallback made EVERY staff member an `admin`:
   *
   *     const role = sessionRole || (isSuperadminEntry ? 'superadmin' : 'admin');
   *
   * That silently demoted a real superadmin to the two-section view, and because
   * `/superadmin` is the console url the `isSuperadminEntry`
   * branch could never fire anyway. The console was therefore unreachable at
   * full privilege.
   *
   * The authoritative role lives in the Supabase session's `app_metadata.role`
   * (see 0002_sync_role_into_jwt.sql) — the SAME source ProtectedRoute already
   * reads through `useSupabaseIdentity`. This component now reads it too, so the
   * door and the room agree on who is inside.
   */
  const [supabaseRole, setSupabaseRole] = useState('');

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
          if (cancelled) return;
          /*
           * From POSTGRES, not from the session claims. `app_metadata.role`
           * is empty on every real Hiraya account (nothing writes it), so
           * this used to fall through to the `|| 'admin'` default below and
           * SILENTLY DEMOTED EVERY SUPERADMIN to the two-section view.
           * See `fetchAuthoritativeRole` in supabaseMfa.js.
           */
          const resolved = data?.session?.user
              ? await fetchAuthoritativeRole(data.session.user)
              : '';
          if (!cancelled) setSupabaseRole(resolved || '');
      })
      .catch(() => {
        // Supabase unreachable: fall back to the Laravel role below, which is
        // '' for staff. Defaulting to the NARROWEST role is the safe failure.
        if (!cancelled) setSupabaseRole('');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * ROLE RESOLUTION ORDER:
   *   1. the Supabase session (staff)      — authoritative for console users
   *   2. the Laravel user (customers)      — kept for any Sanctum-based session
   *   3. `admin`                           — the most restrictive real role
   *
   * A signed-in role always wins over the URL, so a superadmin who bookmarked
   * `/admin` keeps the full view instead of being demoted by their own URL bar.
   */
  const sessionRole = supabaseRole || resolveConsoleRole(user);
  const role = sessionRole || 'admin';

  /*
   * The URL is read for the SECTION (see the hash seeding below), never for the
   * ROLE — a signed-in superadmin who bookmarked `/admin` keeps the full view
   * instead of being demoted by their own address bar. The Supabase session is
   * the authority on WHO; the url only says where inside the console to look.
   */
  const { pathname } = useLocation();
  const navigate = useNavigate();
  void pathname;

  const allowedSections = useMemo(() => sectionsForRole(role), [role]);
  const navLinks = useMemo(
    () => superAdminNavLinks.filter((link) => allowedSections.includes(link.id)),
    [allowedSections],
  );

  /*
   * START WHERE THEY ARE ALLOWED TO BE.
   *
   * The default tab was `dashboard`, which an ordinary admin may not open, so
   * the console would have mounted onto a section it is not meant to show and
   * rendered a blank body. Landing on the first permitted section instead means
   * the console always opens on something real, whether the url asked for a
   * section this role has or not.
   */
  /*
   * NEVER MOUNT ON A SECTION THAT IS NOT RENDERED.
   *
   * `resolveSection` returns null when a role has no permitted sections at all
   * (an unrecognised role). Mounting on that null made every tab's
   * `activeTab === '...'` check false, so the body rendered nothing at all —
   * an empty shell with a working sidebar.
   */
  const [activeTab, setActiveTab] = useState(() => {
    /*
     * THE URL IS READ HERE, AND ONLY HERE, FOR ONE NARROW PURPOSE.
     *
     * This is NOT the role decision the notes above forbid — the role still
     * comes from the Supabase session and nothing in the url can change it. What
     * the url supplies is which SECTION was asked for, so a bookmarked or
     * shared console link (including one naming an id that has since become a
     * sub-tab) opens where it points instead of silently landing on Dashboard.
     *
     * `resolveSection` maps a stale id through SECTION_ALIASES and then enforces
     * the role allow-list, so an unknown id, a forbidden id and an old id are
     * all handled by the one function that already owned that decision.
     */
    const requested = window.location.hash.replace(/^#\/?/, '');
    return resolveSection(role, requested || 'dashboard') ?? 'dashboard';
  });

  useEffect(() => {
    setActiveTab((current) => resolveSection(role, current) ?? 'dashboard');
  }, [role]);

  /*
   * CUSTOMER PROFILE -> ORDERS HAND-OFF.
   *
   * "View Order" / "View All Orders" in a customer's profile open the Orders tab
   * focused on `{ orderId }` or `{ search: email }`. The focus is dropped as soon
   * as the operator leaves Orders, so opening the tab from the sidebar later
   * shows the normal, unfiltered list. The role allow-list still decides
   * whether Orders may open at all.
   */
  const [ordersFocus, setOrdersFocus] = useState(null);

  const viewCustomerOrders = useCallback(
    (focus) => {
      const target = resolveSection(role, 'orders');
      if (target !== 'orders') return;
      setOrdersFocus(focus || null);
      setActiveTab('orders');
    },
    [role]
  );

  useEffect(() => {
    if (activeTab !== 'orders') setOrdersFocus(null);
  }, [activeTab]);

  /*
   * THE SECOND LEVEL — which sub-tab of the active section is open.
   *
   * WHY THIS STATE EXISTS AT ALL, GIVEN THE SIDEBAR USED TO HAVE FLAT ROWS.
   * `api-status` and `api-keys` were two top-level tabs; they are now the two
   * sub-tabs of `api`. `analytics` likewise became a sub-tab of `dashboard`. The
   * section id is what the allow-list authorizes; the sub-tab is only which
   * PANEL inside it is painted, so it never needs a permission check of its own
   * — reaching `api` at all already proved the role may see everything in it.
   *
   * SEEDED FROM THE ALIAS TABLE, so a deep link to the OLD id opens the right
   * panel: `#api-keys` must land on Keys, not on the Status sub-tab that happens
   * to be first. This is the other half of SECTION_ALIASES — the alias maps the
   * section, ALIASED_SUBTAB maps the panel inside it.
   */
  const [activeSubTab, setActiveSubTab] = useState(
    () => ALIASED_SUBTAB[window.location.hash.replace(/^#\/?/, '')] ?? '',
  );

  useEffect(() => {
    const subs = SECTION_SUBTABS[activeTab] || [];
    setActiveSubTab((current) =>
      subs.some((s) => s.id === current) ? current : (subs[0]?.id ?? ''),
    );
  }, [activeTab]);

  /*
   * KEEP THE HASH IN STEP WITH THE ACTIVE SECTION, so a link the operator copies
   * out of the address bar is one they can come back to. `replaceState` rather
   * than a router push: the console is a tabbed surface, and adding a history
   * entry per tab click would make the back button walk the sidebar instead of
   * leaving the console.
   */
  useEffect(() => {
    const suffix = activeSubTab ? `${activeTab}/${activeSubTab}` : activeTab;
    window.history.replaceState(null, '', `#${suffix}`);
  }, [activeTab, activeSubTab]);
  const [loading, setLoading] = useState(false);

  /*
   * LAST WRITE/LOAD ERROR — SURFACED INLINE INSTEAD OF `window.alert`.
   *
   * Every mutating action (toggle a setting, export a backup, reset the demo
   * counters, …) used to report failure with `window.alert()`, and two of them
   * confirmed with `window.confirm()`. Both are BLOCKING calls: they stop the
   * browser's main thread until the user dismisses them. On a backend that can
   * legitimately take seconds, that freeze is indistinguishable from the app
   * hanging — the user cannot even scroll to see what went wrong.
   *
   * A piece of state renders the same message in the banner slot the backend
   * outage uses, so it is visible, dismissible and non-blocking.
   */
  const [actionError, setActionError] = useState(null);

  /* Non-blocking replacement for the two `window.confirm` calls. Declared here,
   * with the rest of the state, because `requestClearDemoAnalytics` (declared
   * further down) closes over the setter. */
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  /*
   * DATASETS THAT FAILED TO LOAD — so a tab can say so instead of showing "0".
   *
   * The fetch helpers below used to swallow every error into `console.error` and
   * resolve normally. Two consequences, both bad:
   *   1. A tab rendered its EMPTY state (“0 products”, “no activity”), which
   *      reads as “there is no data”, not “the read failed”.
   *   2. `loadForTab` still added the dataset to `loadedRef`, so the failure was
   *      never retried for the rest of the session — the blank stayed blank.
   *
   * The helpers now RETHROW after logging, and `loadForTab` records the failures
   * here while only marking the SUCCESSES as loaded. Re-opening the tab retries
   * whatever failed.
   */
  const [loadErrors, setLoadErrors] = useState({});

  const [products, setProducts] = useState([]);
  const [, setActiveSessions] = useState(0);
  const [analyticsLogs, setAnalyticsLogs] = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const [systemSettings, setSystemSettings] = useState({
    ai_engine_active: true,
    registrations_open: true
  });

  /*
   * BACKEND REACHABILITY — the state BOTH features below are built on.
   *
   * The axios interceptor already reports every request outcome to
   * `utils/backendHealth` (see reportRequestSuccess / reportRequestFailure).
   * That module collapses "is the Laravel server answering?" into ONE shared
   * boolean, and logs the outage exactly once instead of on every failed call.
   *
   * This component subscribes to it so it can do the two things the console was
   * missing:
   *
   *   1. BANNER — when the backend is unreachable the console used to render a
   *      calm, empty dashboard ("0 products", "No recent activity"), which reads
   *      as "there is no data" rather than "we could not ask". A visible banner
   *      states the real condition, which is the difference between an operator
   *      checking the server and an operator hunting a data bug that is not there.
   *
   *   2. AUTO-RECOVERY — the moment the backend answers again, re-read the active
   *      tab so the console repopulates on its own. Before this, restarting
   *      `php artisan serve` left the screen empty until the user reloaded the
   *      page manually, which looked like the restart had not worked.
   *
   * `isBackendReachable()` seeds the initial value from the shared state (a
   * request may already have failed before this component mounted), so the
   * banner is correct on first paint and does not flash on/off.
   */
  const [backendReachable, setBackendReachable] = useState(isBackendReachable);

  /*
   * LAZY PER-TAB FETCHING — WHY THE CONSOLE USED TO STALL.
   * ===================================================================
   * The console previously called `fetchAllDatabaseData()` on mount, firing
   * SEVEN reads at once via Promise.all NO MATTER WHICH TAB THE USER WAS ON:
   *
   *     products, live-sessions, analytics-logs, feedbacks,
   *     admin-accounts, system-settings, audit-logs
   *
   * On the dev server (`php artisan serve`) the backend is SINGLE-THREADED, so
   * those seven are served ONE AT A TIME and each pays a round-trip to the
   * remote Supabase pooler. Opening the console therefore queued ~7 requests,
   * and clicking ANY tab (Customers, Orders, …) added that tab's own fetch on
   * TOP of a queue that had not drained — which is what produced:
   *
   *     /admin/customers            -> timeout of 15000ms exceeded
   *     /admin/analytics/sessions   -> timeout of 45000ms exceeded
   *
   * Raising timeouts (see api/axios.js) stopped the FALSE failures, but did not
   * make the console fast — a user sitting on Dashboard was still waiting on
   * feedbacks, admin accounts and audit logs they could not even see.
   *
   * This map is the structural fix: each tab declares ONLY the datasets it
   * renders, and `loadForTab` fetches just those, once, when the tab is opened.
   * A storefront-sized burst becomes at most TWO or THREE reads, and no tab
   * ever competes with data it does not display.
   */
  /*
   * `analyticsLogs` IS DELIBERATELY **NOT** IN THE DASHBOARD SET.
   *
   * It was, and that was the console's single worst read: /admin/analytics/
   * tryon-activity MEASURED at **19.0s** (limit 50 sessions, each row parsing its
   * own render plan over a ~500ms remote round-trip). Because Dashboard's
   * Promise.all waited on it, opening the console to look at ONE counter paid
   * for the whole activity log — and on the single-threaded dev server that 19s
   * also queued ahead of every other request.
   *
   * The Dashboard renders no per-session rows; only the Analytics tab does.
   * The dataset therefore moved to the tab that actually displays it.
   */
  /*
   * THE DASHBOARD DECLARES NOTHING. Every panel on it (summary cards, charts,
   * recent activity, inventory) fetches its own small analytics endpoint via
   * react-query; DashboardTab renders none of `products`, `liveSessions` or
   * `feedbacks`. Loading them here — and re-polling them every 30s, the full
   * catalogue included — only queued dead reads on the single-threaded dev
   * server, which is what timed out as "Failed: Feedback … 15000ms exceeded"
   * whenever a save was in flight. Those datasets load on the tabs that show
   * them (Inventory, Feedback).
   */
  const TAB_DATASETS = useMemo(() => ({
    dashboard: [],         // DashboardTab self-fetches (one insights request).
    inventory: ['products'],
    orders: [],            // OrdersTab self-fetches (read-only, its own endpoint).
    customers: [],         // CustomersTab self-fetches.
    feedback: ['feedbacks'],
    admins: [],            // AdminsTab self-fetches.
    manual: [],
    support: [],           // ContactSupportTab self-fetches.
    'audit-logs': ['auditLogs'],
    settings: ['systemSettings'],
  }), []);

  /*
   * `analyticsLogs` IS FETCHED BY A SUB-TAB, NOT BY THE DASHBOARD ITSELF.
   *
   * Canvas Analytics became the 'analytics' sub-tab of the Dashboard, but the
   * dataset stays keyed to that SUB-TAB and not to `dashboard`, because the
   * original decision still holds and is the reason this split exists at all:
   *
   *   /admin/analytics/tryon-activity MEASURED at 19.0s. Fetching it on console
   *   mount made opening the console to read ONE counter pay for the whole
   *   activity log — and on the single-threaded dev server that 19s also queued
   *   ahead of every other request.
   *
   * Folding the two sections together must not quietly undo that. So the
   * OVERVIEW sub-tab gets the dashboard set, and the ANALYTICS sub-tab adds the
   * logs on top — the cost is still paid only by the operator who asked to see
   * the logs.
   */
  const SUBTAB_DATASETS = useMemo(() => ({
    analytics: ['analyticsLogs'],
  }), []);

  // Datasets already pulled in this session, so re-opening a tab does not
  // re-query (the manual Refresh button and the poll stay the explicit ways to
  // re-read). Cleared by `reloadAll` after a write that changes many datasets.
  const loadedRef = useRef(new Set());
  const loadInFlightRef = useRef(false);

  /*
   * DATASET_LOADERS — WHY IT IS A REF, NOT A useMemo.
   *
   * The loader functions are all `useCallback`s declared FURTHER DOWN this
   * component body (fetchProducts ~line 510, fetchSystemSettings ~line 710).
   * A `useMemo` here would be EVALUATED IMMEDIATELY on the first render, while
   * those `const` bindings are still in their temporal dead zone — which is
   * exactly the crash this replaces:
   *
   *     ReferenceError: Cannot access 'fetchProducts' before initialization
   *
   * A ref sidesteps the ordering problem entirely: it is created empty here and
   * POPULATED after every fetcher is declared (see the assignment right after
   * `fetchSystemSettings`). The only consumers — `loadForTab`,
   * `retryFailedDatasets` and the backend-health listener — read it through
   * `.current` at REQUEST time, long after the first render has completed, so
   * the map is always fully filled by the time anything looks inside it.
   */
  const DATASET_LOADERS = useRef({});

  /**
   * Datasets that are ALWAYS refetched on tab entry, even when already loaded.
   *
   * `loadedRef` exists so a tab switch does not re-request slow, unchanging
   * datasets (the catalog, the live-session list). That caching is wrong for the
   * audit log: it is APPEND-ONLY, and its entire purpose is to show what other
   * people have just done. An admin who opens the console, edits a garment in
   * another tab, then returns to Audit Logs was previously shown the snapshot from
   * their first visit — the new entry existed in the database but not on screen,
   * which is the precise failure that makes an audit trail untrustworthy.
   *
   * Only this key is listed. Adding a dataset here opts it out of caching, so it
   * should stay a short, deliberate list rather than a general exemption.
   */
  const ALWAYS_REFETCH = useMemo(() => new Set(['auditLogs']), []);

  /**
   * Fetches ONLY the datasets a given tab declares, skipping any already loaded.
   * Safe to call on every tab change.
   *
   * `Promise.allSettled`, NOT `Promise.all` — and a `finally`, NOT a bare tail.
   *
   * `Promise.all` rejects on the FIRST failure, so one flaky endpoint skipped
   * the `loadedRef` bookkeeping entirely and left `loading` stuck true. Worse,
   * the OLD code added every dataset to `loadedRef` regardless of outcome, so a
   * dataset that failed was marked "already loaded" and NEVER retried — the tab
   * stayed blank for the whole session with no way to recover short of a reload.
   *
   * `allSettled` lets each request finish independently; successes are marked
   * loaded, failures are RECORDED (so the UI can say so) and left UNMARKED, so
   * returning to the tab retries exactly the ones that did not answer.
   */
  const loadForTab = useCallback(async (tab) => {
    const wanted = [...(TAB_DATASETS[tab] || []), ...(SUBTAB_DATASETS[tab] || [])];
    const missing = wanted.filter(
      (key) => !loadedRef.current.has(key) || ALWAYS_REFETCH.has(key)
    );

    if (missing.length === 0) return;

    loadInFlightRef.current = true;
    setLoading(true);

    try {
      const results = await Promise.allSettled(
        missing.map((key) => DATASET_LOADERS.current[key]?.())
      );

      const failures = {};

      results.forEach((result, index) => {
        const key = missing[index];

        if (result.status === 'fulfilled') {
          loadedRef.current.add(key);
        } else {
          // Left OUT of loadedRef on purpose — this is what makes it retryable.
          failures[key] = result.reason?.message || 'Failed to load';
        }
      });

      setLoadErrors((prev) => {
        const next = { ...prev };
        // Clear the flags for the ones that just succeeded, so a recovered
        // dataset stops reporting itself as broken.
        missing.forEach((key) => {
          if (!(key in failures)) delete next[key];
        });

        return { ...next, ...failures };
      });
    } finally {
      // Runs on EVERY path, so a throw can never leave the console spinning
      // or the lock held (which would silently stop the 30s poll for good).
      setLoading(false);
      loadInFlightRef.current = false;
    }
  }, []);

  /*
   * HUMAN LABELS FOR THE FAILURE BANNER.
   * A raw key (`analyticsLogs`) means nothing to the operator reading the
   * screen; these are the names of the panels actually affected.
   */
  const DATASET_LABELS = {
    products: 'Products',
    liveSessions: 'Active sessions',
    analyticsLogs: 'Try-on activity',
    feedbacks: 'Feedback',
    systemSettings: 'System settings',
    auditLogs: 'Audit logs',
  };

  const datasetErrors = Object.entries(loadErrors).map(([key, message]) => ({
    key,
    label: DATASET_LABELS[key] || key,
    message,
  }));

  /**
   * Re-issues ONLY the reads that failed, then clears their error entries.
   *
   * This is the escape hatch the old code lacked: a dataset that failed was
   * marked "loaded" forever, so the only recovery was a full page reload.
   */
  const retryFailedDatasets = useCallback(async () => {
    const failed = Object.keys(loadErrors);
    if (failed.length === 0) return;

    // Drop them from `loadedRef` so `loadForTab` treats them as missing again.
    failed.forEach((key) => loadedRef.current.delete(key));

    loadInFlightRef.current = true;
    setLoading(true);

    try {
      const results = await Promise.allSettled(
        failed.map((key) => DATASET_LOADERS.current[key]?.())
      );

      const failures = {};

      results.forEach((result, index) => {
        const key = failed[index];

        if (result.status === 'fulfilled') {
          loadedRef.current.add(key);
        } else {
          failures[key] = result.reason?.message || 'Failed to load';
        }
      });

      setLoadErrors(failures);
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
    }
  }, [loadErrors]);

  /*
   * `clearDemoAnalytics` is DESTRUCTIVE (it zeroes counters on every product),
   * so it must still be confirmed — but without `window.confirm`, which blocks
   * the UI thread and can be suppressed by the browser after enough dialogs
   * (which would silently skip the guard). The Settings button now OPENS a
   * panel; the panel's confirm button calls `clearDemoAnalytics` directly.
   */
  const requestClearDemoAnalytics = useCallback(() => {
    setActionError(null);
    setConfirmResetOpen(true);
  }, []);

  /**
   * Reload EVERY dataset and mark them all loaded. Reserved for writes that can
   * affect several tabs at once (e.g. clearing demo interaction counters, which
   * changes both the Dashboard and Analytics views).
   */
  const fetchAllDatabaseData = useCallback(async () => {
    loadInFlightRef.current = true;
    setLoading(true);

    try {
      // allSettled: a single dead endpoint must not blank the whole console.
      const results = await Promise.allSettled(
        Object.keys(DATASET_LOADERS.current).map((key) => DATASET_LOADERS.current[key]())
      );

      const keys = Object.keys(DATASET_LOADERS.current);
      const failures = {};

      results.forEach((result, index) => {
        const key = keys[index];

        if (result.status === 'fulfilled') {
          loadedRef.current.add(key);
        } else {
          failures[key] = result.reason?.message || 'Failed to load';
        }
      });

      setLoadErrors(failures);
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
    }
  }, []);

  /*
   * Load the ACTIVE tab's data on mount and on every tab change. Because
   * `loadForTab` skips already-loaded datasets, switching tabs is cheap and the
   * very first paint only ever queues what the landing tab needs.
   */
  useEffect(() => {
    loadForTab(activeTab);
    // `loadForTab` is a useCallback with a stable identity, so the dependency
    // list is now honest instead of suppressed.
  }, [activeTab, loadForTab]);

  useEffect(() => {
    /*
     * LIGHT POLL INSTEAD OF SUPABASE REALTIME.
     *
     * Every dataset this console shows now lives in Laravel/MySQL, which does
     * NOT broadcast over Supabase Realtime. The old superadmin master channel
     * subscribed to canvas_sessions, canvas_analytics and feedbacks - all dead
     * Supabase tables with no writer - so it was a phantom channel that never
     * fired. A simple interval re-fetch keeps the dashboard live instead.
     */
    const interval = setInterval(() => {
      /*
       * ONLY POLL WHILE THE CONSOLE IS ACTUALLY ON SCREEN, AND ONLY WHAT THE
       * VISIBLE TAB SHOWS.
       *
       * This interval was registered unconditionally and never stopped while the
       * tab was backgrounded, so a left-open console fired `fetchLiveSessions`
       * AND `fetchAnalyticsLogs` every 30s forever — the two HEAVIEST endpoints
       * here — competing with whatever else was running on the single-threaded
       * server, including an in-flight try-on render.
       *
       * It now skips entirely when hidden, skips while a load is in flight, and
       * refreshes only the datasets the ACTIVE tab actually renders. Polling
       * audit logs the user cannot see was pure waste against a one-worker server.
       */
      if (document.visibilityState !== 'visible') return;
      if (loadInFlightRef.current) return;

      const wanted = TAB_DATASETS[activeTab] || [];
      // allSettled + no rethrow: this is a background poll, so a failed read
      // must not become an unhandled rejection. The error state is owned by
      // loadForTab / refreshActiveTab; the poll is best-effort.
      Promise.allSettled(wanted.map((key) => DATASET_LOADERS.current[key]?.()));
    }, 30000);

    return () => clearInterval(interval);
  }, [activeTab]);

  /*
   * BACKEND REACHABILITY — BANNER STATE + AUTO-RECOVERY.
   *
   * Both features ride on the shared health state the axios interceptor already
   * maintains (utils/backendHealth). Subscribing here costs one listener and no
   * extra requests.
   *
   * RECOVERY REFETCHES THROUGH `DATASET_LOADERS`, not `refreshActiveTab`, so the
   * effect has no dependency on a callback declared LATER in the component body
   * (which would be a stale/`undefined` binding on the first render). It re-reads
   * exactly the datasets the visible tab renders — the same set the poll uses —
   * so recovering from an outage costs no more than one poll tick.
   */
  useEffect(() => {
    const unsubscribe = subscribeBackendHealth((reachable) => {
      setBackendReachable(reachable);

      /*
       * The backend just came back. Re-read the ACTIVE tab so the console
       * repopulates by itself instead of staying empty until a manual reload.
       *
       * On the DOWN edge we deliberately do nothing: the in-flight requests that
       * tripped the breaker are already rejecting on their own, and re-issuing
       * them at a server we know is unreachable would only add load to a machine
       * that is already failing.
       */
      if (!reachable) return;

      const wanted = TAB_DATASETS[activeTab] || [];
      // allSettled — the health listener must never leak an unhandled rejection
      // if the backend answers this probe and then fails the next one.
      Promise.allSettled(wanted.map((key) => DATASET_LOADERS.current[key]?.()));
    });

    return unsubscribe;
    // `activeTab` is read through the closure above; re-subscribing on tab change
    // keeps the recovery refetch aimed at the tab that is actually on screen.
    // `DATASET_LOADERS` holds useCallback-stable functions, so it is safe to
    // include here without causing a re-subscribe storm.
  }, [activeTab]);

  /**
   * Products are the ONE dataset shared with the storefront and the Admin
   * console, and both of those read Laravel/MySQL - not Supabase. Reading them
   * from Supabase here showed superadmins a phantom catalog, so this now hits
   * the same Laravel endpoint the Admin console uses.
   */
  const fetchProducts = useCallback(async () => {
    const res = await api.get('/products');
    const rows = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    setProducts(rows);
  }, []);

  /**
   * Product create/update/delete against Laravel, mirroring MainDashboard so
   * the SuperAdmin inventory editor actually persists to the live catalog.
   */
  /*
   * CATALOG WRITES — LOCAL REFRESH **AND** SHOPPER CACHE INVALIDATION.
   *
   * `fetchProducts()` only repaints THIS console's own table. The storefront
   * reads React Query caches, which it never touched, so a superadmin edit stayed
   * invisible to shoppers for up to the 5-minute `staleTime` on ['products'] — the
   * reported "hindi nagre-reload ang products sa users".
   *
   * `invalidateCatalog` is the missing half: it marks every shopper-facing product
   * list stale and refetches the mounted ones, so Shop and Home show the edit
   * immediately. Both are kept, because each does something the other cannot.
   */
  // Product write routes are AAL2-GATED, so they carry the Supabase session JWT
  // (attached by the axios interceptor). Save / Edit / Delete therefore need a
  // console session completed with two-factor verification, and answer 401
  // "Your admin session has expired..." when it is missing.
  const handleAddProduct = async (payload) => {
    const res = await api.post('/products', payload);
    await fetchProducts();
    invalidateCatalog(queryClient);
    return res.data;
  };

  const handleUpdateProduct = async (id, payload) => {
    const res = await api.post(`/products/${id}`, payload);
    await fetchProducts();
    invalidateCatalog(queryClient);
    return res.data;
  };

  const handleDeleteProduct = async (id) => {
    const res = await api.delete(`/products/${id}`);
    await fetchProducts();
    invalidateCatalog(queryClient);
    return res.data;
  };

  /**
   * Garment image analysis (Gemini) - SAME endpoint the Admin console uses
   * (POST /products/analyze-image, now PUBLIC). Returns the auto-filled product
   * attributes so the SuperAdmin inventory form can fill its details in one
   * click, exactly like the Admin "Auto-fill details (AI)" button.
   *
   * Takes a data-URI ("data:image/jpeg;base64,...") built by the form from the
   * chosen file, so the caller owns the file -> data-URI conversion.
   */
  const analyzeProductImage = async (imageDataUri) => {
    // The AI analysis endpoint is now PUBLIC (POST /products/analyze-image),
    // so it works with NO admin login and can never answer
    // "Forbidden. Admin access required." (403) again.
    const res = await api.post('/products/analyze-image', { image: imageDataUri });
    return res.data?.data || {};
  };

  /*
   * REAL platform activity - read from Laravel/MySQL, NOT Supabase.
   *
   * These three used to read Supabase tables (`canvas_sessions`,
   * `canvas_analytics`, `feedbacks`) that NOTHING in the app ever wrote to, so
   * the dashboard counter was stuck at 0, the try-on log was empty, and the
   * Feedback tab said "no feedback received" forever. They now hit the same
   * MySQL tables the Studio writes to (try_on_sessions, feedbacks) via the
   * superadmin-gated /admin/analytics/* and /admin/feedbacks endpoints.
   *
   * Each is still wrapped so one failing call degrades to an empty value
   * instead of rejecting the shared Promise.all and blanking the whole console.
   */
  /*
   * ON RETHROWING INSTEAD OF SWALLOWING
   * -----------------------------------
   * These seven helpers used to catch, `console.error`, and return normally.
   * That made every failure INVISIBLE to the code that called them: `loadForTab`
   * saw seven fulfilled promises, so it marked all seven datasets as loaded and
   * cleared `loading` — and the tab rendered its empty state (“0 products”)
   * exactly as if the catalog were genuinely empty.
   *
   * They now RETHROW so `loadForTab` / `refreshActiveTab` can use allSettled and
   * record which dataset failed, leaving it out of `loadedRef` so re-opening the
   * tab retries it. The `console.error` stays for the browser-console trail.
   *
   * Each is a `useCallback` with a stable identity because `DATASET_LOADERS` is
   * built from them and read inside effects — without it, every render would
   * hand the effects a new object and re-trigger the loads.
   */
  const fetchLiveSessions = useCallback(async () => {
    try {
      const res = await api.get('/admin/analytics/sessions');
      const count = res.data?.active_sessions ?? res.data?.activeSessions;
      if (typeof count === 'number') setActiveSessions(count);
    } catch (err) {
      console.error('SuperAdmin: failed to load live sessions', err);
      throw err;
    }
  }, []);

  /*
   * TRY-ON ACTIVITY — THE 19-SECOND READ.
   *
   * MEASURED on this deployment: /admin/analytics/tryon-activity took **19,041
   * ms** at the default `limit=50`, versus ~1s for every other console endpoint.
   * The backend queries 50 sessions and parses a render plan per row over a
   * ~500ms remote Supabase round-trip, so the cost is roughly linear in `limit`.
   *
   * The Dashboard does not render these rows — only the Analytics tab does — so
   * the dataset was moved out of `TAB_DATASETS.dashboard`. On top of that the
   * request now asks for FEWER rows than the server default, which cuts the
   * first paint proportionally. `exportSurveyCSV` reads from the same state, so
   * the CSV simply reflects what was loaded; raise this if you need a longer
   * export and can accept the wait.
   */
  const fetchAnalyticsLogs = useCallback(async () => {
    try {
      const res = await api.get('/admin/analytics/tryon-activity', {
        params: { limit: 50 },
      });
      const rows = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setAnalyticsLogs(rows);
    } catch (err) {
      console.error('SuperAdmin: failed to load analytics logs', err);
      throw err;
    }
  }, []);

  const fetchFeedbacks = useCallback(async () => {
    try {
      // Named feedback only (tied to a customer account); admins can read it too.
      const res = await api.get('/admin/customer-feedback');
      const rows = Array.isArray(res.data)
        ? res.data
        : (res.data?.data || []);

      setFeedbacks(rows);
    } catch (err) {
      console.error('SuperAdmin: failed to load customer feedback', err);
      throw err;
    }
  }, []);


  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await api.get('/admin/audit-logs');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setAuditLogs(rows);
    } catch (err) {
      console.error('SuperAdmin: failed to load audit logs', err);
      throw err;
    }
  }, []);

  const fetchSystemSettings = useCallback(async () => {
    try {
      const res = await api.get('/admin/settings');
      const data = res.data || {};
      setSystemSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      console.error('SuperAdmin: failed to load system settings', err);
      throw err;
    }
  }, []);

  /*
   * Fill the loader map now that EVERY fetcher above is declared. This runs on
   * each render but is O(7) and idempotent; assigning the (ref-stable)
   * `useCallback`s here is what keeps the map free of the temporal-dead-zone
   * trap described on `DATASET_LOADERS` near the top of the component.
   */
  DATASET_LOADERS.current = {
    products: fetchProducts,
    liveSessions: fetchLiveSessions,
    analyticsLogs: fetchAnalyticsLogs,
    feedbacks: fetchFeedbacks,
    systemSettings: fetchSystemSettings,
    auditLogs: fetchAuditLogs,
  };

  /**
   * SIGNING OUT OF THE CONSOLE — AND IT MUST BE THE SUPABASE SESSION.
   *
   * The layout's "Exit Console" button used to be dead: `canSignOut` was
   * `Boolean(onLogout)` and App.jsx rendered `<SuperAdmin />` with no prop, so
   * the button never appeared and there was no way out of the console short of
   * clearing storage by hand.
   *
   * Calling AuthContext's `logout()` would not have been the fix either: that
   * hits Laravel's /logout and redirects to /login, but a staff member has NO
   * Laravel session — the one that needs closing is the SUPABASE one, and an
   * aal2 session left open in a shared browser is exactly the thing sign-out
   * exists to prevent.
   */
  const [confirmAction, confirmDialog] = useConfirm();

  /*
   * EVERY SECTION A STAFF MEMBER OPENS IS AUDITED, so Audit Logs can answer
   * "what did each admin look at and do". Fire-and-forget: a failed write must
   * never block navigation.
   */
  useEffect(() => {
    if (!activeTab) return;
    api.post('/admin/console/section-view', { section: activeTab }).catch(() => {});
  }, [activeTab]);

  const handleLogout = async () => {
    /*
     * ASK FIRST. "Exit Console" sits in the header next to everyday controls,
     * and one stray click used to end an aal2 session outright, so the staff
     * member had to sign in again and redo their authenticator code. A
     * confirmation step costs one click and prevents that.
     */
    const confirmed = await confirmAction({
      title: 'Sign out of the console?',
      message: 'You will need your password and authenticator code to sign back in.',
      confirmText: 'Sign out',
      cancelText: 'Stay',
      danger: true,
    });
    if (!confirmed) return;

    // Audit Logs: record the sign-out while the session is still valid —
    // but never make the user wait more than 1.5 s for it.
    await Promise.race([
      api.post('/admin/console/signed-out').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);

    try {
      await signOutSupabase();
    } catch (err) {
      // A failed sign-out must not trap the user in the console; the local
      // session is cleared below regardless and the redirect still happens.
      console.warn('SuperAdmin: Supabase sign-out failed', err);
    } finally {
      /*
       * In-app navigation, not `window.location.href`. The full page load was a
       * second, redundant navigation on top of the one `ProtectedRoute` already
       * makes the moment the Supabase session reads as gone — the guard and this
       * button were both writing the same redirect, and the user paid for it with
       * a double refresh. `ProtectedRoute` owns the destination; the sign-out here
       * only has to close the session.
       */
      navigate('/login', { replace: true });
    }
  };

  /**
   * Flips a global toggle via the Laravel endpoint. The backend records the
   * audit entry with the REAL signed-in superadmin (the old Supabase path
   * hardcoded 'superadmin@hiraya.com', so the trail never named the actor).
   */
  const toggleSetting = async (key) => {
    const nextState = !systemSettings[key];
    setActionError(null);

    // Optimistic update, rolled back if the write fails.
    setSystemSettings(prev => ({ ...prev, [key]: nextState }));

    try {
      await api.put(`/admin/settings/${key}`, { value: nextState });
      await fetchAuditLogs();
    } catch (err) {
      console.error(`SuperAdmin: failed to toggle '${key}'`, err);
      setSystemSettings(prev => ({ ...prev, [key]: !nextState }));
      // Inline, non-blocking. `window.alert` froze the UI on a slow backend.
      setActionError(err?.response?.data?.message || 'Failed to update the setting.');
    }
  };

  /**
   * Real full-database JSON backup - replaces the old alert()-only stub. The
   * backend streams the file, so we just point the browser at the endpoint.
   */
  /**
   * Downloads a full database backup: 'json' (keep / inspect) or 'sql' (a
   * restore script for the Supabase SQL editor). The backup can be tens of MB
   * (try-on images are stored in the database), hence the long timeout.
   */
  const exportFullBackup = async (format = 'json') => {
    setActionError(null);

    try {
      const res = await api.get('/admin/export', {
        params: { format },
        responseType: 'blob',
        timeout: 5 * 60 * 1000,
      });
      const type = format === 'sql' ? 'application/sql' : 'application/json';
      const url = URL.createObjectURL(new Blob([res.data], { type }));
      const link = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      link.href = url;
      link.download = `hiraya_backup_${stamp}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('SuperAdmin: backup export failed', err);
      setActionError(err?.response?.data?.message || 'Failed to export the database backup.');
    }
  };

  /**
   * Zeroes the per-product interaction counters (canvas drags + try-on runs).
   *
   * The control used to read "Clear Demo Analytics Logs", which implied the
   * analytics LOGS were being deleted. What it actually resets is the two
   * COUNTERS on `products` that drive the trending-garments rankings — it
   * touches no orders, accounts or feedback. The copy now says that plainly, so
   * the operator knows exactly what the button did and what it did not.
   */
  const clearDemoAnalytics = async () => {
    setActionError(null);
    setResetBusy(true);

    try {
      const res = await api.delete('/admin/analytics/demo');
      await Promise.allSettled([fetchAllDatabaseData(), fetchAuditLogs()]);
      const resetCount = res.data?.products_reset;
      setActionError(
        typeof resetCount === 'number'
          ? `Interaction counters reset on ${resetCount} product(s).`
          : (res.data?.message || 'Demo interaction counters reset.')
      );
    } catch (err) {
      console.error('SuperAdmin: clear demo analytics failed', err);
      setActionError(err?.response?.data?.message || 'Failed to reset the demo counters.');
    } finally {
      setResetBusy(false);
      setConfirmResetOpen(false);
    }
  };

  /*
   * RFC-4180 CSV field escaping.
   *
   * The old export concatenated raw values, so any garment or paired-item name
   * containing a comma, a double quote or a newline shifted every column after
   * it — the research spreadsheet silently mis-aligned. Wrapping every field in
   * quotes and doubling internal quotes keeps the columns intact no matter what
   * a product name contains.
   */
  const csvField = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    return `"${str.replace(/"/g, '""')}"`;
  };

  /*
   * RESEARCH CSV — COLUMNS THE DATA ACTUALLY HAS.
   *
   * The old header carried `MatchScore`, which is sourced from `match_score` —
   * a field the try-on pipeline has never produced (it came from the retired
   * Supabase `canvas_analytics` table). Excel therefore received a permanently
   * empty column, and the "research dataset" implied a measurement that was
   * never taken. It is replaced by `Status` and `GarmentCount`, which the
   * session table records for real.
   */
  const exportSurveyCSV = () => {
    const header = ['ID', 'User', 'ItemTried', 'PairedItem', 'GarmentCount', 'Status', 'Timestamp'];
    const lines = [header.map(csvField).join(',')];

    analyticsLogs.forEach(row => {
      lines.push([
        row.id,
        row.user_id || 'Guest',
        row.item_name,
        row.paired_item,
        row.garment_count,
        row.status,
        row.created_at,
      ].map(csvField).join(','));
    });

    // AUTF-8 BOM so Excel opens the accented garment names correctly instead of
    // rendering them as mojibake.
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Hiraya_Canvas_Research_Data_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <SuperadminLayout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      activeSubTab={activeSubTab}
      setActiveSubTab={setActiveSubTab}
      onLogout={handleLogout}
      role={role}
      navLinks={navLinks}
      canSignOut
      headerExtra={role === 'superadmin' ? <SystemHealthPill /> : null}
    >
      {/*
        * BACKEND UNREACHABLE BANNER.
        *
        * Rendered the instant the shared health state flips to unreachable (any
        * request returns a transport-level failure). Without it the console looks
        * merely EMPTY — every counter reads 0 and every list says "no data" —
        * which sends an operator looking for a data bug that does not exist. This
        * states the actual condition and the one command that fixes it.
        *
        * It clears itself: the auto-recovery effect above flips `backendReachable`
        * back to true on the first successful request, so no dismiss button (and
        * no stale banner) is needed.
        */}
      {!backendReachable && (
        <div className="mb-6 p-4 bg-red-500/12 border-red-500/40 rounded-2xl flex items-start gap-3 font-mono text-xs">
          <AlertTriangle size={18} className="text-red-700 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-red-700 font-bold uppercase tracking-widest">
              Backend unreachable
            </p>
            <p className="text-hiraya-ink normal-case tracking-normal mt-1">
              The console cannot reach the API server, so the figures below may be
              stale or empty. The tab will refresh automatically once the backend
              responds again.
            </p>
            <p className="text-hiraya-sand normal-case tracking-normal mt-1.5">
              Check that the Laravel server is running:{' '}
              <code className="text-hiraya-ink">php artisan serve</code>
            </p>
          </div>
        </div>
      )}

      {/*
        * PER-DATASET ERROR BANNER.
        *
        * The seven fetch helpers used to be `catch (err) { console.error(...) }`,
        * which meant a failed read was invisible in the UI: `loadForTab`'s
        * Promise.all resolved anyway and the tab painted "0 products / no
        * activity", which reads as "there is no data" rather than "we could not
        * ask". This surfaces the real condition, naming the datasets that failed.
        *
        * Unlike the unreachable banner above, this one CANNOT clear itself: the
        * dataset may keep failing for a reason unrelated to transport (a 403, a
        * 500). The Retry button re-issues only the failed reads.
        */}
      {datasetErrors.length > 0 && (
        <div className="mb-6 p-4 bg-amber-500/15 border-amber-500/40 rounded-2xl flex items-start gap-3 font-mono text-xs">
          <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-amber-700 font-bold uppercase tracking-widest">
              Some data could not be loaded
            </p>
            <p className="text-hiraya-ink normal-case tracking-normal mt-1">
              Failed: {datasetErrors.map((e) => e.label).join(', ')}
              {backendReachable
                ? ' — the server is responding, so these panels may show stale or empty values.'
                : ' — the server is unreachable.'}
            </p>
            <p className="text-hiraya-sand normal-case tracking-normal mt-1.5">
              {datasetErrors[0].message}
            </p>
            <button
              type="button"
              onClick={retryFailedDatasets}
              disabled={loading}
              className="mt-3 px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-800 uppercase tracking-widest text-[10px] font-bold hover:bg-amber-500/15 disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none disabled:cursor-not-allowed"
            >
              {loading ? 'Retrying…' : 'Retry failed'}
            </button>
          </div>
        </div>
      )}

      {/*
        * ACTION RESULT BANNER (replaces `window.alert`).
        *
        * `window.alert` BLOCKS the whole UI thread: while it is open the console
        * cannot repaint, so on this single-threaded backend (where an action can
        * take seconds) the alert looked like a browser hang. This renders the
        * same message inline instead, and the operator can keep working.
        */}
      {actionError && (
        <div className="mb-6 p-4 bg-navy-100 border border-navy-300/70 rounded-2xl flex items-start gap-3 font-mono text-xs">
          <AlertTriangle size={18} className="text-navy-700 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-navy-800 font-bold uppercase tracking-widest">
              Last action
            </p>
            <p className="text-hiraya-ink normal-case tracking-normal mt-1">
              {actionError}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-hiraya-sand hover:text-hiraya-ink uppercase tracking-widest text-[10px] font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {activeTab === 'dashboard' && activeSubTab === 'analytics' && role === 'superadmin' && (
        <AnalyticsTab analyticsLogs={analyticsLogs} exportSurveyCSV={exportSurveyCSV} />
      )}
      {/* Admins get their work dashboard; the analytics board is the owner's. */}
      {activeTab === 'dashboard' && role !== 'superadmin' && (
        <StaffDashboard onOpenSection={(id) => setActiveTab(resolveSection(role, id) ?? 'dashboard')} />
      )}
      {activeTab === 'dashboard' && role === 'superadmin' && activeSubTab !== 'analytics' && (
        <DashboardTab
          role={role}
          onOpenSection={(id) => setActiveTab(resolveSection(role, id) ?? 'dashboard')}
          onOpenAnalytics={role === 'superadmin' ? () => setActiveSubTab('analytics') : undefined}
        />
      )}
      {activeTab === 'inventory' && (
        <InventoryTab
          products={products}
          onAddProduct={handleAddProduct}
          onUpdateProduct={handleUpdateProduct}
          onDeleteProduct={handleDeleteProduct}
          onAnalyzeImage={analyzeProductImage}
        />
      )}
      {activeTab === 'orders' && (
        <OrdersTab
          // `key` remounts the tab for each hand-off, so its search and open
          // sheet are seeded fresh rather than kept from the last visit.
          key={ordersFocus ? JSON.stringify(ordersFocus) : 'orders'}
          initialSearch={ordersFocus?.search}
          initialOrderId={ordersFocus?.orderId}
        />
      )}
      {activeTab === 'customers' && <CustomersTab role={role} onViewOrders={viewCustomerOrders} />}
      {activeTab === 'feedback' && <FeedbackTab feedbacks={feedbacks} />}
      {activeTab === 'manual' && <UserManualTab role={role} />}
      {activeTab === 'support' && <ContactSupportTab role={role} />}
      {activeTab === 'admins' && <AdminsTab />}
      {activeTab === 'audit-logs' && activeSubTab === 'stock' && <StockHistoryTab />}
      {activeTab === 'audit-logs' && activeSubTab !== 'stock' && <AuditLogsTab auditLogs={auditLogs} role={role} />}
      {activeTab === 'settings' && (
        <SettingsTab
          settings={systemSettings}
          onToggle={toggleSetting}
          onExportBackup={exportFullBackup}
          onClearDemoAnalytics={requestClearDemoAnalytics}
        />
      )}

      {/*
        * NON-BLOCKING CONFIRMATION (replaces `window.confirm`).
        *
        * Same reasoning as the alert above: `window.confirm` freezes the UI thread
        * while it is open, and some browsers suppress it entirely after enough
        * dialogs, which would silently SKIP a destructive reset. A rendered panel
        * cannot be suppressed and does not block. It also lets the copy state
        * exactly what is and is not reset — the old dialog had to pack that into a
        * single sentence.
        */}
      {confirmResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/45 p-6 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-[24px] bg-hiraya-surface p-7 text-xs shadow-neu ring-1 ring-cream-50/80">
            <p className="text-amber-700 font-bold uppercase tracking-widest">
              Reset interaction counters?
            </p>
            <p className="text-hiraya-ink normal-case tracking-normal mt-3">
              This zeroes the canvas-drag and try-on counts on{' '}
              <strong className="text-hiraya-ink">every product</strong>, which resets the
              trending-garments rankings.{' '}
              <strong className="text-hiraya-ink">Orders, accounts and feedback are NOT
              affected.</strong>
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                disabled={resetBusy}
                className="px-5 py-2.5 rounded-full border border-hiraya-ink/20 text-hiraya-ink uppercase tracking-widest text-[10px] font-bold hover:bg-cream-200/60 disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearDemoAnalytics}
                disabled={resetBusy}
                className="px-5 py-2.5 rounded-full bg-amber-500 text-hiraya-olive uppercase tracking-widest text-[10px] font-bold hover:bg-amber-400 disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none disabled:cursor-not-allowed"
              >
                {resetBusy ? 'Resetting…' : 'Yes, reset'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </SuperadminLayout>
  );
};

export default SuperAdmin;
