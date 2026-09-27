<?php

/**
 * _smoke_future_garment.php — does the stylist pick up garments added LATER?
 *
 * The whole point of the live-context design is that nothing about the catalog
 * is hardcoded: an admin adds a garment and the very next chat message should
 * see it, with its real sizes and real stock. This test proves that by creating
 * a garment with a size set the catalog does NOT currently hold (S/M/L/XL),
 * asking the controller about it, then rolling the row back.
 *
 * It also proves stock is read LIVE: the per-size counts change between two
 * calls and the answers follow.
 *
 * The row is always deleted before exit, including on failure, so running this
 * against a real database leaves no residue.
 *
 * Usage: php _smoke_future_garment.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;
use App\Models\Product;

$pass = 0;
$fail = 0;

$check = function (string $label, bool $ok, string $detail = '') use (&$pass, &$fail) {
    if ($ok) {
        $pass++;
        echo "  PASS  {$label}" . PHP_EOL;
    } else {
        $fail++;
        echo "  FAIL  {$label}" . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    }
};

$controller = app(TryOnController::class);

$catalog = new ReflectionMethod(TryOnController::class, 'catalogForSize');
$catalog->setAccessible(true);
$present = new ReflectionMethod(TryOnController::class, 'sizesPresentInCatalog');
$present->setAccessible(true);
$stack = new ReflectionMethod(TryOnController::class, 'stackGarmentDetails');
$stack->setAccessible(true);

echo PHP_EOL . '=== FUTURE GARMENT SMOKE ===' . PHP_EOL;

$before = $present->invoke($controller);
echo '  sizes before: ' . json_encode($before) . PHP_EOL;

$check(
    'baseline: L is NOT in the catalog yet',
    ! in_array('L', $before, true),
    json_encode($before)
);

$createdId = null;

try {
    /* ---- 1. A brand-new garment, written the CORRECT way ---- */
    $createdId = Product::create([
        'name' => '__SMOKE_Future_Garment__',
        'description' => 'temporary',
        'price' => 999.00,
        'category' => 'TOPS',
        'subcategory' => 'T-Shirts',
        // LIST shape, exactly what the (now-fixed) consoles send.
        'sizes' => ['S', 'M', 'L', 'XL'],
        'size_stocks' => ['S' => 7, 'M' => 0, 'L' => 3, 'XL' => 11],
        'size_measurements' => [
            'L' => ['chest_bust' => 102.0, 'waist' => 84.0, 'hips' => 108.0],
        ],
        'material' => 'Cotton',
        'gender' => 'Unisex',
        'stock' => 21,
    ])->id;

    echo "  created product #{$createdId}" . PHP_EOL;

    /* ---- 2. Sizes now include L / XL, with no code change ---- */
    $after = $present->invoke($controller);
    echo '  sizes after : ' . json_encode($after) . PHP_EOL;

    foreach (['S', 'M', 'L', 'XL'] as $sz) {
        $check("catalog now reports {$sz}", in_array($sz, $after, true), json_encode($after));
    }

    /* ---- 3. The new garment is MATCHED in each of its sizes ---- */
    foreach (['S', 'L', 'XL'] as $sz) {
        $hits = $catalog->invoke($controller, $sz);
        $names = array_column($hits, 'name');
        $check(
            "new garment matches size {$sz}",
            in_array('__SMOKE_Future_Garment__', $names, true),
            json_encode($names)
        );
    }

    /* ---- 4. Per-size stock is read from size_stocks, not the aggregate ---- */
    $lHit = null;
    foreach ($catalog->invoke($controller, 'L') as $hit) {
        if ($hit['name'] === '__SMOKE_Future_Garment__') {
            $lHit = $hit;
        }
    }

    $check('L hit carries its size list', ($lHit['sizes'] ?? null) === ['S', 'M', 'L', 'XL'], json_encode($lHit['sizes'] ?? null));
    $check('L stock is the per-size count (3)', ($lHit['stock_in_this_size'] ?? null) === 3, (string) ($lHit['stock_in_this_size'] ?? 'null'));
    $check('A deep link URL is attached', ($lHit['url'] ?? null) === '/product/' . $createdId, (string) ($lHit['url'] ?? 'null'));

    /* ---- 5. Stock is LIVE: change it and the answer changes ---- */
    Product::whereKey($createdId)->update(['size_stocks' => json_encode(['S' => 7, 'M' => 0, 'L' => 0, 'XL' => 11])]);

    $lHit2 = null;
    foreach ($catalog->invoke($controller, 'L') as $hit) {
        if ($hit['name'] === '__SMOKE_Future_Garment__') {
            $lHit2 = $hit;
        }
    }

    $check(
        'stock change is reflected immediately (3 -> 0)',
        ($lHit2['stock_in_this_size'] ?? null) === 0,
        (string) ($lHit2['stock_in_this_size'] ?? 'null')
    );

    /* ---- 6. The stack lookup finds it by name (live stock) ---- */
    $details = $stack->invoke($controller, ['__SMOKE_Future_Garment__']);
    $check('stack lookup returns the new garment', count($details) === 1, json_encode($details));
    $check(
        'stack detail carries its sizes',
        ($details[0]['sizes'] ?? null) === ['S', 'M', 'L', 'XL'],
        json_encode($details[0]['sizes'] ?? null)
    );
} finally {
    /* ---- Always clean up, pass or fail ---- */
    if ($createdId !== null) {
        Product::whereKey($createdId)->delete();
        echo "  deleted product #{$createdId}" . PHP_EOL;
    }
}

$afterCleanup = $present->invoke($controller);
$check(
    'cleanup: L is gone from the catalog again',
    ! in_array('L', $afterCleanup, true),
    json_encode($afterCleanup)
);
$check(
    'cleanup: no __SMOKE_Future_Garment__ left',
    Product::where('name', '__SMOKE_Future_Garment__')->count() === 0
);

echo PHP_EOL . "=== {$pass} passed, {$fail} failed ===" . PHP_EOL;

exit($fail === 0 ? 0 : 1);
