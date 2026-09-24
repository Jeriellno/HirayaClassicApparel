<?php

/** Dump the most recent try-on sessions so we can see what the WORKER actually did. */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

echo '=== recent try_on_sessions ===' . PHP_EOL;
$rows = DB::table('try_on_sessions')
    ->orderByDesc('id')
    ->limit(8)
    ->get(['id', 'status', 'created_at', 'updated_at', 'error_message', 'ai_feedback']);

foreach ($rows as $r) {
    $has = DB::table('try_on_sessions')->where('id', $r->id)->value('result_image_base64');
    $len = is_string($has) ? strlen($has) : 0;
    printf(
        "#%d  %-10s  created=%s  updated=%s  result_len=%d\n     err=%s\n     fb=%s\n",
        $r->id,
        (string) $r->status,
        (string) $r->created_at,
        (string) $r->updated_at,
        $len,
        substr((string) $r->error_message, 0, 160),
        substr((string) $r->ai_feedback, 0, 160)
    );
}

echo PHP_EOL . '=== jobs / failed_jobs ===' . PHP_EOL;
foreach (['jobs', 'failed_jobs'] as $t) {
    try {
        $c = DB::table($t)->count();
        echo "  {$t}: {$c} row(s)" . PHP_EOL;
        if ($t === 'failed_jobs' && $c > 0) {
            foreach (DB::table($t)->orderByDesc('id')->limit(5)->get(['id', 'failed_at', 'exception']) as $f) {
                echo '    #' . $f->id . ' @ ' . $f->failed_at . ' :: ' . substr((string) $f->exception, 0, 300) . PHP_EOL;
            }
        }
        if ($t === 'jobs' && $c > 0) {
            foreach (DB::table($t)->limit(5)->get(['id', 'queue', 'attempts', 'created_at']) as $j) {
                echo '    id=' . $j->id . ' queue=' . $j->queue . ' attempts=' . $j->attempts . ' created=' . $j->created_at . PHP_EOL;
            }
        }
    } catch (\Throwable $e) {
        echo "  {$t}: error " . $e->getMessage() . PHP_EOL;
    }
}
