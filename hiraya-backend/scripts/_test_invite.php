<?php

/**
 * Sends one real invitation through the exact service the controller calls, so
 * the whole `invite()` path (token -> mail -> response) is exercised end to end
 * without needing a superadmin session.
 *
 *   php scripts/_test_invite.php kennethgiray457@gmail.com
 *
 * This DOES send mail. It writes no database rows — an invitation stores nothing
 * until the invitee redeems it — so it is safe to run more than once.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\AdminInvitationService;

$email = $argv[1] ?? 'kennethgiray457@gmail.com';
$service = new AdminInvitationService();

echo 'inviting      : ' . $email . PHP_EOL;
echo 'role          : admin' . PHP_EOL;
echo 'invited by    : probe (dev script)' . PHP_EOL;
echo str_repeat('-', 60) . PHP_EOL;

try {
    $result = $service->invite($email, 'admin', 'Probe (dev script)');

    echo PHP_EOL . 'OK — invitation issued and mail handed to the transport.' . PHP_EOL;
    echo 'expires_at    : ' . $result['expires_at'] . PHP_EOL;
    echo 'ttl minutes   : ' . $result['expires_in_minutes'] . PHP_EOL;
    echo PHP_EOL . 'link (also returned to the console so it can be copied):' . PHP_EOL;
    echo $result['url'] . PHP_EOL;
} catch (Throwable $e) {
    echo PHP_EOL . 'FAILED: ' . $e->getMessage() . PHP_EOL;

    $prev = $e->getPrevious();
    while ($prev) {
        echo '  caused by: ' . $prev->getMessage() . PHP_EOL;
        $prev = $prev->getPrevious();
    }

    exit(1);
}