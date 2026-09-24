import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { isBackendReachable } from '../utils/backendHealth';

/**
 * Reads the public system status so the storefront can honor maintenance mode.
 *
 * The settings live in MySQL and are toggled from the Super Admin console, so
 * the backend exposes a PUBLIC read-only endpoint (GET /system-status) that
 * returns just the non-sensitive flags.
 *
 * NON-BLOCKING BY DESIGN
 * ----------------------
 * This hook used to be the ONLY reason the whole app blanked on load: App.jsx
 * folded its `loading` flag into a global "Hiraya is Loading..." screen, so a
 * slow or unreachable `/system-status` (a single-threaded dev server queueing
 * requests, a proxy, backend down) held the ENTIRE storefront — including /shop
 * — blank for the full 15s request timeout. The shop then looked "broken".
 *
 * The fix here is behavioural: the hook NEVER blocks the UI. It starts from the
 * safe default (maintenance OFF) and only flips the flag once the server
 * CONFIRMS maintenance is on. While the check is in flight the rest of the app
 * renders normally.
 *
 * It also re-checks on a slow interval and when the tab regains focus, so a
 * superadmin toggling maintenance does not require every visitor to reload.
 */

const DEFAULT_FLAGS = {
  registrations_open: true,
  ai_engine_active: true,
};

/**
 * MAINTENANCE GATE — REMOVED.
 * ===================================================================
 * Maintenance mode was removed from the Super Admin console, so there is no
 * longer a flag to honor or a screen to show. This switch stays `false` and the
 * hook issues ZERO `/system-status` requests — no fetch on mount, no interval,
 * no focus refresh, no visibilitychange refresh.
 *
 * The two flags the storefront STILL consumes (registrations_open,
 * ai_engine_active) are served from the defaults above, so the Register and
 * Try-On gates keep working with their permissive values.
 *
 * NOTE: `/system-status` is a useful endpoint and still exists on the backend.
 * Flipping this to `true` re-enables the polling if a future flag needs to be
 * read live; nothing else has to change.
 */
const MAINTENANCE_GATE_ENABLED = false;

// Per-tab cache so component remounts (route changes, HMR) do not re-fetch the
// same tiny payload on every navigation. A focus/interval refresh keeps it fresh.
let cachedFlags = null;

// Slow poll — this is a maintenance gate, not live data; 60s is plenty and
// keeps the request count negligible.
const REFRESH_INTERVAL_MS = 60000;

/*
 * FOCUS THROTTLE — do not re-ask on every flick of the window.
 *
 * The focus listener served a real purpose (a long-lived tab should notice a
 * superadmin toggling maintenance), but firing on EVERY focus event made the
 * request count unbounded: alt-tabbing across several tabs re-issued it
 * constantly. `/system-status` is the most-requested endpoint in the app and the
 * dev server is single-threaded, so that burst could occupy the one worker and
 * stall every other request — the measured "the whole site looks dead" outage.
 *
 * 5s still feels instant to a human returning to the tab while capping the rate
 * at which a single window can drive traffic.
 */
const FOCUS_THROTTLE_MS = 5000;

/*
 * BACKGROUND TAB PAUSING — THE "umuulit pag wala sa website" FIX.
 *
 * MEASURED COMPLAINT: with the fitting RENDERING, switching to another tab left
 * `/system-status` polling in the background, and the requests kept repeating
 * while the customer was away from the site.
 *
 * The cause was the 60s `setInterval` below: it was registered unconditionally
 * and NEVER stopped when the tab went to the background. `window.focus`
 * throttling (above) only covered the FOCUS event — it did nothing about the
 * interval, so a backgrounded tab kept firing every minute regardless.
 *
 * That is worst exactly when it matters most. A render can take ~60-165s on the
 * backend path (`php artisan serve` is single-threaded), so a customer who starts
 * a fitting and then browses elsewhere has their tab quietly spending the one
 * worker on maintenance checks — competing with the very render they are waiting
 * for. Multiply by every open tab and the burst is self-amplifying.
 *
 * A BACKGROUND TAB HAS NO USER LOOKING AT IT. There is nothing to keep fresh, so
 * the interval is suspended while hidden and resumed on the way back. The
 * `visibilitychange` handler below performs one refresh on RETURN, so the flags
 * are current the moment the tab is visible again — the behaviour the interval
 * was trying to provide, without the background traffic.
 */

/** Is this tab currently visible to the user? */
const isTabVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden';

/*
 * FAILURE BACKOFF — stop asking while the backend is known to be down.
 *
 * A failed read used to leave the 60s interval running, so during an outage every
 * open tab kept firing a request that could only fail — against a server that was
 * already struggling. That self-amplifies: the failing requests are what keep the
 * single-threaded worker too busy to recover.
 *
 * While `backendHealth` reports UNREACHABLE the interval check is skipped
 * entirely. A single success anywhere in the app flips that state back, and the
 * next tick resumes automatically — so recovery needs no reload.
 */

