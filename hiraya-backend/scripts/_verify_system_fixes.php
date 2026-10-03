<?php

/*
 * Verification for the HIRAYA System Fixes (rolled back — touches no live data).
 *
 *   php scripts/_verify_system_fixes.php
 *
 * Runs the two new migrations INSIDE a Postgres transaction, exercises every
 * new backend path, then rolls everything back. Supabase Storage, mail,
 * notifications, queues and Gemini are faked, so nothing leaves the machine.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Order;
use App\Models\Product;
use App\Models\TryOnSession;
use App\Models\User;
use App\Support\RenderVault;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Validator;

$pass = 0;
$fail = 0;
$check = function (string $label, bool $ok, string $extra = '') use (&$pass, &$fail) {
    $ok ? $pass++ : $fail++;
    echo ($ok ? '  PASS ' : '  FAIL ') . $label . ($extra !== '' ? "  [$extra]" : '') . PHP_EOL;
};

// NEVER touch the real cache: faked Supabase calls would otherwise leave
// "bucket ready" flags (and pending sign-ups) behind in the app's file cache.
config(['cache.default' => 'array']);
Illuminate\Support\Facades\Cache::setDefaultDriver('array');

// In-memory Supabase Storage + forced Gemini failure (deterministic fallbacks).
$bucket = [];
Http::fake(function ($request) use (&$bucket) {
    $url = $request->url();
    if (str_contains($url, 'generativelanguage.googleapis.com')) {
        return Http::response(['error' => ['message' => 'faked']], 500);
    }
    if (str_contains($url, '/storage/v1/bucket')) {
        return Http::response(['name' => 'ok'], 200);
    }
    if (preg_match('#/storage/v1/object/(?:authenticated/)?([^?]+)#', $url, $m)) {
        $key = $m[1];
        if ($request->method() === 'POST') {
            $bucket[$key] = $request->body();
            return Http::response(['Key' => $key], 200);
        }
        if ($request->method() === 'GET') {
            return isset($bucket[$key]) ? Http::response($bucket[$key], 200) : Http::response('not found', 404);
        }
        if ($request->method() === 'DELETE') {
            foreach ((array) ($request->data()['prefixes'] ?? []) as $prefix) {
                unset($bucket[preg_replace('#^[^/]+/#', '', $key) === '' ? $prefix : $key . '/' . $prefix]);
                foreach (array_keys($bucket) as $k) {
                    if (str_ends_with($k, '/' . $prefix)) {
                        unset($bucket[$k]);
                    }
                }
            }
            return Http::response([], 200);
        }
    }
    return Http::response([], 200);
});
Mail::fake();
Notification::fake();
Queue::fake();
config(['queue.default' => 'sync']);

$call = function (string $method, string $uri, array $data = [], ?string $token = null, array $files = []) use ($kernel) {
    $server = ['HTTP_ACCEPT' => 'application/json'];
    if ($token) {
        $server['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
    }
    $request = $files
        ? Request::create('/api' . $uri, $method, $data, [], $files, $server)
        : Request::create('/api' . $uri, $method, [], [], [], $server + ['CONTENT_TYPE' => 'application/json'], json_encode($data));
    $response = $kernel->handle($request);
    app('auth')->forgetGuards();

    return [$response->getStatusCode(), json_decode($response->getContent(), true) ?? $response->getContent()];
};

DB::beginTransaction();
try {
    echo "== Migrations (inside the transaction)\n";
    // Only when still pending — re-running the orders one would take a table
    // lock on the live `orders` table for the length of this test.
    if (! Illuminate\Support\Facades\Schema::hasColumn('try_on_sessions', 'render_fingerprint')) {
        (require __DIR__ . '/../database/migrations/2026_10_24_000001_add_private_render_storage_to_try_on_sessions.php')->up();
    }
    if (! Illuminate\Support\Facades\Schema::hasColumn('orders', 'receipt_sha256')) {
        (require __DIR__ . '/../database/migrations/2026_10_24_000002_add_receipt_verification_to_orders.php')->up();
    }
    $check('try_on_sessions.result_image_path + render_fingerprint exist',
        Illuminate\Support\Facades\Schema::hasColumns('try_on_sessions', ['result_image_path', 'render_fingerprint']));
    $check('orders receipt columns exist',
        Illuminate\Support\Facades\Schema::hasColumns('orders', ['receipt_sha256', 'receipt_phash', 'receipt_risk_level', 'receipt_analysis', 'payment_verification_method', 'payment_verified_by']));

    echo "== Password rule\n";
    $v = fn ($pw) => Validator::make(['p' => $pw], ['p' => [new App\Rules\PasswordStrength]])->passes();
    $check('Secret123 (no special char) rejected', ! $v('Secret123'));
    $check('Secret#123 accepted', $v('Secret#123'));

    echo "== Verified-Gmail registration\n";
    $email = 'hiraya.verify.' . random_int(10000, 99999) . '@gmail.com';
    $form = [
        'full_name' => 'Verify Test', 'password' => 'Secret#123', 'password_confirmation' => 'Secret#123',
        'upper_body_size' => 'M', 'lower_body_size' => 'M', 'preferred_fit' => 'regular', 'gender' => 'female',
    ];
    [$s] = $call('POST', '/register', $form + ['email' => 'someone@yahoo.com']);
    $check('non-Gmail address refused (422)', $s === 422);
    [$s, $b] = $call('POST', '/register', $form + ['email' => $email]);
    $check('Gmail sign-up answers 202 verification_required', $s === 202 && ($b['verification_required'] ?? false), (string) $s);
    $check('no account exists before verification', ! User::where('email', $email)->exists());
    $code = null;
    Mail::assertSent(App\Mail\RegistrationCodeMail::class, function ($mail) use ($email, &$code) {
        $code = $mail->code;
        return $mail->email === $email;
    });
    $check('verification code mailed', $code !== null);
    [$s] = $call('POST', '/register/verify', ['email' => $email, 'code' => '000000' === $code ? '111111' : '000000']);
    $check('wrong code refused', $s === 422);
    [$s, $b] = $call('POST', '/register/verify', ['email' => $email, 'code' => $code]);
    $check('correct code creates a verified account + token', $s === 201 && ! empty($b['token']), (string) $s);
    $customer = User::where('email', $email)->first();
    $check('email_verified_at is set', $customer?->email_verified_at !== null);
    $token = $b['token'] ?? null;

    echo "== Private render vault\n";
    $fakeImg = UploadedFile::fake()->image("r.png", 300, 400);
    $png = "data:image/png;base64," . base64_encode(file_get_contents($fakeImg->getRealPath()));
    $path = RenderVault::put($png);
    $stored = $bucket[array_key_last($bucket)] ?? '';
    $check('stored reference is opaque (no user/session id)', str_starts_with($path, 'supabase:renders/') && ! str_contains($path, (string) $customer->id));
    $check('stored object is ciphertext, not the image', $stored !== '' && ! str_contains($stored, 'iVBOR') && ! str_contains($stored, 'data:image'));
    $check('vault read decrypts to the same image', RenderVault::get($path) === $png);

    echo "== Gallery: soft delete, Recently Deleted, restore, permanent delete\n";
    $session = TryOnSession::create([
        'session_id' => 'tryon_test_' . uniqid(), 'user_id' => $customer->id, 'user_photo_base64' => $png,
        'garment_photos_json' => [$png], 'garment_metadata_json' => [['name' => 'Test Shirt', 'category' => 'top', 'product_id' => null]],
        'history_title' => 'Test Shirt', 'measurements_json' => [], 'status' => TryOnSession::STATUS_QUEUED,
    ]);
    $session->markCompleted($png, 'SIZE: M');
    $session->refresh();
    $check('completed render stored as vault ref, Base64 column empty', $session->result_image_path && $session->result_image_base64 === null);
    [$s, $b] = $call('GET', '/tryon/history', [], $token);
    $check('Gallery lists the render', $s === 200 && collect($b['data'] ?? [])->contains('session_id', $session->session_id));
    [$s, $b] = $call('GET', '/tryon/status/' . $session->session_id, [], $token);
    $check('status endpoint returns the decrypted render to its owner', ($b['result_image_base64'] ?? null) === $png);
    [$s] = $call('DELETE', '/tryon/history/' . $session->session_id, [], $token);
    $check('delete = soft delete', $s === 204 && TryOnSession::withTrashed()->find($session->id)?->trashed());
    [$s, $b] = $call('GET', '/tryon/history-trash', [], $token);
    $check('Recently Deleted lists it with days_left', $s === 200 && ($b['data'][0]['session_id'] ?? null) === $session->session_id && isset($b['data'][0]['days_left']));
    [$s] = $call('POST', '/tryon/history/' . $session->session_id . '/restore', [], $token);
    $check('restore puts it back in the Gallery', $s === 200 && ! TryOnSession::find($session->id)?->trashed());

    // Another customer can never touch it.
    $other = User::create(['full_name' => 'Other', 'email' => 'other.' . uniqid() . '@gmail.com', 'password' => bcrypt('Secret#123'), 'role' => 'user']);
    $otherToken = $other->createToken('t')->plainTextToken;
    [$s] = $call('GET', '/tryon/status/' . $session->session_id, [], $otherToken);
    $check('another user cannot read the render (404)', $s === 404);
    [$s] = $call('DELETE', '/tryon/history/' . $session->session_id, [], $otherToken);
    $check('another user cannot delete it (404)', $s === 404);

    echo "== Duplicate render reuse (no new paid render)\n";
    $fingerprintCall = (new ReflectionMethod(App\Http\Controllers\Api\TryOnController::class, 'renderFingerprint'));
    $controller = app(App\Http\Controllers\Api\TryOnController::class);
    // (photo, garments, categories, index-aligned product ids, measurements)
    $fpA = $fingerprintCall->invoke($controller, $png, [$png], ['top'], [1], ['chest_bust' => 90]);
    $fpB = $fingerprintCall->invoke($controller, $png, [$png], ['top'], [1], ['chest_bust' => 90]);
    $fpC = $fingerprintCall->invoke($controller, $png, [$png], ['top'], [2], ['chest_bust' => 90]);
    $check('same inputs -> same fingerprint', $fpA === $fpB);
    $check('different garment -> different fingerprint', $fpA !== $fpC);
    $session->forceFill(['render_fingerprint' => $fpA])->save();
    $reuse = (new ReflectionMethod(App\Http\Controllers\Api\TryOnController::class, 'reusableRender'));
    $resp = $reuse->invoke($controller, $customer->id, $fpA);
    $data = $resp?->getData(true) ?? [];
    $check('identical request returns the saved render (reused, no dispatch)', ($data['reused'] ?? false) && ($data['result_image_base64'] ?? null) === $png);
    $check('other user gets no reuse for the same fingerprint', $reuse->invoke($controller, $other->id, $fpA) === null);
    Queue::assertNothingPushed();
    $session->delete();
    $resp = $reuse->invoke($controller, $customer->id, $fpA);
    $check('reuse from Recently Deleted restores it', ($resp?->getData(true)['restored_from_trash'] ?? false) && ! $session->fresh()->trashed());

    $session->delete();
    $objects = count($bucket);
    [$s] = $call('DELETE', '/tryon/history/' . $session->session_id . '/permanent', [], $token);
    $check('permanent delete removes the row', $s === 204 && TryOnSession::withTrashed()->find($session->id) === null);
    echo "    (note: the vault object delete runs after commit; verified separately below)\n";

    echo "== Stylist chat: cards only when relevant\n";
    [$s, $b] = $call('POST', '/tryon/chat', ['message' => 'hello'], $token);
    $check('greeting has no recommendation cards', $s === 200 && empty($b['products']), (string) $s);
    [$s, $b] = $call('POST', '/tryon/chat', ['message' => 'what is the capital of France?'], $token);
    $check('off-topic question stays in scope, no cards', $s === 200 && empty($b['products']) && str_contains($b['reply'], 'HIRAYA'));
    [$s, $b] = $call('POST', '/tryon/chat', ['message' => 'Analyze my rendered look', 'context' => ['mode' => 'look_analysis', 'has_generated_image' => true, 'selected_garments' => ['Test Shirt']]], $token);
    $check('look analysis answers without leading on matched size', $s === 200 && ($b['intent'] ?? '') === 'look_analysis' && ! str_contains(strtolower($b['reply']), 'recommended size'));

    echo "== Full payment checkout + receipt protection\n";
    $product = Product::query()->where('stock', '>', 0)->first();
    if ($product) {
        $receipt = UploadedFile::fake()->image('receipt.png', 400, 800);
        $form = [
            'courier' => 'lbc', 'customer_name' => 'Verify Test', 'contact_number' => '09171234567',
            'address_line' => '12 Test St', 'barangay' => 'San Roque', 'city' => 'Marikina', 'province' => 'Metro Manila', 'postal_code' => '1801',
            'product_id' => $product->id, 'quantity' => 1, 'size' => collect($product->sizes ?: ['M'])->first(),
        ];
        [$s] = $call('POST', '/checkout', $form + ['payment_option' => 'down_payment'], $token, ['dp_proof_image' => $receipt]);
        $check('50% down payment option refused', $s === 422);
        [$s, $b] = $call('POST', '/checkout', $form, $token, ['dp_proof_image' => $receipt]);
        $order = isset($b['order']['id']) ? Order::find($b['order']['id']) : null;
        $check('checkout creates a FULL payment order (no reference number needed)', $s === 201 && $order
            && (float) $order->dp_amount === (float) $order->total_amount && (float) $order->balance_amount === 0.0, json_encode($b['message'] ?? $s));
        $check('receipt fingerprinted, stored privately', $order && $order->receipt_sha256 && str_starts_with((string) $order->dp_proof_image_path, 'supabase:receipts/'));
        $check('customer JSON hides receipt analysis / internal ref', ! array_key_exists('receipt_analysis', $b['order'] ?? []) && ! array_key_exists('dp_reference_number', $b['order'] ?? []));
        [$s] = $call('POST', '/checkout', $form, $token, ['dp_proof_image' => new UploadedFile($receipt->getRealPath(), 'receipt.png', 'image/png', null, true)]);
        $check('same receipt cannot be reused on another order', $s === 422);
        $bad = UploadedFile::fake()->createWithContent('evil.png', "\x89PNG<?php echo 1;");
        [$s] = $call('POST', '/checkout', $form, $token, ['dp_proof_image' => $bad]);
        $check('non-image / script payload refused', $s === 422);

        app(App\Services\ReceiptInspector::class)->analyseAndStore($order->id);
        $order->refresh();
        $check('advisory risk signal stored (Gemini unavailable -> flagged for manual check)', in_array($order->receipt_risk_level, ['low', 'medium', 'high'], true) && $order->payment_status === 'pending');

        echo "== Staff verification (controller, admin user)\n";
        $admin = User::whereIn('role', ['admin', 'superadmin'])->first();
        $req = Request::create('/api/admin/orders/' . $order->id . '/approve-dp', 'PATCH', []);
        app()->instance('request', $req);
        $req->setUserResolver(fn () => $admin);
        $ctl = app(App\Http\Controllers\Api\AdminOrderController::class);
        try {
            $ctl->approveDownPayment($req, $order);
            $check('approval without a trusted record is refused', false);
        } catch (Illuminate\Validation\ValidationException $e) {
            $check('approval without a trusted record is refused', true);
        }
        $order->forceFill(['receipt_risk_level' => 'high'])->save();
        $req = Request::create('/x', 'PATCH', ['verification_method' => 'gcash_history', 'payment_confirmed_in_record' => true]);
        app()->instance('request', $req);
        $req->setUserResolver(fn () => $admin);
        $r = $ctl->approveDownPayment($req, $order->fresh());
        $check('high-risk receipt needs explicit acknowledgement', $r->getStatusCode() === 422);
        $req = Request::create('/x', 'PATCH', ['verification_method' => 'gcash_history', 'payment_confirmed_in_record' => true, 'risk_acknowledged' => true, 'transaction_reference' => 'TXN-' . uniqid()]);
        app()->instance('request', $req);
        $req->setUserResolver(fn () => $admin);
        $r = $ctl->approveDownPayment($req, $order->fresh());
        $order->refresh();
        $check('verified against trusted record -> fully_paid', $r->getStatusCode() === 200 && $order->payment_status === 'fully_paid' && $order->payment_verification_method === 'gcash_history');
        $check('audit trail entry written', App\Models\AuditLog::where('action', 'APPROVE_FULL_PAYMENT')->where('details', 'like', '%#' . $order->id . '%')->exists());

        echo "== Delete account\n";
        [$s, $b] = $call('DELETE', '/user/account', ['password' => 'Secret#123'], $token);
        $check('blocked while an order is in progress (409, clear message)', $s === 409 && str_contains($b['message'] ?? '', 'in progress'));
        $order->forceFill(['order_status' => 'delivered'])->save();
    } else {
        echo "  SKIP checkout tests (no product with stock)\n";
    }
    [$s, $b] = $call('DELETE', '/user/account', ['password' => 'wrong'], $token);
    $check('wrong password refused', $s === 422);
    [$s, $b] = $call('DELETE', '/user/account', ['password' => 'Secret#123'], $token);
    $check('account deleted (deleted:true)', $s === 200 && ($b['deleted'] ?? false) && ! User::whereKey($customer->id)->exists());
    $check('orders kept with user_id nulled', ! isset($order) || Order::whereKey($order->id)->whereNull('user_id')->exists());
    [$s] = $call('GET', '/user', [], $token);
    $check('old session token no longer works', $s === 401);

    echo "== Route permissions\n";
    $routes = collect(app('router')->getRoutes()->getRoutes());
    $mw = fn ($uri, $method) => $routes->first(fn ($r) => $r->uri() === $uri && in_array($method, $r->methods(), true))?->gatherMiddleware() ?? [];
    $check('POST /products is superadmin-only', in_array('superadmin', $mw('api/products', 'POST'), true));
    $check('DELETE /products/{product} is superadmin-only', in_array('superadmin', $mw('api/products/{product}', 'DELETE'), true));
    $check('analyze-image is superadmin-only', in_array('superadmin', $mw('api/products/analyze-image', 'POST'), true));
    $check('stock-adjust stays available to admins', in_array('admin', $mw('api/admin/products/{product}/stock-adjust', 'POST'), true));
    $check('GET /admin/customers is superadmin-only', in_array('superadmin', $mw('api/admin/customers', 'GET'), true));
    $check('admin try-on history routes removed', $routes->first(fn ($r) => str_contains($r->uri(), 'customers/{user}/try-ons')) === null);
} finally {
    DB::rollBack();
}

echo "\n== Vault delete after commit (no DB)\n";
$ref = RenderVault::put('data:image/png;base64,AAAA');
RenderVault::delete($ref);
$check('vault object removed on permanent delete', RenderVault::get($ref) === null);

echo PHP_EOL . "Passed: $pass   Failed: $fail" . PHP_EOL;
