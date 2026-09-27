<?php

/**
 * Make the QA user renderable: give user #1 the 5-core body measurements the
 * try-on flow requires, so the Studio does not block on "measurements missing".
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;

$user = User::find($argv[1] ?? 1);
if (! $user) {
    echo 'no user' . PHP_EOL;
    exit(1);
}

// The 5-core CM schema the Studio stores (see ProcessTryOnJob::resolveBodyMetrics).
$user->chest_bust = 92;
$user->waist = 76;
$user->hips = 98;
$user->shoulder_width = 44;
$user->sleeve_length = 60;
$user->save();

echo 'user #' . $user->id . ' measurements set: chest=' . $user->chest_bust
    . ' waist=' . $user->waist . ' hips=' . $user->hips
    . ' shoulder=' . $user->shoulder_width . ' sleeve=' . $user->sleeve_length . PHP_EOL;
