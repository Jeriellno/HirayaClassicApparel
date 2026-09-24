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

export const supabase = createClient(supabaseUrl, supabaseAnonKey);