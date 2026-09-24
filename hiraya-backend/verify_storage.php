<?php
// Temporary verification script (safe to delete).
require __DIR__ . '/vendor/autoload.php';
$app = require __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\Storage;

$publicUrl = Storage::disk('public')->url('');
$prefix = rtrim($publicUrl, '/') . '/';

echo 'FILESYSTEM_DISK (default)  = ' . config('filesystems.default') . PHP_EOL;
echo 'APP_URL                    = ' . config('app.url') . PHP_EOL;
echo 'public disk root           = ' . config('filesystems.disks.public.root') . PHP_EOL;
echo 'public disk url(empty)     = ' . $publicUrl . PHP_EOL;
echo 'delete prefix              = ' . $prefix . PHP_EOL;
echo 'default Storage::url()     = ' . Storage::url('products/test.jpg') . PHP_EOL;
echo 'public  Storage::url()     = ' . Storage::disk('public')->url('products/test.jpg') . PHP_EOL;

$candidates = [
    'http://127.0.0.1:8000/storage/products/a.jpg',
    'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public/products/a.png',
    'data:image/png;base64,AAA',
];
foreach ($candidates as $url) {
    $isOurs = str_starts_with($url, $prefix);
    echo 'would DELETE ' . ($isOurs ? 'YES' : 'no ') . ' -> ' . $url . PHP_EOL;
}

echo 'public/storage symlink     = ' . (file_exists(public_path('storage')) ? 'EXISTS' : 'MISSING') . PHP_EOL;
