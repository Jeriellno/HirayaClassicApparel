<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
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
                'error' => $e->getMessage(),
            ], 500);
        }
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

        try {
            DB::transaction(function () use ($request, $order, $validated) {
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

        } catch (\Throwable $e) {
            Log::error('Reupload DP Error: ' . $e->getMessage());

            return response()->json([
                'message' => 'Failed to re-submit your down payment proof.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
