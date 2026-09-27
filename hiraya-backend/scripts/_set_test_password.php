<?php
/**
 * Set a known local password on a test user so the browser QA run can log in.
 * Local QA convenience only — this is not a production path.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use Illuminate\Support\Facades\Schema;

$email = $argv[1] ?? 'ken@hiraya.com';
$password = $argv[2] ?? 'Hiraya2026!';

$user = User::where('email', $email)->first();
if (! $user) {
    echo 'No such user: ' . $email . PHP_EOL;
    exit(1);
}

$user->password = bcrypt($password);
$user->save();

echo 'Updated user #' . $user->id . ' ' . $user->email . ' password -> ' . $password . PHP_EOL;

// Verify the credential the way the login path will, using the configured guard.
echo 'hash verifies: ' . var_export(\Illuminate\Support\Facades\Hash::check($password, $user->fresh()->password), true) . PHP_EOL;

// Report the body measurements the try-on needs, if present.
echo 'measurements: ' . json_encode($user->measurements ?? null) . PHP_EOL;
echo 'user columns: ' . implode(', ', array_slice(Schema::getColumnListing('users'), 0, 40)) . PHP_EOL;