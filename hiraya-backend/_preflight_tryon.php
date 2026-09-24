<?php
/**
 * Environment pre-flight for running the Virtual Try-On flow for real:
 * DB reachability, a login-able user, and the Style Stack garment assets.
 */

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Product;
use App\Models\TryOnSession;
use App\Models\User;

try {
    echo 'DB: ' . DB::connection()->getPdo()->query('select 1')->fetchColumn() . PHP_EOL;
} catch (\Throwable $e) {
    echo 'DB ERROR: ' . $e->getMessage() . PHP_EOL;
}

echo 'users: ' . User::count() . PHP_EOL;
foreach (User::take(6)->get() as $u) {
    echo '  #' . $u->id . ' ' . $u->email
        . ' | admin=' . var_export($u->is_admin ?? null, true)
        . ' | verified=' . var_export($u->email_verified_at !== null, true) . PHP_EOL;
}

echo 'products: ' . Product::count() . PHP_EOL;
foreach (Product::take(6)->get() as $p) {
    echo '  #' . $p->id . ' ' . ($p->name ?? '?')
        . ' | cat=' . ($p->category ?? '?')
        . ' | ghost=' . (strlen((string) ($p->ghost_mannequin_url ?? '')) > 0 ? 'yes' : 'NO')
        . ' | img=' . (strlen((string) ($p->image_url ?? '')) > 0 ? 'yes' : 'NO') . PHP_EOL;
    echo '      ghost: ' . substr((string) $p->ghost_mannequin_url, 0, 110) . PHP_EOL;
}

echo 'try_on_sessions: ' . TryOnSession::count() . PHP_EOL;
