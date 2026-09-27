<?php

/**
 * Dump every attribute of the newest try-on session so the job's real state
 * (status, attempts, engine, error) is visible without the browser.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\TryOnSession;

$id = (int) ($argv[1] ?? 100);
$s = TryOnSession::find($id);
if (! $s) {
    echo 'not found' . PHP_EOL;
    exit(0);
}

foreach ($s->getAttributes() as $k => $v) {
    if (is_string($v) && strlen($v) > 300) {
        $v = substr($v, 0, 300) . '...[' . strlen($v) . ']';
    }
    echo str_pad($k, 22) . ' = ' . var_export($v, true) . PHP_EOL;
}
