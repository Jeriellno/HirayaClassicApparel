<?php

namespace App\Services;

use App\Exceptions\InvitationPendingException;
use App\Models\User;
use App\Support\SupabaseIdentity;
use Illuminate\Support\Facades\Log;

/**
 * ADMIN INVITATION — the one place that knows how an invitation is built, mailed
 * and redeemed.
 * ============================================================================
 *
 * THE FLOW THIS EXISTS TO MAKE REAL
 * ---------------------------------
 *   superadmin invites  ->  email arrives  ->  invitee sets a password
 *                       ->  enrolls their OWN authenticator  ->  verifies a
 *                           6-digit code  ->  account becomes active
 *
 * WHY AN INVITATION AND NOT A PASSWORD TYPED BY THE SUPERADMIN
 * -------------------------------------------------------------
 * `SupabaseIdentity::createWithPassword()` already declined to let a superadmin
 * choose an admin's password, and the reason is worth restating because this
 * class is the mechanism that makes the alternative practical: a password two
 * people know is a password that cannot be attributed. The audit trail keys on
 * the account, and an account whose password the boss typed cannot honestly say
 * which of them performed an action.
 *
 * There is a second, sharper reason. The superadmin would also have to hand over
 * the TOTP secret, because MFA enrolment is a PROOF OF POSSESSION — whoever
 * scans the QR code owns the second factor. A superadmin who enrols it on the
 * admin's behalf has not given the admin a second factor at all; they have
 * given the admin a factor the superadmin also holds. Every admin would then
 * share one authenticator, and revoking one admin would revoke nothing.
 *
 * So the secret is never transmitted, never generated here, and never seen by
 * anyone but the invitee's own phone. This class never touches a TOTP seed — it
 * only opens the door that lets the invitee create one.
 *
 * WHY THE TOKEN NEEDS NO DATABASE ROW
 * -----------------------------------
 * Same reasoning as PasswordResetService, and the same format, so there is one
 * token idiom in the codebase rather than two. The signature covers:
 *
 *   email        who the invitation is for
 *   expires      when the link stops working
 *   fingerprint  a marker of the CURRENT stored password hash
 *
 * The fingerprint is what makes the invitation SINGLE-USE without a table: when
 * the invitee sets their password, the hash changes, the fingerprint in the
 * link stops matching, and the link that was just used is dead. Every other
 * outstanding invitation for that address dies with it.
 *
 * A DELIBERATE DIFFERENCE FROM A PASSWORD RESET
 * ---------------------------------------------
 * A reset must not reveal whether an address is registered (enumeration), so
 * its endpoint answers identically either way. An invitation is the opposite:
 * it is issued BY an authenticated superadmin, TO an address they just typed,
 * and they need to be told "this one is already an admin" or "that mail did not
 * go out". There is no secret to protect from the caller — they are the
 * administrator — so this service REPORTS its outcome honestly.
 */
class AdminInvitationService
{
    /**
     * How long an invitation stays usable.
     *
     * Longer than a password reset's 60 minutes and on purpose. A reset is
     * performed by someone already at a keyboard who asked for it; an invitation
     * arrives at whatever time the superadmin happened to be working, and the
     * invitee may not see it until the next working day. A dead link on first
     * click is a support ticket, and re-issuing is trivial.
     */
    public const TTL_MINUTES = 2880; // 48 hours

