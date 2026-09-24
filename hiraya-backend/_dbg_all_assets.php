<?php

/**
 * Dump EVERY image-bearing column for every product so we can see whether a
 * clean cut-out already exists somewhere in the row (specifically
 * display_image_url) before we build a background-removal pipeline.
 */

$backend = dirname(__DIR__) . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\Http;

$products = Product::orderBy('id')->get();
echo '=== ALL IMAGE COLUMNS (' . $products->count() . ' products) ===' . PHP_EOL . PHP_EOL;

foreach ($products as $p) {
    echo "#{$p->id}  {$p->name}  [{$p->category}]" . PHP_EOL;
    foreach (['image_url', 'display_image_url', 'ghost_mannequin_url'] as $col) {
        $val = trim((string) ($p->{$col} ?? ''));
        if ($val === '') {
            echo "  {$col}: (EMPTY)" . PHP_EOL;
            continue;
        }
        // Probe the remote/local asset and report real dimensions.
        $dims = 'unresolved';
        try {
            if (str_starts_with($val, 'http')) {
                $res = Http::timeout(25)->get($val);
                $info = $res->successful() ? @getimagesizefromstring($res->body()) : null;
                $mime = $info ? ($info['mime'] ?? '') : '';
                $dims = $info ? ($info[0] . 'x' . $info[1] . ' . ' . $mime) : ('HTTP ' . $res->status());
            } else {
                $clean = preg_replace('#^/?storage/#', '', $val) ?? $val;
                $clean = ltrim($clean, '/');
                if (\Illuminate\Support\Facades\Storage::disk('public')->exists($clean)) {
                    $bytes = \Illuminate\Support\Facades\Storage::disk('public')->get($clean);
                    $info = @getimagesizefromstring($bytes);
                    $mime = $info ? ($info['mime'] ?? '') : '';
                    $dims = $info ? ($info[0] . 'x' . $info[1] . ' . ' . $mime) : 'local, unreadable';
                } else {
                    $dims = 'local path not found: ' . $clean;
                }
            }
        } catch (\Throwable $e) {
            $dims = 'PROBE FAILED: ' . mb_substr($e->getMessage(), 0, 60);
        }
        echo "  {$col}: {$val}" . PHP_EOL;
        echo str_repeat(' ', 4) . "-> {$dims}" . PHP_EOL;
    }
    echo PHP_EOL;
}
