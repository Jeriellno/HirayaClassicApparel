<?php
/**
 * Show the most recent failed_jobs rows with the exception's first lines, so a
 * failed ProcessTryOnJob can be attributed to a concrete cause.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

$rows = DB::table('failed_jobs')->orderByDesc('id')->take(5)->get();
echo 'failed_jobs: ' . DB::table('failed_jobs')->count() . PHP_EOL;
foreach ($rows as $r) {
    echo '--- #' . $r->id . ' at ' . $r->failed_at . ' queue=' . $r->queue . PHP_EOL;
    echo 'uuid: ' . $r->uuid . PHP_EOL;
    $ex = (string) $r->exception;
    echo substr($ex, 0, 700) . PHP_EOL;
}
