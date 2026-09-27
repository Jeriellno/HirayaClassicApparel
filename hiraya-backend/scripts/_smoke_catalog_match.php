<?php

/**
 * _smoke_catalog_match.php — end-to-end: can the stylist now MATCH a garment?
 *
 * Proves the repair is visible to the feature that was broken, not just to a
 * column dump: it asks TryOnController::catalogForSize() for size XS (which the
 * catalog genuinely holds) and for a size it does not hold.
 *
 * Usage: php _smoke_catalog_match.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;
use App\Models\Product;

echo PHP_EOL . '=== CATALOG SIZE MATCH ===' . PHP_EOL;

foreach (Product::all(['id', 'name', 'sizes']) as $p) {
    echo '  #' . $p->id . ' sizes=' . json_encode($p->sizes) . '  (' . $p->name . ')' . PHP_EOL;
}

$controller = app(TryOnController::class);

$m = new ReflectionMethod(TryOnController::class, 'catalogForSize');
$m->setAccessible(true);

$present = new ReflectionMethod(TryOnController::class, 'sizesPresentInCatalog');
$present->setAccessible(true);

echo PHP_EOL . 'sizes present in catalog: ' . json_encode($present->invoke($controller)) . PHP_EOL;

foreach (['XS', 'M', 'L', 'XL', '2XL'] as $size) {
    $hits = $m->invoke($controller, $size);
    echo '  ' . str_pad($size, 4) . ' -> ' . count($hits) . ' match(es)'
        . (empty($hits) ? '' : ': ' . implode(', ', array_column($hits, 'name'))) . PHP_EOL;
}

echo PHP_EOL . 'EXPECT: XS matches all 3; M/L/XL/2XL match 0 (not stocked).' . PHP_EOL;
