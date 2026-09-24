/**
 * Runtime guards for non-fatal third-party crashes.
 *
 * The AI Try-On stack pulls in WASM/worker libraries
 * (`@imgly/background-removal`, `onnxruntime-web`) that read the newer
 * Performance API event fields — notably `event.startTime` — which some
 * browsers/synthetic events never populate. Those libraries are bundled, so a
 * throw inside them surfaces as an uncaught error that bubbles up and can white-
 * screen React during a state transition.
 *
 * We cannot patch node_modules, so we install a narrow global safety net that
 * swallows ONLY this known, non-fatal class of error (a `startTime` property
 * read on an undefined object) and lets everything else reach the console so
 * genuine bugs are still visible.
 */

const KNOWN_THIRD_PARTY_ERRORS = [
    // e.g."TypeError: Cannot read properties of undefined (reading 'startTime')"
    /reading 'startTime'/i,
    /startTime' of undefined/i,
    /startTime' of null/i,
    /Cannot read properties of undefined \(reading 'startTime'\)/i,
];

/** True when an error is the known, recoverable third-party startTime crash. */
export const isKnownStartTimeError = (error) => {
    if (!error) return false;
    const message =
        typeof error === 'string'
            ? error
            : `${error?.message || ''} ${error?.stack || ''}`;
    return KNOWN_THIRD_PARTY_ERRORS.some((pattern) => pattern.test(message));
};

/**
 * Installs the global handlers. Idempotent — safe to call once from main.jsx.
 * Returns a teardown function (useful for tests / HMR).
 */
export const installRuntimeGuards = () => {
    if (typeof window === 'undefined') return () => { };

    const onError = (event) => {
        if (isKnownStartTimeError(event?.error) || isKnownStartTimeError(event?.message)) {
            // Known, non-fatal: stop it poisoning the React render tree.
            event.preventDefault?.();
            console.warn('[Hiraya] Suppressed non-fatal startTime error from the AI media pipeline.');
        }
    };

    const onUnhandledRejection = (event) => {
        if (isKnownStartTimeError(event?.reason)) {
            event.preventDefault?.();
            console.warn('[Hiraya] Suppressed non-fatal startTime rejection from the AI media pipeline.');
        }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
};

/**
 * Defensive `performance.now()` reader. Returns `event?.startTime ?? a safe now`
 * so timing/analytics callbacks never read a property off an undefined event.
 */
export const safeNow = (event) => {
    if (event && typeof event.startTime === 'number' && Number.isFinite(event.startTime)) {
        return event.startTime;
    }
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
};
