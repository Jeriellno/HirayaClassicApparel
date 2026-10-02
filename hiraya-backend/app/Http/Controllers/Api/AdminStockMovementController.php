<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductStockMovement;
use App\Support\ProductVariants;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminStockMovementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_id' => 'sometimes|integer|exists:products,id',
            'limit' => 'sometimes|integer|min:1|max:100',
        ]);

        $movements = ProductStockMovement::query()
            ->with('user:id,full_name')
            ->when(
                isset($validated['product_id']),
                fn ($query) => $query->where('product_id', $validated['product_id'])
            )
            ->latest()
            ->limit($validated['limit'] ?? 20)
            ->get();

        return response()->json(['data' => $movements]);
    }

    /**
     * POST /api/admin/products/{product}/stock-adjust
     *
     * Adds or removes units for one size of one colour — a walk-in sale, a
     * recount, a restock. It applies a DELTA to the current count under a row
     * lock, so it can never overwrite a checkout that landed in the meantime
     * (the Edit Product form saves absolute numbers and can). The movement is
     * recorded by the Product model hooks with "Manual adjustment: <reason>".
     */
    public function adjust(Request $request, Product $product): JsonResponse
    {
        $validated = $request->validate([
            'size' => 'required|string|max:20',
            'color' => 'nullable|string|max:50',
            'delta' => 'required|integer|not_in:0|min:-100000|max:100000',
            'reason' => 'required|string|min:2|max:60',
        ]);

        $color = trim((string) ($validated['color'] ?? ''));

        return DB::transaction(function () use ($product, $validated, $color) {
            $locked = Product::whereKey($product->id)->lockForUpdate()->firstOrFail();

            if ($color !== '' && ProductVariants::indexFor($locked, $color) === null
                && ! in_array(strtolower($color), ['standard', 'original', strtolower((string) ($locked->colors[0] ?? ''))], true)) {
                return response()->json(['message' => "This product has no {$color} colour."], 422);
            }

            $index = ProductVariants::indexFor($locked, $color);
            $sizeStocks = $index === null
                ? (array) (is_string($locked->size_stocks) ? json_decode($locked->size_stocks, true) : $locked->size_stocks)
                : (array) (ProductVariants::all($locked)[$index]['size_stocks'] ?? []);

            if (! array_key_exists($validated['size'], $sizeStocks)) {
                return response()->json(['message' => "Size {$validated['size']} is not offered for this colour."], 422);
            }

            $current = ProductVariants::available($locked, $validated['size'], $color);
            if ($current + $validated['delta'] < 0) {
                return response()->json([
                    'message' => "Only {$current} left in size {$validated['size']}; you cannot remove " . abs($validated['delta']) . '.',
                ], 422);
            }

            ProductVariants::adjust($locked, $validated['size'], $color, (int) $validated['delta']);

            return response()->json([
                'message' => 'Stock updated.',
                'available' => $current + $validated['delta'],
                'product' => $locked->fresh(),
            ]);
        });
    }
}
