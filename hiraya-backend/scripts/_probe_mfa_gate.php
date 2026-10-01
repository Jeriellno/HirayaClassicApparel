<?php

/**
 * Establishes the ground truth for the mfa_enrolled_at gate:
 *   - does the column actually exist in the live database?
 *   - was the backfill recorded as having run?
 *   - what do the privileged rows hold RIGHT NOW?
 *
 *   php scripts/_probe_mfa_gate.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// 1. Column present?
echo 'column exists      : ' . var_export(Schema::hasColumn('users', 'mfa_enrolled_at'), true) . PHP_EOL;
echo 'suspended_at exists: ' . var_export(Schema::hasColumn('users', 'suspended_at'), true) . PHP_EOL;

// 2. Was the backfill migration recorded as run?
$row = DB::table('migrations')
    ->where('migration', 'like', '%mfa_enrolled_at%')
    ->first();
echo 'migration recorded : ' . ($row ? 'YES (batch ' . $row->batch . ', ' . $row->migration . ')'
    : 'NO — never recorded as run') . PHP_EOL;

// 3. The privileged rows, raw.
echo PHP_EOL . 'privileged rows:' . PHP_EOL;
$rows = DB::table('users')
    ->whereIn('role', ['admin', 'superadmin'])
    ->orderBy('id')
    ->get(['id', 'email', 'role', 'mfa_enrolled_at', 'auth_id', 'created_at', 'suspended_at']);

foreach ($rows as $u) {
    echo '  #' . $u->id . ' ' . $u->email
        . '  role=' . $u->role
        . '  mfa_enrolled_at=' . ($u->mfa_enrolled_at ?? 'NULL')
        . '  created_at=' . $u->created_at
        . '  auth_id=' . ($u->auth_id ?: 'NULL')
        . '  suspended=' . ($u->suspended_at ?: 'no')
        . PHP_EOL;
}

// 4. The exact predicate the middleware uses.
echo PHP_EOL . 'gate verdict (ResolveSupabaseUser.php:158):' . PHP_EOL;
foreach ($rows as $u) {
    $role = strtolower(str_replace(['-', '_'], '', (string) $u->role));
    $blocked = in_array($role, ['admin', 'superadmin'], true) && $u->mfa_enrolled_at === null;
    echo '  #' . $u->id . ' ' . $u->email . ' -> ' . ($blocked ? 'BLOCKED 403' : 'allowed') . PHP_EOL;
}