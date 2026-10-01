<?php

namespace App\Services;

use App\Models\ApiCredential;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * RESOLVES THE ACTIVE KEY FOR A PROVIDER — database first, `.env` as fallback.
 *
 * THE DESIGN RULE
 * ---------------
 * This service never *requires* the database. It prefers it, and falls back to
 * the existing `.env` configuration. That is deliberate, and it is what lets this
 * ship without breaking anything:
 *
 *   - A deployment with NO rows in `api_credentials` behaves EXACTLY as it did
 *     before, because the fallback reads the same `config('services.…')` values
 *     the renderers already read.
 *   - A deployment that adopts the panel can rotate a key from the console
 *     without touching a file on disk.
 *   - A database that is unreachable degrades to `.env` instead of taking down
 *     every try-on render.
 *
 * IT IS DELIBERATELY NOT A CACHE
 * -----------------------------
 * The panel's claim is that the active key is *dynamic* — that it changes
 * without a deploy. A cached copy would reintroduce exactly the staleness the
 * table removes, and would need invalidation on every write. So every resolution
 * is a single indexed query, and a rotation is visible to the very next request.
 * The query is cheap and only runs on paths that are about to make an outbound
 * call anyway.
 */
class ApiCredentialStore
{
    /** Providers this service will resolve, matching the status registry. */
    public const PROVIDERS = ['pixelapi', 'gemini', 'supabase'];

    /**
     * The secret a caller should use RIGHT NOW.
     *
     * Order of preference:
     *   1. the active, unexpired database row for the provider
     *   2. `.env` / config, so an un-migrated deployment keeps working
     *
     * Returns null only when the provider is genuinely unconfigured, which is the
     * same signal the renderers already handle.
     */
    public static function activeSecret(string $provider): ?string
    {
        $row = self::activeRow($provider);

        if ($row !== null) {
            $plain = $row->plainSecret();

            if ($plain !== null && $plain !== '') {
                return $plain;
            }

            /*
             * The row exists but its secret will not decrypt — most likely the
             * APP_KEY was rotated after it was stored. Falling through to `.env`
             * is strictly better than returning null, which would read as "this
             * provider is not configured" and could disable the feature entirely.
             */
            Log::warning('Api credential could not be decrypted; falling back to env', [
                'provider' => $provider,
                'credential_id' => $row->id,
            ]);
        }

        return self::envSecret($provider);
    }

    /**
     * The active database row for a provider, or null.
     *
     * "Active" means: flagged active, not retired, and not past a known expiry.
     * An expired key is deliberately excluded so a short-lived token can never be
     * handed to a renderer even in the window before the scheduled task rotates
     * it away — the request fails cleanly and the task catches up, rather than
     * every call failing against a key we already knew was dead.
     */
    public static function activeRow(string $provider): ?ApiCredential
    {
        try {
            return ApiCredential::query()
                ->where('provider', $provider)
                ->where('is_active', true)
                ->whereNull('retired_at')
                ->orderByDesc('id')
                ->get()
                ->first(fn(ApiCredential $c) => !$c->isExpired());
        } catch (Throwable $e) {
            /*
             * A missing or unmigrated table must not be fatal. This service is on
             * the renderer's hot path, and a schema problem should degrade to the
             * `.env` behaviour rather than break every customer fitting.
             */
            Log::warning('Api credential lookup failed: ' . $e->getMessage(), [
                'provider' => $provider,
            ]);

            return null;
        }
    }

    /**
     * The pre-existing configuration value for a provider, unchanged.
     *
     * Kept as its own method so the fallback is obvious in review, and so the
     * console can report "using .env" as a distinct, honest state rather than
     * implying a managed credential exists when none does.
     */
    public static function envSecret(string $provider): ?string
    {
        $path = match ($provider) {
            'pixelapi' => 'services.vton.token',
            'gemini' => 'services.gemini.key',
            'supabase' => 'services.supabase.service_role_key',
            default => null,
        };

        if ($path === null) {
            return null;
        }

        $value = trim((string) config($path));

        if ($value === '' || preg_match('/^(<.*>|your[-_]?key|changeme|null|none)$/i', $value)) {
            return null;
        }

        return $value;
    }

    /**
     * Where the active key for a provider is coming from RIGHT NOW.
     *
     * @return 'database'|'env'|'none'
     */
    public static function sourceFor(string $provider): string
    {
        if (self::activeRow($provider) !== null) {
            return 'database';
        }

        return self::envSecret($provider) !== null ? 'env' : 'none';
    }

