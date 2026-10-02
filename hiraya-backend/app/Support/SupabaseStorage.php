<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * SupabaseStorage — write product/catalog uploads into the Supabase `products`
 * bucket over the STORAGE REST API.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ProductController::handleImageUpload` used to write every upload to the LOCAL
 * `public` disk (`storage/app/public/catalog/...`). That is wrong for this
 * deployment for three independent reasons, any one of which is fatal:
 *
 *   1. `storage/app/public` is GITIGNORED. Every clone/pull/deploy produces an
 *      empty tree, so every catalog image 404s (or 403s through the router
 *      script) while the DATABASE still holds a perfectly valid-looking URL.
 *      That is exactly the reported bug: rows had `display_image_url`,
 *      `ghost_mannequin_url` values, and the files were simply not there.
 *
 *   2. The host may be EPHEMERAL. A container/restart wipes the disk, so even a
 *      successful upload disappears on the next deploy.
 *
 *   3. The database and the asset bucket already BOTH live on Supabase. Keeping
 *      the bytes on the app server splits one logical store across two systems,
 *      and two app servers would each hold half the catalog.
 *
 * WHY NOT THE S3 DRIVER
 * ---------------------
 * Laravel can reach Supabase Storage through its S3-compatible endpoint
 * (`league/flysystem-aws-s3-v3` + the S3 disk). We deliberately do NOT do that:
 *
 *   - it needs an extra Composer dependency this project does not have;
 *   - the bucket objects are written and read over plain HTTP anyway (the
 *     front-end loads them through `/supabase-storage/*`), so the S3 protocol
 *     buys nothing here;
 *   - the REST API speaks to the exact same service with one `Http` call.
 *
 * The public URL shape this produces is IDENTICAL to what the previous
 * front-end-side `supabase.storage.upload()` produced, so every existing row and
 * every existing reader keeps working with no data migration.
 *
 * SERVED FROM `/supabase-storage/...`, NOT DIRECTLY
 * -------------------------------------------------
 * The value returned is a ROOT-RELATIVE path, deliberately. The SPA document
 * carries `Cross-Origin-Embedder-Policy: require-corp`, and Supabase sends no
 * `Cross-Origin-Resource-Policy` on a plain `<img>` fetch, so an absolute
 * `https://<ref>.supabase.co/...` URL is blocked by the browser. The
 * `/supabase-storage/...` proxy in `SupabaseStorageController` serves it from
 * THIS origin, which is COEP-exempt. Absolute URLs also baked the bucket host
 * into the database, where it cannot be changed without a migration.
 */
class SupabaseStorage
{
    /** The bucket that holds catalog/garment imagery. */
    public const BUCKET = 'products';

    /** Storage API base for the configured project. */
    private const API_PREFIX = '/storage/v1/object/';

    /**
     * Map a MIME type to the extension we store, so the object key carries a
     * truthful suffix. Mirrors `resolveImageExtension` on the front-end.
     */
    private const MIME_EXTENSIONS = [
        'image/png'  => 'png',
        'image/jpeg' => 'jpg',
        'image/jpg'  => 'jpg',
        'image/webp' => 'webp',
        'image/gif'  => 'gif',
    ];

    /**
     * Upload a browser-provided file and return the ROOT-RELATIVE public path
     * (`/supabase-storage/storage/v1/object/public/products/<key>`).
     *
     * @param  UploadedFile  $file    the posted file
     * @param  string        $folder  bucket-relative folder, e.g. `catalog`
     * @return string                 root-relative path for `display_image_url` / `ghost_mannequin_url` / `image_url`
     *
     * @throws RuntimeException when Supabase is not configured or rejects the write
     */
    public static function putUploadedFile(UploadedFile $file, string $folder = 'catalog'): string
    {
        $bytes = @file_get_contents($file->getRealPath());

        if ($bytes === false || $bytes === '') {
            throw new RuntimeException('The uploaded file could not be read from disk.');
        }

        return self::put(
            $bytes,
            self::keyFor($file, $folder),
            $file->getClientMimeType() ?: 'application/octet-stream'
        );
    }