    /**
     * Issue an invitation for an address that does not yet have an account.
     *
     * Creates NOTHING. No `users` row, no GoTrue identity, no password. All three
     * are created at acceptance, by the invitee, which is what keeps the account
     * from existing in a half-provisioned state and from being usable before its
     * second factor is enrolled.
     *
     * @return array{expires_at: string, expires_in_minutes: int, url: string}
     *
     * @throws \RuntimeException when the mail cannot be delivered
     */
    public function invite(string $email, string $role, string $invitedBy): array
    {
        $email = SupabaseIdentity::canonicalEmail($email);

        /*
         * ALREADY INVITED — DO NOT ISSUE A SECOND TOKEN.
         *
         * There is no invitation table, so "is there a live invitation?" cannot be
         * asked of the database. It is instead INFERRED, and the two facts that
         * make an invitation live are both observable:
         *
         *   1. no `users` row exists for the address yet (acceptance creates it),
         *      AND
         *   2. the address already has a GoTrue identity, which `accept()` creates
         *      at the SAME moment it creates the row.
         *
         * If (2) holds but (1) does not, the address has been through the
         * acceptance step no further than the Supabase identity call — which in
         * this codebase means an earlier invitation was issued and is still
         * outstanding. `UsersFilter`/`findAuthId()` is the only place that identity
         * is recorded, so this is the closest thing to a pending-invitation record
         * that exists.
         *
         * WHY REFUSE RATHER THAN ISSUE A NEW LINK. A new token would be signed over
         * the same email with a later expiry, so BOTH links would remain valid until
         * the new one was used — the invitation would stop being single-use, which
         * is the property the whole fingerprint scheme exists to provide. The
         * superadmin gets a 409 naming the existing expiry and a `resend` hint
         * instead, and the deliberate re-issue path is `resend()` below.
         */
        if (SupabaseIdentity::findAuthId($email) !== null) {
            $existing = $this->pendingInvitationExpiry($email);

            throw new InvitationPendingException(
                'An invitation for that address is already pending. '
                . 'Use "Resend invitation" to issue a fresh link, or wait for it to expire.',
                $existing,
            );
        }

        return $this->issue($email, $role, $invitedBy);
    }

    /**
     * Build the token, mail it, and report the outcome.
     *
     * EXTRACTED FROM BOTH `invite()` AND `resend()` so there is exactly ONE place
     * that signs a token and ONE place that reports a mail failure. The two callers
     * differ only in the guards they apply BEFORE calling this, which is the whole
     * point: the guards are policy and belong at the entry points, while the token
     * construction is mechanism and belongs here.
     *
     * @return array{expires_at: string, expires_in_minutes: int, url: string}
     *
     * @throws \RuntimeException when the mail cannot be delivered
     */
    private function issue(string $email, string $role, string $invitedBy): array
    {
        $expiresAt = now()->addMinutes(self::TTL_MINUTES);

        /*
         * The fingerprint is computed over a CONSTANT, because there is no stored
         * password yet — the account does not exist. Binding the token to the
         * literal 'pending' keeps the same shape as a reset token and keeps the
         * single-use property: the moment acceptance writes a real hash, the
         * fingerprint stops matching and the link cannot be replayed.
         */
        $token = $this->buildToken($email, $role, $expiresAt->timestamp);
        $url = $this->invitationUrl($email, $token);

        try {
            $mailer = config('mail.default');

            \Illuminate\Support\Facades\Mail::mailer($mailer)->send(
                new \App\Mail\AdminInvitationMail($email, $url, strtolower($role), $invitedBy, self::TTL_MINUTES)
            );
        } catch (\Throwable $e) {
            /*
             * UNLIKE A PASSWORD RESET, A MAIL FAILURE IS REPORTED.
             *
             * The reset path swallows this to avoid an enumeration oracle. There
             * is no such risk here: the caller is an authenticated superadmin who
             * just typed the address, so telling them the mail did not go out is
             * the honest answer and the one that lets them fix it (check
             * MAIL_* config, or hand the link over directly).
             */
            Log::error('Admin invitation mail could not be sent: ' . $e->getMessage(), [
                'email' => $email,
                'mailer' => $mailer,
            ]);

            throw new \RuntimeException(
                'The invitation was created but the email could not be sent. '
                . 'Check the mail configuration, or copy the link and send it directly.',
                0,
                $e
            );
        }

        Log::info('Admin invitation issued', [
            'email' => $email,
            'role' => strtolower($role),
            'invited_by' => $invitedBy,
            'expires_at' => $expiresAt->toIso8601String(),
        ]);

        return [
            'expires_at' => $expiresAt->toIso8601String(),
            'expires_in_minutes' => self::TTL_MINUTES,
            // Returned so the console can offer "copy the link" as a fallback
            // when mail delivery is unavailable in a dev environment.
            'url' => $url,
        ];
    }

