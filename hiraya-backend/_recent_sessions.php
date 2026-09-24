<?php

/**
 * List the most recent try-on sessions so a retry (which creates a NEW session)
 * can be inspected together with the original.
 */

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\TryOnSession;

foreach (TryOnSession::orderByDesc('id')->take(5)->get() as $s) {
    echo '#' . $s->id . ' ' . $s->session_id
        . ' | status=' . $s->status
        . ' | engine=' . ($s->engine ?? '-')
        . ' | progress=' . ($s->progress ?? '-')
        . ' | img=' . strlen((string) ($s->generated_image ?? ''))
        . ' | upd=' . $s->updated_at . PHP_EOL;
    echo '    err: ' . substr((string) ($s->error_message ?? ''), 0, 160) . PHP_EOL;
    echo '    fb : ' . substr((string) ($s->feedback ?? ''), 0, 200) . PHP_EOL;
}