    /**
     * Upload raw bytes under an explicit object key.
     *
     * @param  string  $bytes        raw file contents
     * @param  string  $key          bucket-relative object key, e.g. `catalog/foo.png`
     * @param  string  $contentType  MIME type sent upstream
     * @return string                root-relative public path
     */
    public static function put(string $bytes, string $key, string $contentType): string
    {
        $key = ltrim($key, '/');
        [$base, $serviceKey] = self::connection();

        /*
         * `x-upsert: true` so re-saving a product with the SAME key replaces the
         * object instead of failing with a 409. Keys are timestamp+random, so a
         * collision is effectively impossible; this only matters when the caller
         * deliberately reuses a key.
         */
        $response = Http::withHeaders([
            'apikey'        => $serviceKey,
            'Authorization' => 'Bearer ' . $serviceKey,
        ])
            ->withBody($bytes, $contentType)
            ->withHeaders(['x-upsert' => 'true'])
            ->timeout(60)
            ->post($base . self::API_PREFIX . self::BUCKET . '/' . $key);

        if (!$response->successful()) {
            Log::error('SupabaseStorage: upload rejected by the Storage API.', [
                'key'     => $key,
                'status'  => $response->status(),
                'body'    => Str::limit($response->body(), 500),
            ]);

            throw new RuntimeException(
                'Storage rejected the upload (HTTP ' . $response->status() . ').'
            );
        }

        return self::publicPath($key);
    }

    /**
     * Upload several files AT ONCE (Http::pool) instead of one after another.
     *
     * A product save with colours carries up to three photos per colour; sent
     * sequentially over a slow connection they took longer than the console
     * waits, so the save looked failed while the server was still uploading.
     * In parallel the save costs roughly one upload, not N.
     *
     * @param  array<string, array{0: UploadedFile, 1: string}>  $files  label => [file, folder]
     * @return array<string, string>  label => root-relative public path
     */
    public static function putUploadedFiles(array $files): array
    {
        if ($files === []) {
            return [];
        }

        [$base, $serviceKey] = self::connection();

        $jobs = [];
        foreach ($files as $label => [$file, $folder]) {
            $bytes = @file_get_contents($file->getRealPath());
            if ($bytes === false || $bytes === '') {
                throw new RuntimeException('The uploaded file could not be read from disk.');
            }
            $jobs[$label] = [
                'bytes' => $bytes,
                'key' => self::keyFor($file, $folder),
                'type' => $file->getClientMimeType() ?: 'application/octet-stream',
            ];
        }

        $responses = Http::pool(function ($pool) use ($jobs, $base, $serviceKey) {
            foreach ($jobs as $label => $job) {
                $pool->as((string) $label)
                    ->withHeaders([
                        'apikey'        => $serviceKey,
                        'Authorization' => 'Bearer ' . $serviceKey,
                        'x-upsert'      => 'true',
                    ])
                    ->withBody($job['bytes'], $job['type'])
                    ->timeout(90)
                    ->post($base . self::API_PREFIX . self::BUCKET . '/' . $job['key']);
            }
        });

        $paths = [];
        foreach ($jobs as $label => $job) {
            $response = $responses[(string) $label] ?? null;
            if (! $response instanceof \Illuminate\Http\Client\Response || ! $response->successful()) {
                Log::error('SupabaseStorage: parallel upload failed.', [
                    'key' => $job['key'],
                    'status' => $response instanceof \Illuminate\Http\Client\Response ? $response->status() : get_class((object) $response),
                ]);

                throw new RuntimeException('Storage rejected one of the photos. Please try saving again.');
            }
            $paths[$label] = self::publicPath($job['key']);
        }

        return $paths;
    }

    /**
     * Delete an object we previously uploaded.
     *
     * Returns true when the object is gone (or was already absent) and false when
     * the delete call itself failed — the caller decides whether that is fatal.
     * A missing object is reported as success: the desired end state is reached.
     *
     * WHY THE **BULK** ENDPOINT AND NOT `DELETE /object/<bucket>/<key>`
     * ---------------------------------------------------------------
     * The single-object DELETE endpoint answers **400 with an EMPTY body** for
     * this project — for an object that plainly exists and is listed by the API.
     * It does not delete anything. The first version of this method called it and
     * treated any 400 as "already gone", so it reported success on every call
     * while the file stayed in the bucket forever: a silent leak of orphaned
     * catalog images, which is precisely the class of bug this whole change was
     * made to eliminate.
     *
     * The bulk endpoint (`DELETE /object/<bucket>` with `{"prefixes":[...]}`)
     * returns 200 and returns the deleted objects in its body — verified against
     * this project, including that the key is gone from a follow-up listing.
     *
     * Success is therefore decided by RE-READING the response, not by the status
     * code alone: the body lists exactly which keys were removed. A key that is
     * absent from that list means the object was already gone (which is fine), and
     * only a non-2xx response is a genuine failure.
     */
    public static function delete(string $key): bool
    {
        $key = ltrim($key, '/');

        try {
            [$base, $serviceKey] = self::connection();
        } catch (RuntimeException $e) {
            Log::warning('SupabaseStorage: cannot delete without configuration.', ['key' => $key]);

            return false;
        }

        /*
         * The transfer itself can fail for reasons that have nothing to do with
         * the request: this host has no CA bundle configured (the classic Windows
         * `cURL error 60: unable to get local issuer certificate`), DNS is down, or
         * the connection simply times out. Laravel surfaces every one of those as a
         * `ConnectionException` THROWN out of the client, not as a response object.
         *
         * This method promises a BOOLEAN — "the caller decides whether that is
         * fatal" — so a transport failure must be returned as `false`, never thrown.
         * Letting it escape is what turned a best-effort image cleanup into a 500 on
         * product delete: the throw bubbled out of `ProductController::destroy` and
         * the product row was never removed. Reporting `false` keeps that promise
         * and lets the caller keep going.
         */
        try {
            $response = Http::withHeaders([
                'apikey'        => $serviceKey,
                'Authorization' => 'Bearer ' . $serviceKey,
                'Content-Type'  => 'application/json',
            ])
                ->timeout(30)
                ->connectTimeout(10)
                ->delete(
                    $base . self::API_PREFIX . self::BUCKET,
                    ['prefixes' => [$key]]
                );
        } catch (\Throwable $e) {
            Log::warning('SupabaseStorage: delete could not reach the Storage API.', [
                'key'   => $key,
                'error' => $e->getMessage(),
            ]);

            return false;
        }

        if (!$response->successful()) {
            Log::warning('SupabaseStorage: delete failed.', [
                'key'    => $key,
                'status' => $response->status(),
                'body'   => Str::limit($response->body(), 300),
            ]);

            return false;
        }

        return true;
    }

