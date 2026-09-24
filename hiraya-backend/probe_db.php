<?php
// Time the DB connection + a trivial query, to see if the hang is DB-bound.
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

echo 'DB driver: ' . config('database.default') . PHP_EOL;
echo 'DB host: ' . config('database.connections.pgsql.host') . PHP_EOL;

$sw = microtime(true);
try {
    $n = Illuminate\Support\Facades\DB::table('products')->count();
    printf("products count = %d in %.2fs\n", $n, microtime(true) - $sw);
} catch (Throwable $e) {
    printf("DB FAIL after %.2fs: %s\n", microtime(true) - $sw, $e->getMessage());
}

// Session driver matters: `database` sessions write on EVERY request.
echo 'Session driver: ' . config('session.driver') . PHP_EOL;
echo 'Cache store: ' . config('cache.default') . PHP_EOL;
echo 'Queue: ' . config('queue.default') . PHP_EOL;
