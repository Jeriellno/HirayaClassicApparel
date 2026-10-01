<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CartItem;
use App\Models\Product;
use App\Support\ProductVariants;
use Illuminate\Http\Request;

class CartController extends Controller {
    /**
     * GET /api/cart
     * Returns the signed-in user's bag with product details attached.
     */
    public function index(Request $request) {
        try {
            // Drop orphaned rows (a product deleted by an admin) so a single
            // dangling cart item can't 500 the whole bag.
            $items = $request->user()->cartItems()->with('product')->latest()->get()
                ->filter(fn ($item) => $item->product !== null)
                ->values();

            return response()->json([
                'items' => $items,
                'count' => $items->sum('quantity'),
                'total' => $this->calculateTotal($items),
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Cart Index Error: ' . $e->getMessage());
            return response()->json(['items' => [], 'count' => 0, 'total' => 0]);
        }
    }

    /**
     * POST /api/cart
     * Adds an item. If the same user+product+size+color already exists,
     * the quantity is incremented instead of creating a duplicate row.
     */
    public function store(Request $request) {
        $request->validate([
            'product_id' => 'required|exists:products,id',
            'quantity' => 'nullable|integer|min:1|max:50',
            'selected_size' => 'nullable|string|max:50',
            'selected_color' => 'nullable|string|max:50',
        ]);

        $user = $request->user();
        $quantity = (int) ($request->quantity ?? 1);
        $size = $request->selected_size ?? 'M';
        $color = $request->selected_color ?? 'Standard';

        $existing = CartItem::where('user_id', $user->id)
            ->where('product_id', $request->product_id)
            ->where('selected_size', $size)
            ->where('selected_color', $color)
            ->first();

        /*
         * STOCK GUARD — a bag can never hold more of a colour + size than is
         * actually in stock (variant colours have their own stock).
         */
        $product = Product::find($request->product_id);
        $available = ProductVariants::available($product, $size, $color);
        if ($available < $quantity + (int) ($existing?->quantity ?? 0)) {
            return response()->json(['message' => $this->stockMessage($available, $color)], 422);
        }

        if ($existing) {
            $existing->increment('quantity', $quantity);
            $existing->load('product');

            return response()->json([
                'status' => 'updated',
                'message' => 'Quantity updated in your bag',
                'data' => $existing,
            ], 200);
        }

        $cartItem = CartItem::create([
            'user_id' => $user->id,
            'product_id' => $request->product_id,
            'selected_color' => $color,
            'selected_size' => $size,
            'quantity' => $quantity,
        ]);

        return response()->json([
            'status' => 'added',
            'message' => 'Added to your bag',
            'data' => $cartItem->load('product'),
        ], 201);
    }

    /**
     * PUT /api/cart/{id}
     * Sets an explicit quantity. A quantity of 0 removes the item.
     */
    public function update(Request $request, $id) {
        $request->validate([
            'quantity' => 'required|integer|min:0',
        ]);

        $cartItem = $request->user()->cartItems()->find($id);

        if (! $cartItem) {
            return response()->json(['message' => 'Item not found in your bag'], 404);
        }

        if ((int) $request->quantity === 0) {
            $cartItem->delete();
            return response()->json(['status' => 'removed', 'message' => 'Item removed from your bag']);
        }

        $cartItem->loadMissing('product');
        if ($cartItem->product) {
            $available = ProductVariants::available($cartItem->product, $cartItem->selected_size, $cartItem->selected_color);
            if ((int) $request->quantity > $available) {
                return response()->json(['message' => $this->stockMessage($available, $cartItem->selected_color)], 422);
            }
        }

        $cartItem->update(['quantity' => $request->quantity]);

        return response()->json([
            'status' => 'updated',
            'data' => $cartItem->load('product'),
        ]);
    }

    /**
     * DELETE /api/cart/{id}
     */
    public function destroy(Request $request, $id) {
        $cartItem = $request->user()->cartItems()->find($id);

        if (! $cartItem) {
            return response()->json(['message' => 'Item not found in your bag'], 404);
        }

        $cartItem->delete();

        return response()->json(['message' => 'Item removed from your bag']);
    }

    /**
     * DELETE /api/cart
     */
    public function clear(Request $request) {
        $request->user()->cartItems()->delete();

        return response()->json(['message' => 'Cart cleared']);
    }

    private function stockMessage(int $available, ?string $color): string
    {
        $what = $color && strcasecmp($color, 'Standard') !== 0 ? 'this colour and size' : 'this size';

        return $available > 0 ? "Only {$available} left in {$what}." : ucfirst($what) . ' is out of stock.';
    }

    /**
     * Sum of (product price x quantity) across the given cart items.
     */
    private function calculateTotal($items): float {
        return round($items->reduce(function ($carry, $item) {
            // Null-safe: a product row removed by an admin must not break the
            // whole bag — treat the missing price as 0 instead of throwing.
            $price = $item->product?->price ?? 0;
            return $carry + ((float) $price * (int) $item->quantity);
        }, 0), 2);
    }
}