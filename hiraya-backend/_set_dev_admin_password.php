<?php

/**
 * DEV ONLY — set a known password on the admin account so the local admin
 * console can be reached without guessing. Safe, idempotent, Eloquent-based.
 *
 *   php _set_dev_admin_password.php
 */
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use Illuminate\Support\Facades\Hash;

$email = 'admin@hiraya.com';
$password = 'HirayaAdmin2026!';

$user = User::where('email', $email)->first();

if (! $user) {
    echo "No account for {$email} — creating one.\n";
    $user = User::create([
        'full_name' => 'Hiraya Admin',
        'email'     => $email,
        'password'  => Hash::make($password),
        'role'      => 'admin',
    ]);
} else {
    $user->password = Hash::make($password);
    $user->role = 'admin';
    $user->save();
    echo "Password reset for {$email}.\n";
}

echo "role      : {$user->role}\n";
echo "user id   : {$user->id}\n";
echo "password  : {$password}\n";
