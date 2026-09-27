<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * PASSWORD RESET — one place that knows how a reset link is built, mailed and
 * verified.
 *
 * WHY A SERVICE AND NOT A CONTROLLER
 * ----------------------------------
 * Three separate requests have to agree on the exact same token format:
 *
 *   POST /forgot-password   -> issues and emails a token
 *   POST /reset-password    -> consumes that token
 *   POST /validate-reset-token -> tells the Reset page whether the link is
 *                                 still usable BEFORE the customer types a new
 *                                 password into it
 *
 * When that format lived inline in the controller, the "validate" step did not
 * exist at all, so an expired link only failed AFTER the customer had chosen a
 * password — and then showed them a message indistinguishable from success.
 * A single owner makes the three endpoints incapable of disagreeing.
 *
 * WHY NOT LARAVEL'S PasswordBroker
 * --------------------------------
 * The framework's broker needs a `password_reset_tokens` table and a
 * `CanResetPassword` contract on the model. This deployment authenticates with
 * Sanctum tokens against an existing `users` table, and adding a migration plus
 * a schema change to ship one feature is a larger blast radius than signing a
 * token we can verify without any storage at all.
 *
 * HOW THE TOKEN WORKS — AND WHY IT IS NOT JUST AN HMAC
 * ----------------------------------------------------
 * The previous implementation was `hash_hmac('sha256', $email, app.key)`. That is
 * a DETERMINISTIC value: the same email always produced the same "token", so
 * every link ever issued for an account stayed valid FOREVER, and a reset link
 * leaked from an old email was still usable months later.
 *
 * This version binds three things into the signature:
 *
 *   email        who the link is for
 *   expiry       when it stops working (60 minutes by default)
 *   password     a fingerprint of the CURRENT password hash
 *
 * That third input is the important one: consuming a reset changes the password
 * hash, which changes the fingerprint, which invalidates the token that was just
 * used — and every other reset link outstanding for that account. A reset link
 * therefore works ONCE, which is what makes it safe to leave in an inbox.
 */
class PasswordResetService
{
    /** How long a reset link stays usable. */
    public const TTL_MINUTES = 60;

    /**
     * Mailer used for reset mail.
     *
     * NULL MEANS "WHATEVER config('mail.default') SAYS", and that is the correct
     * default. Hard-coding 'smtp' here was a bug: with no MAIL_HOST set, the SMTP
     * transport has nowhere to connect, every send throws, and the service's
     * catch-and-return-null (correct for enumeration safety) swallowed it. The
     * symptom was a reset endpoint that reported success and delivered nothing,
     * with no error visible from the caller.
     *
     * Reading the configured default instead lets config/mail.php decide: SMTP
     * when a host is present, the `log` mailer when it is not. A deployment can
     * still force a specific mailer with MAIL_MAILER in .env.
     */
    private const MAILER = null;

    /**
     * Issue a reset link for an email address, if that address has an account.
     *
     * ALWAYS RETURNS null ON "NO SUCH USER" AND THE CALLER MUST NOT BRANCH ON IT
     * VISIBLY — the endpoint responds identically either way so it cannot be used
     * to discover which addresses are registered. The return value is here for
     * LOGGING and for tests, not for shaping the HTTP response.
     */
    public function sendResetLink(string $email): ?array
    {
        $email = strtolower(trim($email));
        $user = User::where('email', $email)->first();

        if (!$user) {
            Log::info('Password reset requested for an unknown address', ['email' => $email]);

            return null;
        }

        $expiresAt = now()->addMinutes(self::TTL_MINUTES);
        $token = $this->buildToken($email, $user->password, $expiresAt->timestamp);

        $url = $this->resetUrl($email, $token);

        try {
            $mailer = self::MAILER ?? config('mail.default');

            Mail::mailer($mailer)->send(
                new \App\Mail\PasswordResetMail($user, $url, self::TTL_MINUTES)
            );
        } catch (\Throwable $e) {
            /*
             * A MAIL FAILURE MUST NOT BECOME AN ENUMERATION ORACLE.
             *
             * If this threw out to the controller, a working address (which
             * attempts a send) would 500 while an unknown one returned 200 — a
             * one-request test for "is this person registered". So the failure is
             * logged with everything an operator needs and swallowed here, and
             * the endpoint answers exactly as it would on success.
             */
            Log::error('Password reset mail could not be sent: ' . $e->getMessage(), [
                'email' => $email,
                'mailer' => $mailer,
            ]);

            return null;
        }

        Log::info('Password reset link issued', [
            'email' => $email,
            'expires_at' => $expiresAt->toIso8601String(),
        ]);

        return [
            'expires_at' => $expiresAt->toIso8601String(),
            'expires_in_minutes' => self::TTL_MINUTES,
        ];
    }

