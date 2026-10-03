<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * SupabaseIdentity — THE BRIDGE BETWEEN A LARAVEL USER AND A SUPABASE AUTH IDENTITY.
 * =====================================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * A Hiraya staff account is TWO rows in TWO systems:
 *
 *     users        (Laravel / Postgres)   role, orders, measurements, the RBAC answer
 *     auth.users   (Supabase GoTrue)      the password GoTrue verifies, the JWT, MFA
 *
 * A staff sign-in checks the password TWICE — once against `users.password` and once
 * against `auth.users` — and the console is authorized by the Supabase JWT, so both
 * must agree. Nothing kept them in agreement:
 *
 *   - `hiraya:make-superadmin` wrote only the Laravel row.
 *   - `POST /admin/accounts` wrote only the Laravel row.
 *   - `0002_link_supabase_auth_users.sql` links the `auth_id` UUID but never sets a
 *     password — linking an identity is not creating one.
 *
 * The result was a class of account that could not be signed into AT ALL: Laravel
 * says the password is right, Supabase says it is wrong. `hiraya:make-superadmin`
 * printed the very next step as "make sure this account has a Supabase identity", and
 * the command that was supposed to be the way out of a locked console was itself the
 * thing that produced the lockout. The only way out was the Supabase Dashboard.
 *
 * THIS CLASS MAKES PROVISIONING WRITE BOTH ROWS.
 * ===========================================
 * `createWithPassword()` writes the GoTrue identity; the provisioning paths that call
 * it are the ones that create staff accounts. Every method REFUSES to report success
 * if the write failed, so a half-created account is never announced as a working one.
 *
 * THE CREDENTIAL AND WHAT IT MAY NOT DO
 * -------------------------------------
 * Writes go over the Supabase ADMIN REST API (`/auth/v1/admin/users`) with the
 * service-role key. That key bypasses RLS on every table, so:
 *
 *   - it is read from config only, never from a request
 *   - it never appears in a response payload
 *   - it never appears in a log line
 *   - it never appears in this class's exception messages
 *
 * WHY A SUPERADMIN DOES NOT SET AN ADMIN'S PASSWORD
 * -------------------------------------------------
 * That was the alternative, and it was rejected on purpose: the superadmin would
 * learn the password, and the admin would never choose their own. An admin who knows
 * their own password can rotate it; one whose password a boss typed cannot. The admin
 * is therefore created here and sets their own password through the normal flow.
 *
 * FAILURE POLICY — WHY A REFUSAL IS AN ERROR, NOT A WARNING
 * -----------------------------------------------------------
 * A failed write must NOT be reported as success. The whole failure mode this file
 * exists to prevent is an account that LOOKS provisioned but cannot be signed into;
 * a caller told "done" that then finds a locked-out superadmin has been handed a
 * worse problem than one told to retry. Every method here throws on a failed write,
 * and the caller decides what to do about it.
 */
class SupabaseIdentity
{
    /**
     * Project URL and service-role key, or null when Supabase is not configured.
     *
     * Null rather than `abort()`: the caller decides whether a missing configuration
     * is fatal (provisioning a staff account) or merely a reason to skip (a customer
     * registration, which needs no Supabase identity at all).
     *
     * @return array{0: string, 1: string}|null [baseUrl, serviceRoleKey]
     */
    public static function connection(): ?array
    {
        $base = rtrim((string) config('services.supabase.url'), '/');
        $key  = (string) config('services.supabase.service_role_key');

        if ($base === '' || $key === '') {
            return null;
        }

        return [$base, $key];
    }

    /** Lowercase + trim, which is the form both systems store. */
    public static function canonicalEmail(?string $email): string
    {
        return strtolower(trim((string) $email));
    }

