import { supabase } from './supabase';

/*
 * HIRAYA — Supabase MFA (TOTP) service layer.
 * ============================================================================
 * The project's second factor is Supabase's built-in MFA, NOT the legacy
 * Laravel challenge-token flow. That legacy implementation cached a random
 * string under `login:2fa:*`, verified a locally-computed TOTP, and issued
 * its own Sanctum token. It has been removed.
 *
 * The replacement is two claims in a token Supabase already signs:
 *
 *   aal1  the session has a password and nothing else
 *   aal2  the session ALSO passed a TOTP challenge
 *
 * `auth.jwt() ->> 'aal'` is readable from the JWT, and RLS enforces it in the
 * database, so an aal1 session cannot reach an admin table no matter what the
 * browser believes. The checks in this file are therefore CONVENIENCE (better
 * UX, no wasted requests) rather than the security boundary itself.
 *
 * `getAuthenticatorAssuranceLevel()` asks the GoTrue server to verify the
 * session's aal, and a refreshes the local session when the level changes
 * after a successful verify() — without that refresh the browser keeps serving
 * the old aal1 token even though the server issued an aal2 one.
 */

const AUDIENCE = 'authenticated';

/*
 * Shared with the route guard, so it lives here rather than being redefined per
 * module. See AAL2_GRACE_MS in ProtectedRoute for what it is for.
 */
let aal2ConfirmedAt = 0;
const AAL2_GRACE_MS = 15000;

const noteAal2Confirmed = () => {
    aal2ConfirmedAt = Date.now();
};
const recentlyConfirmedAal2 = () =>
    aal2ConfirmedAt > 0 && Date.now() - aal2ConfirmedAt < AAL2_GRACE_MS;

/** Test seam, and the way sign-out resets the grace window. */
export const __resetAal2Grace = () => {
    aal2ConfirmedAt = 0;
};

/**
 * True while this browser is inside the aal2 grace window.
 *
 * The loop this stops: /superadmin mounts, reads aal1, redirects to
 * /login, which redirects back — a ping-pong with no error and no way
 * out. A verified sign-in can briefly still read aal1, so rather than bounce a
 * user back to a code prompt they already satisfied, the guard declines to
 * RE-prompt inside a short window.
 *
 * It never GRANTS access and never preserves a real downgraded session: the
 * window is short, sign-out clears it, and the actual boundary is RLS plus
 * Laravel's AAL middleware, which refuse an aal1 request on their own.
 */
export const wasAal2JustConfirmed = () => recentlyConfirmedAal2();

/** Roles that must hold aal2 before they may open the console. */
export const PRIVILEGED_ROLES = ['admin', 'superadmin'];

export const normalizeRole = (raw) =>
    String(raw || '')
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

/*
 * THE `user.role` TRAP — AND WHY IT SENT THE OWNER TO /shop
 * =============================================================================
 * A GoTrue user object always has a TOP-LEVEL `role` field, and it is NOT a
 * Hiraya role. It is the Postgres role name — the string "authenticated" — and
 * it is present on EVERY signed-in user, staff or customer:
 *
 *   { id: "...", aud: "authenticated", role: "authenticated",
 *     app_metadata: { role: "superadmin" }, user_metadata: { role: "..." } }
 *
 * The old `user.role ?? user.app_metadata?.role` therefore NEVER reached
 * app_metadata. `??` only falls through on null/undefined, and "authenticated"
 * is neither, so a genuine superadmin resolved to the literal string
 * "authenticated" — not privileged, not empty, and never correct. That is what
 * made `fetchAuthoritativeRole()` skip straight past its own free claims check
 * and go to Postgres, where your probe correctly found `role: null`, and what
 * made `isPrivilegedRole()` answer false so the sign-in flow treated a real
 * superadmin as a customer.
 *
 * `role` is only ever read here if it is one of ours, and a GoTrue tag can never
 * be one, so the check is unambiguous rather than a denylist.
 */
export const isHirayaRole = (value) => {
    const r = normalizeRole(value);
    return r === 'admin' || r === 'superadmin' || r === 'user' || r === 'customer';
};

/** role from the Supabase profile row, the JWT claim, or app_metadata. */
export const roleOf = (user) => {
    if (!user) return '';
    /*
     * app_metadata first: it is the only field Supabase itself writes and only
     * staff ever have a value there. user_metadata is user-editable, so it is
     * read but ranked last, and the top-level `role` is only considered if it
     * actually looks like a Hiraya role.
     */
    return normalizeRole(
        user.app_metadata?.role ??
        user.user_metadata?.role ??
        (isHirayaRole(user.role) ? user.role : '') ??
        '',
    );
};

