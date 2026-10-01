import axios from 'axios';
import { reportRequestSuccess, reportRequestFailure, isBackendReachable } from '../utils/backendHealth';
import { supabase } from '../services/supabase';

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
   * The backend walks the configured Gemini MODEL CHAIN (`model` first, then
   * `gemini.models`), retrying each one up to 3 times with an 800ms backoff, and
   * each attempt carries its own 30s HTTP timeout. A first model that is retired
   * (404), out of its 20/day free quota (429), overloaded (503) or simply slow
   * therefore no longer ends the request — the backend falls through to the next
   * entry and answers.
   *
   * 120s covered exactly ONE model exhausting all three attempts. With the chain
   * in front of it the same budget is spent on a model that is failing for a
   * reason a retry cannot fix, so the ceiling is raised to 300s. That stays
   * above the worst case (2 models x 3 attempts x 30s + backoff ~= 184s) with
   * headroom, and it is a CLIENT ceiling only: the backend gives up on its own
   * first, so an actually-broken call still returns its real 502/504 message
   * long before this fires.
   *
   * It is deliberately still BELOW the 360s try-on render ceiling — the auto-fill
   * is a foreground button an admin waits on, and a failed analysis should not
   * hang for as long as a full garment render.
   */
  AI_ANALYSIS: 300000,
};

/*
 * ENDPOINTS WHOSE 401 MUST NOT WIPE THE SESSION.
 *
 * These are the requests a LOCKED-OUT customer makes: they cannot sign in, so
 * there is no session to restore, and the response interceptor's habit of
 * clearing storage on 401 would destroy a valid one if they happened to have
 * one. More importantly, `/forgot-password` and `/validate-reset-token` answer
 * a probe with 200 for enumeration safety (see PasswordResetService) — the
 * 401 they can produce is a RATE LIMIT or a transient auth failure, not an
 * expired session, and treating it as one logs the person out mid-reset.
 */
const AUTH_ENDPOINTS = [
  '/login',
  '/register',
  '/check-email',
  '/reset-password-direct',
  '/forgot-password',
  '/validate-reset-token',
];

