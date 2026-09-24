<?php

/**
 * End-to-end check for App\Support\SupabaseStorage — writes a real object to the
 * `products` bucket, verifies it is publicly readable, then deletes it.
 *
 * Run:  php _verify_supabase_storage.php
 *
 * It talks to the SAME class the upload endpoint uses, so a pass here means the
 * whole write path (config -> REST -> public URL -> delete) is sound.
 */

$backend = __DIR__;
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Support\SupabaseStorage;
use Illuminate\Support\Facades\Http;

echo '=== SupabaseStorage round-trip ===' . PHP_EOL . PHP_EOL;

// A 1x1 transparent PNG — enough to prove a real image lands and is readable.
$png = base64_decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
);

$key = 'catalog/_verify_' . time() . '-' . substr(md5((string) mt_rand()), 0, 7) . '.png';

echo "1. Uploading key: {$key}" . PHP_EOL;

try {
    $url = SupabaseStorage::put($png, $key, 'image/png');
} catch (\Throwable $e) {
    echo '   FAILED to upload: ' . $e->getMessage() . PHP_EOL;
    exit(1);
}

echo "   returned URL: {$url}" . PHP_EOL;
echo '   (root-relative is correct: ' . (str_starts_with($url, '/supabase-storage/') ? 'YES' : 'NO') . ')' . PHP_EOL;

echo PHP_EOL . '2. Fetching it back over plain HTTP (public read)' . PHP_EOL;

$absolute = rtrim((string) config('services.supabase.url'), '/')
    . '/storage/v1/object/public/products/' . $key;

$res = Http::timeout(30)->get($absolute);
$info = @getimagesizefromstring($res->body());

echo "   GET {$absolute}" . PHP_EOL;
echo "   status: {$res->status()}" . PHP_EOL;
echo '   content-type: ' . $res->header('Content-Type') . PHP_EOL;
echo '   dimensions: ' . ($info ? $info[0] . 'x' . $info[1] : 'NOT AN IMAGE') . PHP_EOL;

if ($res->status() !== 200 || !$info) {
    echo PHP_EOL . 'RESULT: FAILED — the object is not publicly readable.' . PHP_EOL;
    SupabaseStorage::delete($key);
    exit(1);
}

echo PHP_EOL . '3. keyFromReference() recognises every stored shape' . PHP_EOL;

$shapes = [
    $url,
    $absolute,
    $key,
    '/storage/catalog/legacy-local.png',
];

foreach ($shapes as $shape) {
    $resolved = SupabaseStorage::keyFromReference($shape);
    echo '   ' . str_pad(substr($shape, 0, 70), 72) . ' => ' . ($resolved ?? '(null — not ours)') . PHP_EOL;
}

echo PHP_EOL . '4. Deleting the test object' . PHP_EOL;
$deleted = SupabaseStorage::delete($key);
echo '   delete returned: ' . ($deleted ? 'true' : 'false') . PHP_EOL;

/*
 * VERIFY BY RE-LISTING, not by trusting the status code.
 *
 * The single-object DELETE endpoint answers 400-with-an-empty-body and does
 * nothing, so a status-only check passed while the object stayed in the bucket.
 * Listing is the only honest proof that the bytes are gone.
 */
$listRes = Http::withHeaders([
    'apikey'        => (string) config('services.supabase.service_role_key'),
    'Authorization' => 'Bearer ' . config('services.supabase.service_role_key'),
    'Content-Type'  => 'application/json',
])
    ->timeout(30)
    ->post(
        rtrim((string) config('services.supabase.url'), '/') . '/storage/v1/object/list/products',
        ['prefix' => 'catalog', 'limit' => 100, 'search' => basename($key)]
    );

$stillThere = collect($listRes->json())->contains(fn ($o) => ($o['name'] ?? '') === basename($key));

echo '   still listed in bucket: ' . ($stillThere ? 'YES (LEAK!)' : 'no') . PHP_EOL;

if ($stillThere) {
    echo PHP_EOL . 'RESULT: FAILED — delete reported success but the object remains.' . PHP_EOL;
    exit(1);
}

echo PHP_EOL . 'RESULT: PASS — write, public read, reference parsing and delete all work.' . PHP_EOL;
