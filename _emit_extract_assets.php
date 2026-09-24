<?php

/**
 * Emit the two live product assets (raw photo + display card) as data URIs in a
 * JSON file, so the headless-browser extractor check can load them WITHOUT a
 * cross-origin fetch (a CORS-tainted canvas makes getImageData throw, which
 * would turn the whole verification into a false 'skipped').
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\Http;

$out = [];
foreach (Product::orderBy('id')->get() as $p) {
    $row = [
        'id' => $p->id,
        'name' => $p->name,
        'category' => $p->category,
        'ghost_mannequin_url' => (string) $p->ghost_mannequin_url,
        'display_image_url' => (string) $p->display_image_url,
        'image_url' => (string) $p->image_url,
        'raw_image_url' => (string) $p->image_url,
        'display_data' => null,
        'raw_data' => null,
    ];

    foreach (['display_image_url' => 'display_data', 'image_url' => 'raw_data'] as $col => $key) {
        $url = trim((string) $p->{$col});
        if ($url === '') {
            continue;
        }
        try {
            $res = Http::timeout(30)->get($url);
            if ($res->successful() && strlen($res->body()) > 500) {
                $info = @getimagesizefromstring($res->body());
                $mime = $info['mime'] ?? 'image/png';
                $row[$key] = 'data:' . $mime . ';base64,' . base64_encode($res->body());
                $row[$key . '_dims'] = $info ? ($info[0] . 'x' . $info[1]) : 'unknown';
            }
        } catch (\Throwable $e) {
            $row[$key . '_error'] = $e->getMessage();
        }
    }

    $out[] = $row;
    echo "#{$p->id} {$p->name}: display=" . ($row['display_data'] ? 'ok' : 'MISSING')
        . " raw=" . ($row['raw_data'] ? 'ok' : 'MISSING') . PHP_EOL;
}

file_put_contents(__DIR__ . '/_extract_assets.json', json_encode($out));
echo "wrote _extract_assets.json (" . filesize(__DIR__ . '/_extract_assets.json') . " bytes)" . PHP_EOL;
