<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\WritesAuditTrail;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Notifications\OrderStatusChanged;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class AdminOrderController extends Controller
{
    use WritesAuditTrail;

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
            $query->with(['user:id,full_name,email', 'orderItems.product'])->latest()->get()
        );
    }

    /**
     * GET /api/admin/orders/{order}
     */
    public function show(Order $order)
    {
        return response()->json($order->load(['user:id,full_name,email', 'orderItems.product']));
    }

    /**
     * GET /api/admin/orders/{order}/proof/{type}   (type: dp | balance)
     *
     * Streams a payment receipt to the admin console. Receipts are financial
     * documents, so they are served only through this admin-gated route instead
     * of a public `/storage/...` URL (which also depends on a `storage:link`
     * symlink that this deployment does not have).
     */
    public function proof(Order $order, string $type)
    {
        $path = match ($type) {
            'dp' => $order->dp_proof_image_path,
            'balance' => $order->full_payment_proof_image_path,
            default => null,
        };

        if (! $path || ! Storage::disk('public')->exists($path)) {
            return response()->json(['message' => 'Payment proof not found.'], 404);
        }

        return Storage::disk('public')->response($path, null, [
            'Cache-Control' => 'private, no-store',
        ]);
    }

    /**
     * PATCH /api/admin/orders/{order}/approve-dp
     *
     * Step 1 of the 2-step flow: admin verifies the uploaded 50% down payment
     * proof and marks the order as secured. Moves the order into processing.
     */
    public function approveDownPayment(Request $request, Order $order)
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

        /*
         * Approving money is the single most consequential thing an admin does in this
         * console, so it is recorded with the amount that was verified. "Payment
         * approved" on its own is not reconstructable later — the proof image is a
         * file that can be replaced — whereas "verified ₱X against the uploaded 50%
         * proof" answers the question the audit log exists to answer.
         */
        $this->writeAudit(
            $request,
            'APPROVE_DOWN_PAYMENT',
            'ORDERS',
            'Verified the 50% down payment of ₱' . number_format((float) $order->dp_amount, 2)
                . ' for order #' . $order->id
                . ($order->dp_reference_number ? ' (ref. ' . $order->dp_reference_number . ')' : '')
                . ', moving it to processing. Balance due: ₱'
                . number_format((float) $order->balance_amount, 2) . '.',
        );

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

            /*
             * A rejection both refuses money AND releases inventory, so the entry
             * records the reason an auditor needs (was the proof wrong, or was the
             * customer suspected?) and notes the stock return that just happened
             * invisibly behind it. Without this, stock movements triggered by an
             * order decision have no origin in the audit trail at all.
             */
            $this->writeAudit(
                $request,
                'REJECT_DOWN_PAYMENT',
                'ORDERS',
                'Rejected the ₱' . number_format((float) $order->dp_amount, 2) . ' down payment for order #'
                    . $order->id . ' and returned its stock to inventory. Reason given: '
                    . $validated['rejection_reason'],
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
        /*
         * The customer normally uploads the balance receipt themselves through
         * POST /orders/{order}/pay-balance, so the admin only confirms it. An
         * admin upload is still accepted for a balance paid outside the app
         * (e.g. the customer sent the receipt over chat), but it is optional.
         */
        $request->validate([
            'full_payment_proof_image' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:5120',
        ]);

        if ($order->payment_status !== '50_paid') {
            return response()->json([
                'message' => 'The 50% down payment must be verified before confirming the full payment.',
            ], 422);
        }

        if (! $request->hasFile('full_payment_proof_image') && empty($order->full_payment_proof_image_path)) {
            return response()->json([
                'message' => 'No balance payment proof has been uploaded for this order yet.',
            ], 422);
        }

        try {
            DB::transaction(function () use ($request, $order) {
                $changes = [
                    'payment_status' => 'fully_paid',
                    'order_status' => 'ready_for_shipping',
                ];

                if ($request->hasFile('full_payment_proof_image')) {
                    $changes['full_payment_proof_image_path'] = $request->file('full_payment_proof_image')
                        ->store('orders/full-payment-proofs', 'public');
                }

                $order->update($changes);
            });

            $this->notifyCustomer(
                $order,
                'Full Payment Confirmed',
                'Your remaining balance has been confirmed. Order #' . $order->id . ' is now ready for shipping.'
            );

            /*
             * Records the balance that was cleared, which together with the
             * APPROVE_DOWN_PAYMENT entry adds up to the order total. That pair is how
             * a later reader can prove the money was accounted for: a fully-paid order
             * with no matching approval and confirmation entries is the shape of
             * fraud, and it is only visible if both halves were written.
             */
            $this->writeAudit(
                $request,
                'CONFIRM_FULL_PAYMENT',
                'ORDERS',
                'Confirmed the ₱' . number_format((float) $order->balance_amount, 2) . ' balance for order #'
                    . $order->id
                    . ($order->balance_reference_number ? ' (ref. ' . $order->balance_reference_number . ')' : '')
                    . ', marking it fully paid (₱'
                    . number_format((float) $order->total_amount, 2) . ' total) and ready for shipping.',
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
     * Manually sets the order status (e.g. mark as shipped once the Lalamove
     * booking or LBC tracking number is on hand, or delivered once it arrives).
     * Used by both the Admin console and the Super Admin order screen.
     *
     * Every change notifies the customer, so their notification bell doubles as
     * an order tracker.
     *
     * `rejected` returns the order's reserved stock to inventory and is final:
     * moving a rejected order back out would need that stock re-reserved, which
     * this endpoint does not do, so it is refused instead of silently
     * over-selling.
     */
    public function updateStatus(Request $request, Order $order)
    {
        $validated = $request->validate([
            'order_status' => 'required|in:pending,processing,ready_for_shipping,shipped,delivered,rejected',
        ]);

        $previousStatus = $order->order_status;
        $newStatus = $validated['order_status'];

        if ($previousStatus === $newStatus) {
            return response()->json([
                'message' => 'Order is already ' . str_replace('_', ' ', $newStatus) . '.',
                'order'   => $order->fresh()->load(['user:id,full_name,email', 'orderItems.product']),
            ]);
        }

        if ($previousStatus === 'rejected') {
            return response()->json([
                'message' => 'This order was rejected and its stock was returned. It can no longer change status.',
            ], 422);
        }

        // Nothing leaves the store unpaid: shipping requires the balance to be
        // confirmed first (confirm-full-payment), not just the 50% down payment.
        if (in_array($newStatus, ['ready_for_shipping', 'shipped', 'delivered'], true)
            && $order->payment_status !== 'fully_paid') {
            return response()->json([
                'message' => 'This order is not fully paid yet. Confirm the full payment before marking it '
                    . str_replace('_', ' ', $newStatus) . '.',
            ], 422);
        }

        try {
            DB::transaction(function () use ($order, $newStatus) {
                $locked = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();

                if ($locked->order_status === 'rejected') {
                    throw new \RuntimeException('This order was already rejected.');
                }

                $locked->update(['order_status' => $newStatus]);

                // A rejected down payment already released the stock
                // (rejectDownPayment), so only credit it back once.
                if ($newStatus === 'rejected' && $locked->payment_status !== 'rejected') {
                    $this->restoreStock($locked);
                }
            });
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            Log::error('Update Order Status Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to update the order status.'], 500);
        }

        $order->refresh();

        /*
         * The status an order is MOVED FROM is the half of the fact that is easy to
         * lose. Reading `->order_status` after `$order->update()` would always yield
         * the new value, so the entry would read "moved to shipped" with no record
         * that it had previously been "ready_for_shipping" — which is exactly what
         * you need when someone skipped a step or back-dated a shipment.
         */
        $this->writeAudit(
            $request,
            'UPDATE_ORDER_STATUS',
            'ORDERS',
            'Order #' . $order->id . ' moved from ' . $previousStatus . ' to ' . $newStatus
                . ($newStatus === 'rejected' ? ' and its stock was returned to inventory' : '') . '.',
        );

        [$title, $body] = $this->statusMessage($order, $newStatus);
        // A delivered order carries the "Review Products" call-to-action.
        $this->notifyCustomer($order, $title, $body, $newStatus === 'delivered' ? 'review_products' : null);

        return response()->json([
            'message' => 'Order status updated.',
            'order'   => $order->load(['user:id,full_name,email', 'orderItems.product']),
        ]);
    }

    /**
     * Customer-facing notification copy for each order status.
     *
     * @return array{0: string, 1: string}
     */
    private function statusMessage(Order $order, string $status): array
    {
        $id = '#' . $order->id;

        return match ($status) {
            'pending' => ['Order Pending', 'Order ' . $id . ' is pending. We will update you as soon as it moves forward.'],
            'processing' => ['Order Processing', 'Order ' . $id . ' is now being prepared.'],
            'ready_for_shipping' => ['Ready for Shipping', 'Order ' . $id . ' is packed and ready for shipping.'],
            'shipped' => ['Order Shipped', 'Good news — order ' . $id . ' has been shipped. Your courier details are on your orders page.'],
            'delivered' => ['Order Delivered', 'Your order ' . $id . ' has been delivered. You can now review the products you received.'],
            'rejected' => ['Order Rejected', 'We are sorry — order ' . $id . ' has been rejected. Please contact Hiraya support for help or a refund of any payment made.'],
            default => ['Order Update', 'Order ' . $id . ' is now ' . str_replace('_', ' ', $status) . '.'],
        };
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
            private function notifyCustomer(Order $order, string $title, string $body, ?string $action = null): void
            {
                try {
                    $order->loadMissing('user');

                    if ($order->user) {
                        $order->user->notify(new OrderStatusChanged($order, $title, $body, $action));
                    }
                } catch (\Throwable $e) {
                    // A notification failure must never block the admin's status change.
                    Log::error('Order notification failed: ' . $e->getMessage());
                }
            }
        }
