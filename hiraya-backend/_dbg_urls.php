<?php
foreach (App\Models\Product::all() as $p) {
    echo '=== ' . $p->name . ' ===' . PHP_EOL;
    echo 'image_url:         ' . substr((string) $p->image_url, 0, 110) . PHP_EOL;
    echo 'display_image_url: ' . substr((string) $p->display_image_url, 0, 110) . PHP_EOL;
    echo 'ghost_mannequin:   ' . substr((string) $p->ghost_mannequin_url, 0, 110) . PHP_EOL;
}
