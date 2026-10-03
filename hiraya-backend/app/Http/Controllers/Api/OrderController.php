<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ReceiptStorage;
use App\Models\Order;
use App\Models\Product;
use App\Services\ReceiptInspector;
use App\Support\ProductVariants;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class OrderController extends Controller
{
    /**
     * GET /api/orders
     *
     * The signed-in customer's own order history, newest first.
     * Used by the MyOrders tracking page.
     */
    public function index(Request $request)
    {
        try {
            $orders = Order::where('user_id', $request->user()->id)
                ->with('orderItems.product')
                ->latest()
                ->get();

            return response()->json($orders);
        } catch (\Throwable $e) {
            // Never let an eager-load / serialization problem surface as an
            // opaque 500 in the customer dashboard; return an empty history
            // and log the real cause for the developer.
            Log::error('Order Index Error: ' . $e->getMessage());

            return response()->json([]);
        }
    }

    /**
     * GET /api/orders/{order}
     *
     * A single order, scoped to its owner so customers cannot read
     * somebody else's order by guessing an id.
     */
    public function show(Request $request, Order $order)
    {
        if ((int) $order->user_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        return response()->json($order->load('orderItems.product'));
    }

    /**
     * POST /api/orders/{order}/pay-balance
     *
     * LEGACY ONLY. New orders are paid in full at checkout, so they never reach
     * `50_paid`. This stays so a HISTORICAL 50/50 order that is still waiting for
     * its balance can be completed. The customer-facing reference number was
     * removed; the receipt goes through the same file-safety and duplicate checks
     * as checkout.
     */
    public function payBalance(Request $request, Order $order)
    {
        if ((int) $order->user_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        if ($order->payment_status !== '50_paid') {
            return response()->json([
                'message' => 'The remaining balance can only be paid after the 50% down payment is verified.',
            ], 422);
        }

        $request->validate([
            'full_payment_proof_image' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
        ]);

        $inspector = app(ReceiptInspector::class);
        if ($reason = $inspector->rejectReason($request->file('full_payment_proof_image'))) {
            return response()->json(['message' => $reason, 'errors' => ['full_payment_proof_image' => [$reason]]], 422);
        }
        $fingerprints = $inspector->fingerprints($request->file('full_payment_proof_image'));
        if ($inspector->exactDuplicateOf($fingerprints['sha256'], $order->id) || $fingerprints['sha256'] === $order->receipt_sha256) {
            $message = 'This receipt was already submitted. Please upload the receipt for the remaining balance.';

            return response()->json(['message' => $message, 'errors' => ['full_payment_proof_image' => [$message]]], 422);
        }

        try {
            DB::transaction(function () use ($request, $order) {
                $path = ReceiptStorage::store($request->file('full_payment_proof_image'), 'full-payment-proofs');

                $order->update([
                    'full_payment_proof_image_path' => $path,
                    'balance_proof_submitted_at' => now(),
                ]);
            });

            return response()->json([
                'message' => 'Balance payment submitted. Waiting for admin confirmation.',
                'order' => $order->fresh(),
            ]);

        } catch (\Throwable $e) {
            Log::error('Pay Balance Error: ' . $e->getMessage());

            return response()->json([
                'message' => 'Failed to submit balance payment.',
            ], 500);
        }
    }

    /**
     * POST /api/orders/{order}/lalamove-booking
     *
     * Order Guidelines §4: for Lalamove the CLIENT books the courier and sends
     * the booking/tracking details. Allowed once the order is fully paid (§3 —
     * nothing ships before that) and until it is delivered.
     */
    public function submitLalamoveBooking(Request $request, Order $order)
    {
        if ((int) $order->user_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        if ($order->courier !== 'lalamove') {
            return response()->json(['message' => 'Booking details are only sent by the customer for Lalamove orders.'], 422);
        }

        if ($order->payment_status !== 'fully_paid' || in_array($order->order_status, ['rejected', 'delivered'], true)) {
            return response()->json([
                'message' => 'Book your Lalamove rider after your full payment is confirmed.',
            ], 422);
        }

        $validated = $request->validate([
            'tracking_booking_details' => 'required|string|min:4|max:255',
        ]);

        $order->update(['tracking_booking_details' => trim($validated['tracking_booking_details'])]);

        return response()->json([
            'message' => 'Lalamove booking details sent to the store.',
            'order' => $order->fresh(),
        ]);
    }

    /**
     * POST /api/orders/{order}/reupload-dp
     *
     * The recovery path for a payment whose verification FAILED: the customer
     * replaces the receipt and the order returns to `pending` (Pending
     * Verification) for a fresh staff check. Only `rejected` orders can use
     * this, so a receipt already under review cannot be silently swapped.
     */
    public function reuploadDownPayment(Request $request, Order $order)
    {
        if ((int) $order->user_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        if ($order->payment_status !== 'rejected') {
            return response()->json([
                'message' => 'You can only upload a new receipt for an order whose payment verification failed.',
            ], 422);
        }

        $request->validate([
            'dp_proof_image' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
        ]);

        $inspector = app(ReceiptInspector::class);
        if ($reason = $inspector->rejectReason($request->file('dp_proof_image'))) {
            return response()->json(['message' => $reason, 'errors' => ['dp_proof_image' => [$reason]]], 422);
        }
        $fingerprints = $inspector->fingerprints($request->file('dp_proof_image'));
        if ($inspector->exactDuplicateOf($fingerprints['sha256'], $order->id) || $fingerprints['sha256'] === $order->receipt_sha256) {
            $message = 'This is the same receipt that could not be verified, or one already used for another order. Please upload the correct receipt.';

            return response()->json(['message' => $message, 'errors' => ['dp_proof_image' => [$message]]], 422);
        }

        try {
            DB::transaction(function () use ($request, $order, $fingerprints) {
                /*
                 * RE-RESERVE THE STOCK. Rejecting the down payment returned every
                 * unit to inventory, so putting the order back in the queue
                 * without taking them again let an approved order ship stock it
                 * no longer held — and a second rejection credited it twice.
                 */
                $order->loadMissing('orderItems');
                foreach ($order->orderItems as $item) {
                    $product = $item->product_id
                        ? Product::whereKey($item->product_id)->lockForUpdate()->first()
                        : null;
                    if (! $product) {
                        throw new \RuntimeException('An item in this order is no longer sold. Please contact Hiraya support.');
                    }
                    if (ProductVariants::available($product, $item->selected_size, $item->selected_color) < (int) $item->quantity) {
                        throw new \RuntimeException($product->name . ' (size ' . $item->selected_size . ') is no longer in stock. Please contact Hiraya support.');
                    }
                    ProductVariants::adjust($product, $item->selected_size, $item->selected_color, -(int) $item->quantity);
                }

                $path = ReceiptStorage::store($request->file('dp_proof_image'), 'dp-proofs');

                $order->update([
                    'dp_proof_image_path' => $path,
                    'dp_submitted_at'     => now(),
                    'payment_status'      => 'pending',
                    'rejection_reason'    => null,
                    'receipt_sha256'      => $fingerprints['sha256'],
                    'receipt_phash'       => $fingerprints['phash'],
                    'receipt_risk_level'  => null,
                    'receipt_analysis'    => null,
                ]);
            });

            $orderId = $order->id;
            dispatch(fn () => app(ReceiptInspector::class)->analyseAndStore($orderId))->afterResponse();

            return response()->json([
                'message' => 'New receipt submitted. Your payment is pending verification.',
                'order' => $order->fresh(),
            ]);

        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);

        } catch (\Throwable $e) {
            Log::error('Reupload DP Error: ' . $e->getMessage());

            return response()->json([
                'message' => 'Failed to submit your new receipt.',
            ], 500);
        }
    }
}
