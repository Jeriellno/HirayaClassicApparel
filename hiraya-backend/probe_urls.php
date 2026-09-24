<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

foreach (App\Models\Product::select('id', 'name', 'image_url', 'display_image_url')->limit(8)->get() as $p) {
    echo $p->id . ' | ' . $p->name . PHP_EOL;
    echo '   RAW  = ' . $p->image_url . PHP_EOL;
    echo '   DISP = ' . $p->display_image_url . PHP_EOL;
}
