<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ReceiptStorage;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Services\ReceiptInspector;
use App\Support\ProductVariants;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CheckoutController extends Controller
{
        /** Error string used when a requested size has no stock left. */
        private const ERR_OUT_OF_STOCK = 'One or more items are no longer available in the requested size.';

        /**
         * POST /api/checkout
         *
         * Creates a new order paid in FULL with ONE payment. The former 50% down
         * payment / remaining-balance flow was removed: the uploaded receipt must
         * cover the whole order total. The order starts as `pending`
         * (Pending Verification) and is only marked paid by staff after they
         * match the payment in the store's trusted transaction record.
         *
         * PRICING IS SERVER-AUTHORITATIVE: the client-supplied `total_amount` is
         * deliberately ignored. Every unit price is read from the products table
         * and the total is computed here, so a forged request body cannot deflate
         * the amount owed.
         *
         * STOCK POLICY (Option A — reserve on checkout): stock is decremented the
         * moment the order is created. A rejection by an admin restores it.
         *
         * Supports two entry paths:
         *   - Cart path:      items[] = [{ product_id, quantity, size, color }, ...]
         *   - Buy-now path:   product_id + quantity + size + color (single item)
         */
        public function store(Request $request)
        {
            $validated = $request->validate([
                'courier'          => 'required|in:lalamove,lbc',
                'customer_name'    => 'required|string|min:2|max:255',
                // PH mobile number: 09XXXXXXXXX or +639XXXXXXXXX, spaces/dashes allowed.
                'contact_number'   => ['required', 'string', 'max:30', 'regex:/^(\+?63|0)9[\d\s-]{9,13}$/'],
                /*
                 * DELIVERY DETAILS (Order Guidelines §4).
                 *  - LBC: the store books the shipment, so the COMPLETE address is
                 *    required as separate parts (street, barangay, city, province,
                 *    ZIP) and composed into delivery_address here.
                 *  - Lalamove: the customer books the rider, so only the drop-off
                 *    address is asked for; booking details follow from My Orders.
                 */
                'delivery_address' => 'required_if:courier,lalamove|nullable|string|min:10|max:500',
                'address_line'     => 'required_if:courier,lbc|nullable|string|min:3|max:200',
                'barangay'         => 'required_if:courier,lbc|nullable|string|min:2|max:100',
                'city'             => 'required_if:courier,lbc|nullable|string|min:2|max:100',
                'province'         => 'required_if:courier,lbc|nullable|string|min:2|max:100',
                'postal_code'      => ['required_if:courier,lbc', 'nullable', 'regex:/^\d{4}$/'],
                // Full payment only. `full` is still accepted from older clients;
                // the removed `down_payment` option is refused.
                'payment_option'   => 'nullable|in:full',
                // The receipt of the FULL payment (field name kept for compatibility).
                'dp_proof_image'   => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',

                // Accepted for backwards-compatibility, but never used for pricing.
                'total_amount'     => 'nullable|numeric',

                // Cart path
                'source'                       => 'nullable|string|in:cart,direct',
                'cart_item_ids'                => 'nullable|array',
                'cart_item_ids.*'              => 'integer|min:1',
                'items'                        => 'required_without:product_id|array|min:1',
                'items.*.product_id'           => 'required_with:items|integer|exists:products,id',
                'items.*.quantity'             => 'required_with:items|integer|min:1',
                'items.*.size'                 => 'nullable|string|max:50',
                'items.*.color'                => 'nullable|string|max:50',

                // Buy-now path
                'product_id'                   => 'required_without:items|integer|exists:products,id',
                'quantity'                     => 'nullable|integer|min:1',
                'size'                         => 'nullable|string|max:50',
                'color'                        => 'nullable|string|max:50',
            ], [
                'contact_number.regex'         => 'Please enter a valid mobile number, e.g. 0917 123 4567.',
                'delivery_address.min'         => 'Please enter your complete delivery address.',
                'delivery_address.required_if' => 'Please enter the drop-off address for your Lalamove rider.',
                'address_line.required_if'     => 'Enter your house no. and street for LBC.',
                'barangay.required_if'         => 'Enter your barangay for LBC.',
                'city.required_if'             => 'Enter your city or municipality for LBC.',
                'province.required_if'         => 'Enter your province for LBC.',
                'postal_code.required_if'      => 'Enter your 4-digit ZIP code for LBC.',
                'postal_code.regex'            => 'The ZIP code must be 4 digits.',
                'payment_option.in'            => 'Down payments are no longer offered. Please pay the full order amount.',
            ]);

            if ($validated['courier'] === 'lbc') {
                $validated['delivery_address'] = sprintf(
                    '%s, Brgy. %s, %s, %s %s',
                    trim($validated['address_line']),
                    trim($validated['barangay']),
                    trim($validated['city']),
                    trim($validated['province']),
                    trim($validated['postal_code'])
                );
            }

            /*
             * RECEIPT FILE SAFETY + ONE RECEIPT, ONE ORDER.
             * The bytes must be a real image of an allowed type, and the exact
             * same receipt file can never be submitted for a second order.
             */
            $inspector = app(ReceiptInspector::class);
            if ($reason = $inspector->rejectReason($request->file('dp_proof_image'))) {
                return response()->json(['message' => $reason, 'errors' => ['dp_proof_image' => [$reason]]], 422);
            }
            $fingerprints = $inspector->fingerprints($request->file('dp_proof_image'));
            if ($inspector->exactDuplicateOf($fingerprints['sha256'])) {
                $message = 'This receipt was already submitted for another order. Please upload the receipt for this payment.';

                return response()->json(['message' => $message, 'errors' => ['dp_proof_image' => [$message]]], 422);
            }

            // Normalise both paths into one list of requested lines.
            $lines = $this->normaliseLines($validated);
            $fromCart = ($validated['source'] ?? null) === 'cart';

            // A selected-items cart checkout is only allowed to remove the exact
            // bag rows represented by cart_item_ids. Never trust IDs from another
            // user's bag: filter through the authenticated user's relationship.
            $hasCartSelection = $fromCart && array_key_exists('cart_item_ids', $validated);
            $cartItemIds = array_values(array_unique(array_map('intval', $validated['cart_item_ids'] ?? [])));
            if ($hasCartSelection && count($cartItemIds) !== count($validated['items'] ?? [])) {
                return response()->json([
                    'message' => 'One or more selected bag items could not be matched to the order.',
                ], 422);
            }
            $ownedCartItems = $fromCart && $hasCartSelection
                ? $request->user()->cartItems()->whereIn('id', $cartItemIds)->get()
                : collect();
            if ($hasCartSelection && $ownedCartItems->count() !== count($cartItemIds)) {
                return response()->json([
                    'message' => 'One or more selected bag items are no longer available.',
                ], 422);
            }

            try {
                $order = DB::transaction(function () use ($request, $validated, $lines, $fromCart, $ownedCartItems, $fingerprints) {
                    // 1. Re-read every product inside the transaction and lock the
                    //    rows so two concurrent checkouts for the last item cannot
                    //    both pass the stock check.
                    $productIds = array_values(array_unique(array_column($lines, 'product_id')));
                    $products = Product::whereIn('id', $productIds)
                        ->lockForUpdate()
                        ->get()
                        ->keyBy('id');

                    // 2. Verify + price each line from the database (never the body).
                    $resolved = [];
                    $total = 0.0;

                    foreach ($lines as $line) {
                        $product = $products->get($line['product_id']);

                        if (! $product) {
                            throw new \RuntimeException('A product in your bag is no longer available.');
                        }

                        $qty = (int) $line['quantity'];
                        $size = $line['size'];

                        $this->assertStockAvailable($product, $size, $qty, $line['color'] ?? null);

                        $unitPrice = (float) $product->price;
                        $subtotal = round($unitPrice * $qty, 2);
                        $total += $subtotal;

                        $resolved[] = [
                            'product'    => $product,
                            'quantity'   => $qty,
                            'size'       => $size,
                            'color'      => $line['color'],
                            'unit_price' => $unitPrice,
                            'subtotal'   => $subtotal,
                        ];
                    }

                    $total = round($total, 2);

                    if ($total <= 0) {
                        throw new \RuntimeException('Order total could not be computed.');
                    }

                    // 3. Store the payment receipt in the PRIVATE receipts bucket.
                    $dpProofPath = ReceiptStorage::store($request->file('dp_proof_image'), 'dp-proofs');

                    // 4. Create the order with the SERVER-COMPUTED total. One full
                    //    payment: the paid amount is the total, nothing remains.
                    //    (dp_amount / balance_amount are kept as columns so
                    //    historical 50/50 orders stay readable.)
                    $order = Order::create([
                        'user_id'                  => $request->user()?->id,
                        'total_amount'             => $total,
                        'dp_amount'                => $total,
                        'balance_amount'           => 0,
                        'payment_status'           => 'pending',
                        'order_status'             => 'pending',
                        'courier'                  => $validated['courier'],
                        'customer_name'            => $validated['customer_name'],
                        'contact_number'           => $validated['contact_number'],
                        'delivery_address'         => $validated['delivery_address'],
                        'tracking_booking_details' => null,
                        'dp_proof_image_path'      => $dpProofPath,
                        'dp_submitted_at'          => now(),
                        'receipt_sha256'           => $fingerprints['sha256'],
                        'receipt_phash'            => $fingerprints['phash'],
                    ]);

                    // 5. Persist the line items + 6. reserve stock.
                    foreach ($resolved as $row) {
                        OrderItem::create([
                            'order_id'              => $order->id,
                            'product_id'            => $row['product']->id,
                            'product_name_snapshot' => $row['product']->name,
                            'selected_size'         => $row['size'] ?? 'M',
                            'selected_color'        => $row['color'] ?? 'Standard',
                            'quantity'              => $row['quantity'],
                            'unit_price'            => $row['unit_price'],
                            'line_total'            => $row['subtotal'],
                        ]);

                        ProductVariants::adjust($row['product'], $row['size'], $row['color'] ?? null, -$row['quantity']);
                    }

                    // 7. Remove only the selected bag rows. Legacy clients that
                    // omit cart_item_ids still get the old full-bag behavior.
                    if ($fromCart) {
                        if ($ownedCartItems->isNotEmpty()) {
                            // A Collection has no delete(); remove the rows by key.
                            \App\Models\CartItem::whereKey($ownedCartItems->modelKeys())->delete();
                        } elseif (empty($validated['cart_item_ids'])) {
                            // Backwards-compatible full-bag checkout from an old client.
                            $request->user()?->cartItems()->delete();
                        }
                    }

                    return $order->load('orderItems');
                });

                // Advisory OCR / fraud-risk check, after the customer is answered.
                $orderId = $order->id;
                dispatch(fn () => app(ReceiptInspector::class)->analyseAndStore($orderId))->afterResponse();

                return response()->json([
                    'message' => 'Checkout submitted. Your payment is pending verification — we will confirm it against our payment records.',
                    'order'   => $order,
                ], 201);

            } catch (\RuntimeException $e) {
                // Business-rule failures (stock, missing product): safe to show.
                return response()->json(['message' => $e->getMessage()], 422);

            } catch (\Throwable $e) {
                Log::error('Checkout Store Error: ' . $e->getMessage());

                return response()->json([
                    'message' => 'Failed to submit checkout.',
                ], 500);
            }
        }

        /**
         * Collapse the cart path and the buy-now path into a single list of
         * {product_id, quantity, size, color} lines.
         */
        private function normaliseLines(array $validated): array
        {
            if (! empty($validated['items'])) {
                return array_map(fn ($item) => [
                    'product_id' => (int) $item['product_id'],
                    'quantity'   => (int) ($item['quantity'] ?? 1),
                    'size'       => $item['size'] ?? null,
                    'color'      => $item['color'] ?? null,
                ], $validated['items']);
            }

            return [[
                'product_id' => (int) $validated['product_id'],
                'quantity'   => (int) ($validated['quantity'] ?? 1),
                'size'       => $validated['size'] ?? null,
                'color'      => $validated['color'] ?? null,
            ]];
        }

        /**
         * Throws unless `$qty` of the product is available in the requested size.
         * Falls back to the aggregate `stock` column when no per-size data exists,
         * so products without size_stocks still sell correctly.
         */
        private function assertStockAvailable(Product $product, ?string $size, int $qty, ?string $color = null): void
        {
            // Per colour: a variant colour has its own stock (see ProductVariants).
            $available = ProductVariants::available($product, $size, $color);

            if ($available < $qty) {
                throw new \RuntimeException(
                    self::ERR_OUT_OF_STOCK . ' (' . $product->name
                        . ($color && strcasecmp($color, 'Standard') !== 0 ? ' — ' . $color : '')
                        . ($size ? ' — size ' . $size : '') . ')'
                );
            }
        }
    }