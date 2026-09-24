<?php

/**
 * Inspect the queue: pending jobs, failed jobs, and the tryon heartbeat so we
 * can tell whether the worker is actually draining the `tryon` queue.
 */

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;

echo 'queue.default = ' . config('queue.default') . PHP_EOL;

try {
    $pending = DB::table('jobs')->count();
    echo 'jobs (pending): ' . $pending . PHP_EOL;
    foreach (DB::table('jobs')->orderByDesc('id')->take(5)->get() as $j) {
        echo '  #' . $j->id . ' queue=' . $j->queue . ' attempts=' . $j->attempts
            . ' available_at=' . date('H:i:s', $j->available_at) . PHP_EOL;
    }
} catch (\Throwable $e) {
    echo 'jobs error: ' . $e->getMessage() . PHP_EOL;
}

try {
    echo 'failed_jobs: ' . DB::table('failed_jobs')->count() . PHP_EOL;
    foreach (DB::table('failed_jobs')->orderByDesc('id')->take(3)->get() as $f) {
        echo '  failed#' . $f->id . ' ' . $f->queue . ' at ' . $f->failed_at . PHP_EOL;
        echo '     ' . substr($f->exception, 0, 300) . PHP_EOL;
    }
} catch (\Throwable $e) {
    echo 'failed_jobs error: ' . $e->getMessage() . PHP_EOL;
}

try {
    echo 'worker heartbeat: ' . var_export(Cache::get('tryon:worker-heartbeat'), true) . PHP_EOL;
} catch (\Throwable $e) {
    echo 'cache error: ' . $e->getMessage() . PHP_EOL;
}
