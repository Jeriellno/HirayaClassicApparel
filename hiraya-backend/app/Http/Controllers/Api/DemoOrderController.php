<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\WritesAuditTrail;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * DEMO ORDERS — for presenting the payment flow (e.g. a capstone defense).
 *
 * A demo order is a REAL order row walking the REAL admin flow (verify down
 * payment -> confirm balance -> tracking -> shipped -> delivered), so what the
 * panel sees is exactly what a customer order does. Only the customer's two
 * uploads are simulated:
 *
 *   POST   /admin/orders/demo                    a new order from "Demo Customer",
 *                                                with a generated 50% receipt,
 *                                                waiting for down-payment review
 *   POST   /admin/orders/{order}/demo-balance    the customer's balance receipt
 *   DELETE /admin/orders/demo                    remove every demo order
 *
 * Demo orders carry `is_demo`: they never touch stock, are excluded from the
 * dashboard analytics, and the console badges them. The demo customer's email
 * is the shop's own inbox (+demo alias), so the customer e-mails the flow sends
 * can be shown live too.
 */
class DemoOrderController extends Controller
{
    use WritesAuditTrail;

    public function store(Request $request): JsonResponse
    {
        $product = Product::query()->where('stock', '>', 0)->inRandomOrder()->first()
            ?? Product::query()->first();
        if (!$product) {
            return response()->json(['message' => 'Add at least one product before creating a demo order.'], 422);
        }

        $customer = $this->demoCustomer();
        $size = collect(is_array($product->sizes) ? $product->sizes : [])->first() ?: 'M';
        $total = round((float) $product->price, 2);
        $dp = round($total / 2, 2);

        $order = DB::transaction(function () use ($customer, $product, $size, $total, $dp) {
            $order = Order::create([
                'user_id' => $customer->id,
                'total_amount' => $total,
                'dp_amount' => $dp,
                'balance_amount' => round($total - $dp, 2),
                'payment_status' => 'pending',
                'order_status' => 'pending',
                'courier' => 'lbc',
                'customer_name' => $customer->full_name,
                'contact_number' => '09170000000',
                'delivery_address' => '123 Demo Street, Barangay Sample, Quezon City, Metro Manila',
                'dp_proof_image_path' => $this->receipt('DOWN PAYMENT (50%)', $dp, 'orders/dp-proofs'),
                'dp_reference_number' => 'DEMO-' . strtoupper(Str::random(8)),
                'dp_submitted_at' => now(),
            ]);
            $order->forceFill(['is_demo' => true])->save();

            OrderItem::create([
                'order_id' => $order->id,
                'product_id' => $product->id,
                'product_name_snapshot' => $product->name,
                'selected_size' => $size,
                'selected_color' => collect(is_array($product->colors) ? $product->colors : [])->first(),
                'quantity' => 1,
                'unit_price' => $total,
                'line_total' => $total,
            ]);

            return $order;
        });

        $this->writeAudit($request, 'CREATE_DEMO_ORDER', 'ORDERS', "Demo order #{$order->id} ({$product->name}, ₱" . number_format($total, 2) . ') created for a presentation.');

        return response()->json([
            'message' => "Demo order #{$order->id} created — it is waiting for down-payment verification.",
            'order' => $order->fresh()->load(['user:id,full_name,email', 'orderItems.product']),
        ], 201);
    }

    /** Simulates the customer uploading the balance receipt. */
    public function simulateBalance(Request $request, Order $order): JsonResponse
    {
        if (!$order->is_demo) {
            return response()->json(['message' => 'Only demo orders can simulate a customer upload.'], 422);
        }
        if ($order->payment_status !== '50_paid') {
            return response()->json(['message' => 'Verify the down payment first; the customer pays the balance after that.'], 422);
        }
        if ($order->full_payment_proof_image_path) {
            return response()->json(['message' => 'The balance receipt was already uploaded.'], 422);
        }

        $order->update([
            'full_payment_proof_image_path' => $this->receipt('REMAINING BALANCE', (float) $order->balance_amount, 'orders/full-payment-proofs'),
            'balance_reference_number' => 'DEMO-' . strtoupper(Str::random(8)),
            'balance_proof_submitted_at' => now(),
        ]);

        return response()->json([
            'message' => 'The demo customer uploaded the balance receipt. You can now confirm the full payment.',
            'order' => $order->fresh()->load(['user:id,full_name,email', 'orderItems.product']),
        ]);
    }

