<?php
echo 'COLUMNS: ';
foreach (\Illuminate\Support\Facades\Schema::getColumnListing('products') as $c) {
    echo $c . ', ';
}
echo PHP_EOL . PHP_EOL;

$total = App\Models\Product::count();
$withGhost = App\Models\Product::whereNotNull('ghost_mannequin_url')->where('ghost_mannequin_url', '!=', '')->count();
echo "total products: {$total}" . PHP_EOL;
echo "with ghost_mannequin_url: {$withGhost}" . PHP_EOL . PHP_EOL;

foreach (App\Models\Product::latest()->take(5)->get() as $p) {
    echo $p->name . PHP_EOL;
    echo '  ghost_mannequin_url: ' . ($p->ghost_mannequin_url ?? 'NULL') . PHP_EOL;
    echo '  display_image_url:   ' . substr((string) ($p->display_image_url ?? 'NULL'), 0, 90) . PHP_EOL;
}
