<?php

/**
 * Verify VtonApiRenderer::upstreamReason() reads every REAL PixelAPI error shape,
 * so the "Unknown error" placeholder can never be shown for a message we have.
 *
 * Usage: php _smoke_upstream_reason.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\VtonApiRenderer;

$fail = 0;
$ok = function (string $label, bool $pass, string $detail = '') use (&$fail) {
    echo ($pass ? '  PASS  ' : '  FAIL  ') . $label . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    if (!$pass) {
        $fail++;
    }
};

$r = app(VtonApiRenderer::class);
$m = new ReflectionMethod(VtonApiRenderer::class, 'upstreamReason');
$m->setAccessible(true);

echo PHP_EOL . '=== upstreamReason() TEST ===' . PHP_EOL . PHP_EOL;

/* 1. FastAPI validation array — the real 422 body captured from PixelAPI. */
$fastapi = [
    'detail' => [
        [
            'type' => 'value_error',
            'loc' => ['body', 'category'],
            'msg' => 'Value error, category must be upperbody, lowerbody, dress, saree, lehenga, kurti, or sherwani',
            'input' => 'tops',
        ]
    ],
    'friendly_message' => 'Please check the photos and try again.',
];
$out = $m->invoke($r, $fastapi);
echo '  fastapi  -> ' . $out . PHP_EOL;
$ok('names the field', str_contains($out, 'body.category'));
$ok('carries the vendor message', str_contains($out, 'upperbody, lowerbody, dress'));
$ok('appends friendly_message', str_contains($out, 'Please check the photos'));
$ok('never says "Unknown error"', !str_contains($out, 'Unknown error'));

/* 2. `detail` as a plain string — the real 400 body captured from PixelAPI. */
$out = $m->invoke($r, ['detail' => 'garment_image is not a valid JPEG/PNG/WebP image']);
echo '  detail-s -> ' . $out . PHP_EOL;
$ok('string detail carried verbatim', $out === 'garment_image is not a valid JPEG/PNG/WebP image');

/* 3. The classic nested/plain keys still work. */
$out = $m->invoke($r, ['error' => ['message' => 'out of credits']]);
echo '  error.msg-> ' . $out . PHP_EOL;
$ok('error.message still read', $out === 'out of credits');

$out = $m->invoke($r, ['message' => 'rate limited']);
echo '  message  -> ' . $out . PHP_EOL;
$ok('message still read', $out === 'rate limited');

/* 4. A genuinely empty body degrades honestly (never the misleading "Unknown"). */
$out = $m->invoke($r, []);
echo '  empty    -> ' . $out . PHP_EOL;
$ok('empty body has an honest fallback', $out === 'The service gave no reason.');

$out = $m->invoke($r, null);
echo '  null     -> ' . $out . PHP_EOL;
$ok('null body has an honest fallback', $out === 'The service gave no reason.');

/* 5. friendly_message alone is used rather than discarded. */
$out = $m->invoke($r, ['friendly_message' => 'Please check the photos and try again.']);
echo '  friendly -> ' . $out . PHP_EOL;
$ok('friendly_message alone is used', $out === 'Please check the photos and try again.');

echo PHP_EOL . '================================' . PHP_EOL;
echo $fail === 0 ? '  ALL CHECKS PASSED' . PHP_EOL : "  {$fail} CHECK(S) FAILED" . PHP_EOL;
echo '================================' . PHP_EOL . PHP_EOL;

exit($fail === 0 ? 0 : 1);
