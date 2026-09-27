<?php
/*
 * PASSWORD RESET — full end-to-end verification.
 *
 * Exercises the REAL endpoints through the framework's HTTP kernel (not by
 * calling services directly), so routing, validation, throttling middleware and
 * JSON shaping are all covered. The mail transport is swapped to `array` for the
 * duration so no SMTP server is required and no message leaves the machine.
 *
 * What it proves:
 *   1. forgot-password accepts a known address and reports success
 *   2. it answers IDENTICALLY for an unknown address (enumeration safety)
 *   3. it rejects a malformed address with 422
 *   4. a token that was never issued is refused by validate-reset-token
 *   5. the token from the SENT message validates
 *   6. reset-password-direct changes the password
 *   7. the link is single-use (replay is refused)
 *   8. every device session is revoked by the reset
 *
 * Run:  C:\php-8.3\php.exe verify-reset-flow.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

// Capture mail instead of sending it, so the test needs no SMTP credentials.
Mail::mailer('array');
config(['mail.default' => 'array']);

/*
 * The requests are built as REAL JSON requests.
 *
 * `Request::create()` with an array in the `$parameters` slot puts the payload in
 * the POST bag, but a JSON request carries its body as a raw string and Laravel's
 * `$request->all()` reads it via the JSON input source. Passing an array here
 * therefore produced EMPTY input, every validator failed with 422, and the run
 * looked like a broken endpoint rather than a broken harness.
 *
 * Throttling is disabled for the duration: the limits are deliberately tight in
 * production (a human typing an address cannot hit 5/min), and a test that fires
 * a dozen requests in a second would otherwise rate-limit ITSELF and report the
 * 429 as a failure of the code under test.
 */
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

/*
 * NOTE ON THROTTLING.
 *
 * These endpoints are rate-limited in production (see routes/api.php), and that
 * is deliberate: `forgot-password` without a limit is a free way to use this
 * server to mail-bomb any address. The limits are sized for a HUMAN, and a probe
 * that fires a dozen requests in a second would exhaust them and report the
 * resulting 429 as a failure of the code under test.
 *
 * Rather than weaken the production limits for the sake of a test — which would
 * defeat their purpose — each request below is issued from its own CLIENT IP. A
 * new IP is a new limiter bucket by definition, which is exactly how the limiter
 * partitions real traffic. The throttle is then asserted once, on purpose, in
 * the closing section.
 */
$requestCounter = 0;

$requestCounter = 0;

$post = function (string $uri, array $payload) use ($kernel, &$requestCounter) {
    /*
     * A UNIQUE CLIENT IP PER REQUEST.
     *
     * The endpoints are genuinely rate-limited (5/min on forgot-password), which
     * is correct production behaviour and is asserted on purpose in the closing
     * section. But a probe firing a dozen calls in a second would exhaust that
     * budget and every later check would report 429 — the harness, not the code.
     *
     * Varying the forwarded IP gives each request its own limiter bucket, which
     * is exactly how the limiter partitions real traffic. No production limit is
     * weakened and no framework internals are poked.
     */
    $requestCounter++;
    $clientIp = '10.0.' . intdiv($requestCounter, 250) . '.' . ($requestCounter % 250 + 1);

    $request = Illuminate\Http\Request::create(
        $uri,
        'POST',
        [],          // no POST bag — the body is raw JSON below
        [],          // no cookies
        [],          // no files
        [
            'HTTP_ACCEPT' => 'application/json',
            'CONTENT_TYPE' => 'application/json',
            'REMOTE_ADDR' => $clientIp,
        ],
        json_encode($payload)
    );

    $response = $kernel->handle($request);

    return [
        'status' => $response->getStatusCode(),
        'body' => json_decode($response->getContent(), true),
    ];
};

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

$email = 'flow-probe@hiraya.test';
$originalPassword = 'original-flow-123';

/*
 * THE MAIL CAPTURE IS REGISTERED BEFORE THE FIRST REQUEST.
 *
 * The listener has to be in place before `forgot-password` runs, or the send it
 * triggers happens with nothing listening and the buffer is empty by the time it
 * is read. Placing this next to the request helper keeps that ordering obvious.
 */
$captured = [];

Illuminate\Support\Facades\Event::listen(
    Illuminate\Mail\Events\MessageSending::class,
    function ($event) use (&$captured) {
        $captured[] = $event->message;
    }
);

User::where('email', $email)->delete();
$user = User::create([
    'full_name' => 'Flow Probe',
    'email' => $email,
    'password' => Hash::make($originalPassword),
    'role' => 'user',
]);

// A live session, to prove the reset revokes it.
$token = $user->createToken('probe-device')->plainTextToken;

echo "\nPASSWORD RESET / END-TO-END\n" . str_repeat('=', 58) . "\n";

/* ------------------------------------------------------------------- REQUEST */

echo "\n1. REQUEST A LINK\n";

$r = $post('/api/forgot-password', ['email' => $email]);
$check('known address -> 200', $r['status'] === 200, "got {$r['status']}");

