<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * LocalAsset — resolve a catalog/storage image reference WITHOUT a network hop.
 *
 * WHY THIS CLASS EXISTS
 * ---------------------
 * The try-on flow needs the RAW BYTES of every garment cut-out and the customer
 * portrait. Those assets are stored on the `public` disk and the database keeps
 * their ABSOLUTE url (`Storage::disk('public')->url($path)` ->
 * `http://127.0.0.1:8000/storage/catalog/x.png`).
 *
 * Both the renderer (`VtonApiRenderer::toDataUri`) and the controller
 * (`TryOnController::toBase64DataUri`) used to resolve such a url with
 * `Http::timeout(20)->get($url)`. On the `php artisan serve` dev server that is
 * a SELF-FETCH: the process is single-threaded, so the queued worker (or the
 * request handler itself) blocks waiting for the very server that is busy
 * running it. The fetch dies with `cURL error 28: Operation timed out after
 * 20016ms` — measured in storage/logs/laravel.log — and the render then fails
 * with "input rejected" / no-asset even though the file is sitting right there
 * on local disk.
 *
 * The disk already holds the bytes, so reading them directly is both correct and
 * strictly faster. This helper maps a reference back to a disk path and reads
 * it; it only falls back to HTTP for genuinely REMOTE urls (e.g. a Supabase
 * bucket) that this host does not own.
 */
class LocalAsset
{
    /** Disk that backs the web-served `/storage` symlink. */
    private const DISK = 'public';

    /**
     * Turn any image reference into a Base64 data URI, or null when it cannot
     * be resolved.
     *
     * Order of resolution:
     *   1. An already-encoded `data:` URI is returned as-is.
     *   2. A reference that maps to a file ON THIS HOST'S public disk is read
     *      straight off disk (no network).
     *   3. A SUPABASE-PROXIED reference is resolved to the bucket's absolute url
     *      and fetched over HTTP. This is the shape the catalog ACTUALLY stores.
     *   4. Any other remote URL is fetched over HTTP.
     *   5. Anything else is treated as raw Base64 and given a PNG prefix.
     */
    public static function toDataUri(?string $reference): ?string
    {
        if (!is_string($reference)) {
            return null;
        }

        $reference = trim($reference);
        if ($reference === '') {
            return null;
        }

        if (str_starts_with($reference, 'data:image')) {
            return $reference;
        }

        // 2. Local disk read — the fix for the single-threaded self-fetch.
        $local = self::readFromDisk($reference);
        if ($local !== null) {
            return $local;
        }

        /*
         * 3. THE SHAPE THE CATALOG ACTUALLY STORES.
         *
         * `SupabaseStorage::publicPath()` persists a ROOT-RELATIVE proxy path:
         *
         *     /supabase-storage/storage/v1/object/public/products/catalog/x.png
         *
         * MEASURED on the live database: this is the ONLY shape present on
         * `image_url` / `display_image_url` / `ghost_mannequin_url` for the
         * seeded product. The front-end reads it through the same-origin proxy
         * (COEP requires that), but the BACKEND has no such constraint — it can
         * fetch the bucket directly.
         *
         * This reference matched NEITHER of the old branches: it is not a
         * `data:` URI, and it does not start with `http(s)://`, so it fell
         * straight through to the bare-base64 test and returned null. Every
         * bag-hydrated garment therefore resolved to no pixels at all and the
         * render failed with `no_garment_asset` even though the object was
         * sitting in the bucket.
         *
         * The key is resolved with `SupabaseStorage::keyFromReference()` — the
         * SAME helper the storage proxy and `ProductController` already use —
         * rather than a second, drifting parser for the same string shape.
         */
        $bucketUrl = self::supabaseUrlFor($reference);
        if ($bucketUrl !== null) {
            return self::fetchAsDataUri($bucketUrl);
        }

        // 4. Remote url (a Supabase bucket, or a host we do not own).
        if (str_starts_with($reference, 'http://') || str_starts_with($reference, 'https://')) {
            return self::fetchAsDataUri($reference);
        }

        // 5. Bare base64 blob.
        if (preg_match('#^[A-Za-z0-9+/=\s]+$#', $reference) && strlen($reference) > 256) {
            return 'data:image/png;base64,' . preg_replace('/\s+/', '', $reference);
        }

        return null;
    }

