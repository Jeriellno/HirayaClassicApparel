<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * RENDERED TRY-ON PHOTOS — private, encrypted object storage.
 *
 * Renders used to live as plain Base64 in `try_on_sessions.result_image_base64`,
 * so anyone holding a database dump held every customer's fitting photo. Now:
 *
 *   1. The render (a data URI) is ENCRYPTED with the application key
 *      (Crypt / APP_KEY — the same key-management approach ApiCredential uses;
 *      the key lives in the environment, never in the database or the code).
 *   2. The ciphertext is written to a PRIVATE Supabase Storage bucket
 *      (`config('tryon.renders_bucket')`) under a random, unguessable key with
 *      no user id or session id in it. The bucket is created `public: false`,
 *      and objects are only read back with the service key, server-side.
 *   3. The database keeps only the opaque reference (`supabase:<bucket>/<key>`),
 *      in `try_on_sessions.result_image_path`.
 *
 * So a leaked database yields no images, and a leaked bucket yields ciphertext.
 * Delivery happens only through the authenticated, owner-checked try-on
 * endpoints (TryOnController). If Supabase is unreachable when a render
 * finishes, the encrypted object falls back to the private local disk
 * (`storage/app/private`, not web-served) as `local:<key>`.
 *
 * Nothing here ever logs image bytes, object keys or URLs with tokens.
 */
class RenderVault
{
    private const SUPABASE_PREFIX = 'supabase:';

    private const LOCAL_PREFIX = 'local:';

    /** Encrypt and store a render data URI. Returns the opaque storage reference. */
    public static function put(string $dataUri): string
    {
        $cipher = Crypt::encryptString($dataUri);
        $key = Str::random(48) . '.bin';
        $bucket = self::bucket();

        try {
            [$base, $serviceKey] = self::connection();
            self::ensureBucket($base, $serviceKey, $bucket);

            $upload = fn () => Http::withHeaders([
                'apikey' => $serviceKey,
                'Authorization' => 'Bearer ' . $serviceKey,
                'x-upsert' => 'false',
            ])
                ->withBody($cipher, 'application/octet-stream')
                ->timeout(30)
                ->post($base . '/storage/v1/object/' . $bucket . '/' . $key);

            $response = $upload();

            /*
             * SELF-HEAL: a 400/404 here usually means the bucket is missing even
             * though the "bucket ready" flag is cached (e.g. the bucket was
             * deleted, or the flag was set by a test). Forget the flag, create
             * the private bucket for real, and retry once.
             */
            if (in_array($response->status(), [400, 404], true)) {
                Cache::forget('renders.bucket.ready.' . $bucket);
                self::ensureBucket($base, $serviceKey, $bucket);
                $response = $upload();
            }

            if ($response->successful()) {
                return self::SUPABASE_PREFIX . $bucket . '/' . $key;
            }

            Log::error('RenderVault: upload rejected, keeping the render on the private local disk.', [
                'status' => $response->status(),
            ]);
        } catch (Throwable $e) {
            Log::error('RenderVault: upload failed, keeping the render on the private local disk: ' . $e->getMessage());
        }

        Storage::disk('local')->put('renders/' . $key, $cipher);

        return self::LOCAL_PREFIX . 'renders/' . $key;
    }

    /** Read and decrypt a stored render. Returns the data URI, or null. */
    public static function get(?string $reference): ?string
    {
        if (! $reference) {
            return null;
        }

        // Deliberately NOT cached: a cache entry would put the decrypted image
        // on disk (the file cache store), which is exactly what this avoids.
        $cipher = self::readCipher($reference);
        if ($cipher === null) {
            return null;
        }

        try {
            return Crypt::decryptString($cipher);
        } catch (Throwable $e) {
            Log::warning('RenderVault: a stored render could not be decrypted.');

            return null;
        }
    }

    /** Permanently remove a stored render. Never throws. */
    public static function delete(?string $reference): void
    {
        if (! $reference) {
            return;
        }

        try {
            if (str_starts_with($reference, self::SUPABASE_PREFIX)) {
                [$bucket, $key] = self::split($reference);
                [$base, $serviceKey] = self::connection();
                Http::withHeaders(['apikey' => $serviceKey, 'Authorization' => 'Bearer ' . $serviceKey])
                    ->timeout(15)
                    ->delete($base . '/storage/v1/object/' . $bucket, ['prefixes' => [$key]]);
            } elseif (str_starts_with($reference, self::LOCAL_PREFIX)) {
                Storage::disk('local')->delete(substr($reference, strlen(self::LOCAL_PREFIX)));
            }
        } catch (Throwable $e) {
            Log::warning('RenderVault: a stored render could not be deleted: ' . $e->getMessage());
        }
    }

    public static function isReference(?string $value): bool
    {
        return is_string($value)
            && (str_starts_with($value, self::SUPABASE_PREFIX) || str_starts_with($value, self::LOCAL_PREFIX));
    }

    private static function readCipher(string $reference): ?string
    {
        if (str_starts_with($reference, self::LOCAL_PREFIX)) {
            $path = substr($reference, strlen(self::LOCAL_PREFIX));
            $disk = Storage::disk('local');

            return $disk->exists($path) ? $disk->get($path) : null;
        }

        if (! str_starts_with($reference, self::SUPABASE_PREFIX)) {
            return null;
        }

        try {
            [$bucket, $key] = self::split($reference);
            [$base, $serviceKey] = self::connection();
            $response = Http::withHeaders([
                'apikey' => $serviceKey,
                'Authorization' => 'Bearer ' . $serviceKey,
            ])
                ->timeout(20)
                ->get($base . '/storage/v1/object/authenticated/' . $bucket . '/' . $key);

            return $response->successful() ? $response->body() : null;
        } catch (Throwable $e) {
            Log::warning('RenderVault: a stored render could not be read: ' . $e->getMessage());

            return null;
        }
    }

    /** @return array{0: string, 1: string} [bucket, key] */
    private static function split(string $reference): array
    {
        $rest = substr($reference, strlen(self::SUPABASE_PREFIX));
        $slash = strpos($rest, '/');

        return [substr($rest, 0, $slash), substr($rest, $slash + 1)];
    }

    private static function bucket(): string
    {
        return (string) config('tryon.renders_bucket', 'renders');
    }

    /** Create the PRIVATE bucket once (an existing bucket is fine). */
    private static function ensureBucket(string $base, string $serviceKey, string $bucket): void
    {
        Cache::rememberForever('renders.bucket.ready.' . $bucket, function () use ($base, $serviceKey, $bucket) {
            $response = Http::withHeaders([
                'apikey' => $serviceKey,
                'Authorization' => 'Bearer ' . $serviceKey,
            ])
                ->timeout(15)
                ->post($base . '/storage/v1/bucket', [
                    'id' => $bucket,
                    'name' => $bucket,
                    'public' => false,
                ]);

            if (! $response->successful() && ! str_contains(strtolower($response->body()), 'exist')) {
                throw new \RuntimeException('Could not prepare the renders bucket (HTTP ' . $response->status() . ').');
            }

            return true;
        });
    }

    /** @return array{0: string, 1: string} */
    private static function connection(): array
    {
        $base = rtrim((string) config('services.supabase.url'), '/');
        $key = (string) config('services.supabase.service_role_key');

        if ($base === '' || $key === '') {
            throw new \RuntimeException('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not configured.');
        }

        return [$base, $key];
    }
}
