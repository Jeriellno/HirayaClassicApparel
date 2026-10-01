/**
 * backendHealth — a tiny, dependency-free circuit breaker for the Hiraya API.
 *
 * WHY THIS EXISTS
 * ---------------
 * The console was filling with the same two errors on every page load and every
 * window focus:
 *
 *   Request to "/cart" timed out after 15000ms. Is the Laravel server running?
 *   Request to "/wishlist" timed out after 15000ms. ...
 *   GET https://<proj>.supabase.co/rest/v1/system_settings  net::ERR_PROXY_CONNECTION_FAILED
 *
 * Those are real, but they were reported as if the APP were broken. In practice
 * the backend was HEALTHY — a direct probe answered every endpoint in 0.4-1.9s —
 * while the BROWSER could not reach it (a proxy/VPN/firewall, or the dev server
 * briefly restarting). The damage was the reporting, not the server:
 *
 *   1. Every component that mounts re-issued its request, and each one logged.
 *   2. `refetchOnWindowFocus` fired the whole set again on every tab focus, so
 *      alt-tabbing produced an unbounded stream of identical warnings.
 *   3. Nothing told the UI "the network is down", so the app looked broken.
 *
 * This module turns that into ONE piece of shared state:
 *
 *   - a request failure marks the backend UNREACHABLE,
 *   - any success marks it REACHABLE again,
 *   - while UNREACHABLE, callers can skip work instead of repeating a request
 *     that is known to be failing, and the console is told ONCE per outage.
 *
 * It is deliberately NOT a retry engine and it does NOT hide errors from the
 * caller — a request still runs and still rejects. It only stops the app from
 * shouting the same line a hundred times and lets the UI be honest.
 */

/** A network-level failure that says "I could not reach the server at all". */
const isConnectivityFailure = (error) => {
  const code = error?.code;
  /*
   * A TIMEOUT is NOT proof of unreachability.
   *
   * `ECONNABORTED`/`ETIMEDOUT` mean the request was still in flight when our own
   * budget expired — which on this dev setup is usually the single-threaded
   * `php artisan serve` QUEUEING requests behind one another, not a dead server.
   * Reporting those as connectivity failures printed "check your VPN/proxy" for
   * a backend that was answering other endpoints fine at the same moment, and
   * latched the shared health state to "unreachable" — which then SUPPRESSED
   * focus refetches for requests that would have succeeded.
   *
   * Only a true transport rejection (no response object at all, e.g.
   * ERR_NETWORK = connection refused / DNS / proxy) marks the backend down.
   */
  if (code === 'ERR_NETWORK') {
    return true;
  }
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return false;
  }
  /*
   * A CANCELED REQUEST IS NOT AN OUTAGE. IT IS THE APP CANCELLING ITSELF.
   * ---------------------------------------------------------------
   * React Query aborts an in-flight query the moment its component unmounts or
   * its key changes, and axios surfaces that as `ERR_CANCELED` with NO `.response`
   * — indistinguishable, to the two checks above, from a connection rejection.
   *
   * So a normal navigation (leaving Shop, opening the console, switching a tab)
   * cancelled every request it had in flight, each one latched the shared state to
   * UNREACHABLE, and the console then painted "BACKEND UNREACHABLE" against a
   * server that was answering 200 the whole time. That is exactly the reported
   * symptom: 200 in the Network tab, "cannot reach Hiraya" on screen.
   *
   * A cancel says the CLIENT walked away. It carries no information at all about
   * whether the server is alive, so it must never touch this state.
   */
  if (code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError') {
    return false;
  }
  // No response object at all means the request never completed a round trip —
  // a DNS, proxy or connection rejection rather than an HTTP status.
  if (!error?.response) return true;
  return false;
};

let reachable = true;
let outageLogged = false;
const listeners = new Set();

const emit = () => {
  listeners.forEach((fn) => {
    try {
      fn(reachable);
    } catch {
      /* a listener must never break the reporter */
    }
  });
};

const setReachable = (next) => {
  if (reachable === next) return;
  reachable = next;
  emit();
};

/** Subscribe to reachability changes. Returns an unsubscribe function. */
export const subscribeBackendHealth = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Current belief about whether the backend is reachable. */
export const isBackendReachable = () => reachable;

/**
 * Record the outcome of a request so the shared state reflects reality.
 * Call this from the axios interceptor for BOTH success and failure.
 */
export const reportRequestSuccess = () => {
  if (!reachable || outageLogged) {
    // Recovery is worth exactly one line, so the console shows the gap closing.
    console.info('[Hiraya] Backend reachable again.');
  }
  outageLogged = false;
  setReachable(true);
};

export const reportRequestFailure = (error) => {
  if (!isConnectivityFailure(error)) {
    // An HTTP status (401/422/500) is the server TALKING to us: it is reachable.
    setReachable(true);
    return;
  }

  setReachable(false);

  /*
   * Log the outage ONCE, with an actionable message and the reason it is not
   * necessarily the app's fault. Every later failure during the same outage is
   * counted silently instead of spamming.
   */
  if (!outageLogged) {
    outageLogged = true;
    const url = error?.config?.url || '(unknown)';
    const base = error?.config?.baseURL || '';
    console.warn(
      `[Hiraya] Cannot reach the backend at ${base}. Request: ${url}. ` +
      'The server did not respond to the connection at all. Check in order: ' +
      '(1) the Laravel dev server is running (`php artisan serve`), ' +
      '(2) no VPN/proxy is intercepting localhost, ' +
      '(3) the Vite proxy target in vite.config.js matches the running port. ' +
      'Further failures during this outage will be suppressed.',
    );
  }
};

/**
 * Reset the internal memory. FOR TESTS ONLY — lets a spec exercise the
 * unreachable -> reachable transition without depending on call order.
 */
export const __resetBackendHealth = () => {
  reachable = true;
  outageLogged = false;
  listeners.clear();
};

export default {
  subscribeBackendHealth,
  isBackendReachable,
  reportRequestSuccess,
  reportRequestFailure,
};