const TIMEOUT_RULES = [
  /*
   * /tryon/history — THE RULE ABOVE, NARROWED. THIS ONE MUST COME FIRST.
   *
   * `find()` returns the FIRST matching rule, and the blanket `/\/try-?on/`
   * below catches `/tryon/history` too, so every history read was being given
   * the 180s RENDER budget. That budget exists for a reason: POST /tryon/generate
   * blocks on a full PixelAPI render, measured at ~65s and up to ~155s when the
   * provider's one-job queue is busy. A history read is nothing of the sort —
   * MEASURED solo at 1.7s-5.9s, and it is a single indexed SELECT.
   *
   * The 180s was actively harmful here, on the single-threaded `php artisan serve`
   * (the same queueing trap documented for /system-status and /admin/orders).
   * This page is a CUSTOMER-FACING route, and it is requested on every mount.
   * `TryOnHistory.load()` shows a full-page "Loading your looks…" spinner for
   * the entire wait, so one queued read parked the grid in that state for up to
   * THREE MINUTES — a page that looks broken rather than slow. It is also the
   * exact route a customer opens to find out whether a render they just waited
   * on actually landed, so a 3-minute blank grid there is the worst possible
   * place to spend the patience.
   *
   * HEAVY_DATA is queue headroom for the dev server, not tolerance for a slow
   * query — this endpoint stays one cheap SELECT. Anchored to the `/history`
   * path so the render and its polling (`/status`, `/initiate`, `/retry`) keep
   * the 180s budget they genuinely need.
   */
  { pattern: /\/try-?on\/history/, timeout: TIMEOUTS.HEAVY_DATA },
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
   *
   * /admin/feedbacks joins the rule for the same reason: a small SELECT that
   * was aborted at 15s ("Failed: Feedback") while queued behind a save.
   */
  { pattern: /\/admin\/(accounts|settings|audit-logs|feedbacks)/, timeout: TIMEOUTS.HEAVY_DATA },

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

/*
 * ADMIN PATHS ARE THE ONES AUTHORIZED BY AAL, SO THEY CARRY THE SUPABASE JWT.
 *
 * Anchored on the `/admin` segment rather than on a bare substring, so a
 * storefront route that happens to contain the word (e.g. `/outfits/recommended`)
 * is never misclassified and never loses its Sanctum token.
 */
const isAdminPath = (url = '') => /(^|\/)(api\/)?admin(\/|$|\?)/.test(String(url));

/*
 * THE CATALOG WRITES ARE AAL2-GATED BUT ARE NOT NAMED `/admin/...`.
 * ------------------------------------------------------------------
 * `POST /products`, `PUT|PATCH|DELETE /products/{id}` live behind
 * `supabase.aal2` + `supabase.user` + `admin` on the Laravel side (see
 * hiraya-backend/routes/api.php), yet their paths carry no `/admin`
 * segment — so `isAdminPath()` was false for them and the request
 * interceptor left on the header whatever `getAuthToken()` returned.
 *
 * For a staff console that value is usually a Laravel Sanctum token (an
 * opaque string with no JWT shape at all) or nothing, and
 * `EnsureSupabaseAAL2` answers exactly what was reported:
 *
 *     "Unauthenticated. A Supabase access token is required."
 *
 * The Save / Edit / Delete buttons worked only while the routes were
 * left PUBLIC, which is not a fix — it deleted the lock instead of
 * repairing the credential. The credential is the Supabase access token
 * and the request has to carry it, so the classification is widened
 * here instead of loosening the backend.
 *
 * It is deliberately METHOD-SCOPED. `GET /products` is the storefront
 * catalog and must keep working for an anonymous shopper, so only the
 * write verbs on a bare `/products` path are reclassified.
 *
 * The literal PUBLIC sub-routes under the same prefix are excluded by name.
 * `/products/analyze-image` is a single segment and would otherwise satisfy the
 * item pattern, which is harmless for correctness (an extra bearer token on a
 * public route changes nothing) but NOT free: it puts an awaited
 * `supabase.auth.getSession()` in front of the auto-fill request on every
 * photo, and turns a public endpoint into one that reports a session error
 * when the console has none. Two-segment routes such as
 * `/products/{id}/track-canvas` are excluded by the pattern's shape.
 */
const CATALOG_WRITE_PATH = /^\/products\/?$/;
const CATALOG_WRITE_ITEM_PATH = /^\/products\/[^/]+\/?$/;
const CATALOG_WRITE_VERBS = new Set(['post', 'put', 'patch', 'delete']);
const PUBLIC_CATALOG_SUBROUTES = new Set([
  'analyze-image',
  'spotlight',
  'track-canvas',
  'track-tryon'
]);

const isCatalogWrite = (method = '', url = '') => {
  const verb = String(method).toLowerCase();
  if (!CATALOG_WRITE_VERBS.has(verb)) return false;
  // Strip the query string so a cache-buster cannot defeat the anchor.
  const path = String(url).split('?')[0].replace(/^.*\/api/, '');
  if (CATALOG_WRITE_PATH.test(path)) return true;
  if (!CATALOG_WRITE_ITEM_PATH.test(path)) return false;
  // A write aimed at a reserved public sub-route is not a catalogue mutation.
  return !PUBLIC_CATALOG_SUBROUTES.has(path.split('/')[2] || '');
};

/**
 * THE ONE PREDICATE that answers "does this request carry the Supabase JWT?".
 * Both the request and the response interceptor use it, so the header that is
 * attached and the header that is diagnosed can never disagree.
 */
const needsSupabaseToken = (config = {}) =>
  isAdminPath(config?.url) || isCatalogWrite(config?.method, config?.url);

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

export const clearStoredSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
};

