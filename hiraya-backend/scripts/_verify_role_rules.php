<?php

/**
 * Verifies the RULE 2/3 clamp without needing anyone's password or a live
 * Supabase session — the rules are pure request/response contracts, so they can
 * be exercised directly.
 *
 *   php scripts/_verify_role_rules.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

$pass = 0;
$fail = 0;

function check(string $label, bool $ok): void
{
    global $pass, $fail;
    $ok ? $pass++ : $fail++;
    echo ($ok ? '  PASS  ' : '  FAIL  ') . $label . PHP_EOL;
}

// The exact rule set AdminAccountController::invite() now uses.
$rules = [
    'email' => ['required', 'email', 'max:255', 'unique:users,email'],
    'role' => ['required', 'string', Rule::in(['admin']), 'not_in:superadmin'],
];

$messages = [
    'role.in' => 'Only the admin role can be invited.',
];

echo PHP_EOL . 'RULE 2/3 — an invitation may not create a superadmin:' . PHP_EOL;

$v = Validator::make(
    ['email' => 'probe-rule-test@example.com', 'role' => 'admin'],
    $rules,
    $messages
);
check('role=admin is ACCEPTED', $v->passes());

$v = Validator::make(
    ['email' => 'probe-rule-test@example.com', 'role' => 'superadmin'],
    $rules,
    $messages
);
check('role=superadmin is REJECTED', $v->fails());

$v = Validator::make(
    ['email' => 'probe-rule-test@example.com', 'role' => 'SUPERADMIN'],
    $rules,
    $messages
);
check('role=SUPERADMIN (case variant) is REJECTED', $v->fails());

// The token clamp: buildToken() is private, so read it reflectively.
echo PHP_EOL . 'Invitation TOKEN clamp (buildToken must only ever carry admin):' . PHP_EOL;

$service = new \App\Services\AdminInvitationService();
$method = new \ReflectionMethod($service, 'buildToken');
$method->setAccessible(true);

foreach (['admin', 'superadmin', 'SUPERADMIN', 'garbage', ''] as $attempt) {
    $token = $method->invoke($service, 'probe@example.com', $attempt, time() + 3600);
    $encoded = explode('.', $token)[0];
    $payload = json_decode(
        base64_decode(strtr($encoded, '-_', '+/') . str_repeat('=', (4 - strlen($encoded) % 4) % 4)),
        true
    );
    check(
        "token for role='" . $attempt . "' carries role=" . ($payload['role'] ?? '?'),
        ($payload['role'] ?? null) === 'admin'
    );
}

echo PHP_EOL . ($fail === 0 ? "ALL $pass CHECKS PASSED" : "$fail FAILED, $pass passed") . PHP_EOL;