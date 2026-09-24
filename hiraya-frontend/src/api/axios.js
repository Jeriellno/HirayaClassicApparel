import axios from 'axios';
import {
  reportRequestSuccess,
  reportRequestFailure,
  isBackendReachable,
} from '../utils/backendHealth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';

const TIMEOUTS = {
  DEFAULT: 15000,
  AUTH: 20000,
  NOTIFICATIONS: 30000,
  HEAVY_DATA: 45000,
  /*
   * STATUS — TIGHT ON PURPOSE.
   *
   * `/system-status` used to be a DB read over the remote Supabase pooler, so it
   * was given the 45s HEAVY_DATA ceiling to survive queueing on the single-
   * threaded dev server. The backend now serves it from a LOCAL FILE cache,
   * bypassing the network entirely, and bounds even its cold path to ~3s.
   *
   * Keeping 45s of patience here is actively harmful: this endpoint gates
   * MAINTENANCE, and `useMaintenanceMode` treats a failed read as "unknown" — so
   * a genuinely stuck request would leave the storefront gate unresolved for 45
   * seconds instead of failing fast to the safe default. Now that the endpoint is
   * local, anything past this short ceiling is a real fault, not queueing.
   */
  STATUS: 8000,
  /*
   * AI_TRYON — RAISED FROM 60s.
   *
   * The try-on POST now renders INLINE on the server when QUEUE_CONNECTION is
   * `sync` (no queue worker to run), so the request itself blocks for the whole
   * PixelAPI render — measured at ~65s, and longer when the provider's one-job
   * queue is busy. A 60s ceiling aborted requests that were about to succeed.
   * 180s covers a cold render plus queueing with room to spare.
   */
  AI_TRYON: 180000,
  /*
   * AI_ANALYSIS — GARMENT IMAGE AUTO-FILL (/analyze-image).
   *
   * The backend wraps its Gemini call in UP TO 3 ATTEMPTS to survive Google's
   * transient 503 "model overloaded" responses, with an 800ms backoff between
   * them. Each attempt carries a 30s HTTP timeout, so a request that needs every
   * retry can legitimately run for ~92s — and one in-flight test measured 82s
   * before succeeding.
   *
   * The old 45s HEAVY_DATA ceiling would ABORT that success client-side, which
   * would put the failure straight back in front of the admin: the retry work
   * the backend does to fix the 502 is only useful if the browser waits for it.
   * 120s covers the full retry budget with headroom, while staying under the
   * 180s try-on ceiling so a stuck analysis still fails faster than a render.
   */
  AI_ANALYSIS: 120000,
};

const AUTH_ENDPOINTS = ['/login', '/register', '/check-email', '/reset-password-direct'];

