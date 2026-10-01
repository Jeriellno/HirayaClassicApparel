<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;

/**
 * ONE EXTERNAL API CREDENTIAL, held in the database instead of (only) `.env`.
 *
 * See the migration for why the table exists at all. This model owns the two
 * things that must not be got wrong around the secret:
 *
 *   1. It is ENCRYPTED AT REST. `secret_ciphertext` is only ever written through
 *      `setSecretAttribute()`, and only ever read through `plainSecret()`. There
 *      is deliberately no accessor that silently returns the plaintext, because an
 *      attribute that decrypts on every `$model->toArray()` would put live keys
 *      into every log line, API response and error message that touches the
 *      model — which is exactly how a Supabase service-role key ends up on the
 *      internet. Making the decrypt an explicit method call means a leak has to
 *      be deliberate.
 *
 *   2. It is MASKED for display. `maskedSecret()` is what the console shows, and
 *      it is derived from the plaintext only long enough to build a hint.
 */
class ApiCredential extends Model
{
    /** Verification verdicts, matching ProviderHealthEvent's vocabulary. */
    public const STATUS_VALID = 'valid';
    public const STATUS_UNAUTHORIZED = 'unauthorized';
    public const STATUS_RATE_LIMITED = 'rate_limited';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_ERROR = 'error';
    public const STATUS_UNVERIFIED = 'unverified';

    protected $fillable = [
        'provider',
        'label',
        'secret_ciphertext',
        'fingerprint',
        'is_active',
        'expires_at',
        'last_verified_at',
        'last_status',
        'last_message',
        'retired_at',
        'created_by',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'expires_at' => 'datetime',
        'last_verified_at' => 'datetime',
        'retired_at' => 'datetime',
    ];

    /**
     * `secret_ciphertext` is deliberately NOT in `$casts` and has no accessor.
     * Encrypting on write here means no call site can store a plaintext key by
     * forgetting to call Crypt — the single most damaging mistake this table
     * could allow.
     */
    protected function setSecretAttribute(?string $plain): void
    {
        $plain = trim((string) $plain);

        if ($plain === '') {
            $this->attributes['secret_ciphertext'] = '';
            $this->attributes['fingerprint'] = '';

            return;
        }

        $this->attributes['secret_ciphertext'] = Crypt::encryptString($plain);
        $this->attributes['fingerprint'] = self::fingerprintFor($plain);
    }

    /**
     * A stable, non-reversible identifier for a secret.
     *
     * Used to tell "is this key already stored?" without decrypting every row. The
     * input is hashed with the app key, so the fingerprint cannot be used to
     * confirm a guessed key against a database dump without also holding APP_KEY.
     */
    public static function fingerprintFor(string $plain): string
    {
        return hash_hmac('sha256', trim($plain), (string) config('app.key'));
    }

    /**
     * THE ONLY WAY TO GET THE PLAIN KEY OUT. Explicit, so every read is a
     * deliberate act that can be found in review.
     *
     * Returns null rather than throwing when decryption fails, because a key that
     * was encrypted under a rotated APP_KEY should degrade to "this credential is
     * unusable" rather than taking down a request that may not even need it.
     */
    public function plainSecret(): ?string
    {
        $raw = (string) $this->attributes['secret_ciphertext'];

        if ($raw === '') {
            return null;
        }

        try {
            return Crypt::decryptString($raw);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * A display hint: first few and last four characters only.
     *
     * Enough for an operator to confirm "this is the key I pasted", useless to
     * anyone who reads the screen or a log. Deliberately built without exposing
     * the whole value in a template.
     */
    public function maskedSecret(): string
    {
        $plain = $this->plainSecret();

        if ($plain === null || strlen($plain) < 12) {
            return '••••••••';
        }

        return substr($plain, 0, 6) . '…' . substr($plain, -4);
    }

    /** Has the vendor told us this key dies at a known moment? */
    public function hasKnownExpiry(): bool
    {
        return $this->expires_at !== null;
    }

    /**
     * Is this credential past its expiry RIGHT NOW?
     *
     * Separate from "unverified" and "unauthorized": a short-lived token can be
     * perfectly valid and still time out, and the panel must be able to say which
     * happened, because the remedy differs (wait vs. replace).
     */
    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /**
     * The shape the API and console consume.
     *
     * Note what is absent: the secret, in any form, other than the masked hint.
     */
    public function toPanelArray(): array
    {
        return [
            'id' => $this->id,
            'provider' => $this->provider,
            'label' => $this->label,
            'masked' => $this->maskedSecret(),
            'is_active' => (bool) $this->is_active,
            'expires_at' => $this->expires_at?->toIso8601String(),
            'expires_soon' => $this->isExpiringSoon(),
            'last_verified_at' => $this->last_verified_at?->toIso8601String(),
            'last_status' => $this->last_status ?? self::STATUS_UNVERIFIED,
            'last_message' => $this->last_message,
            'retired_at' => $this->retired_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }

    /**
     * Warn before the customer does.
     *
     * A key expiring within the hour is still working, so it must not be rendered
     * as broken — but the whole point of scheduling is to act before a failure, so
     * the console gets a warning band rather than a binary.
     */
    public function isExpiringSoon(int $withinMinutes = 60): bool
    {
        if ($this->expires_at === null) {
            return false;
        }

        return $this->expires_at->between(now(), now()->addMinutes($withinMinutes));
    }
}
