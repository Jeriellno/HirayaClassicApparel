<?php
$p = App\Models\Product::whereNotNull('ghost_mannequin_url')
    ->orWhereNotNull('display_image_url')
    ->orWhereNotNull('image_url')
    ->first();

if ($p) {
    echo $p->name . PHP_EOL;
    echo 'ghost: ' . ($p->ghost_mannequin_url ?? 'none') . PHP_EOL;
    echo 'display: ' . ($p->display_image_url ?? 'none') . PHP_EOL;
    echo 'image: ' . ($p->image_url ?? 'none') . PHP_EOL;
} else {
    echo 'no product' . PHP_EOL;
}