    /**
     * Is this token still usable for this email?
     *
     * Called both by the validate endpoint (so the Reset page can refuse a dead
     * link up front) and by the consume step (so a reset can never be applied
     * with a stale token).
     */
    public function tokenIsValid(string $email, string $token): bool
    {
        $email = strtolower(trim($email));
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

        $user = User::where('email', $email)->first();

        if (!$user) {
            return false;
        }

        /*
         * The password fingerprint is what makes the link single-use: consuming
         * it writes a new hash, so the fingerprint embedded here stops matching
         * and every outstanding link for this account dies with it.
         */
        return hash_equals($decoded['fingerprint'], $this->fingerprint($user->password));
    }

    /**
     * Consume a valid token and set the new password.
     *
     * Returns false when the token is not usable; the caller answers with the
     * same generic message it uses for every other outcome.
     */
    public function resetPassword(string $email, string $token, string $newPassword): bool
    {
        if (!$this->tokenIsValid($email, $token)) {
            Log::warning('Rejected password reset with an invalid or expired token', [
                'email' => strtolower(trim($email)),
            ]);

            return false;
        }

        $user = User::where('email', strtolower(trim($email)))->first();

        if (!$user) {
            return false;
        }

        /*
         * HASH THE PASSWORD HERE — THE MODEL DOES NOT DO IT FOR US.
         *
         * `User` has NO `'password' => 'hashed'` cast (see the casts() method),
         * so assigning a raw string writes it to the database AS-IS. The register
         * path avoids that trap by calling `Hash::make()` explicitly; this path
         * must do the same.
         *
         * `forceFill` was the specific trap here: it bypasses mass-assignment
         * protection, which reads like the "safer" choice, but it also skips
         * nothing else — the value lands in the column exactly as given. Without
         * `Hash::make` the customer's new password is stored in PLAIN TEXT, the
         * login check (`Hash::check`) then throws "does not use the Bcrypt
         * algorithm", and the account is locked out by the very flow meant to
         * restore access.
         */
        $user->forceFill(['password' => Hash::make($newPassword)])->save();

        /*
         * SIGN EVERY DEVICE OUT.
         *
         * A password reset is what someone does when they believe their account
         * is compromised. Leaving existing Sanctum tokens alive would keep the
         * intruder's session working — the reset would look successful while the
         * access it was meant to revoke continued.
         */
        $user->tokens()->delete();

        Log::info('Password reset completed', ['email' => $user->email]);

        return true;
    }

    /** The frontend route the emailed link points at. */
    public function resetUrl(string $email, string $token): string
    {
        $base = rtrim((string) config('app.frontend_url', env('FRONTEND_URL', config('app.url'))), '/');

        return $base . '/reset-password?' . http_build_query([
            'email' => $email,
            'token' => $token,
        ]);
    }

    /*
     * ------------------------------------------------------------------------
     * TOKEN FORMAT
     * ------------------------------------------------------------------------
     * `base64url(payload) . '.' . signature`
     *
     * The payload is JSON — email, expiry, password fingerprint — so the token is
     * self-describing and needs NO database row to verify. The signature is an
     * HMAC over that exact payload string, so tampering with the email or pushing
     * the expiry into the future invalidates it.
     *
     * base64URL (not plain base64) because the token travels in a QUERY STRING:
     * `+` and `/` would arrive percent-encoded and fail an exact comparison.
     */

    private function buildToken(string $email, string $passwordHash, int $expiresAt): string
    {
        $payload = [
            'email' => $email,
            'expires' => $expiresAt,
            'fingerprint' => $this->fingerprint($passwordHash),
        ];

        $encoded = $this->base64UrlEncode(json_encode($payload));

        return $encoded . '.' . $this->sign($encoded);
    }

    /** @return array{email: string, expires: int, fingerprint: string}|null */
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
            || !isset($decoded['email'], $decoded['expires'], $decoded['fingerprint'])
            || !is_string($decoded['email'])
            || !is_int($decoded['expires'])
            || !is_string($decoded['fingerprint'])
        ) {
            return null;
        }

        return [
            'email' => $decoded['email'],
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
     * A short, non-reversible marker of the current password hash.
     *
     * NOT the hash itself: the token is emailed, and an email that leaks should
     * not hand over the stored BCrypt digest. `hash_hmac` with the app key makes
     * this a value only the server can compute, while still changing whenever the
     * password changes — which is all the single-use behaviour needs.
     */
    private function fingerprint(string $passwordHash): string
    {
        return substr(hash_hmac('sha256', $passwordHash, $this->signingKey()), 0, 32);
    }

    /**
     * The signing key.
     *
     * Prefers a DEDICATED secret so rotating the app key (which invalidates
     * sessions) does not silently invalidate every in-flight reset link, and so
     * a leaked app key does not by itself let someone mint reset tokens.
     */
    private function signingKey(): string
    {
        $dedicated = (string) env('PASSWORD_RESET_SECRET', '');

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