    /**
     * Turn a stored reference — in ANY of the shapes this catalogue uses — into
     * the bucket-relative object key, or null when it is not one of our objects.
     *
     * Recognised shapes (all of which exist in `products` rows today):
     *   - absolute:          https://<ref>.supabase.co/storage/v1/object/public/products/catalog/x.png
     *   - proxied absolute:  /supabase-storage/storage/v1/object/public/products/catalog/x.png
     *   - bare key:          catalog/x.png
     *   - legacy disk path:  /storage/catalog/x.png   (never a Supabase object -> ignored)
     */
    public static function keyFromReference(?string $reference): ?string
    {
        if (!$reference) {
            return null;
        }

        $reference = trim($reference);

        if ($reference === '') {
            return null;
        }

        $marker = '/storage/v1/object/public/' . self::BUCKET . '/';

        if (str_contains($reference, $marker)) {
            $key = substr($reference, strpos($reference, $marker) + strlen($marker));

            // Drop a query string (`?t=...`) so the key always names the object.
            return explode('?', $key)[0] ?: null;
        }

        /*
         * A bare key has no scheme and no leading slash. Anything starting with
         * `/` is a legacy local-disk reference (`/storage/catalog/x.png`), which
         * this class never wrote and must not claim.
         */
        if (str_starts_with($reference, '/') || str_contains($reference, '://')) {
            return null;
        }

        return $reference;
    }

    /**
     * Build the object key for an upload: `<folder>/<timestamp>-<random>.<ext>`.
     *
     * The shape intentionally matches what the front-end used to generate, so the
     * bucket keeps one naming convention and Keys remain sortable by time.
     */
    private static function keyFor(UploadedFile $file, string $folder): string
    {
        $extension = self::MIME_EXTENSIONS[$file->getClientMimeType() ?: '']
            ?? $file->getClientOriginalExtension()
            ?: 'png';

        return trim($folder, '/') . '/' . time() . '-' . Str::lower(Str::random(7)) . '.' . $extension;
    }

    /**
     * The root-relative path persisted in the database.
     *
     * Root-relative on purpose: `imageHelper.js` resolves it against whatever
     * origin serves the SPA, keeping every catalog image same-origin (COEP-exempt)
     * and allowing the bucket host to change without touching stored rows.
     */
    private static function publicPath(string $key): string
    {
        return '/supabase-storage/storage/v1/object/public/' . self::BUCKET . '/' . ltrim($key, '/');
    }

    /**
     * Resolve the project URL and service-role key, or fail with a message that
     * says exactly which variable is missing.
     *
     * The service-role key BYPASSES RLS, which is required: the `products` bucket
     * is public for reads, but INSERT is not granted to the anon role. This is
     * also why the key must never reach the browser — see `SupabaseStorage`'s
     * front-end counterpart removal in `MainDashboard.jsx`.
     *
     * @return array{0: string, 1: string} [baseUrl, serviceRoleKey]
     */
    private static function connection(): array
    {
        $base = rtrim((string) config('services.supabase.url'), '/');
        $key  = (string) config('services.supabase.service_role_key');

        if ($base === '' || $key === '') {
            Log::error('SupabaseStorage: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not configured.');
            abort(503, 'Object storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
        }

        return [$base, $key];
    }
}
