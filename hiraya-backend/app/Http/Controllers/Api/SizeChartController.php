<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SizeChart;
use Illuminate\Http\JsonResponse;

/**
 * SizeChartController — serves the store's sizing policy to the frontend.
 *
 * The chart is static policy, not user data, so this is a plain read-only
 * endpoint with no auth. The frontend fetches it once and derives the Size
 * Suggester from it, instead of hardcoding the same thresholds a second time.
 *
 * See App\Services\SizeChart for the numbers themselves and why they live in
 * one place.
 */
class SizeChartController extends Controller
{
    /**
     * GET /api/size-chart
     */
    public function show(): JsonResponse
    {
        /*
         * Cacheable: the response only changes when the code changes, so a
         * long max-age is safe and keeps the Studio from re-fetching on every
         * try-on session. `public` because there is nothing per-user in it.
         */
        return response()
            ->json(SizeChart::toArray())
            ->header('Cache-Control', 'public, max-age=3600');
    }
}
