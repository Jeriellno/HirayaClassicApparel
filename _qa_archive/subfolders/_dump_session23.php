<?php

/** Dump session #23's completed render to a PNG so it can be looked at. */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\TryOnSession;

$s = TryOnSession::find(23);
if (!$s) {
    echo 'no session 23' . PHP_EOL;
    exit(1);
}

echo 'status     : ' . $s->status . PHP_EOL;
echo 'error      : ' . substr((string) $s->error_message, 0, 200) . PHP_EOL;
echo 'render     : ' . var_export($s->render_engine ?? null, true) . PHP_EOL;

$img = (string) $s->result_image_base64;
echo 'result_len : ' . strlen($img) . PHP_EOL;

if (strlen($img) > 1000) {
    $b64 = preg_replace('#^data:image/\w+;base64,#', '', $img);
    $bytes = base64_decode($b64, true);
    if ($bytes !== false) {
        $path = __DIR__ . '/_studio_session23.png';
        file_put_contents($path, $bytes);
        $info = @getimagesizefromstring($bytes);
        echo 'saved      : _studio_session23.png (' . strlen($bytes) . ' bytes)' . PHP_EOL;
        $dims = $info ? ($info[0] . 'x' . $info[1]) : 'unknown';
        $mime = $info ? $info['mime'] : 'unknown';
        echo 'dims       : ' . $dims . '  ' . $mime . PHP_EOL;
    }
}
