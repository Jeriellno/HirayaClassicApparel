<?php

/** Convert the jobs table into human time and show availability/reserved state. */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;

echo 'now        : ' . date('Y-m-d H:i:s') . PHP_EOL;
echo 'now epoch  : ' . time() . PHP_EOL . PHP_EOL;

$rows = DB::table('jobs')->orderBy('id')->get(['id', 'queue', 'attempts', 'reserved_at', 'available_at', 'created_at']);
foreach ($rows as $j) {
    printf(
        "id=%d queue=%s attempts=%d reserved_at=%s available_at=%s created=%s (%s)%s\n",
        $j->id,
        $j->queue,
        $j->attempts,
        var_export($j->reserved_at, true),
        $j->available_at,
        $j->created_at,
        date('Y-m-d H:i:s', (int) $j->created_at),
        $j->available_at > time() ? '  <- NOT YET AVAILABLE (delayed)' : ''
    );
}
