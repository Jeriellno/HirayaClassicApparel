<?php

/** _smoke_catalog_sizes.php — what does the catalog actually contain for sizes? */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;

echo 'products total: ' . Product::count() . PHP_EOL;

echo PHP_EOL . 'per-product size columns:' . PHP_EOL;
$rows = Product::all(['id', 'name', 'sizes', 'size_stocks', 'size_measurements', 'stock']);
foreach ($rows as $row) {
    $name = substr((string) $row->name, 0, 30);
    echo '      size_stocks       = ' . json_encode($row->size_stocks) . PHP_EOL;
    echo '      size_measurements = ' . json_encode($row->size_measurements) . PHP_EOL;
    $sizesJson = json_encode($row->sizes);
    $stock = $row->stock;
    echo '  #' . $row->id . ' ' . $name . '  sizes=' . $sizesJson . '  stock=' . $stock . PHP_EOL;
}

echo PHP_EOL . 'distinct size labels (key of the sizes map):' . PHP_EOL;
$counts = [];
$all = Product::all(['sizes']);
foreach ($all as $row) {
    foreach ((array) $row->sizes as $size => $qty) {
        $counts[(string) $size] = ($counts[(string) $size] ?? 0) + 1;
    }
}
arsort($counts);
foreach ($counts as $size => $n) {
    echo '  ' . $size . ' => ' . $n . PHP_EOL;
}