const TIMEOUT_RULES = [
  { pattern: /\/try-?on/, timeout: TIMEOUTS.AI_TRYON },
  { pattern: /\/analyze-image/, timeout: TIMEOUTS.AI_ANALYSIS },
  { pattern: /\/notifications/, timeout: TIMEOUTS.NOTIFICATIONS },
  { pattern: /\/(measurements|outfits\/recommended|cart|wishlist)/, timeout: TIMEOUTS.HEAVY_DATA },
  /*
   * Admin dashboard analytics.
   *
   * On the dev server (`php artisan serve`) the backend is SINGLE-THREADED and
   * every query pays a ~300ms round-trip to the remote Supabase pooler. The
   * admin dashboard fires /products, /admin/orders and /admin/analytics/dashboard
   * together on mount, so they serialize and the last one measured ~7s on its
   * own — and pushed past the 15s DEFAULT once the pooler was slow, which is
   * what surfaced as "timeout of 15000ms exceeded". The query itself is now a
   * couple of SQL aggregates, so this higher ceiling is only headroom for the
   * queueing, not a slow query.
   */
  { pattern: /\/admin\/analytics\//, timeout: TIMEOUTS.HEAVY_DATA },
  /*
   * Admin order reads.
   *
   * Same single-threaded-dev-server story as the analytics note above, but for
   * the ORDER list: on admin/dashboard mount the browser fires /products,
   * /admin/orders (count_only badge), /admin/analytics/* and /system-status
   * TOGETHER, and `php artisan serve` serves them ONE AT A TIME. Measured with
   * four concurrent requests: 9.7s of wall clock for ~3.4s of actual work, so a
   * request that is cheap on its own (a lone COUNT answers in ~220ms) can still
   * QUEUE past the 15s DEFAULT and abort with "took too long to respond".
   *
   * Every `/admin/orders` GET here is a read (list, show, or count), so the
   * HEAVY_DATA ceiling is queue headroom, not tolerance for a slow query.
   */
  { pattern: /\/admin\/orders/, timeout: TIMEOUTS.HEAVY_DATA },

  /*
   * /system-status — THE "(cancelled)" FIX.
   *
   * This endpoint looked like the LEAST likely one to need a raised ceiling: it
   * is a single `SystemSetting::all()`, a trivial SELECT. Measured on its own it
   * answers in ~3s, which is comfortably inside the 15s DEFAULT — so it had no
   * rule here, and it aborted ONLY when it mattered.
   *
   * The trap is that `system-status` is requested on EVERY page mount,
   * alongside /products, /notifications and whatever else the view fires. On the
   * single-threaded dev server (`php artisan serve`) those requests are served
   * ONE AT A TIME, so its real wall-clock time is its own 3s PLUS the queue of
   * everything ahead of it. The comment on `/admin/orders` above measured the
   * same effect: four concurrent requests cost 9.7s of wall clock for ~3.4s of
   * work. Under that queueing, `system-status` passed 15s and the BROWSER
   * aborted it — which is exactly the "(cancelled)" row in the Network tab.
   *
   * A cancelled status read is not cosmetic: the maintenance gate treats a
   * failed /system-status as "unknown", and the request that a user actually
   * cares about — POST /tryon/generate, fired in the same burst — is aborted
   * behind it. The hook then sees NO response at all, falls into its
   * `unreachable` branch (useTryOnState line ~1092), and paints
   * "FITTING INTERRUPTED / CODE: UNREACHABLE" even though the backend was up and
   * a render had completed minutes earlier. A server-side timeout and a browser
   * cancellation both reach that branch looking identical.
   *
   * HEAVY_DATA is queue headroom, not tolerance for a slow query: this endpoint
   * stays a trivial SELECT, it is simply allowed to WAIT ITS TURN behind the
   * other requests the page fired with it.
   */
  { pattern: /\/system-status/, timeout: TIMEOUTS.STATUS },

  /*
   * /admin/api-status — THE SAME QUEUEING TRAP AS /system-status ABOVE.
   *
   * This endpoint is CONFIG-ONLY and cheap on its own (it reads the server's own
   * config), but the API & AI STATUS tab is opened ON THE SAME CONSOLE as every
   * other super-admin view, and `SuperAdmin.fetchAllDatabaseData()` fires NINE
   * requests TOGETHER via Promise.all (products, canvas-assets, ai-rules,
   * live-sessions, logs, feedbacks, admin accounts, system settings, audit logs).
   *
   * `php artisan serve` is SINGLE-THREADED, so those nine are served ONE AT A
   * TIME and this one WAITS ITS TURN behind all of them. MEASURED in the browser
   * Network tab: `tryon-activity` 8.34s and `sessions` 0.67s ahead of it, and
   * `api-status` then aborted at exactly 15.01s with status "(cancelled)" — the
   * 15s DEFAULT ceiling, reached while QUEUEING rather than while querying.
   *
   * The console reported "COULD NOT LOAD THE API STATUS REPORT" for a server that
   * was answering correctly. This is the same class of false failure the
   * /system-status note describes, and it is fixed the same way: HEAVY_DATA is
   * queue headroom, NOT tolerance for a slow query — this endpoint stays a trivial
   * config read, it is simply allowed to wait for the requests ahead of it.
   *
   * The tally endpoint added to this controller (a few indexed SELECTs over
   * provider_health_events) is not what causes the wait; it only made an
   * already-queued request slightly more likely to cross the 15s line.
   */
  { pattern: /\/admin\/api-status/, timeout: TIMEOUTS.HEAVY_DATA },

  /*
   * /admin/accounts, /admin/settings, /admin/audit-logs — THE SAME QUEUEING TRAP.
   *
   * MEASURED together in the banner this fixes: on one console mount
   * `SuperAdmin.fetchAllDatabaseData()` fires NINE reads via Promise.all, and the
   * single-threaded `php artisan serve` serves them one at a time. `tryon-activity`
   * alone took 8.34s, so the requests behind it crossed the 15s DEFAULT and the
   * browser aborted them:
   *
   *     fetchAdminAccounts  -> AxiosError: timeout of 15000ms exceeded
   *     fetchSystemSettings -> AxiosError: timeout of 15000ms exceeded
   *     fetchAuditLogs      -> AxiosError: timeout of 15000ms exceeded
   *
   * These three (accounts, settings, audit logs) are each a single small SELECT —
   * `/admin/settings` is literally `SystemSetting::all()`, the same trivial read
   * as `/system-status` which is already covered below. None of them is slow; they
   * simply WAIT while the requests ahead of them finish.
   *
   * Covered as one rule because they are one symptom from one cause: a cheap read
   * queued behind a console's whole mount burst. HEAVY_DATA is headroom for the
   * QUEUE, not tolerance for a slow query. Deliberately anchored to the admin path
   * so a storefront route that happens to contain the same word is unaffected.
   */
  { pattern: /\/admin\/(accounts|settings|audit-logs)/, timeout: TIMEOUTS.HEAVY_DATA },

  /*
   * /admin/customers — THE SAME QUEUEING TRAP (and the newest stranger to it).
   *
   * This endpoint is a single small SELECT over `users WHERE role = 'user'`, so
   * on its own it is one of the CHEAPEST reads in the console. It nonetheless
   * aborted with "timeout of 15000ms exceeded" the moment the Customers tab
   * opened, for the exact reason the notes above describe: the console mounts
   * NINE requests together via Promise.all and the single-threaded
   * `php artisan serve` serves them ONE AT A TIME, so this read spends almost
   * all of its wall clock WAITING rather than querying.
   *
   * It had no rule here because it did not exist when the others were written,
   * so it inherited the 15s DEFAULT and was the first to cross the line.
   *
   * Deliberately anchored to the admin path so a storefront route containing the
   * same word is unaffected. HEAVY_DATA is headroom for the QUEUE, not tolerance
   * for a slow query.
   */
  { pattern: /\/admin\/customers/, timeout: TIMEOUTS.HEAVY_DATA },

  /*
   * /products — THE SAME QUEUEING TRAP, NOW ON THE SUPERADMIN INVENTORY.
   *
   * This is the ONE dataset the SuperAdmin console reads from Laravel rather
   * than Supabase (`SuperAdmin.fetchProducts`), and it inherited the 15s DEFAULT
   * because it is a storefront route and was assumed to be fast.
   *
   * MEASURED SOLO on this machine: `GET /api/products` answers 200 in 4.86s.
   * That is ALREADY a third of the budget for a single request, because every
   * row is hydrated through Eloquent over the remote Supabase pooler. It passed
   * on its own and aborted the moment it had COMPANY:
   *
   *     SuperAdmin: failed to load products from Laravel
   *     AxiosError: timeout of 15000ms exceeded
   *
   * `fetchAllDatabaseData()` fires NINE reads at once and `php artisan serve` is
   * SINGLE-THREADED, so this one WAITS ITS TURN behind the other eight (the
   * notes above measured that burst at 9.7s of wall clock for ~3.4s of work).
   * Its own 4.86s plus that queue crosses 15s.
   *
   * HEAVY_DATA is headroom for the QUEUE, not tolerance for a slow query.
   *
   * NOTE THE ABSENT LEADING SLASH ANCHOR: the storefront shares this exact route
   * (`GET /products`), so unlike the /admin/* rules above this one cannot be
   * narrowed to a console path — the storefront needs the same patience for the
   * same reason, and widening its ceiling changes no behaviour that was not
   * already failing intermittently behind the mount burst.
   */
  { pattern: /\/products/, timeout: TIMEOUTS.HEAVY_DATA },
];

const isAuthEndpoint = (url = '') =>
  AUTH_ENDPOINTS.some((endpoint) => String(url).includes(endpoint));

const getTimeoutForUrl = (url = '') => {
  const target = String(url);
  if (isAuthEndpoint(target)) return TIMEOUTS.AUTH;
  const matchedRule = TIMEOUT_RULES.find((rule) => rule.pattern.test(target));
  return matchedRule ? matchedRule.timeout : TIMEOUTS.DEFAULT;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: TIMEOUTS.DEFAULT,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

export const getAuthToken = () =>
  localStorage.getItem('token') || sessionStorage.getItem('token');

/**
 * SUPER ADMIN TOKEN BYPASS (dev request) — "para hindi na manghingi ng
 * permission" sa /superadmin.
 *
 * WHY
 * ---
 * The console lives on the /superadmin path. When there is no session token,
 * every /api/admin/* call the console makes (notably POST /admin/products/
 * analyze-image for "Auto-fill Details (AI)" and POST /admin/products for
 * "Add Garment") is sent WITHOUT an Authorization header, so the backend's
 * auth:sanctum + superadmin gate answers 401/403 — the "Forbidden / permission"
 * the user keeps hitting.
 *
 * WHAT THIS DOES
 * --------------
 * On the /superadmin path, if no token is stored yet, this transparently
 * performs a REAL login against /api/login with the seeded dev superadmin and
 * caches the returned bearer token. Every subsequent console call then carries
 * a valid Admin/Super Admin token, so the AI auto-fill and product save WORK
 * with no permission prompt.
 *
 * The backend gate is NOT weakened — a real, valid token is still presented;
 * we only stop the console from launching with an empty session.
 *
 * SCOPE / SAFETY
 * --------------
 *  - DEV ONLY: compiled out of a production build (import.meta.env.DEV).
 *  - Only triggers on the /superadmin path; the storefront is untouched.
 *  - Credentials are the LOCAL dev seed (UserSeeder) — not a production secret.
 *  - Set VITE_SUPERADMIN_AUTOLOGIN=false in the front-end .env to disable.
 */
/*
 * Candidate dev accounts, tried IN ORDER until one logs in. Both the seeded
 * superadmin (UserSeeder) AND the admin that `_set_dev_admin_password.php`
 * provisions are listed, because only one of them is guaranteed to exist in a
 * given local database. Either one satisfies the `admin` gate that was
 * answering "Forbidden. Admin access required."
 */
/*
 * The hardcoded dev super-admin accounts (superadmin@hiraya.com /
 * admin@hiraya.com) were REMOVED per request — they are not used yet.
 *
 * The AI garment analysis endpoint is now PUBLIC (POST /products/analyze-image),
 * so no admin token is needed for "Auto-fill Details (AI)". Admin-only routes
 * (product save/update/delete, ai-rules, canvas-assets, ...) still require a
 * REAL admin session — promote an account with `php artisan hiraya:make-admin`.
 */
const SUPERADMIN_CREDS = [];

const isSuperAdminPath = () => {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.toLowerCase().startsWith('/superadmin');
};

/**
 * True when the STORED user already holds admin/superadmin rights.
 *
 * WHY THIS MATTERS: the "Forbidden. Admin access required." (403) the console
 * shows is NOT a missing token — it is a token whose user is a plain CUSTOMER.
 * A leftover customer session in localStorage passed the old `if (existing)
 * return existing` short-circuit, so the bypass never signed in as superadmin
 * and every /api/admin/* call was refused by EnsureUserIsAdmin. Checking the
 * stored role (not just the token's existence) is what fixes it.
 */
const hasStoredAdminRole = () => {
  try {
    const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
    if (!raw) return false;
    const role = String(
      JSON.parse(raw)?.role ?? '',
    ).toLowerCase().replace(/[\s_-]+/g, '');
    return role === 'admin' || role === 'superadmin';
  } catch {
    return false;
  }
};

let superAdminTokenRequest = null;

/**
 * Ensures a token exists on the /superadmin path by silently logging in once.
 * Returns the (cached) token, or null when the bypass does not apply.
 *
 * A stored token is REUSED only when its user is already an admin/superadmin;
 * a customer (or roleless) token is discarded and replaced with a real
 * superadmin session, which is what removes the "Forbidden" 403.
 */
const ensureSuperAdminToken = async () => {
  if (!import.meta.env?.DEV) return null;
  if (import.meta.env?.VITE_SUPERADMIN_AUTOLOGIN === 'false') return null;
  if (!isSuperAdminPath()) return null;

  const existing = getAuthToken();
  if (existing && hasStoredAdminRole()) return existing;

  // Stale customer/non-admin session: drop it so the fresh superadmin token is
  // the one every subsequent request carries.
  if (existing && !hasStoredAdminRole()) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
  }

  // No dev accounts configured — nothing to auto-login with.
  if (!SUPERADMIN_CREDS.length) return null;

  if (!superAdminTokenRequest) {
    superAdminTokenRequest = (async () => {
      for (const creds of SUPERADMIN_CREDS) {
        try {
          const res = await axios.post(`${API_BASE_URL}/login`, creds, {
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            timeout: TIMEOUTS.AUTH,
          });

          const token = res.data?.token;
          const user = res.data?.user;

          if (token) {
            localStorage.setItem('token', token);
            if (user) localStorage.setItem('user', JSON.stringify(user));
            return token;
          }
        } catch {
          // Try the next candidate account.
        }
      }

      return null;
    })().finally(() => {
      superAdminTokenRequest = null;
    });
  }

  return superAdminTokenRequest;
};

export const clearStoredSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
};

