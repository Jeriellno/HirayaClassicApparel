<?php

namespace App\Services;

use App\Mail\RegistrationCodeMail;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * VERIFIED-GMAIL SIGN-UP.
 *
 * A new customer account is NOT created when the form is submitted. The
 * validated sign-up (with the password already bcrypt-hashed) is parked in the
 * cache under the address, and a 6-digit one-time code is mailed to it. Only
 * when that code comes back is the `users` row created — with
 * `email_verified_at` set. So:
 *
 *   - an address that merely LOOKS like Gmail never becomes an account;
 *   - there are no half-created, unverified accounts to sign in to, which is
 *     what "login requires an existing verified account" means for new users;
 *   - existing accounts are untouched (they never pass through here).
 *
 * The code is stored only as an HMAC (keyed with APP_KEY), attempts are capped,
 * and the pending entry expires.
 */
class RegistrationVerificationService
{
    public const TTL_MINUTES = 15;

    public const MAX_ATTEMPTS = 5;

    public const RESEND_COOLDOWN_SECONDS = 60;

    /** Park a validated sign-up and mail its code. Returns false if mail failed. */
    public function start(array $pending): bool
    {
        $email = strtolower(trim((string) $pending['email']));
        $code = $this->newCode();

        Cache::put($this->key($email), [
            'data' => $pending,
            'code_hash' => $this->hash($email, $code),
            'attempts' => 0,
            'sent_at' => now()->timestamp,
        ], now()->addMinutes(self::TTL_MINUTES));

        return $this->send($email, (string) ($pending['full_name'] ?? ''), $code);
    }

    /**
     * Re-send a fresh code for a sign-up that is still pending.
     *
     * @return 'sent'|'cooldown'|'missing'|'failed'
     */
    public function resend(string $email): string
    {
        $email = strtolower(trim($email));
        $entry = Cache::get($this->key($email));
        if (! is_array($entry)) {
            return 'missing';
        }

        if (now()->timestamp - (int) ($entry['sent_at'] ?? 0) < self::RESEND_COOLDOWN_SECONDS) {
            return 'cooldown';
        }

        $code = $this->newCode();
        $entry['code_hash'] = $this->hash($email, $code);
        $entry['attempts'] = 0;
        $entry['sent_at'] = now()->timestamp;
        Cache::put($this->key($email), $entry, now()->addMinutes(self::TTL_MINUTES));

        return $this->send($email, (string) ($entry['data']['full_name'] ?? ''), $code) ? 'sent' : 'failed';
    }

    /**
     * Check a code. On success the pending sign-up is consumed and returned.
     *
     * @return array{status: 'ok'|'invalid'|'expired'|'locked', data?: array, attempts_left?: int}
     */
    public function verify(string $email, string $code): array
    {
        $email = strtolower(trim($email));
        $key = $this->key($email);
        $entry = Cache::get($key);

        if (! is_array($entry)) {
            return ['status' => 'expired'];
        }

        if ((int) $entry['attempts'] >= self::MAX_ATTEMPTS) {
            Cache::forget($key);

            return ['status' => 'locked'];
        }

        if (! hash_equals((string) $entry['code_hash'], $this->hash($email, preg_replace('/\D/', '', $code)))) {
            $entry['attempts'] = (int) $entry['attempts'] + 1;
            Cache::put($key, $entry, now()->addMinutes(self::TTL_MINUTES));

            return ['status' => 'invalid', 'attempts_left' => max(0, self::MAX_ATTEMPTS - $entry['attempts'])];
        }

        Cache::forget($key);

        return ['status' => 'ok', 'data' => $entry['data']];
    }

    private function send(string $email, string $name, string $code): bool
    {
        try {
            Mail::mailer(config('mail.default'))->send(
                new RegistrationCodeMail($email, $name, $code, self::TTL_MINUTES)
            );

            return true;
        } catch (\Throwable $e) {
            // Never log the code itself.
            Log::error('Registration code mail could not be sent: ' . $e->getMessage());

            return false;
        }
    }

    private function newCode(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    private function hash(string $email, string $code): string
    {
        return hash_hmac('sha256', $email . '|' . $code, (string) config('app.key'));
    }

    private function key(string $email): string
    {
        return 'register:pending:' . hash('sha256', $email);
    }
}
