<?php

/**
 * Measure raw Supabase round-trip latency: time one trivial SELECT and a
 * connect, so the "server is hung" symptom can be attributed to the DB or not.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use App\Models\Product;
use App\Models\TryOnSession;

$t0 = microtime(true);
$one = DB::connection()->getPdo()->query('select 1')->fetchColumn();
$t1 = microtime(true);
echo 'select 1 -> ' . $one . ' in ' . round(($t1 - $t0) * 1000) . 'ms' . PHP_EOL;

$t0 = microtime(true);
$count = Product::count();
$t1 = microtime(true);
echo 'products count = ' . $count . ' in ' . round(($t1 - $t0) * 1000) . 'ms' . PHP_EOL;

$t0 = microtime(true);
$s = TryOnSession::orderByDesc('id')->take(1)->get();
$t1 = microtime(true);
echo 'latest session in ' . round(($t1 - $t0) * 1000) . 'ms (' . $s->count() . ' row)' . PHP_EOL;
