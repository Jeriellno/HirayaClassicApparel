<?php
/*
 * TOKEN LIFECYCLE — the properties that make a reset link SAFE to email.
 *
 * The original implementation was `hash_hmac('sha256', $email, app.key)`: a
 * DETERMINISTIC value, so every link ever issued for an account stayed valid
 * forever and a link leaked from an old inbox kept working months later. Each
 * assertion below pins one of the properties that replaced it.
 *
 * Run:  C:\php-8.3\php.exe verify/token-lifecycle.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use App\Services\PasswordResetService;
use Illuminate\Support\Facades\Hash;

$service = app(PasswordResetService::class);

$pass = 0;
$fail = 0;
$check = function (string $label, bool $ok) use (&$pass, &$fail) {
    if ($ok) {
        $pass++;
        echo "  PASS  {$label}\n";
    } else {
        $fail++;
        echo "  FAIL  {$label}\n";
    }
};

$email = 'token-probe@hiraya.test';
User::where('email', $email)->delete();
$user = User::create([
    'full_name' => 'Token Probe',
    'email' => $email,
    'password' => Hash::make('original-password-123'),
    'role' => 'user',
]);

// Mint a token exactly as sendResetLink() does, without touching the mailer.
$reflect = new ReflectionClass($service);
$build = $reflect->getMethod('buildToken');
$build->setAccessible(true);

$token = $build->invoke(
    $service,
    $email,
    $user->password,
    now()->addMinutes(PasswordResetService::TTL_MINUTES)->timestamp
);

echo "\nTOKEN LIFECYCLE\n" . str_repeat('=', 52) . "\n";

echo "\n1. A FRESH TOKEN WORKS\n";
$check('validates for its own address', $service->tokenIsValid($email, $token));

echo "\n2. IT IS BOUND TO ONE ACCOUNT AND ONE VALUE\n";
$check('rejected for a different address', !$service->tokenIsValid('other@hiraya.test', $token));
$check('rejected when the signature is tampered with', !$service->tokenIsValid($email, $token . 'x'));

$parts = explode('.', $token);
$parts[0][3] = $parts[0][3] === 'A' ? 'B' : 'A';
$check('rejected when the payload is tampered with', !$service->tokenIsValid($email, implode('.', $parts)));

echo "\n3. IT EXPIRES\n";
$expired = $build->invoke($service, $email, $user->password, now()->subMinute()->timestamp);
$check('an expired token is rejected', !$service->tokenIsValid($email, $expired));

echo "\n4. IT WORKS EXACTLY ONCE\n";
$newPassword = 'brand-new-password-456';
$check('reset accepted', $service->resetPassword($email, $token, $newPassword));
$check('the new password is stored HASHED', Hash::check($newPassword, $user->fresh()->password));
$check('the same token cannot be replayed', !$service->tokenIsValid($email, $token));

echo "\n5. A RESET KILLS EVERY OTHER OUTSTANDING LINK\n";
$stale = $build->invoke($service, $email, $user->fresh()->password, now()->addMinutes(60)->timestamp);
$check('a token minted against the OLD hash is dead', !$service->tokenIsValid($email, $token));
$check('a token minted against the NEW hash works', $service->tokenIsValid($email, $stale));

echo "\n6. UNKNOWN ADDRESSES DO NOT LEAK\n";
$check('sendResetLink returns null for an unknown address', $service->sendResetLink('nobody@nowhere.test') === null);

echo "\n" . str_repeat('=', 52) . "\n";
echo "  {$pass} passed, {$fail} failed\n\n";

User::where('email', $email)->delete();

exit($fail === 0 ? 0 : 1);