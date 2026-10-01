<?php

/**
 * Exercises the invitation mail WITHOUT a live superadmin session, by calling the
 * same service the controller calls. It uses Laravel's `array` mailer so nothing
 * leaves the machine, and it asserts the thing that was actually broken: that the
 * mailable carries a To header, and that the token inside the link carries `admin`
 * and never `superadmin`.
 *
 *   php scripts/_verify_invite_mail.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Mail\AdminInvitationMail;
use App\Services\AdminInvitationService;
use Illuminate\Support\Facades\Mail;

$pass = 0;
$fail = 0;

function check(string $label, bool $ok): void
{
    global $pass, $fail;
    $ok ? $pass++ : $fail++;
    echo ($ok ? '  PASS  ' : '  FAIL  ') . $label . PHP_EOL;
}

$mailable = new AdminInvitationMail(
    'probe@example.com',
    'https://localhost:5173/accept-invitation?email=probe%40example.com&token=abc.def',
    'admin',
    'hirayaclassicapparel@gmail.com',
    2880
);

// Render the mailable for real, with no SMTP involved.
// `render()` is the public entry point: it builds the Envelope, resolves the view
// and produces the Symfony Message, which is exactly what Mail::send() would
// hand to the transport — so the To header and the body are both real here. Before
// the `to:` was added to envelope() this call is exactly where it died.
$mailable->render();

echo PHP_EOL . 'Mailable envelope:' . PHP_EOL;

$envelope = $mailable->envelope();

check(
    'envelope declares a To (the 502: "must have a To, Cc, or Bcc header")',
    ! empty($envelope->to)
);
check(
    'envelope To is the invited address',
    is_array($envelope->to) && ($envelope->to[0]->address ?? null) === 'probe@example.com'
);
check(
    'subject is the invitation subject',
    $envelope->subject === 'You have been invited to the Hiraya Admin Console'
);

echo PHP_EOL . 'Invitation token carries only `admin`:' . PHP_EOL;

$service = new AdminInvitationService();
$method = new ReflectionMethod($service, 'buildToken');
$method->setAccessible(true);

foreach (['admin', 'superadmin', 'SUPERADMIN'] as $attempt) {
    $token = $method->invoke($service, 'probe@example.com', $attempt, time() + 3600);
    $encoded = explode('.', $token)[0];
    $payload = json_decode(
        base64_decode(strtr($encoded, '-_', '+/') . str_repeat('=', (4 - strlen($encoded) % 4) % 4)),
        true
    );
    check("token(role='" . $attempt . "') -> role=" . ($payload['role'] ?? '?'), ($payload['role'] ?? null) === 'admin');
}

echo PHP_EOL . ($fail === 0 ? "ALL $pass CHECKS PASSED" : "$fail FAILED, $pass passed") . PHP_EOL;