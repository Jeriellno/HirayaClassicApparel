<?php

/**
 * Fetch the product's ghost-mannequin matte (the CLEAN cut-out the VTON model is
 * supposed to receive) and write it to disk so we can compare it against the
 * broken garment input that was actually stored in the session.
 *
 * Usage: php _fetch_ghost.php [productId]
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\Http;

$id = (int) ($argv[1] ?? 18);
$p = Product::find($id);
if (!$p) {
    echo "no product {$id}" . PHP_EOL;
    exit(1);
}

$url = trim((string) $p->ghost_mannequin_url);
echo 'product : #' . $p->id . ' — ' . $p->name . PHP_EOL;
echo 'ghost   : ' . $url . PHP_EOL;

try {
    $res = Http::timeout(30)->get($url);
    echo 'HTTP    : ' . $res->status() . PHP_EOL;
    if ($res->successful()) {
        $bytes = $res->body();
        $out = __DIR__ . '/_ghost_matte.png';
        file_put_contents($out, $bytes);
        $info = @getimagesizefromstring($bytes);
        echo 'wrote   : ' . round(strlen($bytes) / 1024) . ' KB -> _ghost_matte.png' . PHP_EOL;
        echo 'dims    : ' . ($info ? $info[0] . 'x' . $info[1] . ' (' . $info['mime'] . ')' : 'UNREADABLE') . PHP_EOL;

        // Does it actually carry an alpha channel with real transparency?
        if ($info && str_contains($info['mime'], 'png')) {
            $img = @imagecreatefromstring($bytes);
            if ($img) {
                $w = imagesx($img);
                $h = imagesy($img);
                $transparent = 0;
                $opaque = 0;
                for ($y = 0; $y < $h; $y += 4) {
                    for ($x = 0; $x < $w; $x += 4) {
                        $rgba = imagecolorat($img, $x, $y);
                        $a = ($rgba >> 24) & 0x7F; // 0 = opaque, 127 = transparent
                        if ($a > 100) $transparent++;
                        else $opaque++;
                    }
                }
                $total = $transparent + $opaque;
                echo 'alpha   : transparent=' . round($transparent / $total * 100) . '%  opaque=' . round($opaque / $total * 100) . '%' . PHP_EOL;
            }
        }
    }
} catch (\Throwable $e) {
    echo 'threw   : ' . $e->getMessage() . PHP_EOL;
}
