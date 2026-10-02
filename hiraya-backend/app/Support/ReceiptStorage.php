<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * PAYMENT RECEIPTS — stored in a PRIVATE Supabase Storage bucket.
 *
 * Receipts used to be written to the server's local `public` disk. On Render
 * that disk belongs to the container and is wiped on every deploy and restart
 * (the free plan restarts after sleeping), so staff saw "Receipt file not
 * found" for receipts that had been uploaded; and local + Render share one
 * database but not one disk, so a receipt was only ever visible on the
 * machine that received it.
 *
 * Receipts are personal payment data, so the bucket is PRIVATE: objects are
 * read back with the service key by the staff-only proof endpoint
 * (AdminOrderController::proof) and never get a public URL.
 *
 * Stored paths look like `supabase:receipts/dp-proofs/<name>.png`. Older rows
 * keep their plain local path (`orders/dp-proofs/...`) and are still served from
 * the local disk. If Supabase cannot be reached at upload time the receipt is
 * saved locally instead, so a checkout never fails because of storage.
 */
class ReceiptStorage
{
    public const BUCKET = 'receipts';

    private const PREFIX = 'supabase:' . self::BUCKET . '/';

    private const EXTENSIONS = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/webp' => 'webp'];

    /** Store an uploaded receipt under `$folder` (e.g. `dp-proofs`). */
    public static function store(UploadedFile $file, string $folder): string
    {
        $bytes = (string) @file_get_contents($file->getRealPath());
        $type = $file->getMimeType() ?: ($file->getClientMimeType() ?: 'image/png');

        return self::put($bytes, $folder, $type);
    }

    /** Store raw receipt bytes (demo orders render their own PNG). */
    public static function put(string $bytes, string $folder, string $type = 'image/png'): string
    {
        $ext = self::EXTENSIONS[strtolower($type)] ?? 'png';
        $key = trim($folder, '/') . '/' . Str::random(40) . '.' . $ext;

        try {
            [$base, $serviceKey] = self::connection();
            self::ensureBucket($base, $serviceKey);

            $response = Http::withHeaders([
                'apikey' => $serviceKey,
                'Authorization' => 'Bearer ' . $serviceKey,
                'x-upsert' => 'true',
            ])
                ->withBody($bytes, $type)
                ->timeout(30)
                ->post($base . '/storage/v1/object/' . self::BUCKET . '/' . $key);

            if ($response->successful()) {
                return self::PREFIX . $key;
            }

            Log::error('ReceiptStorage: upload rejected, keeping the receipt on the local disk.', [
                'status' => $response->status(),
                'body' => Str::limit($response->body(), 300),
            ]);
        } catch (Throwable $e) {
            Log::error('ReceiptStorage: upload failed, keeping the receipt on the local disk: ' . $e->getMessage());
        }

        $local = 'orders/' . $key;
        Storage::disk('public')->put($local, $bytes);

        return $local;
    }

    /**
     * Read a stored receipt.
     *
     * @return array{0: string, 1: string}|null  [bytes, content type]
     */
    public static function read(?string $path): ?array
    {
        if (! $path) {
            return null;
        }

        if (str_starts_with($path, self::PREFIX)) {
            $key = substr($path, strlen(self::PREFIX));
            try {
                [$base, $serviceKey] = self::connection();
                $response = Http::withHeaders([
                    'apikey' => $serviceKey,
                    'Authorization' => 'Bearer ' . $serviceKey,
                ])
                    ->timeout(20)
                    ->get($base . '/storage/v1/object/authenticated/' . self::BUCKET . '/' . $key);

                if ($response->successful()) {
                    return [$response->body(), $response->header('Content-Type') ?: 'image/png'];
                }
            } catch (Throwable $e) {
                Log::warning('ReceiptStorage: could not read ' . $key . ': ' . $e->getMessage());
            }

            return null;
        }

        $disk = Storage::disk('public');
        if (! $disk->exists($path)) {
            return null;
        }

        return [$disk->get($path), $disk->mimeType($path) ?: 'image/png'];
    }

    /** Delete a stored receipt (Supabase or local). Never throws. */
    public static function delete(?string $path): void
    {
        if (! $path) {
            return;
        }

        try {
            if (str_starts_with($path, self::PREFIX)) {
                [$base, $serviceKey] = self::connection();
                Http::withHeaders(['apikey' => $serviceKey, 'Authorization' => 'Bearer ' . $serviceKey])
                    ->timeout(15)
                    ->delete($base . '/storage/v1/object/' . self::BUCKET, ['prefixes' => [substr($path, strlen(self::PREFIX))]]);
            } else {
                Storage::disk('public')->delete($path);
            }
        } catch (Throwable $e) {
            Log::warning('ReceiptStorage: could not delete ' . $path . ': ' . $e->getMessage());
        }
    }

    /** Create the private bucket once (an existing bucket is fine). */
    private static function ensureBucket(string $base, string $serviceKey): void
    {
        Cache::rememberForever('receipts.bucket.ready', function () use ($base, $serviceKey) {
            $response = Http::withHeaders([
                'apikey' => $serviceKey,
                'Authorization' => 'Bearer ' . $serviceKey,
            ])
                ->timeout(15)
                ->post($base . '/storage/v1/bucket', [
                    'id' => self::BUCKET,
                    'name' => self::BUCKET,
                    'public' => false,
                ]);

            // 200 = created; 400/409 "already exists" = fine.
            if (! $response->successful() && ! str_contains(strtolower($response->body()), 'exist')) {
                throw new \RuntimeException('Could not prepare the receipts bucket (HTTP ' . $response->status() . ').');
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
