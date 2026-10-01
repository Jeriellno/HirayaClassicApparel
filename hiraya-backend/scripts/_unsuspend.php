<?php

/**
 * Clear the suspension flag on a local account so it can sign in again.
 *
 *   php scripts/_unsuspend.php ken@hiraya.com
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;

$email = $argv[1] ?? null;

if (!$email) {
    echo 'usage: php scripts/_unsuspend.php <email>' . PHP_EOL;
    exit(1);
}

$user = User::where('email', $email)->first();

if (!$user) {
    echo 'No such user: ' . $email . PHP_EOL;
    exit(1);
}

$user->suspended_at = null;
$user->save();

echo str_pad($email, 34)
    . ' suspended_at -> ' . var_export($user->fresh()->suspended_at, true)
    . '  role=' . $user->fresh()->role
    . PHP_EOL;