    /**
     * Resolve a Supabase bucket OBJECT KEY to the bucket's own absolute URL.
     *
     * Returns null when the reference is not one of our bucket objects OR when
     * `SUPABASE_URL` is not configured, so the caller can carry on with its other
     * resolution paths instead of being blocked by this one.
     */
    private static function supabaseUrlFor(string $reference): ?string
    {
        try {
            $key = SupabaseStorage::keyFromReference($reference);
        } catch (\Throwable $e) {
            return null;
        }

        if ($key === null || trim($key) === '') {
            return null;
        }

        $base = rtrim((string) config('services.supabase.url'), '/');
        if ($base === '') {
            Log::warning('LocalAsset: SUPABASE_URL is not configured; cannot resolve ' . $reference);

            return null;
        }

        /*
         * Rebuild the documented PUBLIC object url from the validated key.
         * The literal prefix is used (not the raw reference) so nothing that was
         * not vetted by `keyFromReference` can reach the upstream request.
         */
        return $base . '/storage/v1/object/public/' . SupabaseStorage::BUCKET . '/' . ltrim($key, '/');
    }

    /**
     * Fetch a remote image and return it as a data URI, or null on any failure.
     *
     * Never throws: every caller treats an unresolvable asset as a normal,
     * reportable condition rather than a crash.
     */
    private static function fetchAsDataUri(string $url): ?string
    {
        try {
            $res = \Illuminate\Support\Facades\Http::timeout(20)->get($url);
            if ($res->successful() && strlen($res->body()) > 0) {
                $mime = $res->header('Content-Type') ?: 'image/png';
                $mime = explode(';', $mime)[0];

                return 'data:' . $mime . ';base64,' . base64_encode($res->body());
            }
        } catch (\Throwable $e) {
            Log::warning('LocalAsset: remote fetch failed for ' . $url . ': ' . $e->getMessage());
        }

        return null;
    }

    /**
     * Read a reference straight off the local `public` disk when it points at
     * this host's own `/storage` tree. Returns a data URI, or null when the
     * reference is not a local asset (or the file is missing).
     */
    private static function readFromDisk(string $reference): ?string
    {
        $path = self::diskPathFor($reference);
        if ($path === null) {
            return null;
        }

        try {
            $disk = Storage::disk(self::DISK);
            if (!$disk->exists($path)) {
                return null;
            }

            $bytes = $disk->get($path);
            if ($bytes === null || $bytes === '') {
                return null;
            }

            $mime = $disk->mimeType($path) ?: 'image/png';

            return 'data:' . $mime . ';base64,' . base64_encode($bytes);
        } catch (\Throwable $e) {
            Log::warning('LocalAsset: disk read failed for ' . $path . ': ' . $e->getMessage());

            return null;
        }
    }

    /**
     * Map an image reference onto a path INSIDE the public disk, or null when it
     * is not a local `/storage/...` asset this app owns.
     *
     * Handles all three shapes the catalog can store:
     *   - absolute:  http://127.0.0.1:8000/storage/catalog/x.png
     *   - root-rel:  /storage/catalog/x.png
     *   - disk-rel:  catalog/x.png
     *
     * A url whose host is NOT this app's host is left alone (returns null) so a
     * genuinely remote asset is still fetched over HTTP rather than being
     * mis-mapped onto a local path that does not exist.
     */
    private static function diskPathFor(string $reference): ?string
    {
        $candidate = $reference;

        if (str_starts_with($reference, 'http://') || str_starts_with($reference, 'https://')) {
            $parts = parse_url($reference);
            if (!is_array($parts)) {
                return null;
            }

            $host = $parts['host'] ?? '';
            $appHost = parse_url((string) config('app.url', ''), PHP_URL_HOST) ?: '';

            /*
             * Only rewrite a url that points back at this app. `localhost` and
             * `127.0.0.1` are treated as the same host because APP_URL uses one
             * and VITE_API_BASE_URL has used the other.
             */
            $localHosts = array_filter([$appHost, 'localhost', '127.0.0.1', '::1']);
            $sameHost = false;
            foreach ($localHosts as $localHost) {
                if (strcasecmp($host, $localHost) === 0) {
                    $sameHost = true;
                    break;
                }
            }

            if (!$sameHost) {
                return null;
            }

            $candidate = $parts['path'] ?? '';
        }

        $candidate = ltrim($candidate, '/');

        // `/storage/...` is the symlinked public prefix; strip it to a disk path.
        if (str_starts_with($candidate, 'storage/')) {
            $candidate = substr($candidate, strlen('storage/'));
        }

        if ($candidate === '') {
            return null;
        }

        return $candidate;
    }
}
