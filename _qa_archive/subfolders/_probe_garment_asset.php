<?php

/**
 * Show + DOWNLOAD the exact garment asset that gets sent to PixelAPI, so the
 * "inaccurate garment" report can be diagnosed from the real bytes.
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\Http;

$p = Product::find(15);
if (! $p) {
    echo "no product 15" . PHP_EOL;
    exit(1);
}

echo "name            : " . $p->name . PHP_EOL;
echo "category        : " . $p->category . PHP_EOL;
echo "colors          : " . json_encode($p->colors) . PHP_EOL;
echo "ghost_mannequin : " . substr((string) $p->ghost_mannequin_url, 0, 170) . PHP_EOL;
echo "image_url       : " . substr((string) $p->image_url, 0, 170) . PHP_EOL;

$reference = $p->ghost_mannequin_url ?? $p->image_url ?? null;
echo PHP_EOL . "SENT TO PIXELAPI: " . substr((string) $reference, 0, 170) . PHP_EOL;

if (! $reference) {
    echo "no reference to download" . PHP_EOL;
    exit(0);
}

try {
    $res = Http::timeout(30)->get($reference);
    $bytes = $res->body();
    echo "download HTTP   : " . $res->status() . "  bytes=" . strlen($bytes) . PHP_EOL;

    if ($res->successful() && strlen($bytes) > 500) {
        file_put_contents(__DIR__ . '/_garment_sent.png', $bytes);
        $info = @getimagesizefromstring($bytes);
        if ($info) {
            $w = $info[0];
            $h = $info[1];
            $m = $info['mime'];
            echo "saved           : _garment_sent.png {$w}x{$h} {$m}" . PHP_EOL;
        } else {
            echo "saved           : _garment_sent.png (unknown type)" . PHP_EOL;
        }
    }
} catch (\Throwable $e) {
    echo "download threw  : " . $e->getMessage() . PHP_EOL;
}