export const isPrivilegedRole = (role) => PRIVILEGED_ROLES.includes(normalizeRole(role));

/**
 * THE AUTHORITATIVE ROLE — read from the `public.users` row, not the JWT.
 * -------------------------------------------------------------------------
 * WHY THE SESSION OBJECT CANNOT ANSWER THIS
 *
 * `roleOf(user)` above reads `user.app_metadata.role`. That field is EMPTY on
 * every real Hiraya account, because nothing ever writes it: the SQL file the
 * comments kept citing (`0002_sync_role_into_jwt.sql`) DOES NOT EXIST in this
 * project — the two migrations that do are `0001_hiraya_rls_aal2.sql` and
 * `0002_link_supabase_auth_users.sql`, and the latter only adds/backfills the
 * `users.auth_id` uuid link. It never touches `auth.users.raw_app_meta_data`.
 *
 * So `roleOf()` returned '' for a genuine superadmin, `isPrivilegedRole('')` was
 * false, and the sign-in flow sent them to `/home` — the "superadmin
 * landed in the storefront" bug. ProtectedRoute then agreed (same empty role),
 * so nothing corrected it further down.
 *
 * THE ROLE LIVES IN POSTGRES, AND RLS ALREADY LETS US READ IT
 * `0001_hiraya_rls_aal2.sql` creates `users_select_own`, which permits a
 * SELECT of the caller's OWN row by `auth_id` OR by exact email. That is the
 * same function RLS policies themselves use to decide privilege
 * (`hiraya_current_role()`), so this read is exactly as trustworthy as the
 * authorization it feeds — and it needs no service-role key.
 *
 * FAIL-CLOSED: any error or missing row resolves to '' (a customer), which is
 * the narrowest answer. A network blip must never INVENT privilege.
 *
 * @param {object|null} user  a Supabase user object (or a session)
 * @returns {Promise<string>} 'admin' | 'superadmin' | ''
 */
export const fetchAuthoritativeRole = async (user) => {
    /*
     * THE CLAIM FALLBACK HAS TO BE COMPUTED FIRST.
     * ---------------------------------------------
     * `fromClaims` is a plain local. It was referenced in both return paths but
     * never declared anywhere in the function, so every one of those paths threw
     * a ReferenceError instead of returning a role.
     */
    const fromClaims = roleOf(user);

    const email = user?.email;
    if (!email) return fromClaims;

    try {
        // Every Hiraya table carries the `tbl_` prefix (Laravel DB_PREFIX).
        const { data, error } = await supabase
            .from('tbl_users')
            .select('role')
            .eq('email', email)
            .maybeSingle();

        if (error) {
            console.warn('[supabaseMfa] role lookup failed:', error.message);
            return fromClaims;
        }

        return normalizeRole(data?.role) || fromClaims;
    } catch (e) {
        console.warn('[supabaseMfa] role lookup threw:', e?.message);
        return fromClaims;
    }
};

/**
 * THE `aal` CLAIM, DECODED FROM THE ACCESS TOKEN.
 *
 * THE REDIRECT LOOP THIS FIXES
 * ----------------------------
 * `mfa.getAuthenticatorAssuranceLevel()` asks GoTrue to describe the session.
 * That answer is derived from the session as GoTrue has it, and immediately
 * after a successful `mfa.verify()` the freshly issued aal2 token and that
 * answer can disagree for a moment. When they did, the console mounted, decided
 * the session was still aal1, and redirected straight back to
 * the sign-in form — which re-rendered, re-read aal1, and sent it back. The
 * user was bounced between the two screens forever, with no error shown and no
 * way out except signing out.
 *
 * The token itself is the authority: RLS reads `auth.jwt() ->> 'aal'` on every
 * single query, so the claim in the access token is exactly what the database
 * will enforce. Trusting the same value the database trusts removes the
 * disagreement by construction — there is no second source left to contradict
 * it. This is a client-side READ of a signed token, not a security decision:
 * an attacker can forge neither the signature nor the claim.
 *
 * @returns {'aal1'|'aal2'|null}
 */
const decodeAalClaim = (accessToken) => {
    if (!accessToken || typeof accessToken !== 'string') return null;
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;
    try {
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
        return json?.aal === 'aal2' || json?.aal === 'aal1' ? json.aal : null;
    } catch {
        return null;
    }
};

