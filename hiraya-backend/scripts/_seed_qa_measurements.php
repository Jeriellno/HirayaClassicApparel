<?php

/**
 * Make the QA user renderable: give user #1 the sizing profile the try-on flow
 * reads, so the Studio does not treat them as having no size on file.
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

// The two size labels (see TryOnController::bodyMetricsFor, which derives the
// centimetres from these).
$user->upper_body_size = 'M';
$user->lower_body_size = 'M';
$user->save();

echo 'user #' . $user->id . ' sizes set: upper=' . $user->upper_body_size
    . ' lower=' . $user->lower_body_size . PHP_EOL;
