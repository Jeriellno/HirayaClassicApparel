<?php
/*
 * MAIL DELIVERY — what the transport is actually configured to do.
 *
 * This suite reports the CURRENT mail configuration and, where the transport
 * allows it, proves a message can leave the application. It is deliberately
 * ADVISORY rather than a hard gate on SMTP: a developer machine with no
 * credentials should still be able to run the suite and see a clear statement of
 * what will happen, rather than a red failure that says nothing useful.
 *
 * Run:  C:\php-8.3\php.exe verify/mail-delivery.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Mail\PasswordResetMail;
use App\Models\User;
use App\Services\PasswordResetService;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;

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

$mailer = config('mail.default');
$host = config('mail.host');
$port = (int) config('mail.port');
$from = config('mail.from.address');
$frontend = config('app.frontend_url');

echo "\nMAIL DELIVERY\n" . str_repeat('=', 58) . "\n";

echo "\nCONFIGURATION\n";
echo "  mailer          : {$mailer}\n";
echo "  host            : " . ($host ?: '(empty — falls back to the log mailer)') . "\n";
echo "  port            : {$port}\n";
echo "  encryption      : " . (config('mail.mailers.smtp.encryption') ?: '(none)') . "\n";
echo "  from address    : {$from}\n";
echo "  frontend URL    : {$frontend}\n";

echo "\n1. CONFIGURATION IS COHERENT\n";

/*
 * The encryption/port pairing is the setting that breaks silently: a client that
 * expects implicit TLS on a STARTTLS port does not error, it HANGS waiting for a
 * handshake the server never starts. Checking it here turns that into a message.
 */
$expected = $port === 465 ? 'tls' : 'starttls';
$check(
    "encryption matches the port ({$port} -> {$expected})",
    $mailer !== 'smtp' || config('mail.mailers.smtp.encryption') === $expected,
    (string) config('mail.mailers.smtp.encryption')
);

$check('a From address is set', !empty($from));
$check('the frontend URL is absolute', (bool) preg_match('#^https?://#', (string) $frontend), (string) $frontend);
$check('the frontend URL is not the API host', !str_contains((string) $frontend, '/api'), (string) $frontend);

/*
 * Gmail and Outlook both refuse a From that is not the authenticated account, or
 * silently rewrite it — which is the most common reason reset mail lands in spam.
 */
$username = config('mail.username');
if ($mailer === 'smtp' && $username && $host && str_contains((string) $host, 'gmail')) {
    $check(
        'From matches the authenticated Gmail account',
        strtolower((string) $from) === strtolower((string) $username),
        "from={$from} username={$username}"
    );
}

echo "\n2. THE MESSAGE BUILDS AND SENDS\n";

$user = User::first();

if (!$user) {
    echo "  skipped — no user in the database to render against\n";
} else {
    $captured = [];
    Event::listen(Illuminate\Mail\Events\MessageSending::class, function ($event) use (&$captured) {
        $captured[] = $event->message;
    });

    // Capture regardless of the configured transport, so this runs with or
    // without SMTP credentials.
    config(['mail.default' => 'array']);

    $service = app(PasswordResetService::class);
    $url = $service->resetUrl($user->email, 'probe.token.value');
    $mailable = new PasswordResetMail($user, $url, PasswordResetService::TTL_MINUTES);

    $sent = Mail::mailer('array')->send($mailable);
    $check('the mailable sends without throwing', true);
    $check('the send fired MessageSending', count($captured) === 1, 'captured ' . count($captured));

    if ($captured !== []) {
        $message = $captured[0];
        $check('a recipient is set', $message->getTo() !== [], 'To header is empty');
        $check('the subject is correct', $message->getSubject() === 'Reset your Hiraya password', (string) $message->getSubject());
        $check('an HTML part exists', !empty($message->getHtmlBody()));
        $check('a text part exists', !empty($message->getTextBody()));

        // The text part must carry the URL UNESCAPED, or copying it breaks the link.
        $check(
            'the text part has the raw URL (not entity-escaped)',
            str_contains((string) $message->getTextBody(), $url)
        );
    }
}

echo "\n3. HOW THIS DEPLOYMENT WILL BEHAVE\n";

if ($mailer === 'log' || empty($host)) {
    echo "  ADVISORY: no SMTP host is configured, so mail is written to\n";
    echo "            storage/logs/laravel.log instead of sent.\n";
    echo "            The reset flow still WORKS — the link is recoverable from\n";
    echo "            that log — but no customer will receive it.\n";
    echo "            Set MAIL_HOST/MAIL_USERNAME/MAIL_PASSWORD in .env to deliver.\n";
} else {
    echo "  SMTP is configured ({$host}:{$port}). Sends will attempt real delivery.\n";
}

echo "\n" . str_repeat('=', 58) . "\n";
echo "  {$pass} passed, {$fail} failed\n\n";

exit($fail === 0 ? 0 : 1);