/**
 * Current + next assurance levels for the active session.
 *
 * `currentLevel` comes from the access token's `aal` claim (see above) so it
 * agrees with what RLS will actually allow. `nextLevel` still has to come from
 * GoTrue, because whether a second factor EXISTS is not in the token.
 *
 * @returns {Promise<{ currentLevel: 'aal1'|'aal2', nextLevel: 'aal1'|'aal2', authenticated: boolean }>}
 */
export const getAssuranceLevels = async () => {
    /*
     * SEQUENTIAL, RETRIED, TOKEN FIRST.
     *
     * This used to run getSession() and getAuthenticatorAssuranceLevel() in
     * parallel and THROW on any error. After a page reload with an expired
     * access token (every Vite reload during a long session) both calls raced
     * to refresh it; one would fail transiently, the throw made ProtectedRoute
     * treat a valid aal2 session as "not verified", and staff were sent back to
     * /login to redo their authenticator code. getSession() now refreshes first,
     * the signed token's own `aal` claim is trusted when present, and transient
     * failures are retried instead of ending the session.
     */
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const session = sessionData?.session ?? null;
            const fromToken = decodeAalClaim(session?.access_token ?? null);

            let data = null;
            try {
                ({ data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel());
            } catch (aalError) {
                if (!fromToken) throw aalError;
            }

            return {
                currentLevel: fromToken === 'aal2' ? 'aal2' : (data?.currentLevel ?? fromToken ?? null),
                nextLevel: data?.nextLevel ?? null,
                authenticated: Boolean(session),
            };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
};

/**
 * Sign in with password ONLY. Deliberately does not decide where to go.
 *
 * The caller must then call `getAssuranceLevels()`: a staff account comes back
 * at aal1 with nextLevel 'aal2', which is the signal to show the TOTP prompt.
 * A customer comes back at aal1 with nextLevel 'aal1' and goes straight in.
 */
export const signInWithPassword = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        /*
         * GoTrue's own messages name the cause ("Invalid login credentials") but
         * not the account, and a staff member who has just typed the SAME
         * password into the form a second time deserves to be told which of the
         * two systems refused it — otherwise a mismatch here looks like the
         * password was wrong, which it was not.
         *
         * `isAuthError` is what marks this as a real, explained failure rather
         * than an axios error with no `.response`, which `parseApiError` would
         * otherwise report as "Cannot reach the Hiraya server."
         */
        const wrapped = new Error(
            `Your password was accepted, but the staff sign-in service rejected it: ${error.message}`,
        );
        wrapped.isAuthError = true;
        wrapped.status = error.status ?? 400;
        wrapped.errors = {};
        throw wrapped;
    }
    return data;
};

/**
 * Create a challenge for a TOTP factor and return BOTH ids.
 *
 * THE `factor_id must be an UUID` BUG
 * -----------------------------------
 * `mfa.challenge({ factorType })` does NOT return a factor id. It returns a
 * CHALLENGE id — an opaque `challenge-...` string, not a uuid. The old code
 * handed that value to `mfa.verify({ factorId })`, and GoTrue refused it with
 * `factor_id must be an UUID`, so every staff sign-in that reached the TOTP
 * step died before the code was ever typed.
 *
 * `mfa.verify()` needs the two ids SEPARATELY:
 *
 *   factorId     the uuid of the VERIFIED factor (from mfa.listFactors())
 *   challengeId  the id returned by this challenge()
 *
 * So the factor id is resolved here, from the verified TOTP factor, and the
 * challenge is opened against it. Fail-closed: no verified factor of that type
 * means there is nothing to challenge, and the caller is told so.
 *
 * @param {'totp'} factorType
 * @returns {Promise<{ factorId: string, challengeId: string }>}
 */
export const createMfaChallenge = async (factorType = 'totp') => {
    /*
     * WHY THIS USED TO SAY "Cannot reach the Hiraya server."
     * ---------------------------------------------------
     * Two bugs were stacked on top of each other in this one function:
     *
     *   1. `mfa.listFactors()` resolves to `{ all, totp, phone }` — there is no
     *      `factors` property. The destructure `const { data: factors }` therefore
     *      produced `undefined`, so `factor.id` threw
     *        TypeError: Cannot read properties of undefined (reading 'id')
     *      That TypeError carries NO `.status` and NO `.response`, and
     *      parseApiError classifies exactly that shape as a network failure — so a
     *      code error was reported to the user as a dead server.
     *
     *   2. The `if (!factor)` guard sat AFTER the `mfa.challenge()` call, so even
     *      with a correct list it would have called `challenge({ factorId: undefined })`
     *      before checking that a factor existed at all.
     *
     * Both are fixed below: the verified factor is resolved FIRST, absence is
     * reported as itself, and only then is the challenge opened.
     */
    const list = await listMfaFactors();

    // `listFactors` groups by type, so a TOTP challenge must be opened against a
    // VERIFIED TOTP factor specifically — not any verified factor.
    const factor = (list.totp || []).find((f) => f.status === 'verified');

    if (!factor) {
        throw new Error('No verified authenticator is enrolled on this account.');
    }

    const { data, error } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
        factorType,
    });
    if (error) throw error;

    if (!data?.id) {
        throw new Error('Supabase did not return a challenge id.');
    }

    return {
        factorId: factor.id,
        challengeId: data.id,
    };
};

