<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Notifications\OrderStatusChanged;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AdminOrderController extends Controller
{
    /**
     * GET /api/admin/orders
     *
     * Lists all orders for the admin order management screen.
     * Supports optional ?payment_status= and ?order_status= filters.
     */
    public function index(Request $request)
    {
        $query = Order::query();

        if ($request->filled('payment_status')) {
            $query->where('payment_status', $request->input('payment_status'));
        }

        if ($request->filled('order_status')) {
            $query->where('order_status', $request->input('order_status'));
        }

        /*
         * `?count_only=1` returns just the matching total.
         *
         * The admin dashboard only needs "how many orders are pending" for its
         * badge, but it used to request the full unpaginated list (with every
         * order's user and line items eager-loaded) and then read `.length`. On
         * the single-threaded dev server that needlessly heavy hydration queued
         * the dashboard's other mount-time calls behind it until they tripped the
         * client's 15s timeout. A COUNT is one cheap aggregate by comparison.
         */
        if ($request->boolean('count_only')) {
            return response()->json(['count' => $query->count()]);
        }

        /*
         * Ordering/eager-loading is applied only to the real list response so the
         * count path never pays for joins it does not use.
         */
        return response()->json(
            $query->with(['user:id,full_name,email', 'orderItems'])->latest()->get()
        );
    }

    /**
     * GET /api/admin/orders/{order}
     */
    public function show(Order $order)
    {
        return response()->json($order->load(['user:id,full_name,email', 'orderItems']));
    }

    /**
     * PATCH /api/admin/orders/{order}/approve-dp
     *
     * Step 1 of the 2-step flow: admin verifies the uploaded 50% down payment
     * proof and marks the order as secured. Moves the order into processing.
     */
    public function approveDownPayment(Order $order)
    {
        if ($order->payment_status !== 'pending') {
            return response()->json([
                'message' => 'This order has already moved past down payment verification.',
            ], 422);
        }

        if (empty($order->dp_proof_image_path)) {
            return response()->json([
                'message' => 'No down payment proof was uploaded for this order.',
            ], 422);
        }

        $order->update([
            'payment_status'   => '50_paid',
            'order_status'     => 'processing',
            'rejection_reason' => null,
        ]);

        $this->notifyCustomer(
            $order,
            '50% Down Payment Approved',
            'Your down payment has been verified and your order is now being prepared. Please settle the remaining balance of ₱' . number_format((float) $order->balance_amount, 2) . ' before shipping.'
        );

        return response()->json([
            'message' => 'Down payment verified. Order is now secured and processing.',
            'order'   => $order->fresh(),
        ]);
    }

    /**
     * PATCH /api/admin/orders/{order}/reject-dp
     *
     * The missing counterpart to approveDownPayment(): turns down a blurry,
     * wrong or fraudulent down-payment proof instead of leaving the order
     * stuck in `pending` forever. The customer receives the reason and can
     * re-upload a corrected proof.
     */
    public function rejectDownPayment(Request $request, Order $order)
    {
        $validated = $request->validate([
            'rejection_reason' => 'required|string|max:500',
        ]);

        try {
            DB::transaction(function () use ($order, $validated) {
                // Re-read + lock the order so two admins (or a reject racing an
                // approve) cannot both pass the guard and double-release stock.
                $locked = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();

                if ($locked->payment_status !== 'pending') {
                    throw new \RuntimeException(
                        'Only orders awaiting down payment verification can be rejected.'
                    );
                }

                $locked->update([
                    'payment_status'   => 'rejected',
                    'rejection_reason' => $validated['rejection_reason'],
                ]);

                // Option A: stock was reserved at checkout, so a rejection must
                // return every line item's units to inventory.
                $this->restoreStock($locked);
            });

            $this->notifyCustomer(
                $order->fresh(),
                'Down Payment Needs Attention',
                'We could not verify your down payment for order #' . $order->id . '. Reason: ' . $validated['rejection_reason'] . ' Please re-upload a clear proof of payment on your orders page.'
            );

            return response()->json([
                'message' => 'Down payment rejected. The customer has been asked to re-upload.',
                'order'   => $order->fresh()->load('orderItems'),
            ]);

        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);

        } catch (\Throwable $e) {
            Log::error('Reject Down Payment Error: ' . $e->getMessage());

            return response()->json([
                'message' => 'Failed to reject the down payment.',
            ], 500);
        }
    }

    /**
     * Returns every unit on a rejected order back to inventory.
     *
     * Best-effort for legacy orders: a pre-order_items order has no lines, so
     * there is nothing to restore and the loop simply does not run — the
     * rejection still succeeds.
     */
    private function restoreStock(Order $order): void
    {
        $order->loadMissing('orderItems');

        foreach ($order->orderItems as $item) {
            if (! $item->product_id) {
                continue; // product was deleted; nothing to credit back.
            }

            $product = Product::whereKey($item->product_id)->lockForUpdate()->first();

            if (! $product) {
                continue;
            }

            $qty = (int) $item->quantity;
            $size = $item->selected_size;

            $sizeStocks = $product->size_stocks;
            if (is_string($sizeStocks)) {
                $sizeStocks = json_decode($sizeStocks, true) ?: [];
            }

            if ($size && is_array($sizeStocks) && array_key_exists($size, $sizeStocks)) {
                $sizeStocks[$size] = (int) $sizeStocks[$size] + $qty;
                $product->size_stocks = $sizeStocks;
            }

            $product->stock = (int) $product->stock + $qty;
            $product->save();
        }
    }

    /**
     * PATCH /api/admin/orders/{order}/confirm-full-payment
     *
     * Step 2 of the 2-step flow: admin verifies the remaining balance proof
     * and marks the order fully paid, ready to be shipped.
     */
    public function confirmFullPayment(Request $request, Order $order)
    {
        $validated = $request->validate([
            'full_payment_proof_image' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
        ]);

        if ($order->payment_status !== '50_paid') {
            return response()->json([
                'message' => 'The 50% down payment must be verified before confirming the full payment.',
            ], 422);
        }

        try {
            DB::transaction(function () use ($request, $order) {
                $path = $request->file('full_payment_proof_image')
                    ->store('orders/full-payment-proofs', 'public');

                $order->update([
                    'payment_status' => 'fully_paid',
                    'order_status' => 'ready_for_shipping',
                    'full_payment_proof_image_path' => $path,
                ]);
            });

            $this->notifyCustomer(
                $order,
                'Full Payment Confirmed',
                'Your remaining balance has been confirmed. Order #' . $order->id . ' is now ready for shipping.'
            );

            return response()->json([
                'message' => 'Full payment confirmed. Order is ready for shipping.',
                'order'   => $order->fresh(),
            ]);

        } catch (\Throwable $e) {
            Log::error('Confirm Full Payment Error: ' . $e->getMessage());

            return response()->json([
                'message' => 'Failed to confirm full payment.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * PATCH /api/admin/orders/{order}/status
     *
     * Manually advances the order status (e.g. mark as shipped once the
     * Lalamove booking or LBC tracking number is on hand).
     */
    public function updateStatus(Request $request, Order $order)
    {
        $validated = $request->validate([
            'order_status' => 'required|in:pending,processing,ready_for_shipping,shipped',
        ]);

            $order->update(['order_status' => $validated['order_status']]);

            if ($validated['order_status'] === 'shipped') {
                $this->notifyCustomer(
                    $order,
                    'Order Shipped',
                    'Good news — order #' . $order->id . ' has been shipped. Your courier details are on your orders page.'
                );
            }

            return response()->json([
                'message' => 'Order status updated.',
                'order'   => $order->fresh(),
            ]);
        }

    /**
     * PATCH /api/admin/orders/{order}/tracking
     *
     * Stores the Lalamove booking details or the LBC tracking number.
     */
    public function updateTracking(Request $request, Order $order)
    {
        $validated = $request->validate([
            'tracking_booking_details' => 'required|string|max:255',
        ]);

                $order->update([
                    'tracking_booking_details' => $validated['tracking_booking_details'],
                ]);

                $label = $order->courier === 'lalamove' ? 'Lalamove booking' : 'LBC tracking number';

                $this->notifyCustomer(
                    $order,
                    'Shipping Details Added',
                    'Your ' . $label . ' is now available: ' . $validated['tracking_booking_details']
                );

                return response()->json([
                    'message' => 'Tracking / booking details saved.',
                    'order'   => $order->fresh(),
                ]);
            }

            /**
             * Sends the in-app + email notification to the order's owner.
             * Orders created without a user_id (guest) are skipped safely.
             */
            private function notifyCustomer(Order $order, string $title, string $body): void
            {
                try {
                    $order->loadMissing('user');

                    if ($order->user) {
                        $order->user->notify(new OrderStatusChanged($order, $title, $body));
                    }
                } catch (\Throwable $e) {
                    // A notification failure must never block the admin's status change.
                    Log::error('Order notification failed: ' . $e->getMessage());
                }
            }
        }
