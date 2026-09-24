<?php

/**
 * Verify the SERVER-SIDE GHOST-MATTE UPGRADE:
 *
 *   A garment payload that carries `product_id` of a product WITH a
 *   `ghost_mannequin_url` must have its image REPLACED by that clean matte,
 *   regardless of the (segmented marketing card) image the client sent.
 *
 * A garment with NO product_id keeps the client's image untouched.
 *
 * Usage: php _smoke_ghost_upgrade.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;
use App\Models\Product;

$fail = 0;
$ok = function (string $label, bool $pass, string $detail = '') use (&$fail) {
    echo ($pass ? '  PASS  ' : '  FAIL  ') . $label . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    if (!$pass) {
        $fail++;
    }
};

echo PHP_EOL . '=== GHOST-MATTE UPGRADE TEST ===' . PHP_EOL . PHP_EOL;

// Find a product that actually HAS a matte.
$product = Product::whereNotNull('ghost_mannequin_url')->where('ghost_mannequin_url', '!=', '')->first();
if (!$product) {
    echo '  SKIP  no product has a ghost_mannequin_url.' . PHP_EOL;
    exit(0);
}
echo "  using product #{$product->id} ({$product->name})" . PHP_EOL;
echo "  matte: {$product->ghost_mannequin_url}" . PHP_EOL . PHP_EOL;

$controller = app(TryOnController::class);
$m = new ReflectionMethod(TryOnController::class, 'normaliseGarmentPhotos');
$m->setAccessible(true);

// A deliberately bogus "segmented marketing card" the client would have sent.
$clientJunk = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/* --- 1. WITH product_id => the stored matte must WIN --- */
[$images, $cats] = $m->invoke($controller, [
    [
        'category' => 'TOPS',
        'name' => $product->name,
        'product_id' => $product->id,
        'image' => $clientJunk,
    ]
]);

$ok('one image returned', count($images) === 1, 'count=' . count($images));
$ok('category lowercased', ($cats[0] ?? null) === 'tops', 'got ' . var_export($cats[0] ?? null, true));
$ok(
    'client junk was REPLACED by the catalog matte',
    ($images[0] ?? '') !== $clientJunk && str_starts_with((string) ($images[0] ?? ''), 'data:image'),
    'len=' . strlen((string) ($images[0] ?? '')),
);
$ok(
    'the replacement is a real, substantial image (not the 1x1 probe)',
    strlen((string) ($images[0] ?? '')) > 10000,
    'len=' . strlen((string) ($images[0] ?? '')),
);

/* --- 2. WITHOUT product_id => the client image is kept verbatim --- */
[$images2,] = $m->invoke($controller, [
    [
        'category' => 'TOPS',
        'name' => 'Unknown',
        'image' => $clientJunk,
    ]
]);
$ok('no product_id keeps the client image', ($images2[0] ?? null) === $clientJunk);

/* --- 3. An unknown product_id must not break the payload --- */
[$images3,] = $m->invoke($controller, [
    [
        'category' => 'TOPS',
        'product_id' => 999,
        'image' => $clientJunk,
    ]
]);
$ok('unknown product_id falls back to the client image', ($images3[0] ?? null) === $clientJunk);

/* --- 4. Legacy plain-string garments still work --- */
[$images4,] = $m->invoke($controller, [$clientJunk]);
$ok('legacy string garment still accepted', ($images4[0] ?? null) === $clientJunk);

echo PHP_EOL . '================================' . PHP_EOL;
echo $fail === 0 ? '  ALL CHECKS PASSED' . PHP_EOL : "  {$fail} CHECK(S) FAILED" . PHP_EOL;
echo '================================' . PHP_EOL . PHP_EOL;

exit($fail === 0 ? 0 : 1);