export const parseApiError = (error) => {
  /*
   * AN ALREADY-NORMALIZED ERROR MUST NOT BE RE-PARSED.
   *
   * AuthContext.login (and friends) catch an axios error, flatten it to a plain
   * Error carrying { message, status, errors, isAuthError } and re-throw it.
   * Callers then run that result through parseApiError a second time.
   *
   * On the second pass there is no .response, so the naive logic below derives
   * `isNetworkError = !error.response && !isTimeout` -> TRUE and overwrites the
   * real message with "Cannot reach the Hiraya server." The backend's actual
   * "Invalid credentials. Please check your email and password." was DISCARDED,
   * so a wrong password read to the user as an unreachable server.
   *
   * If the object already carries the normalized shape, trust it verbatim.
   */
  if (error?.isAuthError || (error?.status !== undefined && error?.errors !== undefined)) {
    return {
      status: error.status ?? 0,
      message: error.message || 'Something went wrong. Please try again.',
      errors: error.errors || {},
      isTimeout: !!error.isTimeout,
      isCanceled: !!error.isCanceled,
      isNetworkError: !!error.isNetworkError,
      isServerError: (error.status ?? 0) >= 500,
    };
  }

  const status = error?.response?.status ?? 0;
  const data = error?.response?.data;
  const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
  /*
   * A CANCELED REQUEST IS NOT A NETWORK FAILURE. THE CLIENT ABORTED IT.
   * ------------------------------------------------------------
   * React Query aborts an in-flight query on unmount / key change, and `fetch`
   * aborts on its own `AbortController`. axios reports the first as
   * `ERR_CANCELED` and the second as `AbortError` — both with NO `.response`,
   * so the `isNetworkError` test below called them connectivity failures.
   *
   * The user-visible consequence was concrete: navigating away from a page while
   * it was loading produced "Cannot reach the Hiraya server." for a request that
   * was never going to return anyway. That is a false accusation against the
   * network, and it is what made a working backend look dead.
   *
   * There is no server-side fact to report here, so the honest message says the
   * request was cancelled and names nothing.
   */
  const isCanceled =
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError';
  const isNetworkError =
    !isCanceled && (error?.code === 'ERR_NETWORK' || (!error?.response && !isTimeout));

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
  } else if (isCanceled) {
    message = 'That request was cancelled before it finished. Please try again.';
  } else if (isNetworkError) {
    message = 'Cannot reach the Hiraya server.';
  } else if (status === 401 && Object.keys(errors).length === 0) {
    message = data?.message || 'Invalid credentials or session expired.';
  }

  return {
    status,
    message,
    errors,
    isTimeout,
    isCanceled,
    isNetworkError,
    isServerError: status >= 500,
  };
};