/**
 * Verify the code against the challenge and refresh the session so the new
 * (aal2) access token replaces the old aal1 one in local storage.
 */
export const verifyMfaChallenge = async (factorId, challengeId, code) => {
    /*
     * CHALLENGE AND VERIFY IN ONE CALL — the fix for "challenge mismatch".
     *
     * GoTrue only accepts a code from the SAME IP that opened the challenge,
     * and a challenge goes stale. The login page used to open the challenge
     * right after the password and verify it only when the code was typed —
     * any network change in between (IPv6 address rotation, mobile data, VPN)
     * or a slow typist got "challenge … mismatch" / "expired". Opening a fresh
     * challenge at the moment of verifying removes both failure modes.
     * `challengeId` is kept in the signature for existing callers.
     */
    void challengeId;
    const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: String(code || '').replace(/\D/g, ''),
    });
    if (error) throw error;

    /*
     * The session is aal2 server-side now, but the browser is still holding the
     * aal1 token. RLS reads the claim off the token, so until the aal2 token is
     * actually STORED, every admin query is refused as aal1. Refresh, then read
     * the session back so local storage is updated before the caller navigates.
     */
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) throw refreshError;

    // Force the client to re-read and persist the new session.
    await supabase.auth.getSession();

    /*
     * Tell the route guard the second factor has been paid, so mounting /admin
     * does not read one last stale aal1 and bounce the user back here. The grant
     * is time-boxed and cleared on sign-out; it opens no access of its own.
     */
    noteAal2Confirmed();

    return refreshed ?? data;
};

/**
 * Delete every UNVERIFIED factor left on this account.
 *
 * WHY THIS EXISTS — THE 422 DEADLOCK
 * -----------------------------------
 * `mfa.enroll()` is refused with HTTP 422 while a factor of the same
 * friendly_name already exists in ANY state. A previous attempt that was
 * abandoned (closed tab, reload before the 6-digit code was typed) leaves an
 * unverified TOTP row behind forever: it cannot pass a challenge, so it grants
 * nothing, and it is not a "verified factor" either, so the account still has to
 * be aal1 — but it is enough to make every future enroll fail. The account is
 * stuck at aal1 with a factor it can neither use nor (as an aal1 session)
 * delete, because Supabase requires aal2 to remove a VERIFIED factor.
 *
 * GoTrue only applies that aal2 requirement to factors that are already
 * verified, so an unverified factor IS deletable from an aal1 session. That
 * asymmetry is the whole reason this function can exist: it closes the deadlock
 * without weakening anything.
 *
 * It is deliberately tolerant — a factor that fails to delete is reported, not
 * thrown, so a partially-successful cleanup still lets the caller try to enroll
 * and surface Supabase's real reason if it still refuses.
 *
 * @returns {Promise<{ removed: string[], failed: Array<{id:string, reason:string}> }>}
 */
export const cleanupUnverifiedFactors = async () => {
    const removed = [];
    const failed = [];

    let list;
    try {
        list = await listMfaFactors();
    } catch (err) {
        return { removed, failed: [{ id: 'unknown', reason: err?.message || 'Could not list factors.' }] };
    }

    const all = [...(list.totp || []), ...(list.phone || [])];
    const stale = all.filter((f) => f.status !== 'verified');

    for (const factor of stale) {
        try {
            // Sequential on purpose: a burst of parallel unenrolls can race each
            // other for the same row and leave one behind.
            await supabase.auth.mfa.unenroll({ factorId: factor.id });
            removed.push(factor.id);
        } catch (err) {
            failed.push({ id: factor.id, reason: err?.message || 'Could not remove factor.' });
        }
    }

    if (removed.length || failed.length) {
        console.warn('[supabaseMfa] unverified factor cleanup:', { removed, failed });
    }

    return { removed, failed };
};