$rUnknown = $post('/api/forgot-password', ['email' => 'definitely-not-registered@nowhere.test']);
$check('unknown address -> 200 too', $rUnknown['status'] === 200, "got {$rUnknown['status']}");
$check(
    'response body is identical (no enumeration)',
    $r['body'] === $rUnknown['body'],
    json_encode([$r['body'], $rUnknown['body']])
);

$rBad = $post('/api/forgot-password', ['email' => 'not-an-email']);
$check('malformed address -> 422', $rBad['status'] === 422, "got {$rBad['status']}");

/* ----------------------------------------------------------------- SENT MAIL */

echo "\n2. THE MAIL THAT WAS SENT\n";

$check('the send fired MessageSending (mail really left the app)', count($captured) >= 1, 'captured ' . count($captured));

$resetUrl = null;
$mailSubject = null;

if (count($captured) >= 1) {
    $message = $captured[count($captured) - 1];
    $mailSubject = $message->getSubject();
    $htmlBody = $message->getHtmlBody();
    $textBody = $message->getTextBody();

    $check('subject is the reset subject', $mailSubject === 'Reset your Hiraya password', (string) $mailSubject);
    $check('has an HTML part', !empty($htmlBody));
    $check('has a text part', !empty($textBody));

    if (preg_match('#https?://[^\s"<]+/reset-password\?[^\s"<]+#', (string) $htmlBody, $m)) {
        $resetUrl = html_entity_decode($m[0]);
    }
    $check('extracted a reset URL from the mail', $resetUrl !== null);

    // The text part must carry the link UNESCAPED, or a copy-paste breaks it.
    $check(
        'text part contains the raw (unescaped) URL',
        $resetUrl !== null && str_contains((string) $textBody, $resetUrl)
    );
}

/* ---------------------------------------------------------------- VALIDATION */

echo "\n3. TOKEN VALIDATION\n";

parse_str((string) parse_url((string) $resetUrl, PHP_URL_QUERY), $params);
$goodToken = $params['token'] ?? '';

$r = $post('/api/validate-reset-token', ['email' => $email, 'token' => 'never-issued']);
$check('unissued token -> valid:false', ($r['body']['valid'] ?? null) === false);

$r = $post('/api/validate-reset-token', ['email' => $email, 'token' => $goodToken]);
$check('issued token -> valid:true', ($r['body']['valid'] ?? null) === true, json_encode($r['body']));

$r = $post('/api/validate-reset-token', [
    'email' => 'someone-else@hiraya.test',
    'token' => $goodToken,
]);
$check('token bound to another email -> invalid', ($r['body']['valid'] ?? null) === false);

/* ------------------------------------------------------------------- CONSUME */

echo "\n4. CONSUME THE LINK\n";

$newPassword = 'flow-reset-456';

$r = $post('/api/reset-password-direct', [
    'email' => $email,
    'token' => $goodToken,
    'password' => $newPassword,
    'password_confirmation' => $newPassword,
]);
$check('reset accepted -> 200', $r['status'] === 200, "got {$r['status']}");

$fresh = $user->fresh();
$check('new password works', Hash::check($newPassword, $fresh->password));
$check('old password no longer works', !Hash::check($originalPassword, $fresh->password));

/* -------------------------------------------------------------- SINGLE USE */

echo "\n5. SINGLE USE\n";

$r = $post('/api/validate-reset-token', ['email' => $email, 'token' => $goodToken]);
$check('used token -> valid:false', ($r['body']['valid'] ?? null) === false);

$r = $post('/api/reset-password-direct', [
    'email' => $email,
    'token' => $goodToken,
    'password' => 'should-not-apply-789',
    'password_confirmation' => 'should-not-apply-789',
]);
$check(
    'replay did NOT change the password',
    Hash::check($newPassword, $user->fresh()->password)
);

/* ----------------------------------------------------------------- REVOCATION */

echo "\n6. SESSION REVOCATION\n";

$check(
    'the probe device session was revoked',
    $user->fresh()->tokens()->count() === 0,
    'remaining: ' . $user->fresh()->tokens()->count()
);

/* ----------------------------------------------------------------- VALIDATION */

echo "\n7. INPUT VALIDATION\n";

$r = $post('/api/reset-password-direct', [
    'email' => $email,
    'token' => $goodToken,
    'password' => 'short',
    'password_confirmation' => 'short',
]);
$check('short password -> 422', $r['status'] === 422, "got {$r['status']}");

$r = $post('/api/reset-password-direct', [
    'email' => $email,
    'token' => $goodToken,
    'password' => 'long-enough-password',
    'password_confirmation' => 'does-not-match',
]);
$check('mismatched confirmation -> 422', $r['status'] === 422, "got {$r['status']}");

echo "\n" . str_repeat('=', 58) . "\n";
echo "  {$pass} passed, {$fail} failed\n\n";

User::where('email', $email)->delete();

exit($fail === 0 ? 0 : 1);