<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
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
                ->with('orderItems')
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

        return response()->json($order->load('orderItems'));
    }

    /**
     * POST /api/orders/{order}/pay-balance
     *
     * Step 2 from the customer's side: once the 50% down payment has been
     * verified, the customer uploads proof of the remaining balance.
     * The admin still confirms it before the order becomes ready to ship.
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

        $validated = $request->validate([
            'full_payment_proof_image' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
            'balance_reference_number' => 'required|string|min:4|max:64',
        ]);

        if (Order::referenceInUse($validated['balance_reference_number'], $order->id)
            || strcasecmp(trim((string) $order->dp_reference_number), trim($validated['balance_reference_number'])) === 0) {
            return response()->json([
                'message' => 'This reference number was already used for another payment. Please check your receipt.',
                'errors' => ['balance_reference_number' => ['This reference number was already used.']],
            ], 422);
        }

        try {
            DB::transaction(function () use ($request, $order, $validated) {
                $path = $request->file('full_payment_proof_image')
                    ->store('orders/full-payment-proofs', 'public');

                $order->update([
                    'full_payment_proof_image_path' => $path,
                    'balance_reference_number' => trim($validated['balance_reference_number']),
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
     * The recovery path for a rejected down payment: the customer replaces the
     * proof and the order returns to `pending` for a fresh admin review. Only
     * orders in the `rejected` state can use this, so a proof already under
     * review cannot be silently swapped.
     */
    public function reuploadDownPayment(Request $request, Order $order)
    {
        if ((int) $order->user_id !== (int) $request->user()->id) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        if ($order->payment_status !== 'rejected') {
            return response()->json([
                'message' => 'You can only re-upload a down payment proof for an order that was rejected.',
            ], 422);
        }

        $validated = $request->validate([
            'dp_proof_image' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
            'dp_reference_number' => 'required|string|min:4|max:64',
        ]);

        if (Order::referenceInUse($validated['dp_reference_number'], $order->id)) {
            return response()->json([
                'message' => 'This reference number was already used for another payment. Please check your receipt.',
                'errors' => ['dp_reference_number' => ['This reference number was already used.']],
            ], 422);
        }

        try {
            DB::transaction(function () use ($request, $order, $validated) {
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

                $path = $request->file('dp_proof_image')
                    ->store('orders/dp-proofs', 'public');

                $order->update([
                    'dp_proof_image_path' => $path,
                    'dp_reference_number' => trim($validated['dp_reference_number']),
                    'dp_submitted_at'     => now(),
                    'payment_status'      => 'pending',
                    'rejection_reason'    => null,
                ]);
            });

            return response()->json([
                'message' => 'Down payment proof re-submitted. Waiting for admin verification.',
                'order' => $order->fresh(),
            ]);

        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);

        } catch (\Throwable $e) {
            Log::error('Reupload DP Error: ' . $e->getMessage());

            return response()->json([
                'message' => 'Failed to re-submit your down payment proof.',
            ], 500);
        }
    }
}
