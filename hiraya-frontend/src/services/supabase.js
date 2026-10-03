import { createClient } from '@supabase/supabase-js';

/*
 * NOTE: no `service_role` key here, deliberately.
 *
 * This module used to also read `VITE_SUPABASE_SERVICE_ROLE_KEY` and fall back to
 * a hardcoded value. A `service_role` key bypasses RLS on every table and bucket
 * in the project, and a `VITE_`-prefixed variable is compiled into the JavaScript
 * the browser downloads — so that value was public to every visitor of the site.
 *
 * Nothing needs it any more. Uploads go through the backend
 * (`POST /api/admin/upload`), which holds the key in its own server-side `.env`,
 * and every read is a public-bucket GET that needs no credential at all.
 * Only the anon (publishable) key remains, which is designed to be public.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://qnyskltxjfdsvncaehvh.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFueXNrbHR4amZkc3ZuY2FlaHZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NzcxOTIsImV4cCI6MjEwMjE1MzE5Mn0.QHzkgsdJWBkgsY7kIjeQ_Dt0Ev06ERK2PoF3Y7HjtiQ';

// Fail loudly and precisely.
const missing = [
    ['VITE_SUPABASE_URL', supabaseUrl],
    ['VITE_SUPABASE_ANON_KEY', supabaseAnonKey],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
    throw new Error(
        `Supabase is not configured: missing ${missing.join(', ')}. ` +
        'Set these in hiraya-frontend/.env and restart the dev server ' +
        '(Vite only reads .env at startup).'
    );
}

const keyRef = (() => {
    try {
        const payload = supabaseAnonKey.split('.')[1];
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
        return JSON.parse(atob(padded)).ref ?? null;
    } catch {
        return null;
    }
})();

const urlRef = (supabaseUrl.match(/^https?:\/\/([^.]+)\./) || [])[1];

if (keyRef && urlRef && keyRef !== urlRef) {
    throw new Error(
        `Supabase URL/key mismatch: VITE_SUPABASE_URL points at "${urlRef}" ` +
        `but VITE_SUPABASE_ANON_KEY belongs to "${keyRef}". ` +
        'The key is the source of truth — update the URL to match it.'
    );
}

/*
 * EVERY SUPABASE REQUEST GETS A DEADLINE.
 *
 * auth-js calls `fetch` with no timeout, and every `getSession()` that needs a
 * token refresh waits on ONE shared in-flight refresh. A single stalled refresh
 * request (a dropped connection, a DNS hiccup) therefore left every later
 * `getSession()` pending for the life of the tab: the console guard sat on
 * "Verifying Session…", every admin request waited in the axios interceptor
 * before it was even sent (so axios' own timeout never applied), and only a NEW
 * tab — a new client — worked again. With a deadline, a stalled request fails,
 * auth-js reports a retryable error, and the next call can try again.
 */
export const SUPABASE_REQUEST_TIMEOUT_MS = 15000;

const fetchWithTimeout = (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);
    const callerSignal = init.signal;
    if (callerSignal) {
        if (callerSignal.aborted) controller.abort();
        else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: fetchWithTimeout },
});

/**
 * Resolve `promise`, or reject after `ms` with an error marked `isSessionTimeout`.
 * Used where a caller must not wait indefinitely on the auth client.
 */
export const withTimeout = (promise, ms, message = 'The staff session could not be confirmed in time.') => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error(message);
            error.isSessionTimeout = true;
            reject(error);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};