// Request Interceptor
// Request Interceptor
api.interceptors.request.use(
  async (config) => {
    /*
     * AUTHENTICATION RULE
     *
     * Normal requests use the stored application token.
     * Admin requests use the current Supabase access token because
     * the Laravel admin middleware checks the Supabase JWT.
     */

    const token = getAuthToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    /*
     * ADMIN REQUESTS + AAL2-GATED CATALOG WRITES
     *
     * The Laravel side authorizes `POST /products`, `PUT|PATCH /products/{id}`
     * and `DELETE /products/{id}` with `supabase.aal2` + `admin`, so those must
     * carry the Supabase session JWT exactly like an `/admin/...` call does —
     * even though their path has no `/admin` segment. `needsSupabaseToken()` is
     * that single decision (see its definition above).
     *
     * IMPORTANT:
     * Do not silently remove the existing Authorization header unless
     * Supabase explicitly has no session.
     */
    if (needsSupabaseToken(config)) {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error('ADMIN SUPABASE SESSION ERROR:', error);
        }

        const session = data?.session;
        const accessToken = session?.access_token;

        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        } else {
          /*
           * NO SESSION — DO NOT STRIP THE HEADER.
           *
           * The previous branch deleted `Authorization` here. That was right for
           * `/admin/*` (where the Supabase JWT is the only credential) and wrong
           * for the catalogue writes, and deleting it is what produced the exact
           * reported failure: with no live Supabase session the header was removed
           * and `EnsureSupabaseAAL2` replied
           * "Unauthenticated. A Supabase access token is required." — with nothing
           * on screen telling the admin they were signed out.
           *
           * Leaving the last known token in place costs nothing (a stale JWT is
           * rejected by the middleware on its own merits, with the same 401) and
           * wins the case where the session was only momentarily unreadable. So the
           * header is only ever REPLACED, never deleted, and a genuinely missing
           * session is reported below instead of being laundered into a bare 401.
           */
          console.warn(
            'No Supabase session for an AAL2-gated request. Sending the last known token.',
            { method: config.method, url: config.url }
          );
        }
      } catch (error) {
        /*
         * A THROWN `getSession()` (locked IndexedDB, a revoked refresh token, a
         * storage exception) is not proof that there is no session, so the header
         * is left alone. Deleting it here would reproduce the same bare 401 this
         * whole path exists to prevent.
         */
        console.error('Could not read the Supabase session for an AAL2-gated request.', error);
      }
    }

    /*
     * FormData requests need the browser to set Content-Type
     * automatically so the multipart boundary is included.
     */
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    } else {
      config.headers['Accept'] = 'application/json';
      config.headers['Content-Type'] = 'application/json';
    }

    /*
     * Apply endpoint-specific timeout.
     */
    config.timeout =
      config.explicitTimeout ||
      getTimeoutForUrl(config.url);

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
    const url = error?.config?.url ?? '';
    const status = error?.response?.status ?? 0;

    if (status === 401 && isAdminPath(url)) {
      console.error('====================================');
      console.error('ADMIN API 401');
      console.error('URL:', url);
      console.error('STATUS:', status);
      console.error('RESPONSE:', error?.response?.data);
      console.error('HEADERS:', error?.response?.headers);
      console.error('====================================');
    }

    /*
     * A 401 ON AN AAL2-GATED ROUTE — EXPLAIN IT, DO NOT JUST PRINT IT.
     *
     * "Unauthenticated. A Supabase access token is required." is the backend
     * talking correctly about a request that carried no usable Supabase JWT, but
     * on its own it is unactionable for the admin who just pressed Save. The
     * message is rewritten in place with the one thing that actually fixes it —
     * the console session has to be re-established through the TOTP challenge —
     * while the original stays on `error.response.data` for the console trail.
     *
     * The session is NOT cleared here. This route set is reached by staff who ARE
     * signed in; wiping their session over a failed write would throw away a
     * valid sign-in and drop them to /login mid-entry.
     */
    if (status === 401 && needsSupabaseToken(error?.config)) {
      const message = error?.response?.data?.message || '';

      if (/access token is required|legacy login token|Invalid or expired session token/i.test(message)) {
        const explanation =
          'Your admin session has expired or was not completed. Please sign in again (including your 2-step verification) before saving.';

        console.error('AAL2-gated request rejected — the Supabase session was missing or stale.', {
          method: error?.config?.method,
          url: error?.config?.url,
          backendMessage: message,
        });

        error.response.data.message = explanation;
        error.response.data.backend_message = message;
      }
    }

    reportRequestFailure(error);

    // Huwag agad burahin ang session sa mga paminsan-minsang 401 kapag naglo-load ng dashboard
    // Lilinisin lamang ang session kung ang request na nag-fail ay ang mismong check user route (`/user`)
    if (status === 401 && url?.includes('/user') && !isAuthEndpoint(url)) {
      clearStoredSession();
    }

    /*
     * 403 ON AN ADMIN PATH — LOGGED, NOT INTERPRETED, AND THE SESSION KEPT.
     *
     * There is deliberately no branch here any more. This used to read
     * `mfa_enrollment_required` off the body and push an "activation required"
     * screen, but that activation step no longer exists: a staff account is active
     * the moment its TOTP challenge is verified, and `supabase.aal2` verifies that
     * cryptographically on EVERY request. The `mfa_enrolled_at` column was a
     * second, stale copy of a fact the middleware had already proven, and reading it
     * here is what put a correctly-enrolled admin in front of a QR code they did
     * not need.
     *
     * A 403 is now a plain refusal — wrong role, or a suspended account — and the
     * route guard is what decides where to send the user.
     *
     * The session is still NOT cleared. A 403 is never "logged out": an aal1 session
     * that reaches an aal2 endpoint is a legitimate state, merely not a sufficient
     * one, and wiping it would throw away a valid password sign-in over a code the
     * user has simply not typed yet.
     */
    if (status === 403 && needsSupabaseToken(error?.config) && !isAuthEndpoint(url)) {
      console.warn(
        'Admin request returned 403:',
        url,
        error?.response?.data
      );
    }

    return Promise.reject(error);
  }
);

export { isBackendReachable };
export default api;