/**
 * Start TOTP enrollment.
 *
 * Unverified leftovers are cleared FIRST. That makes the friendly name safe to
 * keep stable and human-readable: the 422 can no longer be caused by a stale
 * row, so any refusal that still comes back is a real one (a verified factor
 * already exists) and its Supabase message is surfaced verbatim.
 *
 * @returns {{ qrCodeSvg: string, secret: string, id: string }}
 *   NORMALISED on the way out: the wire shape is `totp.qr_code`, so callers get
 *   `qrCodeSvg` and never touch Supabase's snake_case.
 */
/**
 * The QR as a SAFE <img> source.
 *
 * Supabase returns `totp.qr_code` as a DATA URI ("data:image/svg+xml;utf-8,<svg…"),
 * not as bare SVG markup. Injecting it as HTML rendered the prefix as stray text
 * and an unsized SVG that page styles could distort — phones could not scan it.
 * The SVG is extracted and re-encoded (a raw "#" in a data URI would cut it off).
 */
export const toQrImageSrc = (qr) => {
    const raw = String(qr || '');
    let svg = raw;
    const comma = raw.indexOf(',');
    if (raw.startsWith('data:') && comma !== -1) {
        svg = raw.slice(comma + 1);
        try {
            if (/;base64/i.test(raw.slice(0, comma))) svg = atob(svg);
            else if (/%3C/i.test(svg.slice(0, 6))) svg = decodeURIComponent(svg);
        } catch {
            /* keep as-is */
        }
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export const startMfaEnrollment = async (friendlyName = 'Hiraya Authenticator') => {
    await cleanupUnverifiedFactors();

    const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName,
    });

    /*
     * The 422 REACHES US TWO DIFFERENT WAYS, AND BOTH MUST BE REPORTED HONESTLY.
     * supabase-js usually rejects via `error` (status 422, with Supabase's own
     * reason in the body). Older/edge paths return `data: null` with no error
     * at all. Reporting a hardcoded guess in that second case produced a message
     * that named two unrelated causes and told the reader to check "the console
     * error above" — which is the opposite of useful when the cause is a single
     * database row. The status and any body text are carried through instead.
     */
    if (error) {
        const status = error?.status ? ` (HTTP ${error.status})` : '';
        const reason = error?.message || 'Supabase did not say why.';
        throw new Error(`Supabase refused to create the authenticator${status}. ${reason}`);
    }

    /*
     * THE FIELD IS `totp.qr_code`, NOT `qrCode.svg`.
     *
     * This is not a cosmetic rename. `data.qrCode` does not exist on the TOTP
     * response, so the old guard could NEVER pass and every enrollment ended
     * with "Supabase accepted the request but returned no authenticator data" —
     * even on a perfect success. The factor was genuinely created each time; the
     * QR was simply never read, so the user saw an error where there was a
     * working one.
     *
     * `qr_code` is the raw <svg> markup itself (NOT a URL, despite the field
     * name), which is why it is injected with dangerouslySetInnerHTML rather
     * than used as an <img src>. It contains no script and no remote
     * reference; the TOTP secret is inside it, so it is treated like a password.
     */
    if (!data?.id || !data?.totp?.qr_code) {
        throw new Error(
            'Supabase created the factor but returned no QR code for it. ' +
            'Re-open enrollment to get a fresh one.',
        );
    }

    return {
        id: data.id,
        type: data.type,
        friendlyName: data.friendly_name ?? friendlyName,
        secret: data.totp.secret,
        qrCodeSvg: data.totp.qr_code,
        qrCodeSrc: toQrImageSrc(data.totp.qr_code),
    };
};

/** Finish enrollment: proves the authenticator app holds the same secret. */
export const confirmMfaEnrollment = async (factorId, code) => {
    const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: String(code || '').replace(/\D/g, ''),
    });
    if (error) throw error;
    return data;
};

/** Factors already enrolled on this account. */
export const listMfaFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    return data ?? { all: [], totp: [], phone: [] };
};

/** Remove a factor. Requires an aal2 session; Supabase enforces that. */
export const unenrollMfaFactor = async (factorId) => {
    const { data, error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return data;
};

/** Current Supabase access token — this is what Laravel's AAL middleware reads. */
export const getSupabaseAccessToken = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session?.access_token ?? null;
};

export const signOutSupabase = async () => {
    // Never let the aal2 grace window outlive the session it was granted for.
    __resetAal2Grace();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
};

export const MFA_AUDIENCE = AUDIENCE;
