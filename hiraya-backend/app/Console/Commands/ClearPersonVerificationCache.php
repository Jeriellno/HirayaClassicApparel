<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * Clear every cached PERSON-VERIFICATION verdict.
 *
 * WHY THIS IS A NAMED COMMAND AND NOT A MANUAL DELETE
 * ---------------------------------------------------
 * The verdict cache stores, per image SHA-256, the answer to "is there a person
 * in this photo?" for 24 hours. That is correct for a stable question — but the
 * CACHED PAYLOAD SHAPE is part of the contract, and it changed:
 *
 *   - `reason` used to carry the model's free-text explanation
 *     ("real human person wearing a t-shirt and jeans"). It is now a canonical
 *     control token (`person` / `no-person`), with the wording moved to `detail`,
 *     because `verified` is derived from `reason`.
 *
 * An entry written by the older code therefore holds a `reason` the new
 * `verdict()` logic does not recognise, and any request that hits it would be
 * answered from stale data instead of re-asked. The TTL would eventually expire
 * it, but "eventually" is up to 24 hours of wrong answers.
 *
 * Run this after changing: the verification PROMPT, the provider chain, the
 * confidence threshold, or any code that alters the verdict payload shape.
 *
 *   php artisan tryon:clear-verify-cache
 */
class ClearPersonVerificationCache extends Command
{
    protected $signature = 'tryon:clear-verify-cache';

    protected $description = 'Forget all cached person-verification verdicts (run after changing the prompt, providers or verdict shape)';

    /**
     * Prefix every key the controller writes, so the flush is scoped to THIS
     * feature. A blind `Cache::flush()` would also drop sessions, rate limiters
     * and the product-cache entries other pages rely on.
     */
    private const KEY_PREFIX = 'person-verify:';

    public function handle(): int
    {
        $store = Cache::getStore();

        /*
         * DISPATCH ON THE DRIVER CLASS, NOT ON A METHOD GUESS.
         *
         * The first version of this command probed `method_exists($store,
         * 'getFiles')`, which FileStore does NOT have — so it fell through to the
         * "cannot enumerate" branch and cleared nothing, reporting failure on a
         * cache it could perfectly well have cleaned. Checking the concrete class
         * is unambiguous and tells the reader exactly which drivers are handled.
         */
        if ($store instanceof \Illuminate\Cache\FileStore) {
            $cleared = $this->clearFileStore(
                config('cache.stores.file.path', storage_path('framework/cache/data'))
            );

            $this->info("Cleared {$cleared} cached verdict(s) from the file store.");

            return self::SUCCESS;
        }

        if ($store instanceof \Illuminate\Cache\RedisStore) {
            $cleared = $this->clearByPrefix();

            $this->info("Cleared {$cleared} cached verdict(s) from Redis.");

            return self::SUCCESS;
        }

        $this->warn(
            'Cache driver [' . get_class($store) . '] does not support a scoped clear, so nothing '
            . 'was deleted. This is expected for the array/in-memory store, which does not persist '
            . 'between requests anyway. For a database store, truncate the `cache` table.'
        );

        return self::FAILURE;
    }

    /**
     * Walk the file-store directory and remove only the person-verify entries.
     *
     * THE FILE STORE DOES NOT STORE THE KEY — MEASURED, NOT ASSUMED.
     * ----------------------------------------------------------------
     * This is why the first implementation silently cleared nothing. Laravel's
     * `FileStore::path()` is:
     *
     *     $parts = array_slice(str_split(sha1($key), 2), 0, 2);
     *     return $directory . '/' . implode('/', $parts) . '/' . sha1($key);
     *
     * so the layout is THREE levels (`data/1a/c4/1ac41681...`) and the filename
     * is the SHA-1 of the key — a one-way hash. The entry's payload contains only
     * the VALUE (`<expiry><serialised data>`), never the key. So matching on the
     * key text inside the file could never work, and matching on the filename
     * would require enumerating every possible image SHA-256.
     *
     * WHAT ACTUALLY IDENTIFIES THE ENTRY, then, is the SHAPE OF ITS VALUE: every
     * verdict written by `PersonVerificationController::verdict()` / parsed by
     * `parseVerdict()` is an array carrying `has_person` AND `verified` AND
     * `reason` together. That combination is unique to this feature in this app,
     * and it appears in the serialised payload, so it is what we match on.
     */
    private function clearFileStore(string $directory): int
    {
        $cleared = 0;

        /*
         * THREE levels: <path>/<2 hex>/<2 hex>/<40 hex sha1>.
         *
         * The previous glob asked for only TWO levels, which matched the BUCKET
         * DIRECTORIES and skipped over every real cache file. That is why the
         * command reported "Cleared 0" while a verdict was demonstrably present.
         */
        foreach (glob(rtrim($directory, '/\\') . '/*/*/*') ?: [] as $file) {
            if (! is_file($file)) {
                continue;
            }

            $handle = @fopen($file, 'rb');
            if ($handle === false) {
                continue;
            }

            // Verdict payloads are tiny (a few hundred bytes); 4 KB is generous
            // and still bounded, so one huge unrelated entry cannot be slurped.
            $payload = (string) fread($handle, 4096);
            fclose($handle);

            if (! $this->looksLikePersonVerdict($payload)) {
                continue;
            }

            @unlink($file);
            $cleared++;
        }

        return $cleared;
    }

    /**
     * Does this serialised cache entry hold a person-verification verdict?
     *
     * Requires ALL of `has_person`, `verified` and `reason` to be present, so a
     * product cache or a session blob that happens to contain one of those words
     * is not swept away. Deliberately shape-based rather than prefix-based: the
     * key is not recoverable from a file-store entry (see above).
     */
    private function looksLikePersonVerdict(string $payload): bool
    {
        return str_contains($payload, 'has_person')
            && str_contains($payload, 'verified')
            && str_contains($payload, 'reason');
    }

    /**
     * Scoped clear for Redis, the only other store this deployment is likely to
     * use in production. Keys are matched by the feature prefix so a session,
     * rate limiter or product cache is never touched.
     */
    private function clearByPrefix(): int
    {
        $store = Cache::getStore();

        if (! $store instanceof \Illuminate\Cache\RedisStore) {
            return 0;
        }

        $cleared = 0;

        try {
            // RedisStore::connection() is typed on the concrete class, so the
            // instanceof guard above is what makes this call statically valid.
            $keys = $store->connection()->keys('*' . self::KEY_PREFIX . '*');
        } catch (\Throwable $e) {
            $this->warn('Could not enumerate cache keys: ' . $e->getMessage());

            return 0;
        }

        foreach ($keys as $key) {
            // Redis returns fully-qualified keys (with the app prefix); strip it so
            // Cache::forget() hashes the same name the controller wrote.
            $prefix = (string) config('cache.prefix', '');
            if ($prefix !== '' && str_starts_with($key, $prefix)) {
                $key = substr($key, strlen($prefix));
            }

            Cache::forget($key);
            $cleared++;
        }

        return $cleared;
    }
}
