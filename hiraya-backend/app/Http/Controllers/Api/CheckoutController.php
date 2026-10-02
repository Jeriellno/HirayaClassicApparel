<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
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
         * Creates a new order for the strict 2-step payment flow:
         * 50% down payment (PAYO) to secure, balance before shipping.
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
                'delivery_address' => 'required|string|min:10|max:500',
                'dp_proof_image'   => 'required|image|mimes:jpg,jpeg,png,webp|max:5120',
                // The GCash / bank transaction reference the admin checks against.
                'dp_reference_number' => 'required|string|min:4|max:64',

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
            ]);

            // LBC requires a complete delivery address to generate the shipment.
            // Lalamove is booked by the client, so we only warn (handled in the UI).
            if ($validated['courier'] === 'lbc' && strlen(trim($validated['delivery_address'])) < 10) {
                return response()->json([
                    'message' => 'A complete delivery address is required for LBC shipping.',
                ], 422);
            }

            // One receipt, one order: a reference already on another order is refused.
            if ($usedBy = Order::referenceInUse($validated['dp_reference_number'])) {
                return response()->json([
                    'message' => 'This reference number was already used for another payment. Please check your receipt.',
                    'errors' => ['dp_reference_number' => ['This reference number was already used.']],
                ], 422);
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
                $order = DB::transaction(function () use ($request, $validated, $lines, $fromCart, $ownedCartItems) {
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

                    // 3. Store the down-payment proof.
                    $dpProofPath = $request->file('dp_proof_image')
                        ->store('orders/dp-proofs', 'public');

                    $dp = round($total / 2, 2);        // 50% down payment
                    $balance = round($total - $dp, 2); // remaining balance
                    // 4. Create the order with the SERVER-COMPUTED total.
                    $order = Order::create([
                        'user_id'                  => $request->user()?->id,
                        'total_amount'             => $total,
                        'dp_amount'                => $dp,
                        'balance_amount'           => $balance,
                        'payment_status'           => 'pending',
                        'order_status'             => 'pending',
                        'courier'                  => $validated['courier'],
                        'customer_name'            => $validated['customer_name'],
                        'contact_number'           => $validated['contact_number'],
                        'delivery_address'         => $validated['delivery_address'],
                        'tracking_booking_details' => null,
                        'dp_proof_image_path'      => $dpProofPath,
                        'dp_reference_number'      => trim($validated['dp_reference_number']),
                        'dp_submitted_at'          => now(),
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
                            $ownedCartItems->delete();
                        } elseif (empty($validated['cart_item_ids'])) {
                            // Backwards-compatible full-bag checkout from an old client.
                            $request->user()?->cartItems()->delete();
                        }
                    }

                    return $order->load('orderItems');
                });

                return response()->json([
                    'message' => 'Checkout submitted. Please wait for admin verification of your down payment.',
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