/*
 * SHARED IN-FLIGHT PROMISE — one request for the whole tab, not one per caller.
 *
 * The per-tab `cachedFlags` already prevented a re-fetch on remount, but several
 * components can mount in the SAME tick (a route change rendering a shell plus
 * its children), and each called fetchMaintenanceStatus independently — issuing
 * concurrent identical requests. Deduping them keeps one round trip per tick.
 */
let inFlight = null;

export const useMaintenanceMode = () => {
  const [flags, setFlags] = useState(cachedFlags || DEFAULT_FLAGS);
  const isMountedRef = useRef(true);
  const lastFetchRef = useRef(0);
  const intervalRef = useRef(null);

  const fetchMaintenanceStatus = useCallback(async (options = {}) => {
    const { force = false } = options;

    /*
     * GATE DISABLED — stay completely silent.
     *
     * Return before ANY of the checks below so no request, no backoff bookkeeping
     * and no state update happens. The hook keeps serving DEFAULT_FLAGS, which is
     * the same safe fallback it already used when the read failed — so nothing
     * downstream needs to know the gate is off.
     */
    if (!MAINTENANCE_GATE_ENABLED) return;

    /*
     * Skip while the backend is known to be unreachable — see the backoff note
     * above. `force` (an explicit user-driven refresh) bypasses it so a customer
     * can always try again without reloading the page.
     */
    if (!force && !isBackendReachable()) return;

    /*
     * NEVER POLL A TAB NOBODY IS LOOKING AT.
     *
     * Applies to the interval AND to a stray focus/focus-event that lands while
     * the document is hidden. See the BACKGROUND TAB PAUSING note above.
     */
    if (!force && !isTabVisible()) return;

    // Deduplicate concurrent callers into the single request already running.
    if (inFlight) return inFlight;

    lastFetchRef.current = Date.now();

    inFlight = (async () => {
      try {
        const res = await api.get('/system-status');
        if (!isMountedRef.current) return;

        const data = res.data && typeof res.data === 'object' ? res.data : {};
        const next = { ...DEFAULT_FLAGS, ...data };
        cachedFlags = next;
        setFlags(next);
      } catch (err) {
        /*
         * A failed status read must NEVER block or alarm the storefront. The
         * safe default is "not in maintenance", and we say so ONCE at warn level
         * rather than logging on every mount/focus.
         */
        if (!cachedFlags) {
          console.warn(
            '[Hiraya] System status unavailable — assuming maintenance is OFF.',
            err?.message || err,
          );
        }
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    // Gate disabled: do not fetch, do not start the interval, do not listen for
    // focus/visibility. The hook simply holds DEFAULT_FLAGS.
    if (!MAINTENANCE_GATE_ENABLED) {
      return () => {
        isMountedRef.current = false;
      };
    }

    fetchMaintenanceStatus();

    /*
     * START/STOP THE INTERVAL WITH VISIBILITY.
     *
     * The interval is created ONLY while the tab is visible. Going to another tab
     * tears it down entirely, so a backgrounded tab issues ZERO periodic
     * requests instead of one per minute — the reported repeat.
     */
    const startInterval = () => {
      if (intervalRef.current !== null) return;
      intervalRef.current = setInterval(() => {
        // Belt-and-braces: a tick that lands after the tab is hidden is skipped.
        if (!isTabVisible()) return;
        fetchMaintenanceStatus();
      }, REFRESH_INTERVAL_MS);
    };

    const stopInterval = () => {
      if (intervalRef.current === null) return;
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    };

    if (isTabVisible()) startInterval();

    /*
     * Re-check when the tab becomes visible again (covers a long-lived tab) —
     * throttled, so alt-tabbing cannot drive an unbounded request burst.
     */
    const onFocus = () => {
      if (Date.now() - lastFetchRef.current < FOCUS_THROTTLE_MS) return;
      fetchMaintenanceStatus();
    };
    window.addEventListener('focus', onFocus);

    /*
     * VISIBILITY IS THE AUTHORITY.
     *
     * `visibilitychange` fires for tab switches AND window minimising, which the
     * `focus` event alone does not reliably cover. On the way back it refreshes
     * immediately (so the flags are never stale when the customer returns) and
     * restarts the interval; on the way out it stops the interval outright.
     */
    const onVisibilityChange = () => {
      if (isTabVisible()) {
        startInterval();
        fetchMaintenanceStatus();
      } else {
        stopInterval();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      isMountedRef.current = false;
      stopInterval();
      window.removeEventListener('focus', onFocus);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [fetchMaintenanceStatus]);

  /*
   * `loading` is reported for callers that genuinely want to show a spinner,
   * but it does NOT gate the app shell any more — see App.jsx. It resolves
   * immediately when a cached value already exists.
   */
  return {
    registrationsOpen: flags.registrations_open !== false,
    aiEngineActive: flags.ai_engine_active !== false,
    // With the gate disabled nothing is ever in flight, so this must not report
    // "still loading" forever — it would be a permanent, misleading true.
    loading: MAINTENANCE_GATE_ENABLED && cachedFlags === null,
  };
};

export default useMaintenanceMode;