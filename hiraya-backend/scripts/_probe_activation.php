<?php

/**
 * Reports every privileged account's activation state in the exact terms the
 * middleware uses, so "not active yet" can be traced to a specific column
 * instead of guessed at.
 *
 *   php scripts/_probe_activation.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

echo 'mfa_enrolled_at column exists: '
    . var_export(Schema::hasColumn('users', 'mfa_enrolled_at'), true) . PHP_EOL . PHP_EOL;

echo 'gates that decide "active":' . PHP_EOL;
echo '  1. Supabase JWT verifies (ES256 against JWKS)      -> 401' . PHP_EOL;
echo '  2. JWT aal === aal2 (TOTP passed)                  -> 403' . PHP_EOL;
echo '  3. email confirmed on Supabase                    -> 401' . PHP_EOL;
echo '  4. local users row exists                         -> 403' . PHP_EOL;
echo '  5. suspended_at IS NULL                           -> 403' . PHP_EOL;
echo '  6. mfa_enrolled_at IS NOT NULL                    -> 403' . PHP_EOL;
echo PHP_EOL;

$rows = DB::table('users')
    ->whereIn('role', ['admin', 'superadmin'])
    ->orderBy('id')
    ->get(['id', 'email', 'role', 'mfa_enrolled_at', 'auth_id', 'suspended_at']);

foreach ($rows as $u) {
    $blocked = $u->mfa_enrolled_at === null;
    echo ($blocked ? 'PENDING  ' : 'ACTIVE   ')
        . '#' . $u->id . '  ' . $u->email . PHP_EOL;
    echo '         role=' . $u->role
        . '  mfa_enrolled_at=' . ($u->mfa_enrolled_at ?? 'NULL')
        . '  auth_id=' . ($u->auth_id ?: 'NULL')
        . '  suspended=' . ($u->suspended_at ?: 'no') . PHP_EOL;
}