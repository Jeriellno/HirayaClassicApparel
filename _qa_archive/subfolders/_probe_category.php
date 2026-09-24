<?php

/**
 * Probe the LIVE PixelAPI contract for the ONE thing the code cannot know from
 * documentation alone: which spelling of `category` the running API accepts.
 *
 * Two sources disagree:
 *   - the official tutorial (Mar 2026): upper_body | lower_body | full_body
 *   - PixelAPI's own dev.to launch post:    upperbody | lowerbody | dress
 *
 * This sends a deliberately INVALID payload (a tiny 1x1 PNG and a bogus
 * category value) so the API rejects quickly on VALIDATION rather than spending
 * credits on a real render. We read the error message: a validation error that
 * NAMES the allowed set is the ground truth we need.
 *
 * COST: expected 0 (a rejected request is not a rendered image). If the API
 * accepts it anyway, the job id is printed so it can be inspected/cancelled.
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\Http;

$endpoint = config('services.vton.endpoint');
$token = config('services.vton.token');

echo 'endpoint: ' . $endpoint . PHP_EOL;
echo 'token   : ' . ($token ? '<set>' : '(EMPTY)') . PHP_EOL . PHP_EOL;

if (!$token || !$endpoint) {
    echo 'No token/endpoint configured — cannot probe.' . PHP_EOL;
    exit(1);
}

// A valid 1x1 PNG so the request fails on CATEGORY, not on a broken image.
$px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

$probes = [
    // Deliberately bogus: the API must reject this on validation, so the reply
    // costs nothing and its message tells us what it WOULD have accepted.
    'invalid-probe' => 'NOT_A_REAL_CATEGORY',
];

foreach ($probes as $label => $cat) {
    echo "--- probe: {$label} (category='{$cat}') ---" . PHP_EOL;

    try {
        $res = Http::timeout(40)
            ->acceptJson()
            ->withToken($token)
            ->post($endpoint, [
                'person_image' => $px,
                'garment_image' => $px,
                'category' => $cat,
            ]);

        echo 'HTTP ' . $res->status() . PHP_EOL;
        $body = $res->json();
        echo 'body: ' . json_encode($body, JSON_UNESCAPED_SLASHES) . PHP_EOL;

        if ($res->status() === 422 || $res->status() === 400) {
            echo '>> VALIDATION REJECTION — the message above may name the allowed values.' . PHP_EOL;
        } elseif ($res->successful()) {
            $jobId = $body['job_id'] ?? $body['id'] ?? null;
            echo '>> ACCEPTED (job_id=' . ($jobId ?? 'n/a') . ') — category value is valid.' . PHP_EOL;
            if ($jobId) {
                echo '>> NOTE: this may consume credits. Cancel/inspect job ' . $jobId . PHP_EOL;
            }
        }
    } catch (\Throwable $e) {
        echo 'threw: ' . $e->getMessage() . PHP_EOL;
    }

    echo PHP_EOL;
}

echo 'Done.' . PHP_EOL;