export const parseApiError = (error) => {
  const status = error?.response?.status ?? 0;
  const data = error?.response?.data;
  const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
  const isNetworkError = error?.code === 'ERR_NETWORK' || (!error?.response && !isTimeout);

  const rawErrors = data?.errors;
  const errors = {};
  if (rawErrors && typeof rawErrors === 'object') {
    Object.entries(rawErrors).forEach(([field, messages]) => {
      errors[field] = Array.isArray(messages) ? messages[0] : String(messages);
    });
  }

  let message =
    data?.message ||
    (typeof data === 'string' && data ? data : '') ||
    error?.message ||
    'Something went wrong. Please try again.';

  if (isTimeout) {
    message = 'The Hiraya server took too long to respond.';
  } else if (isNetworkError) {
    message = 'Cannot reach the Hiraya server.';
  } else if (status === 401 && Object.keys(errors).length === 0) {
    message = data?.message || 'Invalid credentials or session expired.';
  }

  return { status, message, errors, isTimeout, isNetworkError, isServerError: status >= 500 };
};

// Request Interceptor
api.interceptors.request.use(
  async (config) => {
    let token = getAuthToken();

    /*
     * SUPERADMIN TOKEN BYPASS — runs on EVERY request on the /superadmin path.
     *
     * This used to be `if (!token) { token = await ensureSuperAdminToken(); }`,
     * which only fired when the session was EMPTY. That left the exact reported
     * bug: a stale CUSTOMER token sitting in localStorage is truthy, so the
     * bypass never ran and the request carried a non-admin token — the backend's
     * EnsureUserIsAdmin answered "Forbidden. Admin access required." (403) and
     * the AI auto-fill / product save failed.
     *
     * ensureSuperAdminToken() now also REPLACES a stored token whose user is not
     * admin/superadmin, so it must be consulted unconditionally on this path.
     * Off /superadmin it returns the current token unchanged (or null), so the
     * storefront and normal sign-in are unaffected.
     */
    const ensured = await ensureSuperAdminToken();
    if (ensured) {
      token = ensured;
    } else if (isSuperAdminPath() && token && !hasStoredAdminRole()) {
      // The bypass is disabled but a non-admin token is present — do not send it
      // to /api/admin/*, where it can only produce a 403.
      token = null;
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    } else {
      config.headers['Accept'] = 'application/json';
      config.headers['Content-Type'] = 'application/json';
    }

    config.timeout = config.explicitTimeout || getTimeoutForUrl(config.url);
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
api.interceptors.response.use(
  (response) => {
    reportRequestSuccess();
    return response;
  },
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url;

    reportRequestFailure(error);

    // Huwag agad burahin ang session sa mga paminsan-minsang 401 kapag naglo-load ng dashboard
    // Lilinisin lamang ang session kung ang request na nag-fail ay ang mismong check user route (`/user`)
    if (status === 401 && url?.includes('/user') && !isAuthEndpoint(url)) {
      clearStoredSession();
    }

    return Promise.reject(error);
  }
);

export { isBackendReachable };
export default api;