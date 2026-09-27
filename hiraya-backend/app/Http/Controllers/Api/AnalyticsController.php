<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Feedback;
use App\Models\Product;
use App\Models\TryOnSession;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AnalyticsController extends Controller
{
    /**
     * GET /api/admin/analytics/sessions
     *
     * Count of try-on sessions still being rendered (queued + processing).
     * This is the REAL "Canvas Sessions" figure for the Super Admin dashboard.
     *
     * It replaces a Supabase read of a `canvas_sessions` table that NOTHING in
     * the app ever wrote to, so the counter was permanently stuck at 0.
     */
    public function activeSessions()
    {
        try {
            $active = TryOnSession::query()->active()->count();

            return response()->json([
                'active_sessions' => $active,
                'activeSessions'  => $active,
            ]);
        } catch (\Throwable $e) {
            Log::error('Active sessions error: ' . $e->getMessage());

            return response()->json(['active_sessions' => 0, 'activeSessions' => 0]);
        }
    }

    /**
     * GET /api/admin/analytics/tryon-activity
     *
     * The latest try-on sessions, shaped for the Super Admin "Live Try-On
     * Activity" stream and the analytics table. Reads the SAME MySQL
     * `try_on_sessions` table the Studio writes to, so the console finally shows
     * real activity instead of the dead Supabase `canvas_analytics` list.
     *
     * FIELD NAMES ARE CHOSEN TO MATCH WHAT THE CONSOLE READS.
     * --------------------------------------------------------
     * The console (DashboardTab / AnalyticsTab / exportSurveyCSV) renders
     * `item_name`, `paired_item`, `match_score` and `status`. Those names came
     * from the retired Supabase `canvas_analytics` table, so the payload used to
     * come back missing them and every row rendered "Paired with: None" and
     * "Match: —".
     *
     * `item_name` / `paired_item` are now derived from the REAL data this table
     * holds: the Style Stack category of each garment the customer layered
     * (`render_plan_json.layers`, falling back to `garment_categories_json`).
     * `match_score` is deliberately NOT invented — the try-on pipeline never
     * measures a stylist-match percentage, so the key is simply omitted and the
     * console shows "—" rather than a fabricated 90/92.
     */
    public function tryOnActivity(Request $request)
    {
        try {
            $limit = (int) min(max((int) $request->query('limit', 50), 1), 200);

            $sessions = TryOnSession::query()
                ->with('user:id,full_name,email')
                ->latest()
                ->limit($limit)
                ->get()
                ->map(function (TryOnSession $s) {
                    /*
                     * The layer vocabulary (top/bottom/dress/outerwear/...) of each
                     * garment, in the order the customer stacked them. Read from the
                     * render plan first (the authoritative, post-CV source), then
                     * from the raw categories the client sent.
                     */
                    $layers = $this->garmentLayers($s);

                    return [
                        'id'         => $s->id,
                        'session_id' => $s->session_id,
                        'user_id'    => $s->user_id,
                        'user_name'  => $s->user?->full_name,
                        'user_email' => $s->user?->email,
                        // The first garment the customer tried on (the "primary" piece).
                        'item_name'  => $layers[0] ?? 'Garment',
                        // What it was layered with — the remaining pieces, if any.
                        'paired_item'=> isset($layers[1])
                            ? implode(', ', array_slice($layers, 1))
                            : null,
                        // How many garments were layered in this session.
                        'garment_count' => count($layers),
                        'status'     => $s->status,
                        'ai_feedback'=> $s->ai_feedback,
                        'created_at' => optional($s->created_at)->toIso8601String(),
                    ];
                });

            return response()->json($sessions);
        } catch (\Throwable $e) {
            Log::error('Try-on activity error: ' . $e->getMessage());

            return response()->json([]);
        }
    }

    /**
     * The human-readable garment layers of a try-on session.
     *
     * Preference order:
     *   1. `render_plan_json.layers.*.layer` — the authoritative vocabulary the
     *      renderer actually used (top, bottom, dress, outerwear, footwear,
     *      accessories), index-aligned with the uploaded garments.
     *   2. `garment_categories_json` — the raw category strings the client sent.
     *
     * @return array<int, string>
     */
    private function garmentLayers(TryOnSession $session): array
    {
        $plan = $session->render_plan_json;
        if (is_array($plan) && !empty($plan['layers']) && is_array($plan['layers'])) {
            $layers = [];
            foreach ($plan['layers'] as $layer) {
                $name = is_array($layer) ? ($layer['layer'] ?? null) : null;
                if (is_string($name) && $name !== '') {
                    $layers[] = ucfirst($name);
                }
            }
            if (!empty($layers)) {
                return $layers;
            }
        }

        $categories = $session->garment_categories_json;
        if (is_array($categories)) {
            $layers = array_values(array_filter(array_map(
                fn ($category) => is_string($category) && trim($category) !== ''
                    ? ucfirst(strtolower(trim($category)))
                    : null,
                $categories
            )));
            if (!empty($layers)) {
                return $layers;
            }
        }

        // Last resort: count the photos so the row is never blank.
        $photos = $session->garment_photos_json;
        return is_array($photos) ? array_fill(0, count($photos), 'Garment') : [];
    }

    /**
     * GET /api/admin/feedbacks
     *
     * The latest customer feedback, for the Super Admin Feedback tab and the
     * dashboard's "Recent User Responses". Replaces the Supabase `feedbacks`
     * read that had no writer.
     */
    public function feedbacks(Request $request)
    {
        try {
            $limit = (int) min(max((int) $request->query('limit', 200), 1), 500);

            return response()->json(
                Feedback::query()->latest()->limit($limit)->get()
            );
        } catch (\Throwable $e) {
            Log::error('Feedbacks fetch error: ' . $e->getMessage());

            return response()->json([]);
        }
    }

    /**
     * POST /api/feedback  (public — a guest may leave feedback)
     *
     * Stores a piece of customer feedback. This is the missing WRITER that the
     * old Supabase-backed Feedback tab never had.
     */
    public function submitFeedback(Request $request)
    {
        $validated = $request->validate([
            'rating'  => ['nullable', 'integer', 'min:1', 'max:5'],
            'comment' => ['required', 'string', 'max:2000'],
            'name'    => ['nullable', 'string', 'max:120'],
        ]);

        try {
            $user = $request->user();

            $feedback = Feedback::create([
                'user_id'   => $user?->id,
                'user_name' => $validated['name'] ?? $user?->full_name ?? 'Anonymous Visitor',
                'user_email'=> $user?->email,
                'rating'    => $validated['rating'] ?? 5,
                'comment'   => $validated['comment'],
            ]);

            return response()->json([
                'message'  => 'Thank you for your feedback!',
                'feedback' => $feedback,
            ], 201);
        } catch (\Throwable $e) {
            Log::error('Feedback submit error: ' . $e->getMessage());

            return response()->json(['message' => 'Could not save your feedback.'], 500);
        }
    }

    /**
     * Aggregate dashboard metrics for the Admin console.
     *
     * GET /api/admin/analytics/dashboard
     *
     * Returns catalog-wide totals so the dashboard has a single server-side
     * source instead of recomputing everything from the product list.
     */
    public function dashboardMetrics(Request $request)
    {
        try {
            $period = $request->query('period', 'month');
            if (! in_array($period, ['day', 'week', 'month'], true)) {
                return response()->json([
                    'message' => 'The period must be day, week, or month.',
                    'errors' => ['period' => ['Choose a valid dashboard period.']],
                ], 422);
            }

            /*
             * AGGREGATE IN SQL — DO NOT HYDRATE THE CATALOG HERE.
             *
             * This used to run a full-model hydration (including eight JSON
             * columns: images, colors, sizes, size_measurements, size_stocks,
             * attributes, ai_tags, garment_specifications) into PHP and then
             * reduce it all in memory.
             *
             * Against the remote Supabase pooler in use here a bare SELECT is
             * ~300ms, so the model round-trip dominated the request and blew the
             * SPA's 15s timeout once the dashboard's three mount-time calls queued
             * behind the single-threaded `php artisan serve`. Everything is now a
             * SQL aggregate, so this is one small query instead of a full hydration.
             */
            $row = Product::query()
                ->selectRaw('COUNT(DISTINCT products.id) AS total_products')
                ->selectRaw('COALESCE(SUM(DISTINCT products.stock), 0) AS total_inventory')
                ->selectRaw('COUNT(DISTINCT products.id) FILTER (WHERE products.stock < 5) AS low_stock_count')
                ->selectRaw('COALESCE(SUM(DISTINCT products.canvas_drag_count), 0) AS total_canvas_drags')
                ->selectRaw('COALESCE(SUM(DISTINCT products.try_on_count), 0) AS total_try_ons')
                ->first();

            /*
             * The category distribution is a second (tiny) grouped query. It
             * returns one row per category rather than one per product, so it is
             * cheap even over the pooler and avoids the SUM(DISTINCT) duplication
             * a single joined query would suffer for the per-category counts.
             */
            $categoryDistribution = Product::query()
                ->selectRaw("COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS category")
                ->selectRaw('COUNT(*) AS aggregate')
                ->groupByRaw("COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')")
                ->orderByDesc('aggregate')
                ->pluck('aggregate', 'category');

            $totalProducts  = (int) ($row->total_products ?? 0);
            $totalInventory = (int) ($row->total_inventory ?? 0);
            $lowStockCount  = (int) ($row->low_stock_count ?? 0);

            // `pluck` on a grouped query yields an array/Collection of counts;
            // normalize to a plain map so the JSON shape is unchanged.
            $distribution = collect($categoryDistribution)
                ->map(fn ($count) => (int) $count)
                ->all();

            $now = now();
            $periodStart = match ($period) {
                'day' => $now->copy()->startOfDay(),
                'week' => $now->copy()->startOfWeek(),
                'month' => $now->copy()->startOfMonth(),
            };

            $operations = DB::table('orders')
                ->selectRaw(
                    'COALESCE(SUM(CASE WHEN created_at BETWEEN ? AND ? THEN CASE payment_status WHEN ? THEN total_amount WHEN ? THEN dp_amount ELSE 0 END ELSE 0 END), 0) AS revenue',
                    [$periodStart, $now, 'fully_paid', '50_paid']
                )
                ->selectRaw(
                    'COALESCE(SUM(CASE WHEN payment_status = ? THEN total_amount WHEN payment_status = ? THEN balance_amount ELSE 0 END), 0) AS outstanding_balance',
                    ['pending', '50_paid']
                )
                ->selectRaw('SUM(CASE WHEN payment_status = ? THEN 1 ELSE 0 END) AS awaiting_dp_count', ['pending'])
                ->selectRaw('SUM(CASE WHEN order_status = ? THEN 1 ELSE 0 END) AS processing_count', ['processing'])
                ->selectRaw('SUM(CASE WHEN order_status IN (?, ?) THEN 1 ELSE 0 END) AS shipping_count', ['ready_for_shipping', 'shipped'])
                ->selectRaw('SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS period_order_count', [$periodStart, $now])
                ->first();

            return response()->json([
                'total_products'       => $totalProducts,
                'totalProducts'        => $totalProducts,
                'total_inventory'      => $totalInventory,
                'totalInventoryStock'  => $totalInventory,
                'category_count'       => count($distribution),
                'categoryCount'        => count($distribution),
                'low_stock_count'      => $lowStockCount,
                'lowStockItemsCount'   => $lowStockCount,
                'total_canvas_drags'   => (int) ($row->total_canvas_drags ?? 0),
                'total_try_ons'        => (int) ($row->total_try_ons ?? 0),
                'category_distribution'=> $distribution,
                'categoryDistribution' => $distribution,
                'operations' => [
                    'period' => $period,
                    'period_start' => $periodStart->toIso8601String(),
                    'period_end' => $now->toIso8601String(),
                    'revenue' => (float) ($operations->revenue ?? 0),
                    'period_order_count' => (int) ($operations->period_order_count ?? 0),
                    'outstanding_balance' => (float) ($operations->outstanding_balance ?? 0),
                    'awaiting_dp_count' => (int) ($operations->awaiting_dp_count ?? 0),
                    'processing_count' => (int) ($operations->processing_count ?? 0),
                    'shipping_count' => (int) ($operations->shipping_count ?? 0),
                ],
            ], 200);
        } catch (\Throwable $e) {
            Log::error('Dashboard Metrics Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to fetch dashboard metrics'], 500);
        }
    }

    /**
     * Track Canvas Drag and Drop usage
     */
    public function trackCanvas($id)
    {
        try {
            $product = Product::findOrFail($id);
            $product->increment('canvas_drag_count');

            return response()->json([
                'message' => 'Canvas interaction tracked successfully.',
                'canvas_drag_count' => (int) $product->canvas_drag_count,
            ], 200);
        } catch (\Exception $e) {
            Log::error('Track Canvas Error: ' . $e->getMessage());
            return response()->json(['message' => 'Failed to track canvas usage'], 500);
        }
    }

    /**
     * Track AI Virtual Try-On usage
     */
    public function trackTryOn($id)
    {
        try {
            $product = Product::findOrFail($id);
            $product->increment('try_on_count');

            return response()->json([
                'message' => 'AI Try-On tracked successfully.',
                'try_on_count' => (int) $product->try_on_count,
            ], 200);
        } catch (\Exception $e) {
            Log::error('Track Try-On Error: ' . $e->getMessage());
            return response()->json(['message' => 'Failed to track try-on usage'], 500);
        }
    }
}