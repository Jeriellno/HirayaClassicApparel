<?php
// Dump the exact image columns for every product, so the try-on test can use
// the REAL assets the Studio will receive.
foreach (App\Models\Product::all() as $p) {
    echo "ID: {$p->id}\n";
    echo "  name: {$p->name}\n";
    echo "  category: {$p->category}\n";
    echo "  image_url: " . ($p->image_url ?? 'NULL') . "\n";
    echo "  display_image_url: " . ($p->display_image_url ?? 'NULL') . "\n";
    echo "  ghost_mannequin_url: " . ($p->ghost_mannequin_url ?? 'NULL') . "\n";
    echo "  background_occasion: " . ($p->background_occasion ?? 'NULL') . "\n";
    echo "\n";
}