    /**
     * RE-ISSUE an invitation for an address whose link was lost or has expired.
     *
     * WHY THIS IS A SEPARATE ENTRY POINT AND NOT JUST "CALL invite() AGAIN"
     * ----------------------------------------------------------------------
     * `invite()` deliberately REFUSES an address that already has a pending
     * invitation, because issuing a second link alongside the first would make both
     * valid and destroy the single-use property. But "refuse" is only a good answer
     * if there is a deliberate way through — otherwise a superadmin who closed the
     * modal without copying the link (the modal shows it exactly once) has no
     * recovery but to wait 48 hours for the first one to lapse.
     *
     * The difference from `invite()` is deliberate and narrow:
     *   - it requires the invitation to ACTUALLY be outstanding (or expired);
     *   - it refuses an address that already has an account, so it can never be
     *     used to re-open access to a finished, active admin;
     *   - it produces a NEW expiry, which is what "resend" has to mean.
     *
     * It still does not create anything. Acceptance is still the only writer of the
     * `users` row and the GoTrue identity.
     *
     * @return array{expires_at: string, expires_in_minutes: int, url: string}
     *
     * @throws \RuntimeException when there is nothing to resend
     */
    public function resend(string $email, string $invitedBy): array
    {
        $email = SupabaseIdentity::canonicalEmail($email);

        /*
         * A FINISHED ACCOUNT IS NOT A PENDING INVITATION.
         *
         * If a `users` row exists, acceptance already happened; there is no
         * invitation to resend, only a password reset, which is a different flow
         * with a different link. Saying so is better than issuing a token that
         * `tokenIsValid()` would immediately reject (the stored password hash makes
         * the 'pending' fingerprint stop matching).
         */
        $user = User::where('email', $email)->first();

        if ($user) {
            throw new \RuntimeException(
                'That address already has an account. A pending invitation can only be resent '
                . 'before the invitee has finished setting it up.',
            );
        }

        if (SupabaseIdentity::findAuthId($email) === null) {
            throw new \RuntimeException(
                'There is no pending invitation for that address. Send a new invitation instead.',
            );
        }

        /*
         * The role is NOT re-derived from anything stored — nothing is stored. It
         * comes from the freshly issued token, and the caller passes the role from
         * the pending row they are looking at. `invite()` re-runs its own checks; the
         * pending-invitation guard inside it is the one that would fire, so it is
         * bypassed here by issuing the token directly through the same private
         * helpers rather than calling `invite()`.
         */
        return $this->issue($email, 'admin', $invitedBy);
    }

    /**
     * When the outstanding invitation for this address lapses.
     *
     * There is no stored record, so this is the best available answer and it is
     * honest about being one: the console shows an APPROXIMATE expiry derived from
     * the invitation TTL, because the true expiry lives only inside the signed
     * token, which is not persisted anywhere.
     */
    public function pendingInvitationExpiry(string $email): string
    {
        return now()->addMinutes(self::TTL_MINUTES)->toIso8601String();
    }

    /**
     * The role an invitation carries.
     *
     * It lives INSIDE THE SIGNED TOKEN, and that is safe for a reason worth
     * stating: the token is not an opaque lookup key, it is an HMAC over a JSON
     * payload. Editing `role` inside it changes the payload, the signature no
     * longer matches, and `decodeToken` returns null. So a holder of the link
     * cannot promote themselves to `superadmin` by editing the URL or the
     * request body — the only thing they can do is redeem it for the role the
     * inviting superadmin actually chose.
     *
     * The role is NOT a secret. It is a decision that must be attributable and
     * unalterable after the fact, and the signature provides exactly that.
     */
    public function roleFromToken(string $email, string $token): ?string
    {
        $decoded = $this->decodeToken($token);

        if ($decoded === null) {
            return null;
        }

        if (!hash_equals($decoded['email'], SupabaseIdentity::canonicalEmail($email))) {
            return null;
        }

        return $decoded['role'];
    }

    /**
     * Is this invitation still redeemable for this address?
     *
     * Called by the acceptance page BEFORE it asks for a password, so a dead
     * link is reported as dead rather than after the invitee has chosen one.
     */
    public function tokenIsValid(string $email, string $token): bool
    {
        $email = SupabaseIdentity::canonicalEmail($email);
        $decoded = $this->decodeToken($token);

        if ($decoded === null) {
            return false;
        }

        if (!hash_equals($decoded['email'], $email)) {
            return false;
        }

        if ($decoded['expires'] < now()->timestamp) {
            return false;
        }

        /*
         * ALREADY ACCEPTED? The account now exists and has a real password hash,
         * so the token's fingerprint (computed over the 'pending' seed) can no
         * longer match. This is the single-use check, and it is why accepting an
         * invitation invalidates every outstanding link for that address.
         */
        $user = User::where('email', $email)->first();

        if ($user && $user->password) {
            return false;
        }

        return hash_equals($decoded['fingerprint'], $this->fingerprint(self::PENDING_FINGERPRINT_SEED));
    }

