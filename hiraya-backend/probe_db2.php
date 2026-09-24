<?php
// Measure the per-request DB round trips that a `database` driver setup forces.
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$sw = microtime(true);
Illuminate\Support\Facades\DB::table('products')->count();
$first = microtime(true) - $sw;

$sw = microtime(true);
Illuminate\Support\Facades\DB::table('products')->count();
$second = microtime(true) - $sw;

printf("first query: %.2fs\nsecond query (same connection): %.2fs\n", $first, $second);

// Does the sessions table exist / how many rows (the table hit on every request)?
try {
    $sw = microtime(true);
    $s = Illuminate\Support\Facades\DB::table('sessions')->count();
    printf("sessions rows = %d in %.2fs\n", $s, microtime(true) - $sw);
} catch (Throwable $e) {
    echo 'sessions table: ' . $e->getMessage() . PHP_EOL;
}

try {
    $sw = microtime(true);
    $j = Illuminate\Support\Facades\DB::table('jobs')->count();
    printf("jobs rows = %d in %.2fs\n", $j, microtime(true) - $sw);
} catch (Throwable $e) {
    echo 'jobs table: ' . $e->getMessage() . PHP_EOL;
}
