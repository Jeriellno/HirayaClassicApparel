<?php

/**
 * Measure the REAL cost of the two SuperAdmin endpoints that time out.
 *
 * The console reports `timeout of 45000ms exceeded` for these, and the existing
 * comments in axios.js blame the single-threaded dev server QUEUEING cheap reads.
 * That may be true — but it is an inference. This measures the ENDPOINT ITSELF,
 * so we know whether the query is expensive or merely waiting in line.
 *
 * It also measures the raw database round-trip, because this deployment runs on
 * a REMOTE Supabase pooler (DB_HOST=aws-0-ap-southeast-1.pooler.supabase.com),
 * and a slow/lost pooler is a completely different fix from a slow query.
 *
 * Usage: php _measure_admin_endpoints.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use App\Models\TryOnSession;

$time = function (string $label, callable $fn) {
    $t0 = microtime(true);
    try {
        $result = $fn();
        $ms = round((microtime(true) - $t0) * 1000);
        $note = is_int($result) ? " -> {$result}" : '';
        echo sprintf("  %-46s %8d ms%s\n", $label, $ms, $note);

        return [$ms, $result];
    } catch (\Throwable $e) {
        $ms = round((microtime(true) - $t0) * 1000);
        echo sprintf("  %-46s %8d ms  FAILED: %s\n", $label, $ms, substr($e->getMessage(), 0, 90));

        return [$ms, null];
    }
};

echo 'database driver : ' . config('database.default') . PHP_EOL;
echo 'database host   : ' . (config('database.connections.' . config('database.default') . '.host') ?: '(local sqlite/file)') . PHP_EOL;
echo 'queue driver    : ' . config('queue.default') . PHP_EOL;
echo str_repeat('-', 72) . PHP_EOL;

echo 'RAW DB ROUND-TRIPS' . PHP_EOL;
$time('SELECT 1 (pure round-trip)', fn() => DB::select('SELECT 1 as ok') ? 1 : 0);
$time('SELECT 1 (again, warm)', fn() => DB::select('SELECT 1 as ok') ? 1 : 0);

echo PHP_EOL . 'THE TWO TIMING-OUT ENDPOINTS' . PHP_EOL;
$time('/admin/analytics/sessions -> TryOnSession::active()->count()', function () {
    return TryOnSession::query()->active()->count();
});

$time('/admin/audit-logs -> simple count', function () {
    // The audit endpoint's own query; measured here as a plain count so the
    // number reflects the DB cost rather than the response serialisation.
    return DB::table('audit_logs')->count();
});

echo PHP_EOL . 'QUEUE STATE (this is what actually blocks renders)' . PHP_EOL;
$time('jobs table: pending count', fn() => DB::table('jobs')->count());
$time('jobs table: FAILED count', fn() => DB::table('failed_jobs')->count());

echo PHP_EOL . 'CONTEXT' . PHP_EOL;
$time('try_on_sessions total rows', fn() => DB::table('try_on_sessions')->count());

echo str_repeat('-', 72) . PHP_EOL;
echo 'A cheap query at a few hundred ms is QUEUEING, not cost.' . PHP_EOL;
echo 'Thousands of ms on a bare SELECT 1 means the POOLER/DNS is the problem.' . PHP_EOL;