    /**
     * THE SUPABASE USER ID FOR THIS EMAIL, OR NULL IF THERE IS NO IDENTITY.
     *
     * A missing identity is NOT an error. It is the normal state of a customer
     * account, and the state `createWithPassword()` exists to fix for a staff account.
     */
    /**
     * The REAL authenticator state from GoTrue: canonical email => true when the
     * identity holds at least one VERIFIED MFA factor, false when it has none.
     * Null when Supabase cannot be reached (callers fall back to the stored
     * column). One admin-API request covers every account.
     *
     * @return array<string, bool>|null
     */
    public static function verifiedFactorMap(): ?array
    {
        $conn = self::connection();
        if (!$conn) {
            return null;
        }

        [$base, $key] = $conn;

        try {
            $response = Http::withToken($key)
                ->withHeaders(['apikey' => $key])
                ->timeout(10)
                ->get($base . '/auth/v1/admin/users', ['per_page' => 1000]);

            if ($response->failed()) {
                return null;
            }

            $map = [];
            foreach ((array) $response->json('users') as $row) {
                if (!is_array($row) || empty($row['email'])) {
                    continue;
                }
                $verified = collect((array) ($row['factors'] ?? []))
                    ->contains(fn ($f) => is_array($f) && ($f['status'] ?? null) === 'verified');
                $map[self::canonicalEmail($row['email'])] = $verified;
            }

            return $map;
        } catch (\Throwable $e) {
            Log::warning('SupabaseIdentity: factor lookup threw', ['reason' => $e->getMessage()]);

            return null;
        }
    }

    public static function findAuthId(string $email): ?string
    {
        $conn = self::connection();
        $email = self::canonicalEmail($email);

        if (!$conn || $email === '') {
            return null;
        }

        [$base, $key] = $conn;

        try {
            $response = Http::withToken($key)
                ->withHeaders(['apikey' => $key])
                ->get($base . '/auth/v1/admin/users', ['per_page' => 1000]);

            if ($response->failed()) {
                Log::warning('SupabaseIdentity: identity lookup failed', [
                    'email'  => $email,
                    'status' => $response->status(),
                ]);
                return null;
            }

            foreach ((array) $response->json('users') as $row) {
                if (is_array($row) && self::canonicalEmail($row['email'] ?? null) === $email) {
                    return $row['id'] ?? null;
                }
            }
        } catch (\Throwable $e) {
            Log::warning('SupabaseIdentity: identity lookup threw', [
                'email'  => $email,
                'reason' => $e->getMessage(),
            ]);
        }

        return null;
    }

    /**
     * CREATE THE GORE USER WITH THIS PASSWORD.
     * =============================================
     *
     * The reason this whole class exists: GoTrue must ACCEPT the password the same
     * person will type into `/login`, otherwise Laravel verifies it and GoTrue
     * refuses it and the account can never be signed into.
     *
     * `email_confirm` is set because these are staff accounts created by the owner,
     * not self-service sign-ups — there is no confirmation email to wait for, and
     * leaving it unset would make every staff sign-in fail until someone clicked a
     * link that was never sent.
     *
     * @param  string      $email
     * @param  string      $password PLAINTEXT. Never logged, never returned, never persisted here.
     * @param  string|null $name
     * @return string               the Supabase user id
     *
     * @throws \RuntimeException when Supabase is unconfigured or refuses the write
     */
    public static function createWithPassword(string $email, string $password, ?string $name = null): string
    {
        $conn = self::connection();

        if (!$conn) {
            throw new \RuntimeException(
                'Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). '
                . 'A staff account cannot be created without it.'
            );
        }

        [$base, $key] = $conn;
        $email = self::canonicalEmail($email);
        $name  = trim((string) $name) ?: (ucfirst(explode('@', $email)[0] ?? 'Hiraya'));

        try {
            $response = Http::withToken($key)
                ->withHeaders(['apikey' => $key])
                ->asJson()
                ->post($base . '/auth/v1/admin/users', [
                    'email'         => $email,
                    'password'      => $password,
                    'email_confirm' => true,
                    'user_metadata' => ['full_name' => $name],
                ]);
        } catch (\Throwable $e) {
            // Neither the password nor the key is logged here.
            Log::error('SupabaseIdentity: create threw', [
                'email'  => $email,
                'reason' => $e->getMessage(),
            ]);

            throw new \RuntimeException(
                'The staff sign-in service could not be reached. The Hiraya account was not created.',
                0,
                $e
            );
        }

        if ($response->failed()) {
            /*
             * The response body is NOT logged. GoTrue echoes the submitted values
             * back in some error shapes, and the submitted value here is a plaintext
             * password.
             */
            Log::error('SupabaseIdentity: create refused', [
                'email'  => $email,
                'status' => $response->status(),
            ]);

            throw new \RuntimeException(
                'The staff sign-in service refused to create the account. The Hiraya account was not created.'
            );
        }

        return (string) ($response->json('id') ?? '');
    }