    /**
     * STORE A NEW KEY, optionally making it the active one.
     *
     * Refuses a key that is already on file for the provider. Silently re-adding
     * it under a new label would create two rows that decrypt to the same secret
     * and make the panel's history a lie about how many distinct keys exist.
     *
     * @return array{0: bool, 1: ?string} [ok, error message]
     */
    public static function store(string $provider, string $label, string $secret, bool $activate = true): array
    {
        $secret = trim($secret);

        if (!in_array($provider, self::PROVIDERS, true)) {
            return [false, "Unknown provider '{$provider}'."];
        }

        if ($secret === '') {
            return [false, 'The key is empty.'];
        }

        $fingerprint = ApiCredential::fingerprintFor($secret);

        $duplicate = ApiCredential::query()
            ->where('provider', $provider)
            ->where('fingerprint', $fingerprint)
            ->first();

        if ($duplicate) {
            return [false, "That key is already stored as \"{$duplicate->label}\"."];
        }

        $row = new ApiCredential([
            'provider' => $provider,
            'label' => $label !== '' ? $label : 'Key ' . now()->format('M j H:i'),
            'is_active' => false,
            'last_status' => ApiCredential::STATUS_UNVERIFIED,
        ]);

        // Goes through the mutator, which encrypts and fingerprints.
        $row->secret = $secret;
        $row->created_by = auth()->id();
        $row->save();

        if ($activate) {
            self::promote($row);
        }

        return [true, null];
    }

    /**
     * MAKE THIS ROW THE ACTIVE KEY for its provider.
     *
     * Done in a transaction and by CLEARING the others first, so the invariant
     * "at most one active key per provider" holds even if two operators click at
     * the same moment. Without the transaction, a race could leave two rows
     * flagged active and `activeRow()` would silently pick one of them.
     */
    public static function promote(ApiCredential $row): void
    {
        \Illuminate\Support\Facades\DB::transaction(function () use ($row) {
            ApiCredential::query()
                ->where('provider', $row->provider)
                ->where('id', '!=', $row->id)
                ->update(['is_active' => false]);

            $row->forceFill(['is_active' => true, 'retired_at' => null])->save();
        });

        Log::info('Active API credential changed', [
            'provider' => $row->provider,
            'label' => $row->label,
            'credential_id' => $row->id,
        ]);
    }

    /**
     * RETIRE a key without deleting it.
     *
     * Deleting would erase the evidence of what was in play, which is the thing
     * that makes an outage diagnosable afterwards. The row is marked retired and
     * the next non-retired row is promoted so the provider keeps working.
     *
     * Refuses to retire the LAST usable credential for a provider: that would take
     * the feature down, and the operator's real next step is to add a key, not to
     * be told the operation succeeded.
     */
    public static function retire(ApiCredential $row): array
    {
        $remaining = ApiCredential::query()
            ->where('provider', $row->provider)
            ->where('id', '!=', $row->id)
            ->whereNull('retired_at')
            ->where('is_active', true)
            ->count();

        if ($remaining === 0 && self::envSecret($row->provider) === null) {
            return [false, 'This is the only working key for this service. Add a replacement first.'];
        }

        $row->forceFill([
            'is_active' => false,
            'retired_at' => now(),
            'last_status' => ApiCredential::STATUS_UNAUTHORIZED,
        ])->save();

        // Promote any surviving key so the service is never left pointing at
        // nothing.
        $next = ApiCredential::query()
            ->where('provider', $row->provider)
            ->whereNull('retired_at')
            ->where('is_active', false)
            ->orderByDesc('id')
            ->first();

        if ($next) {
            self::promote($next);
        }

        Log::info('API credential retired', [
            'provider' => $row->provider,
            'label' => $row->label,
            'by_user_id' => auth()->id(),
        ]);

        return [true, null];
    }

    /**
     * Record a verification verdict against a row.
     *
     * Kept separate from the verify logic so the command and the manual console
     * button produce identical history — a key that was checked by a person and
     * one checked by the scheduler must be indistinguishable in the record.
     */
    public static function recordVerdict(ApiCredential $row, string $status, ?string $message = null): void
    {
        $row->forceFill([
            'last_status' => $status,
            'last_message' => $message !== null ? mb_substr($message, 0, 500) : null,
            'last_verified_at' => now(),
        ])->save();
    }

    /**
     * A console-ready summary of where every provider's key is coming from.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function overview(): array
    {
        $out = [];

        foreach (self::PROVIDERS as $provider) {
            $active = self::activeRow($provider);
            $count = 0;

            try {
                $count = ApiCredential::query()
                    ->where('provider', $provider)
                    ->whereNull('retired_at')
                    ->count();
            } catch (Throwable $e) {
                $count = 0;
            }

            $out[$provider] = [
                'source' => self::sourceFor($provider),
                'managed' => $count > 0,
                'stored_keys' => $count,
                'active' => $active?->toPanelArray(),
            ];
        }

        return $out;
    }
}
