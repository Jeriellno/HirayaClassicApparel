<?php

/**
 * REAL end-to-end PixelAPI try-on render through App\Services\VtonApiRenderer.
 *
 * Proves the tier produces an IMAGE, not merely `success: true`. Writes the
 * returned bytes to disk so a human can look at the thing that was rendered.
 *
 * Usage: php _e2e_pixelapi.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\VtonApiRenderer;

$person = __DIR__ . '/hiraya-backend/storage/app/public/tryon/7acsG4dloz.jpeg';
$garment = __DIR__ . '/raw_emerald.jpg';

foreach (['person' => $person, 'garment' => $garment] as $label => $path) {
    if (!is_file($path)) {
        fwrite(STDERR, "missing {$label}: {$path}\n");
        exit(1);
    }
}

$personData = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($person));
$garmentData = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($garment));

echo 'person : ' . basename($person) . ' (' . round(filesize($person) / 1024) . " KB)\n";
echo 'garment: ' . basename($garment) . ' (' . round(filesize($garment) / 1024) . " KB)\n";
echo 'category: dress -> ' . config('services.vton.category_dress') . "\n";
echo str_repeat('-', 60) . "\n";

$t0 = microtime(true);
$result = app(VtonApiRenderer::class)->render(
    $personData,
    [$garmentData],
    ['chest_bust' => 110, 'waist' => 102, 'hips' => 107, 'shoulder_width' => 55, 'sleeve_length' => 71],
    'L',
    null,
    ['dress']
);
$elapsed = round(microtime(true) - $t0, 1);

echo 'elapsed : ' . $elapsed . "s\n";
echo 'success : ' . var_export($result['success'] ?? null, true) . "\n";
echo 'code    : ' . var_export($result['code'] ?? null, true) . "\n";
echo 'engine  : ' . var_export($result['engine'] ?? null, true) . "\n";
echo 'feedback: ' . var_export($result['feedback'] ?? null, true) . "\n";
if (isset($result['error'])) {
    echo 'error   : ' . $result['error'] . "\n";
}

if (!empty($result['image_base64'])) {
    $b64 = preg_replace('#^data:image/\w+;base64,#', '', (string) $result['image_base64']);
    $bytes = base64_decode($b64, true);
    if ($bytes === false) {
        echo "DECODE FAILED\n";
        exit(1);
    }
    $out = __DIR__ . '/_e2e_pixelapi_render.png';
    file_put_contents($out, $bytes);

    // Detect the true format from the magic bytes rather than trusting the ext.
    $magic = substr($bytes, 0, 4);
    $fmt = str_starts_with($magic, "\x89PNG") ? 'png'
        : (str_starts_with($magic, "\xFF\xD8") ? 'jpeg'
            : (str_starts_with($magic, 'RIFF') ? 'webp' : 'unknown'));

    echo 'image   : wrote ' . round(strlen($bytes) / 1024) . ' KB to ' . basename($out) . " (magic says: {$fmt})\n";

    // Read the decoded dimensions straight from the bytes so a 0x0 or truncated
    // payload cannot be mistaken for a render.
    $info = @getimagesizefromstring($bytes);
    echo 'dims    : ' . ($info ? $info[0] . 'x' . $info[1] . ' (' . $info['mime'] . ')' : 'UNREADABLE') . "\n";
} else {
    echo "NO IMAGE RETURNED\n";
}
