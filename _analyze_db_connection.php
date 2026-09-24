<?php

/**
 * DATABASE CONNECTION HEALTH ANALYSIS
 * ===================================
 *
 * Answers three separate questions, because they have different fixes:
 *
 *   1. IS IT REACHABLE AT ALL?     (DNS resolves, TCP connects, auth works)
 *   2. HOW FAST IS IT, REALLY?     (many round-trips, not one lucky sample)
 *   3. DOES IT STAY UP?            (repeated attempts, to expose intermittency)
 *
 * The earlier one-shot measurement showed SELECT 1 at 483ms and the log showed
 * intermittent "could not translate host name", so a single sample is not enough
 * to characterise this. This runs a SERIES and reports the distribution.
 *
 * It is READ-ONLY: only SELECT 1 and counts. It writes nothing.
 *
 * Usage: php _analyze_db_connection.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

$driver = config('database.default');
$conf = config("database.connections.{$driver}");

echo '╔══════════════════════════════════════════════════════════════╗' . PHP_EOL;
echo '║  DATABASE CONNECTION ANALYSIS                                ║' . PHP_EOL;
echo '╚══════════════════════════════════════╝' . PHP_EOL;

echo PHP_EOL . '── CONFIGURATION ─────────────────────────────────────────────' . PHP_EOL;
echo '  driver   : ' . $driver . PHP_EOL;
echo '  host     : ' . ($conf['host'] ?? '(none)') . PHP_EOL;
echo '  port     : ' . ($conf['port'] ?? '(default)') . PHP_EOL;
echo '  database : ' . ($conf['database'] ?? '(none)') . PHP_EOL;
echo '  username : ' . ($conf['username'] ?? '(none)') . PHP_EOL;
echo '  sslmode  : ' . ($conf['sslmode'] ?? '(not set)') . PHP_EOL;

$host = (string) ($conf['host'] ?? '');

/* ── 1. DNS ─────────────────────────────────────────────────────── */
echo PHP_EOL . '── 1. DNS RESOLUTION ─────────────────────────────────────────' . PHP_EOL;

if ($host === '' || $host === '127.0.0.1' || $host === 'localhost') {
    echo '  local host — DNS not applicable.' . PHP_EOL;
} else {
    // Resolve FIVE times to expose an intermittent resolver.
    $times = [];
    $failures = 0;
    for ($i = 1; $i <= 5; $i++) {
        $t0 = microtime(true);
        $ip = @gethostbyname($host);
        $ms = round((microtime(true) - $t0) * 1000);
        // gethostbyname returns the input UNCHANGED when it fails.
        $ok = ($ip !== $host && filter_var($ip, FILTER_VALIDATE_IP));
        if (! $ok) {
            $failures++;
        }
        $times[] = $ms;
        printf("  attempt %d : %-8s %6d ms  %s\n", $i, $ok ? 'OK' : 'FAIL', $ms, $ok ? $ip : '(unresolved)');
    }
    echo '  DNS failures: ' . $failures . '/5' . PHP_EOL;

    if ($failures > 0) {
        echo PHP_EOL . '  >> INTERMITTENT DNS. This alone explains the 45s timeouts:' . PHP_EOL;
        echo '     each failed lookup STALLS a query, and the backend is single-threaded,' . PHP_EOL;
        echo '     so they stack up in the request queue.' . PHP_EOL;
    }
}

/* ── 2. TCP / AUTH ──────────────────────────────────────────────── */
echo PHP_EOL . '── 2. CONNECTIVITY + AUTH ────────────────────────────────────' . PHP_EOL;

$port = (int) ($conf['port'] ?? 5432);
if ($host !== '' && ! in_array($host, ['127.0.0.1', 'localhost'], true)) {
    $t0 = microtime(true);
    $sock = @fsockopen($host, $port, $errno, $errstr, 10);
    $ms = round((microtime(true) - $t0) * 1000);
    if ($sock) {
        fclose($sock);
        echo sprintf("  TCP connect to %s:%d : OK  (%d ms)\n", $host, $port, $ms);
    } else {
        echo sprintf("  TCP connect to %s:%d : FAILED  (%d ms)  [%d] %s\n", $host, $port, $ms, $errno, $errstr);
    }
}

/* ── 3. ROUND-TRIP DISTRIBUTION ─────────────────────────────────── */
echo PHP_EOL . '── 3. ROUND-TRIP TIMING (12 samples) ─────────────────────────' . PHP_EOL;

