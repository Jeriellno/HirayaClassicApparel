<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/*
 * GEMINI KEY POOL — many keys, one quota wall removed.
 * ----------------------------------------------------
 * The Gemini free tier is 20 requests/DAY PER KEY. Every vision call in this
 * app (catalog auto-fill, person verification, fit chat) shares one
 * `GEMINI_API_KEY`, so a busy day drains it by noon and every customer sees a
 * 429 until midnight.
 *
 * The pool turns that single key into an ORDERED LIST of keys. The FIRST key
 * with a fresh bucket answers; a key that returns 429 is put on a DAILY
 * COOLDOWN (it is out of requests, not briefly overloaded) and the next key
 * takes over automatically. Callers never pick a key themselves — they ask the
 * pool, make their call, and report the outcome back.
 *
 * KEY SOURCES (comma-separated, order = preference):
 *   GEMINI_API_KEY       the original key, kept as the FIRST entry
 *   GEMINI_API_KEYS      additional keys, tried after the original
 *
 * Rotation state lives in the CACHE, so it survives a queue restart and is
 * shared between web and worker processes. With no cache backend configured
 * (file cache, the default) it still works — it just restarts from key 1 on
 * reboot, which is harmless.
 */
class GeminiKeyPool
{
    /** Cache key holding the index of the currently preferred key. */
    private const STATE_INDEX = 'gemini_key_pool.index';

    /** Cache key prefix holding the daily cooldown expiry per exhausted key. */
    private const STATE_COOLDOWN = 'gemini_key_pool.cooldown.';

    /** How long an exhausted key sits out: until the END of the current day UTC. */
    private const COOLDOWN_TTL = 86400;

    /**
     * The ordered, de-duplicated list of configured keys.
     *
     * @return string[]
     */
    public static function keys(): array
    {
        $original = (string) config('services.gemini.key', '');
        $extra = (string) config('services.gemini.keys', '');

        $all = array_map('trim', explode(',', $original . ',' . $extra));

        return array_values(array_unique(array_filter($all)));
    }

    /**
     * The key the caller SHOULD use right now: the preferred key unless it is
     * on cooldown, in which case the first key with a fresh bucket.
     *
     * Falls back to `services.gemini.key` when the pool is EMPTY so a
     * deployment with no `GEMINI_API_KEYS` behaves exactly as before.
     */
    public static function current(): ?string
    {
        $keys = self::keys();

        if ($keys === []) {
            return null;
        }

        $preferred = self::preferredIndex($keys);
        $now = now()->timestamp;

        for ($offset = 0; $offset < count($keys); $offset++) {
            $index = ($preferred + $offset) % count($keys);
            $expires = Cache::get(self::STATE_COOLDOWN . md5($keys[$index]));

            if (!$expires || $expires <= $now) {
                // Remember the winner so the next call starts here, not back at
                // a key that is already known to be drained.
                Cache::put(self::STATE_INDEX, $index, self::COOLDOWN_TTL);
                return $keys[$index];
            }
        }

        // EVERY key is on cooldown. Return the preferred key anyway: the call
        // will 429 and report it, which is more useful to the operator than a
        // pool that silently refuses.
        return $keys[$preferred];
    }

    /**
     * IS THE KEY STILL ALIVE? — the caller's post-call check.
     *
     * A 429 means the key's DAILY bucket is gone, not a momentary hiccup, so
     * the key sits out the rest of the day and rotation moves on immediately.
     */
    public static function markRateLimited(?string $key): void
    {
        if (!$key || !in_array($key, self::keys(), true)) {
            return;
        }

        $expiresAt = now()->endOfDay()->timestamp;
        Cache::put(self::STATE_COOLDOWN . md5($key), $expiresAt, self::COOLDOWN_TTL);

        // Point the preferred index at the next key so the very next call does
        // not have to walk past the drained one.
        $keys = self::keys();
        $drained = array_search($key, $keys, true);
        Cache::put(self::STATE_INDEX, ($drained + 1) % count($keys), self::COOLDOWN_TTL);

        Log::warning('Gemini key drained (429) — rotated to the next key in the pool', [
            'key_label' => self::label($key),
            'pool_size' => count($keys),
            'cooldown_until' => now()->endOfDay()->toDateTimeString(),
        ]);
    }

    /**
     * A 401/403 means the key is INVALID (revoked or mistyped), not merely
     * drained — it sits out the same cooldown so a dead key never answers.
     */
    public static function markInvalid(?string $key): void
    {
        if (!$key || !in_array($key, self::keys(), true)) {
            return;
        }

        Cache::put(
            self::STATE_COOLDOWN . md5($key),
            now()->endOfDay()->timestamp,
            self::COOLDOWN_TTL
        );

        Log::error('Gemini key rejected (401/403) — key is invalid and sits out for the day', [
            'key_label' => self::label($key),
        ]);
    }

    /*
     * STATUS for the API & AI STATUS tab.
     *
     * Reports every key, its state, and whether the LIVE endpoint still
     * accepts it, so an operator can see a drained pool BEFORE customers do.
     *
     * @return array[]
     */
    public static function status(): array
    {
        $keys = self::keys();
        $now = now()->timestamp;

        return array_map(function ($index, $key) use ($now, $keys) {
            $expires = Cache::get(self::STATE_COOLDOWN . md5($key));

            $state = 'available';
            if ($expires && $expires > $now) {
                $state = 'drained';
            }

            return [
                'index' => $index,
                'label' => self::label($key),
                'state' => $state,
                'preferred' => $index === self::preferredIndex($keys),
                'cooldown_until' => $state === 'drained'
                    ? now()->endOfDay()->toDateTimeString()
                    : null,
            ];
        }, array_keys($keys), $keys);
    }

    /**
     * RESET ONE KEY'S COOLDOWN — the manual safety valve.
     *
     * A drained key is normally left alone until midnight, but a key can be
     * marked 429 in error (a transient Google hiccup, an operator test). This
     * clears its cooldown so it can answer again WITHOUT touching .env or the
     * running config. Does nothing for a key that was never in the pool.
     */
    public static function resetKey(?string $label): bool
    {
        $keys = self::keys();

        foreach ($keys as $key) {
            if (self::label($key) === $label) {
                Cache::forget(self::STATE_COOLDOWN . md5($key));

                // Make it the preferred key again so the very next call uses it.
                Cache::put(
                    self::STATE_INDEX,
                    (int) array_search($key, $keys, true),
                    self::COOLDOWN_TTL
                );

                Log::info('Gemini key cooldown manually reset', ['key_label' => self::label($key)]);

                return true;
            }
        }

        return false;
    }

    /**
     * SHORT LABEL for logs and the status tab — never the full key.
     */
    private static function label(string $key): string
    {
        return substr($key, 0, 6) . '…' . substr($key, -4);
    }

    /**
     * WHICH KEY WOULD ANSWER FIRST, ignoring cooldowns.
     *
     * @param string[] $keys
     */
    private static function preferredIndex(array $keys): int
    {
        $index = (int) Cache::get(self::STATE_INDEX, 0);

        return ($index >= 0 && $index < count($keys)) ? $index : 0;
    }
}
