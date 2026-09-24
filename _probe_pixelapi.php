<?php

/**
 * Cheap PixelAPI credential probe.
 *
 * Hits the account endpoint the vendor documents (GET /v1/account returns the
 * remaining credit balance) so a BAD TOKEN is caught BEFORE spending a try-on
 * credit. Read-only; does not submit any job.
 *
 * Usage: php _probe_pixelapi.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\Http;

$token = (string) config('services.vton.token');
echo 'token length: ' . strlen($token) . PHP_EOL;
echo 'token prefix: ' . substr($token, 0, 12) . '...' . substr($token, -6) . PHP_EOL;

foreach (['https://api.pixelapi.dev/v1/account', 'https://api.pixelapi.dev/v1/me'] as $url) {
    echo PHP_EOL . '--- GET ' . $url . PHP_EOL;
    try {
        $res = Http::timeout(30)->acceptJson()->withToken($token)->get($url);
        echo 'HTTP ' . $res->status() . PHP_EOL;
        echo 'body: ' . substr($res->body(), 0, 800) . PHP_EOL;
    } catch (\Throwable $e) {
        echo 'threw: ' . $e->getMessage() . PHP_EOL;
        }
    }

    /*
     * RAW request inspection against PixelAPI: show exactly what the vendor says
 * when given a data URI, so the 422 is diagnosed from the response body rather
 * than guessed at.
 */

echo PHP_EOL . '=== RAW /v1/virtual-tryon PROBE ===' . PHP_EOL;

$person = __DIR__ . '/hiraya-backend/storage/app/public/tryon/7acsG4dloz.jpeg';
$garment = __DIR__ . '/raw_emerald.jpg';
$personData = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($person));
$garmentData = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($garment));

// Shape A: what the renderer sends today (data URIs), with the LIVE category
// vocabulary the API itself named in its 422 (upperbody|lowerbody|dress|...),
// NOT the tutorial's upper_body/full_body.
$variantA = [
    'person_image' => $personData,
    'garment_image' => $garmentData,
    'category' => 'dress',
];

// Shape B: bare base64 (no data: prefix), per the dev.to launch post.
$variantB = [
    'person_image' => preg_replace('#^data:image/\w+;base64,#', '', $personData),
    'garment_image' => preg_replace('#^data:image/\w+;base64,#', '', $garmentData),
    'category' => 'dress',
];

foreach (['A: data URI' => $variantA, 'B: bare base64' => $variantB] as $label => $payload) {
    echo PHP_EOL . '--- ' . $label . PHP_EOL;
    try {
        $res = Http::timeout(60)->acceptJson()->withToken($token)
            ->post('https://api.pixelapi.dev/v1/virtual-tryon', $payload);
        echo 'HTTP ' . $res->status() . PHP_EOL;
        echo 'body: ' . substr($res->body(), 0, 600) . PHP_EOL;
    } catch (\Throwable $e) {
        echo 'threw: ' . $e->getMessage() . PHP_EOL;
    }
}
