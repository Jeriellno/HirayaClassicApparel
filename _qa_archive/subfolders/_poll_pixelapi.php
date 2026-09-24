<?php

/**
 * Poll one PixelAPI try-on job and dump its completion shape.
 *
 * Usage: php _poll_pixelapi.php [job-id]
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\Http;

$jobId = $argv[1] ?? '64e2004c-3434-4e72-a477-45ee641cb623';
$token = (string) config('services.vton.token');
$url = 'https://api.pixelapi.dev/v1/virtual-tryon/jobs/' . rawurlencode($jobId);

echo 'polling ' . $jobId . PHP_EOL;

for ($i = 0; $i < 40; $i++) {
    $res = Http::timeout(30)->acceptJson()->withToken($token)->get($url);
    $body = $res->json() ?? [];
    $status = $body['status'] ?? '?';
    echo sprintf('  t=%3ds  HTTP %d  status=%s', $i * 3, $res->status(), $status) . PHP_EOL;

    if (in_array($status, ['completed', 'failed'], true) || $res->failed()) {
        echo PHP_EOL . '=== FINAL BODY (keys + scalar values, base64 truncated) ===' . PHP_EOL;
        $walk = function ($v, $depth = 0) use (&$walk) {
            if (is_string($v)) {
                return strlen($v) > 100 ? '<' . strlen($v) . ' chars> ' . substr($v, 0, 40) . '...' : $v;
            }
            if (is_array($v)) {
                $out = [];
                foreach ($v as $k => $vv) {
                    $out[$k] = $walk($vv, $depth + 1);
                }

                return $out;
            }

            return $v;
        };
        echo json_encode($walk($body), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;

        // Try to salvage an image from any plausible field.
        $cands = [
            'output' => $body['output'] ?? null,
            'result_image_b64' => $body['result_image_b64'] ?? null,
            'result_url' => $body['result_url'] ?? null,
            'image' => $body['image'] ?? null,
            'data.output' => data_get($body, 'data.output'),
        ];
        foreach ($cands as $k => $v) {
            if (is_string($v) && trim($v) !== '') {
                echo "candidate '{$k}': " . (strlen($v) > 60 ? 'len=' . strlen($v) : $v) . PHP_EOL;
            }
        }
        break;
    }

    sleep(3);
}
