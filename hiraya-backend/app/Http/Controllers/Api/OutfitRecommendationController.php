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
         * must degrade to an empty recommendation set rather than 500 while
         * reading a null sizing profile.
         */
        if (!$user) {
            return response()->json([
                'has_sizes' => false,
                'fit_style' => null,
                'recommendations' => [],
            ]);
        }

        // A customer with neither an upper nor a lower size on file cannot be
        // matched to a garment: there is nothing to compare the stock against.
        $hasSizes = filled($user->upper_body_size) || filled($user->lower_body_size);

        if (!$hasSizes) {
            return response()->json([
                'has_sizes' => false,
                'fit_style' => null,
                'gender' => $user->gender,
                'preferred_fit' => $user->preferred_fit,
                'recommendations' => [],
            ]);
        }

        $limit = min(max((int) $request->input('limit', 8), 1), 20);
        $recommendations = $this->recommendationService->getRecommendations($user, $limit);

        return response()->json([
            'has_sizes' => true,
            /*
             * The fit style the shopper chose, echoed back so the UI can label
             * the feed ("Recommended for slim fits") without re-deriving the
             * translation the service already knows how to do. It is null when
             * the account has no fit preference on file — the feed then ranks
             * on the size gate alone and says so.
             */
            'fit_style' => $recommendations->first()?->customer_fit,
            // The raw profile values, so Home can show "Men · Slim fit" even
            // when the feed is empty.
            'gender' => $user->gender,
            'preferred_fit' => $user->preferred_fit,
            'recommendations' => $recommendations,
        ]);
    }
}