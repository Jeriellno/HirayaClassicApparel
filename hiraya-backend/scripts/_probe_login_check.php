<?php

/**
 * Try a candidate password against every local account, using the EXACT check
 * AuthController::login performs, so we can see which email/password pair the
 * running backend would actually accept.
 *
 *   php scripts/_probe_login_check.php [password]
 *
 * The default candidates are the ones the repo's own scripts use.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use Illuminate\Support\Facades\Hash;

$candidates = array_slice($argv, 1);
if ($candidates === []) {
    $candidates = ['Hiraya2026!', 'password', 'HirayaAdmin2026!', 'password123'];
}

foreach (User::orderBy('id')->get() as $u) {
    foreach ($candidates as $pw) {
        if (Hash::check($pw, (string) $u->password)) {
            echo 'MATCH  ' . str_pad((string) $u->email, 34)
                . ' password=' . $pw
                . '  role=' . $u->role
                . '  suspended=' . ($u->suspended_at ? 'YES' : 'no')
                . PHP_EOL;
        }
    }
}

echo 'done' . PHP_EOL;