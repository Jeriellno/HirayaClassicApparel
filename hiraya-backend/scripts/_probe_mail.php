or <?php

/**
 * Reports the effective mail configuration, so a failed invitation can be told
 * apart from a failed MESSAGE. Read-only: nothing is sent.
 *
 *   php scripts/_probe_mail.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$default = config('mail.default');
echo 'MAIL_MAILER    : ' . $default . PHP_EOL;

$m = config('mail.mailers.' . $default);

if (! is_array($m)) {
    echo 'mailer config  : (none)' . PHP_EOL;
    exit(0);
}

echo 'transport      : ' . ($m['transport'] ?? '?') . PHP_EOL;
echo 'host           : ' . ($m['host'] ?? '-') . PHP_EOL;
echo 'port           : ' . ($m['port'] ?? '-') . PHP_EOL;
echo 'username       : ' . ($m['username'] ?? '-') . PHP_EOL;
echo 'password set   : ' . (! empty($m['password']) ? 'yes' : 'NO') . PHP_EOL;
echo 'from address   : ' . config('mail.from.address') . PHP_EOL;
echo 'from name      : ' . config('mail.from.name') . PHP_EOL;

/*
 * CAN THIS MACHINE ACTUALLY REACH THE SMTP HOST?
 *
 * The invitation failing is not always a missing "To" — a dev box with no
 * outbound port 587 also produces a 502, and the two look identical from the
 * console. This resolves the host and attempts a TCP connect, so the failure is
 * attributable to a name that is reported here rather than a mystery in the log.
 */
$host = $m['host'] ?? null;
$port = (int) ($m['port'] ?? 587);

if ($host) {
    $ip = gethostbyname($host);
    echo 'dns            : ' . ($ip === $host ? 'FAILED to resolve' : $ip) . PHP_EOL;

    if ($ip !== $host) {
        $sock = @fsockopen($host, $port, $errno, $errstr, 5);
        echo 'tcp :' . $port . '    : ' . ($sock ? 'reachable' : "BLOCKED ($errstr)") . PHP_EOL;
        if ($sock) {
            fclose($sock);
        }
    }
}