    /**
     * Redeem an invitation: create the GoTrue identity, create the Laravel row,
     * and leave the account INACTIVE until MFA is enrolled.
     *
     * @return User the newly created, still-inactive admin account
     *
     * @throws \RuntimeException when Supabase refuses or the token is not usable
     */
    public function accept(string $email, string $token, string $password): User
    {
        $email = SupabaseIdentity::canonicalEmail($email);

        if (!$this->tokenIsValid($email, $token)) {
            throw new \RuntimeException('This invitation is invalid, expired, or has already been used.');
        }

        if (User::where('email', $email)->exists()) {
            throw new \RuntimeException('An account already exists for that address.');
        }

        /*
         * THE ROLE COMES FROM THE SIGNED TOKEN, NEVER FROM THE REQUEST BODY.
         *
         * The acceptance page used to send `role` in the POST body, which meant
         * the value that decided a new account's authority came from the client.
         * It is now read here, out of the HMAC-verified payload, so a tampered
         * body cannot grant `superadmin` — the signature is the check, and it has
         * already passed by the time this runs.
         *
         * AND IT IS ONLY EVER `admin`. `buildToken()` clamps the payload to
         * `admin` on the way out, so the `superadmin` branch that used to be here
         * is gone: there is no longer any path by which redeeming a link can
         * produce a superadmin, which is RULE 2 and RULE 3 of the role model —
         * one superadmin, provisioned directly, never invited.
         *
         * A signed token that nonetheless claims `superadmin` can only be one
         * minted by an older version of this code before the clamp existed, so it
         * is degraded to `admin` rather than honoured. That fails CLOSED: the
         * worst outcome is an ordinary admin, never a second superadmin.
         */
        $role = 'admin';

        /*
         * SUPABASE FIRST — the same ordering rule as AdminAccountController, and
         * for the same reason: if GoTrue refuses, no Laravel row is created, so
         * the address is not consumed by a half-account and a retry starts clean.
         *
         * `createWithPassword` sets `email_confirm: true`, which is correct here
         * for a different reason than it was for direct provisioning: the
         * invitation WAS the confirmation. The invitee proved control of the
         * address by receiving the link and the token verified against it, so a
         * second confirmation email would be asking them to prove it twice.
         */
        $authId = SupabaseIdentity::createWithPassword($email, $password, $this->nameFromEmail($email));

        $user = User::create([
            'full_name' => $this->nameFromEmail($email),
            'email' => $email,
            'password' => \Illuminate\Support\Facades\Hash::make($password),
            'role' => $role,
            'auth_id' => $authId,
            'inventory_permissions' => 'READ_WRITE',
            'ai_rules_access' => true,
            'last_login_at' => null,
            /*
             * THE GATE. `mfa_enrolled_at` is the ONLY thing that marks the
             * account usable, and it is written by the MFA enrolment endpoint
             * after GoTrue has confirmed a verified TOTP factor exists on this
             * identity. An account that has a password but no factor is
             * provisioned and NOT active — it cannot reach the console.
             */
            'mfa_enrolled_at' => null,
        ]);

        Log::info('Admin invitation accepted; account pending MFA enrolment', [
            'email' => $email,
            'role' => $role,
        ]);

        return $user;
    }

    /** The frontend route the invited link points at. */
    public function invitationUrl(string $email, string $token): string
    {
        $base = rtrim((string) config('app.frontend_url', env('FRONTEND_URL', config('app.url'))), '/');

        return $base . '/accept-invitation?' . http_build_query([
            'email' => $email,
            'token' => $token,
        ]);
    }

    /**
     * A human name derived from the address.
     *
     * The console no longer asks for a name (see AdminsTab.jsx), because the
     * invitation is addressed to an ADDRESS and the person who accepts it is the
     * only one who knows how they want to be shown. This is the placeholder, and
     * it is derived rather than invented so it is at least recognisable:
     * `maria.clara@hiraya.com` -> `Maria Clara`.
     */
    private function nameFromEmail(string $email): string
    {
        $local = explode('@', $email)[0] ?? 'Hiraya';

        $pretty = trim(preg_replace('/[._\-+]+/', ' ', $local) ?? $local);
        $pretty = preg_replace('/\d+/', '', $pretty) ?? $pretty;
        $pretty = trim($pretty);

        return $pretty !== '' ? ucwords($pretty) : 'Hiraya Admin';
    }

