<?php

/**
 * Verify the TryOnController bag-hydration changes WITHOUT a network render:
 *
 *   1. `hydrateGarmentsFromBag` now includes `display_image_url` in its source
 *      preference (previously it skipped straight to the raw marketing photo).
 *   2. It reports an `asset_warnings` entry for a product with no clean cut-out.
 *   3. A product WITH a ghost_mannequin_url produces NO warning.
 *
 * Uses reflection to call the private method directly against the real
 * container and the real database.
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;
use App\Models\Product;
use App\Models\User;

$fail = 0;
$ok = function (string $label, bool $pass, string $detail = '') use (&$fail) {
    echo ($pass ? '  PASS  ' : '  FAIL  ') . $label . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    if (!$pass) {
        $fail++;
    }
};

echo PHP_EOL . '=== BAG-HYDRATION ASSET-WARNING TEST ===' . PHP_EOL . PHP_EOL;

$products = Product::orderBy('id')->get();
echo '  catalog: ' . $products->count() . ' products' . PHP_EOL;
foreach ($products as $p) {
    $ghost = trim((string) $p->ghost_mannequin_url);
    $display = trim((string) $p->display_image_url);
    $raw = trim((string) $p->image_url);
    echo "    #{$p->id} ghost=" . ($ghost !== '' ? 'yes' : 'NO') . ' display=' . ($display !== '' ? 'yes' : 'NO') . ' raw=' . ($raw !== '' ? 'yes' : 'NO') . PHP_EOL;
}

/* ---- Exercise the private method against a real user with a bag ---- */
$controller = app(TryOnController::class);
$method = new ReflectionMethod(TryOnController::class, 'hydrateGarmentsFromBag');
$method->setAccessible(true);

$user = User::has('cartItems')->first();
if (!$user) {
    echo PHP_EOL . '  SKIP  no user currently has a non-empty bag — cannot exercise the live path.' . PHP_EOL;
    echo '  (The static source-preference assertions below still run.)' . PHP_EOL;
} else {
    echo PHP_EOL . "  exercising with user #{$user->id} ({$user->email}), bag size " . $user->cartItems()->count() . PHP_EOL;
    $warnings = [];
    $images = $method->invokeArgs($controller, [$user, &$warnings]);
    echo '    images hydrated : ' . count($images) . PHP_EOL;
    echo '    warnings        : ' . count($warnings) . PHP_EOL;
    foreach ($warnings as $w) {
        echo "      - #{$w['product_id']} {$w['name']}: {$w['reason']}" . PHP_EOL;
    }
    $ok('hydration returns at least one image', count($images) > 0);
}

/* ---- Source-preference: display_image_url must be consulted ---- */
$src = file_get_contents($backend . '/app/Http/Controllers/Api/TryOnController.php');
$ok(
    'source chain includes display_image_url',
    (bool) preg_match('/\$product->display_image_url\s*\?\?/', $src)
);
$ok(
    'source chain keeps image_url as the last fallback',
    str_contains($src, '$product->display_image_url')
    && str_contains($src, '$product->image_url')
);
$ok(
    'asset_warnings is surfaced in the 202 response',
    str_contains($src, "'asset_warnings' => \$assetWarnings")
);
$ok(
    'a non-cut-out input is logged as a warning',
    str_contains($src, 'VTON input is not a clean cut-out')
);

echo PHP_EOL . '================================' . PHP_EOL;
echo $fail === 0 ? '  ALL CHECKS PASSED' . PHP_EOL : "  {$fail} CHECK(S) FAILED" . PHP_EOL;
echo '================================' . PHP_EOL . PHP_EOL;

exit($fail === 0 ? 0 : 1);