    public function destroyAll(Request $request): JsonResponse
    {
        $orders = Order::query()->where('is_demo', true)->get();
        foreach ($orders as $order) {
            foreach (['dp_proof_image_path', 'full_payment_proof_image_path'] as $column) {
                if ($order->{$column}) {
                    \App\Support\ReceiptStorage::delete($order->{$column});
                }
            }
        }
        $ids = $orders->pluck('id');
        DB::transaction(function () use ($ids) {
            OrderItem::whereIn('order_id', $ids)->delete();
            DB::table('product_reviews')->whereIn('order_id', $ids)->delete();
            Order::whereIn('id', $ids)->delete();
        });

        $demo = User::where('email', $this->demoEmail())->first();
        $demo?->notifications()->delete();

        $this->writeAudit($request, 'CLEAR_DEMO_ORDERS', 'ORDERS', 'Removed ' . $ids->count() . ' demo order(s).');

        return response()->json(['message' => 'Removed ' . $ids->count() . ' demo order(s).', 'removed' => $ids->count()]);
    }

    private function demoEmail(): string
    {
        $from = (string) config('mail.from.address', 'hirayaclassicapparel@gmail.com');
        [$local, $domain] = array_pad(explode('@', $from, 2), 2, 'example.com');

        return strtolower($local . '+demo@' . $domain);
    }

    /** The one customer account demo orders belong to. It can never sign in. */
    private function demoCustomer(): User
    {
        $user = User::firstOrCreate(
            ['email' => $this->demoEmail()],
            ['full_name' => 'Demo Customer', 'password' => Hash::make(Str::random(48)), 'role' => 'user']
        );

        return $user;
    }

    /** Draws a simple payment receipt image and stores it like a real upload. */
    private function receipt(string $label, float $amount, string $dir): string
    {
        $w = 600;
        $h = 800;
        $img = imagecreatetruecolor($w, $h);
        $white = imagecolorallocate($img, 255, 255, 255);
        $navy = imagecolorallocate($img, 29, 44, 69);
        $gray = imagecolorallocate($img, 120, 120, 120);
        $blue = imagecolorallocate($img, 0, 90, 200);
        imagefilledrectangle($img, 0, 0, $w, $h, $white);
        imagefilledrectangle($img, 0, 0, $w, 120, $blue);
        imagestring($img, 5, 30, 30, 'GCash  -  DEMO RECEIPT', $white);
        imagestring($img, 3, 30, 60, 'For presentation only. No money was sent.', $white);
        imagestring($img, 5, 30, 170, $label, $navy);
        imagestring($img, 5, 30, 220, 'Amount:  PHP ' . number_format($amount, 2), $navy);
        imagestring($img, 4, 30, 270, 'Paid to:  Hiraya Classic Apparel', $gray);
        imagestring($img, 4, 30, 300, 'Date:     ' . now()->format('M d, Y h:i A'), $gray);
        imagestring($img, 4, 30, 330, 'Ref No.:  DEMO' . random_int(100000, 999999), $gray);
        imagestring($img, 5, 30, 720, 'SUCCESSFUL', $blue);
        ob_start();
        imagepng($img);
        $png = ob_get_clean();
        imagedestroy($img);

        // Same private receipts bucket as real orders (see ReceiptStorage).
        return \App\Support\ReceiptStorage::put($png, str_replace('orders/', '', $dir), 'image/png');
    }
}
