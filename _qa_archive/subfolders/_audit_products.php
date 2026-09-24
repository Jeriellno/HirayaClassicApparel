<?php

/**
 * Audit EVERY product for a VTON-ready garment asset.
 *
 * For each product, reports what TryOnController::hydrateGarmentsFromBag would
 * actually send to PixelAPI (ghost_mannequin_url -> image_url -> image_base64),
 * downloads it, and inspects the real bytes.
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\Http;

$products = Product::orderBy('id')->get();
echo "=== PRODUCT VTON-ASSET AUDIT (" . $products->count() . " products) ===" . PHP_EOL . PHP_EOL;

$withGhost = 0;
$withoutGhost = 0;
$rows = [];

foreach ($products as $p) {
    $ghost = trim((string) $p->ghost_mannequin_url);
    $img = trim((string) $p->image_url);

    $hasGhost = $ghost !== '';
    if ($hasGhost) {
        $withGhost++;
    } else {
        $withoutGhost++;
    }

    $reference = $hasGhost ? $ghost : $img;

    $line = sprintf(
        "#%-3d %-42s [%-9s] %s",
        $p->id,
        mb_substr((string) $p->name, 0, 42),
        (string) $p->category,
        $hasGhost ? 'GHOST OK' : 'NO GHOST'
    );
    echo $line . PHP_EOL;
    echo "     ghost : " . ($hasGhost ? mb_substr($ghost, 0, 110) : '(EMPTY)') . PHP_EOL;
    echo "     fallback image_url : " . ($img !== '' ? mb_substr($img, 0, 110) : '(EMPTY)') . PHP_EOL;

    // What the backend would genuinely send.
    if ($reference === '') {
        echo "     -> SENDS: NOTHING (no usable asset)" . PHP_EOL . PHP_EOL;
        $rows[] = ['id' => $p->id, 'name' => $p->name, 'ghost' => $hasGhost, 'usable' => false, 'dims' => null];
        continue;
    }

    try {
        $res = Http::timeout(25)->get($reference);
        $bytes = $res->body();
        $info = strlen($bytes) > 100 ? @getimagesizefromstring($bytes) : null;
        $dims = $info ? ($info[0] . 'x' . $info[1]) : 'unknown';

        echo "     -> SENDS: HTTP " . $res->status() . "  " . strlen($bytes) . " bytes  " . $dims . PHP_EOL;

        if ($info) {
            $safe = preg_replace('/[^A-Za-z0-9_-]/', '_', (string) $p->name);
            file_put_contents(__DIR__ . "/_audit_{$p->id}_{$safe}.png", $bytes);
            echo "        saved _audit_{$p->id}_" . $safe . ".png" . PHP_EOL;
        }
        $rows[] = ['id' => $p->id, 'name' => $p->name, 'ghost' => $hasGhost, 'usable' => $info !== null, 'dims' => $dims];
    } catch (\Throwable $e) {
        echo "     -> SENDS: FETCH FAILED " . mb_substr($e->getMessage(), 0, 90) . PHP_EOL;
        $rows[] = ['id' => $p->id, 'name' => $p->name, 'ghost' => $hasGhost, 'usable' => false, 'dims' => null];
    }

    echo PHP_EOL;
}

echo "=== SUMMARY ===" . PHP_EOL;
echo "products total          : " . $products->count() . PHP_EOL;
echo "WITH ghost_mannequin    : " . $withGhost . PHP_EOL;
echo "WITHOUT ghost_mannequin : " . $withoutGhost . PHP_EOL;

$usable = count(array_filter($rows, fn($r) => $r['usable']));
echo "usable image fetched    : " . $usable . PHP_EOL;