    /**
     * SET THIS PASSWORD ON AN EXISTING GORE IDENTITY.
     * ================================================
     *
     * This is the REPAIR path for an account that is already in the bad state — the
     * Laravel row exists, the GoTrue password does not match, and the owner is locked
     * out of the console. Running this against that account is what makes the sign-in
     * that just failed succeed on the next attempt.
     *
     * @throws \RuntimeException when the identity is missing or the write is refused
     */
    public static function setPassword(string $email, string $password): void
    {
        $authId = self::findAuthId($email);

        if (!$authId) {
            throw new \RuntimeException(
                'No Supabase identity exists for that address, so there is nothing to set a password on. '
                . 'Create the identity first.'
            );
        }

        $conn = self::connection();
        if (!$conn) {
            throw new \RuntimeException('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
        }

        [$base, $key] = $conn;

        try {
            $response = Http::withToken($key)
                ->withHeaders(['apikey' => $key])
                ->asJson()
                ->put($base . '/auth/v1/admin/users/' . $authId, [
                    'password' => $password,
                ]);
        } catch (\Throwable $e) {
            Log::error('SupabaseIdentity: setPassword threw', [
                'email'  => self::canonicalEmail($email),
                'reason' => $e->getMessage(),
            ]);

            throw new \RuntimeException(
                'The staff sign-in service could not be reached, so the password was not changed.',
                0,
                $e
            );
        }

        if ($response->failed()) {
            Log::error('SupabaseIdentity: setPassword refused', [
                'email'  => self::canonicalEmail($email),
                'status' => $response->status(),
            ]);

            throw new \RuntimeException(
                'The staff sign-in service refused the password change.'
            );
        }
    }

    /**
     * Deletes the Supabase sign-in identity for an address, so that person can
     * no longer sign in to the console (used when an admin resigns). Returns
     * false when there was no identity to delete.
     */
    public static function deleteIdentity(string $email): bool
    {
        $authId = self::findAuthId($email);
        if (!$authId) {
            return false;
        }

        $conn = self::connection();
        if (!$conn) {
            throw new \RuntimeException('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
        }
        [$base, $key] = $conn;

        $response = Http::withToken($key)
            ->withHeaders(['apikey' => $key])
            ->delete($base . '/auth/v1/admin/users/' . $authId);

        if ($response->failed()) {
            Log::error('SupabaseIdentity: delete refused', [
                'email' => self::canonicalEmail($email),
                'status' => $response->status(),
            ]);
            throw new \RuntimeException('The staff sign-in service refused to remove the sign-in for this account.');
        }

        return true;
    }

    /**
     * Does this e-mail + password sign in to Supabase right now? Used to
     * confirm the CURRENT password before a staff member changes their own.
     * The password is never logged.
     */
    public static function checkPassword(string $email, string $password): bool
    {
        $conn = self::connection();
        if (!$conn) {
            return false;
        }
        [$base, $key] = $conn;

        try {
            $response = Http::withHeaders(['apikey' => $key])
                ->asJson()
                ->post($base . '/auth/v1/token?grant_type=password', [
                    'email' => self::canonicalEmail($email),
                    'password' => $password,
                ]);
        } catch (\Throwable $e) {
            return false;
        }

        return $response->successful();
    }
}
