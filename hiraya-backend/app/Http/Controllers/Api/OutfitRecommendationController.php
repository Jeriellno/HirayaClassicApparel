<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\OutfitRecommendationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OutfitRecommendationController extends Controller
{
    protected OutfitRecommendationService $recommendationService;

    public function __construct(OutfitRecommendationService $recommendationService)
    {
        $this->recommendationService = $recommendationService;
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        /*
         * This route IS behind `auth:sanctum`, so `user()` is populated for
         * every real caller. The guard stays as defence in depth: a token that
         * expired mid-session, or a request that slips past the middleware,
         * must degrade to an empty recommendation set rather than 500 on
         * `$user->chest_bust`.
         */
        if (!$user) {
            return response()->json([
                'has_measurements' => false,
                'recommendations' => [],
            ]);
        }

        // Check if user has populated at least 2 core body measurements
        $hasMeasurements = !is_null($user->chest_bust) || !is_null($user->waist);

        if (!$hasMeasurements) {
            return response()->json([
                'has_measurements' => false,
                'recommendations' => [],
            ]);
        }

        $limit = min(max((int) $request->input('limit', 8), 1), 20);
        $outfits = $this->recommendationService->getRecommendations($user, $limit);

        return response()->json([
            'has_measurements' => true,
            'recommendations' => $outfits,
        ]);
    }
}