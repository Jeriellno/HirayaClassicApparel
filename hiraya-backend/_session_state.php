<?php

/**
 * Read the current state of the QA try-on session (id from the URL/status poll)
 * so the render outcome can be inspected without the browser.
 */

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\TryOnSession;

$id = $argv[1] ?? 'tryon_a89a7eef-2bc1-40b4-b544-2b1f71e71710';
$s = TryOnSession::where('session_id', $id)->first();
if (! $s) {
    echo 'session not found' . PHP_EOL;
    exit(0);
}

echo 'id=' . $s->session_id . PHP_EOL;
echo 'status=' . $s->status . PHP_EOL;
echo 'engine=' . ($s->engine ?? '-') . PHP_EOL;
echo 'progress=' . ($s->progress ?? '-') . PHP_EOL;
echo 'feedback=' . substr((string) ($s->feedback ?? ''), 0, 300) . PHP_EOL;
echo 'error=' . substr((string) ($s->error_message ?? ''), 0, 300) . PHP_EOL;
echo 'attempts=' . ($s->attempts ?? '-') . PHP_EOL;
echo 'updated=' . ($s->updated_at ?? '-') . PHP_EOL;
$img = (string) ($s->generated_image ?? $s->result_image ?? '');
echo 'image_len=' . strlen($img) . PHP_EOL;
