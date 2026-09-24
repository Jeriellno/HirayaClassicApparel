<?php

/**
 * Fetch display_image_url for product 15 and 16 so we can LOOK at them and
 * decide whether they are clean VTON cut-outs or still the framed card.
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\Http;

foreach ([15, 16] as $id) {
    $p = Product::find($id);
    if (!$p) {
        echo "#{$id} not found" . PHP_EOL;
        continue;
    }
    $res = Http::timeout(25)->get($p->display_image_url);
    file_put_contents(__DIR__ . "/_disp_{$id}.png", $res->body());
    echo "#{$id} display -> " . strlen($res->body()) . " bytes saved _disp_{$id}.png" . PHP_EOL;
}