$samples = [];
$errors = 0;

for ($i = 1; $i <= 12; $i++) {
    $t0 = microtime(true);
    try {
        DB::select('SELECT 1 as ok');
        $ms = round((microtime(true) - $t0) * 1000);
        $samples[] = $ms;
        printf("  %2d : %6d ms\n", $i, $ms);
    } catch (\Throwable $e) {
        $ms = round((microtime(true) - $t0) * 1000);
        $errors++;
        printf("  %2d : %6d ms  FAILED: %s\n", $i, $ms, substr($e->getMessage(), 0, 70));
    }
}

if ($samples !== []) {
    sort($samples);
    $count = count($samples);
    $min = $samples[0];
    $max = $samples[$count - 1];
    $avg = round(array_sum($samples) / $count);

    echo PHP_EOL . '  ── DISTRIBUTION ──' . PHP_EOL;
    echo '  min    : ' . $min . ' ms' . PHP_EOL;
    echo '  median : ' . $samples[intdiv($count, 2)] . ' ms' . PHP_EOL;
    echo '  avg    : ' . $avg . ' ms' . PHP_EOL;
    echo '  max    : ' . $max . ' ms' . PHP_EOL;
    echo '  errors : ' . $errors . '/' . ($count + $errors) . PHP_EOL;

    /*
     * A LOCAL database answers a bare SELECT 1 in well under 10ms. Anything in
     * the hundreds of ms is NETWORK LATENCY, and the spread between min and max
     * is what tells us whether the link is stable or erratic.
     */
    $spread = $max - $min;
    echo PHP_EOL . '  ── READING ──' . PHP_EOL;

    if ($max < 20 && $errors === 0) {
        echo '  LOCAL and HEALTHY: sub-20ms round-trips, no errors.' . PHP_EOL;
    } else {
        echo '  REMOTE: a bare SELECT 1 costs ~' . $avg . 'ms. That is pure network,' . PHP_EOL;
        echo '  not query cost — the DB has nothing to do for SELECT 1.' . PHP_EOL;
        echo '  Spread min->max is ' . $spread . 'ms, which is the link being ' . ($spread > 500 ? 'ERRATIC' : 'fairly stable') . '.' . PHP_EOL;
    }
}

/* ── 4. THE ACTUAL ENDPOINT QUERIES ─────────────────────────────── */
echo PHP_EOL . '── 4. THE TWO ENDPOINTS THAT TIMED OUT ───────────────────────' . PHP_EOL;

$timed = function (string $label, callable $fn) {
    $t0 = microtime(true);
    try {
        $r = $fn();
        printf("  %-44s %7d ms -> %s\n", $label, round((microtime(true) - $t0) * 1000), var_export($r, true));
    } catch (\Throwable $e) {
        printf("  %-44s %7d ms -> FAILED: %s\n", $label, round((microtime(true) - $t0) * 1000), substr($e->getMessage(), 0, 60));
    }
};

$timed('sessions: TryOnSession::active()->count()', fn() => App\Models\TryOnSession::query()->active()->count());
$timed('audit: audit_logs count', fn() => DB::table('audit_logs')->count());

/* ── 5. POOLER-SPECIFIC WARNING ─────────────────────────────────── */
echo PHP_EOL . '── 5. VERDICT ────────────────────────────────────────────────' . PHP_EOL;

$isRemote = $host !== '' && ! in_array($host, ['127.0.0.1', 'localhost'], true);

if (! $isRemote) {
    echo '  Database is LOCAL — latency is not the issue.' . PHP_EOL;
} elseif ($errors > 0 || $samples === []) {
    echo '  ✗ UNSTABLE. ' . $errors . ' failed round-trips out of 12.' . PHP_EOL;
    echo '    The connection DROPS — that is why requests burn their whole timeout.' . PHP_EOL;
} else {
    echo '  ~ WORKING BUT SLOW. Every query pays ~' . round(array_sum($samples) / count($samples)) . 'ms of network.' . PHP_EOL;
    echo '    The connection is UP; the LATENCY is the problem.' . PHP_EOL;
    echo PHP_EOL . '  This is a Supabase pooler in a remote region. Options:' . PHP_EOL;
    echo '    a) check the project is not PAUSED (dashboard -> project status)' . PHP_EOL;
    echo '    b) if paused, unpause it — that is the "could not translate host name" error' . PHP_EOL;
    echo '    c) cache the admin reads server-side so latency stops mattering' . PHP_EOL;
}
