/**
 * Unit test for the backendHealth circuit breaker.
 *
 * Verifies the exact behaviour the console fix depends on:
 *   1. A transport failure marks the backend unreachable.
 *   2. A SECOND failure during the same outage does NOT log again (the whole
 *      point - no repeated spam).
 *   3. An HTTP status (401) is NOT a connectivity failure; it keeps the backend
 *      marked reachable.
 *   4. A success flips the state back to reachable.
 *   5. Subscribers are notified on transitions.
 *
 * Runs in Node: the module is pure JS with no DOM dependency.
 */

import {
  subscribeBackendHealth,
  isBackendReachable,
  reportRequestSuccess,
  reportRequestFailure,
  __resetBackendHealth,
} from './hiraya-frontend/src/utils/backendHealth.js';

let fail = 0;
const ok = (label, pass, detail = '') => {
  console.log((pass ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  (' + detail + ')' : ''));
  if (!pass) fail++;
};

console.log('\n=== BACKEND HEALTH TEST ===\n');

/* Count log calls to prove the spam is actually gone. */
const origWarn = console.warn;
const origInfo = console.info;
let warnCount = 0;
let infoCount = 0;
console.warn = () => { warnCount++; };
console.info = () => { infoCount++; };

/* --- 1. transport failure => unreachable --- */
__resetBackendHealth();
warnCount = 0;
reportRequestFailure({ code: 'ECONNABORTED', config: { url: '/cart', baseURL: 'http://127.0.0.1:8000/api' } });
ok('timeout marks backend unreachable', isBackendReachable() === false);
ok('first outage logs exactly once', warnCount === 1, 'warnCount=' + warnCount);

/* --- 2. repeat failures during the SAME outage are silent --- */
reportRequestFailure({ code: 'ECONNABORTED', config: { url: '/wishlist' } });
reportRequestFailure({ code: 'ERR_NETWORK', config: { url: '/products' } });
reportRequestFailure({ code: 'ETIMEDOUT', config: { url: '/outfits' } });
ok('repeat failures stay silent (no spam)', warnCount === 1, 'warnCount=' + warnCount);

/* --- 3. a real HTTP status is NOT a connectivity failure --- */
__resetBackendHealth();
warnCount = 0;
reportRequestFailure({ response: { status: 401 }, config: { url: '/cart' } });
ok('HTTP 401 keeps backend reachable', isBackendReachable() === true);
ok('HTTP 401 does not log an outage', warnCount === 0, 'warnCount=' + warnCount);

reportRequestFailure({ response: { status: 500 }, config: { url: '/cart' } });
ok('HTTP 500 keeps backend reachable', isBackendReachable() === true);

/* --- 4. success recovers the state and logs the recovery once --- */
__resetBackendHealth();
warnCount = 0;
infoCount = 0;
reportRequestFailure({ code: 'ECONNABORTED', config: { url: '/cart' } }); // outage
reportRequestSuccess();
ok('success flips back to reachable', isBackendReachable() === true);
ok('recovery is announced once', infoCount === 1, 'infoCount=' + infoCount);

infoCount = 0;
reportRequestSuccess();
reportRequestSuccess();
ok('redundant successes are silent', infoCount === 0, 'infoCount=' + infoCount);

/* --- 5. subscribers fire on transitions --- */
__resetBackendHealth();
const seen = [];
const unsub = subscribeBackendHealth((v) => seen.push(v));
reportRequestFailure({ code: 'ERR_NETWORK', config: { url: '/x' } }); // -> false
reportRequestSuccess();                                               // -> true
unsub();
reportRequestFailure({ code: 'ERR_NETWORK', config: { url: '/y' } }); // no listener
ok('subscriber saw both transitions', seen.length === 2 && seen[0] === false && seen[1] === true, 'seen=' + JSON.stringify(seen));
ok('unsubscribe stops notifications', seen.length === 2, 'seen=' + JSON.stringify(seen));

console.warn = origWarn;
console.info = origInfo;

console.log('\n================================');
console.log(fail === 0 ? '  ALL CHECKS PASSED' : '  ' + fail + ' CHECK(S) FAILED');
console.log('================================\n');
process.exit(fail === 0 ? 0 : 1);
