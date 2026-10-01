<?php

/**
 * List local accounts with the columns that decide whether a /api/login can
 * succeed, so a 401 can be told apart from "the row does not exist".
 *
 *   php scripts/_probe_accounts.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;

foreach (User::orderBy('id')->get() as $u) {
    echo str_pad((string) $u->id, 4)
        . ' | ' . str_pad((string) $u->email, 34)
        . ' | role=' . str_pad((string) $u->role, 12)
        . ' | susp=' . ($u->suspended_at ? 'YES' : 'no')
        . ' | mfa=' . ($u->mfa_enrolled_at ? 'set' : 'NULL')
        . ' | auth_id=' . ($u->auth_id ?: 'NULL')
        . ' | pwdlen=' . strlen((string) $u->password)
        . ' | prefix=' . substr((string) $u->password, 0, 7)
        . PHP_EOL;
}