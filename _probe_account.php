<?php

/**
 * READ-ONLY PixelAPI credential + credit-balance probe.
 *
 * Unlike `_probe_pixelapi.php` (which also SUBMITS two real try-on jobs at the
 * bottom and therefore spends credits), this script only performs GETs. It is
 * safe to run before you know whether the token is valid.
 *
 * Answers three things:
 *   1. Is the token configured at all?
 *   2. Does PixelAPI accept it (HTTP 200 = yes)?
 *   3. How many credits remain?
 *
 * Usage: php _probe_account.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\Http;

$token = (string) config('services.vton.token');

echo PHP_EOL . '=== PIXELAPI ACCOUNT PROBE (read-only) ===' . PHP_EOL;
echo 'endpoint : ' . config('services.vton.endpoint') . PHP_EOL;
echo 'token    : ' . ($token === '' ? '<NOT SET>' : substr($token, 0, 12) . '…' . substr($token, -6) . ' (' . strlen($token) . ' chars)') . PHP_EOL;

if ($token === '') {
    echo PHP_EOL . 'RESULT: no token configured — set VTON_API_TOKEN in hiraya-backend/.env' . PHP_EOL;
    exit(1);
}

$ok = false;

foreach (['https://api.pixelapi.dev/v1/account', 'https://api.pixelapi.dev/v1/me'] as $url) {
    echo PHP_EOL . '--- GET ' . $url . PHP_EOL;

    try {
        $res = Http::timeout(30)->acceptJson()->withToken($token)->get($url);
        echo 'HTTP ' . $res->status() . PHP_EOL;
        echo 'body: ' . substr($res->body(), 0, 800) . PHP_EOL;

        if ($res->successful()) {
            $ok = true;
        }
    } catch (\Throwable $e) {
        echo 'threw: ' . $e->getMessage() . PHP_EOL;
    }
}

echo PHP_EOL . 'RESULT: ' . ($ok ? 'TOKEN ACCEPTED — the account endpoint answered 200.' : 'NO 200 — check the token / see the bodies above.') . PHP_EOL;

exit($ok ? 0 : 1);