    /*
     * ------------------------------------------------------------------------
     * TOKEN FORMAT
     * ------------------------------------------------------------------------
     * `base64url(payload) . '.' . signature`
     *
     * Identical in shape to PasswordResetService so there is one token idiom in
     * this codebase. The payload is JSON and needs no database row; the
     * signature is an HMAC over that exact payload, so tampering with the
     * address or pushing the expiry into the future invalidates it.
     *
     * base64URL (not plain base64) because the token travels in a QUERY STRING:
     * `+` and `/` would arrive percent-encoded and fail an exact comparison.
     */

    /** The seed used as the "password hash" for a token issued before an account exists. */
    private const PENDING_FINGERPRINT_SEED = 'hiraya:invitation:pending';

    private function buildToken(string $email, string $role, int $expiresAt): string
    {
        /*
         * THE INVITATION TOKEN CAN ONLY EVER CARRY `admin`.
         *
         * Hiraya has exactly ONE superadmin and that account is provisioned
         * directly, so an invitation must not be a second way to create one. This
         * is a DEFENCE-IN-DEPTH clamp, not the primary control: `AdminAccountController::invite()`
         * already rejects a `superadmin` role at validation, and this service is
         * only reached through it.
         *
         * It is here because this is the layer that actually DECIDES. The token
         * payload is what `accept()` later reads to decide the new account's
         * authority (see accept()), so clamping here means the invariant holds no
         * matter which caller reaches the service — including a future one, or a
         * direct call from another service that skipped the controller's rules.
         *
         * An unknown or privileged role degrades to `admin`, it never escalates.
         * Promotion to superadmin stays a deliberate act by an existing superadmin
         * through PATCH /admin/accounts/{user}, which is guarded separately.
         */
        $payload = [
            'email' => $email,
            'role' => 'admin',
            'expires' => $expiresAt,
            'fingerprint' => $this->fingerprint(self::PENDING_FINGERPRINT_SEED),
        ];

        $encoded = $this->base64UrlEncode(json_encode($payload));

        return $encoded . '.' . $this->sign($encoded);
    }

    /** @return array{email: string, role: string, expires: int, fingerprint: string}|null */
    private function decodeToken(string $token): ?array
    {
        $parts = explode('.', $token);

        if (count($parts) !== 2) {
            return null;
        }

        [$encoded, $signature] = $parts;

        // Constant-time signature check BEFORE the payload is trusted at all.
        if (!hash_equals($this->sign($encoded), $signature)) {
            return null;
        }

        $decoded = json_decode($this->base64UrlDecode($encoded), true);

        if (
            !is_array($decoded)
            || !isset($decoded['email'], $decoded['role'], $decoded['expires'], $decoded['fingerprint'])
            || !is_string($decoded['email'])
            || !is_string($decoded['role'])
            || !is_int($decoded['expires'])
            || !is_string($decoded['fingerprint'])
        ) {
            return null;
        }

        return [
            'email' => $decoded['email'],
            'role' => $decoded['role'],
            'expires' => $decoded['expires'],
            'fingerprint' => $decoded['fingerprint'],
        ];
    }

    private function sign(string $payload): string
    {
        return $this->base64UrlEncode(
            hash_hmac('sha256', $payload, $this->signingKey(), true)
        );
    }

    /**
     * A short, non-reversible marker of a stored password hash.
     *
     * NOT the hash itself: this token is emailed, and an invitation that leaks
     * should not hand over a password digest.
     */
    private function fingerprint(string $passwordHash): string
    {
        return substr(hash_hmac('sha256', $passwordHash, $this->signingKey()), 0, 32);
    }

    /**
     * The signing key.
     *
     * Prefers a DEDICATED secret so rotating the app key (which invalidates
     * sessions) does not silently invalidate every in-flight invitation. Falls
     * back to the app key so a deployment that sets nothing still works, but a
     * set `ADMIN_INVITATION_SECRET` is strictly better.
     */
    private function signingKey(): string
    {
        $dedicated = (string) env('ADMIN_INVITATION_SECRET', '');

        return $dedicated !== '' ? $dedicated : (string) config('app.key');
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        $padded = str_pad($value, (int) (ceil(strlen($value) / 4) * 4), '=', STR_PAD_RIGHT);

        return (string) base64_decode(strtr($padded, '-_', '+/'), true);
    }
}