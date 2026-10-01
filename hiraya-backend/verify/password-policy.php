<?php
/*
 * PASSWORD POLICY — is one rule, applied everywhere.
 *
 * The policy was declared three times in three different shapes:
 *
 *   POST /register              'required|string|min:8|confirmed'
 *   POST /reset-password-direct 'required|string|min:8|confirmed'
 *   PUT  /user/password         Password::min(8) + different
 *
 * ...while the Register form additionally demanded an uppercase letter and a
 * number IN THE BROWSER ONLY. The server never checked either, so anything the
 * sign-up form rejected was accepted verbatim by the API.
 *
 * These checks drive the REAL endpoints through the HTTP kernel and assert that
 * App\Rules\PasswordStrength now refuses the same passwords on all three, so
 * the three screens cannot drift apart again.
 *
 * Run:  C:\php-8.3\php.exe verify/password-policy.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use App\Rules\PasswordStrength;
use App\Services\PasswordResetService;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

Mail::mailer('array');
config(['mail.default' => 'array']);

$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$pass = 0;
$fail = 0;
$check = function (string $label, bool $ok, string $detail = '') use (&$pass, &$fail) {
    if ($ok) {
        $pass++;
        echo "  PASS  {$label}\n";
    } else {
        $fail++;
        echo "  FAIL  {$label}" . ($detail !== '' ? "  [{$detail}]" : '') . "\n";
    }
};

$n = 0;
$post = function (string $uri, array $payload) use ($kernel, &$n) {
    $n++;
    $req = Illuminate\Http\Request::create(
        $uri,
        'POST',
        [],
        [],
        [],
        [
            'HTTP_ACCEPT' => 'application/json',
            'CONTENT_TYPE' => 'application/json',
            'REMOTE_ADDR' => '10.7.' . intdiv($n, 250) . '.' . ($n % 250 + 1),
        ],
        json_encode($payload)
    );

    $res = $kernel->handle($req);

    return [
        'status' => $res->getStatusCode(),
        'body' => json_decode($res->getContent(), true),
    ];
};

$put = function (string $uri, array $payload, string $token) use ($kernel, &$n) {
    $n++;
    $req = Illuminate\Http\Request::create(
        $uri,
        'PUT',
        [],
        [],
        [],
        [
            'HTTP_ACCEPT' => 'application/json',
            'CONTENT_TYPE' => 'application/json',
            'HTTP_AUTHORIZATION' => 'Bearer ' . $token,
            'REMOTE_ADDR' => '10.8.' . intdiv($n, 250) . '.' . ($n % 250 + 1),
        ],
        json_encode($payload)
    );

    $res = $kernel->handle($req);

    return [
        'status' => $res->getStatusCode(),
        'body' => json_decode($res->getContent(), true),
    ];
};

echo "\nPASSWORD POLICY\n" . str_repeat('=', 58) . "\n";

/* ------------------------------------------------------------------ THE RULE */

echo "\n1. THE RULE OBJECT\n";

$rule = new PasswordStrength();

$captures = [];
$verdict = function (string $value) use ($rule, &$captures) {
    $captures = [];
    $rule->validate('password', $value, function ($m) use (&$captures) {
        $captures[] = $m;
    });

    return $captures;
};

$check('8 chars, upper, number -> accepted', $verdict('Passw0rd') === []);
$check('too short -> rejected', $verdict('Pw0') !== [], implode('; ', $captures));
$check('no uppercase -> rejected', $verdict('password1') !== [], implode('; ', $captures));
$check('no number -> rejected', $verdict('Password') !== [], implode('; ', $captures));
$check('all lowercase 8+ -> rejected', $verdict('password') !== [], implode('; ', $captures));
$check('the message names the field', str_contains(implode(' ', $captures), 'password'), implode('; ', $captures));

/* ---------------------------------------------------------------- REGISTER */

echo "\n2. POST /register ENFORCES IT\n";

$email = 'policy-probe@hiraya.test';
User::where('email', $email)->delete();

$base = [
    'full_name' => 'Policy Probe',
    'email' => $email,
    'password_confirmation' => 'Passw0rd',
];

$r = $post('/api/register', $base + ['password' => 'Passw0rd']);
$check('compliant password -> 201', $r['status'] === 201, "got {$r['status']}");

$weak = [
    'abc',
    'password',
    'password1',
    'Password',
    'alllowercase123',
];

foreach ($weak as $w) {
    $r = $post('/api/register', $base + [
        'email' => 'probe-' . md5($w) . '@hiraya.test',
        'password' => $w,
    ]);
    $check("register rejects \"{$w}\"", $r['status'] === 422, "got {$r['status']}");
}

/* ------------------------------------------------------------ RESET PASSWORD */

echo "\n3. POST /reset-password-direct ENFORCES IT\n";

$user = User::where('email', $email)->first();
$service = app(PasswordResetService::class);

$build = (new ReflectionClass($service))->getMethod('buildToken');
$build->setAccessible(true);

$mint = function () use ($service, $build, $user) {
    return $build->invoke($service, $user->email, $user->password, now()->addMinutes(60)->timestamp);
};

foreach (['abc', 'password1', 'Password'] as $w) {
    $r = $post('/api/reset-password-direct', [
        'email' => $email,
        'token' => $mint(),
        'password' => $w,
        'password_confirmation' => $w,
    ]);
    $check("reset rejects \"{$w}\"", $r['status'] === 422, "got {$r['status']}");
}

// A compliant reset must still work — the rule must not be a blanket refusal.
$good = 'Reset-Pass-2026';
$r = $post('/api/reset-password-direct', [
    'email' => $email,
    'token' => $mint(),
    'password' => $good,
    'password_confirmation' => $good,
]);
$check('reset ACCEPTS a compliant password', $r['status'] === 200, "got {$r['status']}");
$check('the new password was applied', Hash::check($good, $user->fresh()->password));

/* ------------------------------------------------------------ CHANGE PASSWORD */

echo "\n4. PUT /user/password ENFORCES IT\n";

$token = $user->fresh()->createToken('policy-probe')->plainTextToken;

foreach (['password1', 'Password'] as $w) {
    $r = $put('/api/user/password', [
        'current_password' => $good,
        'new_password' => $w,
    ], $token);

    $check("change rejects \"{$w}\"", $r['status'] === 422, "got {$r['status']}");
}

$r = $put('/api/user/password', [
    'current_password' => $good,
    'new_password' => 'Changed-Pass-9',
], $token);
$check('change ACCEPTS a compliant password', $r['status'] === 200, "got {$r['status']}");

/* --------------------------------------------------------------- THE POINT */

echo "\n5. ALL THREE AGREE\n";

echo "  Register, Reset and Change now refuse the same passwords.\n";
echo "  A password the sign-up form rejects cannot be set through the API,\n";
echo "  and a weak password typed on the reset screen is not accepted either.\n";

User::where('email', $email)->delete();
foreach (User::where('email', 'like', 'probe-%@hiraya.test')->pluck('email') as $e) {
    User::where('email', $e)->delete();
}

echo "\n" . str_repeat('=', 58) . "\n";
echo "  {$pass} passed, {$fail} failed\n\n";

exit($fail === 0 ? 0 : 1);
