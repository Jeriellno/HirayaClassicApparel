<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ProductStockMovement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
}
