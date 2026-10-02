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

            /*
             * ONLY THE COLUMNS THE LIST ACTUALLY RENDERS.
             *
             * This query used to hydrate the WHOLE row, and every row carries the
             * customer's photo and the generated render as base64 in the database.
             * MEASURED on this data: an average row is 1.9 MB of image
             * (user_photo_base64 ~871 KB + result_image_base64 ~1.12 MB), and the
             * table is 64 MB across 35 rows. So the default limit of 50 dragged
             * roughly 95 MB across the remote Supabase pooler to draw a table of
             * text — measured at 18.2 s, and the reason the console blew past its
             * 45 s ceiling and reported "timeout of 45000ms exceeded".
             *
             * The list needs: identity, the layer vocabulary, the status and the
             * timestamps. It never renders the images, so those columns are not
             * selected at all. `garmentLayers()` reads render_plan_json and
             * garment_categories_json, so both are kept.
             *
             * garment_photos_json is the last heavy column and it is NOT selected:
             * it averages 735 KB per row and is only ever used to COUNT the
             * photos, so a database-side jsonb_array_length answers that in
             * constant time instead of streaming the whole array over the wire.
             *
             * result_image_base64 and user_photo_base64 are the two multi-
             * megabyte blobs, and they are the whole cost. Dropping them turns a
             * multi-megabyte read into an indexed one.
             */
            $sessions = TryOnSession::query()
                ->select([
                    'id',
                    'session_id',
                    'user_id',
                    'status',
                    'ai_feedback',
                    'render_plan_json',
                    'garment_categories_json',
                    'created_at',
                ])
                /*
                 * COUNT THE PHOTOS IN THE DATABASE, not in PHP.
                 *
                 * This is the only reason garment_photos_json was being read at
                 * all, and reading it to count its elements meant transferring
                 * every base64 garment image in the row. The count is a number.
                 */
                ->selectRaw('coalesce(jsonb_array_length(garment_photos_json), 0) as garment_photo_count')
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

        /*
         * Last resort: count the photos so the row is never blank.
         *
         * The count arrives as `garment_photo_count`, computed in SQL by
         * tryOnActivity(). Falling back to reading the array itself is kept only
         * for callers that did not select that column — the array itself is
         * megabytes, so it is never the intended source.
         */
        if (isset($session->garment_photo_count)) {
            $count = (int) $session->garment_photo_count;

            return $count > 0 ? array_fill(0, $count, 'Garment') : [];
        }

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
    /**
     * GET /api/feedback/mine — the signed-in customer's own feedback, so My
     * Orders can show the rating they gave each delivered order.
     */
    public function myFeedback(Request $request)
    {
        return response()->json([
            'feedback' => Feedback::where('user_id', $request->user()->id)
                ->latest()
                ->get(['id', 'order_id', 'rating', 'comment', 'created_at']),
        ]);
    }

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
     * POST /api/feedback  (signed-in accounts with an email only)
     *
     * Stores a piece of customer feedback. This is the missing WRITER that the
     * old Supabase-backed Feedback tab never had.
     */
    public function submitFeedback(Request $request)
    {
        /*
         * ONLY AN ACCOUNT WITH AN EMAIL MAY SEND FEEDBACK. The route is behind
         * auth:sanctum; this is the second check, so an account without an email
         * cannot post an unattributable message either. The sender's name and
         * email come from the ACCOUNT — a free-typed `name` is no longer accepted.
         */
        $user = $request->user();
        if (!$user || empty($user->email)) {
            return response()->json([
                'message' => 'Please sign in with an account that has an email to send feedback.',
            ], 401);
        }

        $validated = $request->validate([
            // Every feedback carries a 1-5 star rating (the column is NOT NULL).
            'order_id' => ['nullable', 'integer'],
            'rating'  => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['required', 'string', 'max:2000'],
        ]);

        /*
         * ORDER EXPERIENCE FEEDBACK — once per delivered order, own orders only.
         * Mirrors the product-review rule (reviews open on delivery).
         */
        $orderId = $validated['order_id'] ?? null;
        if ($orderId !== null) {
            $order = \App\Models\Order::whereKey($orderId)->where('user_id', $user->id)->first();
            if (! $order) {
                return response()->json(['message' => 'Order not found.'], 404);
            }
            if ($order->order_status !== 'delivered') {
                return response()->json(['message' => 'You can rate your order once it has been delivered.'], 422);
            }
            if (Feedback::where('order_id', $order->id)->exists()) {
                return response()->json(['message' => 'You already rated this order. Thank you!'], 422);
            }
        }

        try {
            $feedback = Feedback::create([
                'user_id'   => $user->id,
                'user_name' => $user->full_name ?: $user->email,
                'user_email'=> $user->email,
                'rating'    => $validated['rating'],
                'comment'   => $validated['comment'],
                'order_id'  => $orderId,
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
                // Unqualified on purpose: this is a single-table query, and a raw
                // "products." would not follow the `tbl_` table prefix.
                ->selectRaw('COUNT(DISTINCT id) AS total_products')
                ->selectRaw('COALESCE(SUM(DISTINCT stock), 0) AS total_inventory')
                ->selectRaw('COUNT(DISTINCT id) FILTER (WHERE stock < 5) AS low_stock_count')
                ->selectRaw('COALESCE(SUM(DISTINCT canvas_drag_count), 0) AS total_canvas_drags')
                ->selectRaw('COALESCE(SUM(DISTINCT try_on_count), 0) AS total_try_ons')
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
     * GET /api/admin/analytics/summary?period=today|week|month
     *
     * The four compact cards at the top of the Master Console dashboard: orders,
     * revenue, AI try-ons and product reviews for the selected period.
     *
     * Each figure is compared with the SAME stretch of the previous period
     * (e.g. Monday→now this week vs Monday→same time last week), so a week that
     * is only two days old is not measured against a full seven.
     *
     * Revenue uses the same rule as dashboardMetrics(): a fully paid order counts
     * its total, a 50%-paid order counts its verified down payment, anything
     * else counts nothing yet.
     */
    public function summary(Request $request)
    {
        $period = $request->query('period', 'week');
        if (! in_array($period, ['today', 'week', 'month'], true)) {
            return response()->json([
                'message' => 'The period must be today, week, or month.',
                'errors' => ['period' => ['Choose a valid period.']],
            ], 422);
        }

        try {
            /*
             * "Today" / "This Week" / "This Month" follow the STORE's calendar
             * (Philippine time), not the server's UTC clock — otherwise "today"
             * would begin at 8:00 AM local. Boundaries are computed in Manila time
             * and converted back to UTC, the zone the timestamps are stored in.
             */
            $local = now('Asia/Manila');
            [$start, $prevStart] = match ($period) {
                'today' => [$local->copy()->startOfDay(), $local->copy()->subDay()->startOfDay()],
                'week'  => [$local->copy()->startOfWeek(), $local->copy()->subWeek()->startOfWeek()],
                'month' => [$local->copy()->startOfMonth(), $local->copy()->subMonthNoOverflow()->startOfMonth()],
            };
            // Same elapsed time into the previous period.
            $prevEnd = $prevStart->copy()->addSeconds($start->diffInSeconds($local));

            $now = $local->copy()->utc();
            $start = $start->utc();
            $prevStart = $prevStart->utc();
            $prevEnd = $prevEnd->utc();

            $orderStats = function ($from, $to) {
                $row = DB::table('orders')
                    ->whereBetween('created_at', [$from, $to])
                    ->selectRaw('COUNT(*) AS orders')
                    // A rejected order's payment is refunded, so it earns nothing
                    // (the same rule the revenue trend chart uses).
                    ->selectRaw(
                        'COALESCE(SUM(CASE WHEN order_status = ? THEN 0 ELSE CASE payment_status WHEN ? THEN total_amount WHEN ? THEN dp_amount ELSE 0 END END), 0) AS revenue',
                        ['rejected', 'fully_paid', '50_paid']
                    )
                    ->first();

                return [(int) ($row->orders ?? 0), (float) ($row->revenue ?? 0)];
            };

            [$orders, $revenue] = $orderStats($start, $now);
            [$prevOrders, $prevRevenue] = $orderStats($prevStart, $prevEnd);

            // Counts only — the image columns on this table are never read here.
            $tryOns = TryOnSession::query()->whereBetween('created_at', [$start, $now]);
            $tryOnTotal = (clone $tryOns)->count();
            $tryOnCompleted = (clone $tryOns)->where('status', 'completed')->count();
            $prevTryOns = TryOnSession::query()->whereBetween('created_at', [$prevStart, $prevEnd])->count();

            $reviews = DB::table('product_reviews')
                ->whereBetween('created_at', [$start, $now])
                ->selectRaw('COUNT(*) AS total, AVG(rating) AS average')
                ->first();
            $prevReviews = DB::table('product_reviews')->whereBetween('created_at', [$prevStart, $prevEnd])->count();

            $change = fn (float $current, float $previous) => $previous > 0
                ? round((($current - $previous) / $previous) * 100)
                : null; // no baseline: the UI says "new" instead of an infinite %

            return response()->json([
                'period' => $period,
                'period_start' => $start->toIso8601String(),
                'period_end' => $now->toIso8601String(),
                'orders' => [
                    'total' => $orders,
                    'previous' => $prevOrders,
                    'change_pct' => $change($orders, $prevOrders),
                ],
                'revenue' => [
                    'total' => round($revenue, 2),
                    'previous' => round($prevRevenue, 2),
                    'change_pct' => $change($revenue, $prevRevenue),
                ],
                'try_ons' => [
                    'total' => $tryOnTotal,
                    'completed' => $tryOnCompleted,
                    'previous' => $prevTryOns,
                    'change_pct' => $change($tryOnTotal, $prevTryOns),
                ],
                'reviews' => [
                    'total' => (int) ($reviews->total ?? 0),
                    'average' => $reviews->average !== null ? round((float) $reviews->average, 1) : null,
                    'previous' => $prevReviews,
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('Dashboard Summary Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to load the dashboard summary.'], 500);
        }
    }

    /**
     * GET /api/admin/analytics/charts?period=today|week|month
     *
     * The data behind the Master Console "Charts & Insights" section, for the
     * same period the summary cards use (Philippine calendar, like summary()):
     *
     *   revenue_trend  hourly (today) or daily (week / month) revenue. Every
     *                  bucket of the period is returned so the axis is stable;
     *                  buckets still in the future are null, not 0.
     *   top_products   units sold per product (order_items.quantity)
     *   order_status   orders placed in the period, by their CURRENT status
     *   try_on_products  try-on sessions per product (garment_metadata_json)
     *   review_ratings   submitted product reviews per star rating
     *
     * "VALID" ORDERS. Revenue and units sold count only orders whose payment
     * was verified (50% down payment or fully paid) and that were not
     * rejected — the same money rule as summary(). AI try-on counts are never
     * mixed into sales.
     */
    public function charts(Request $request)
    {
        $period = $request->query('period', 'week');
        if (! in_array($period, ['today', 'week', 'month'], true)) {
            return response()->json([
                'message' => 'The period must be today, week, or month.',
                'errors' => ['period' => ['Choose a valid period.']],
            ], 422);
        }

        try {
            $tz = 'Asia/Manila';
            $local = now($tz);
            $localStart = match ($period) {
                'today' => $local->copy()->startOfDay(),
                'week'  => $local->copy()->startOfWeek(),
                'month' => $local->copy()->startOfMonth(),
            };
            $start = $localStart->copy()->utc();
            $now = $local->copy()->utc();

            /*
             * REVENUE TREND. The period holds at most a month of orders, so the
             * paid rows are read (four small columns) and bucketed in PHP in
             * Manila time — portable across pgsql/mysql/sqlite, no tz SQL.
             */
            $hourly = $period === 'today';
            $buckets = [];
            $cursor = $localStart->copy();
            $periodEnd = match ($period) {
                'today' => $localStart->copy()->endOfDay(),
                'week'  => $localStart->copy()->endOfWeek(),
                'month' => $localStart->copy()->endOfMonth(),
            };
            while ($cursor <= $periodEnd) {
                $key = $cursor->format($hourly ? 'Y-m-d H' : 'Y-m-d');
                $buckets[$key] = [
                    'key' => $key,
                    'label' => $hourly ? $cursor->format('g A') : ($period === 'week' ? $cursor->format('D') : $cursor->format('M j')),
                    'full_label' => $hourly
                        ? $cursor->format('M j, g:00 A')
                        : $cursor->format('l, M j'),
                    // Future buckets stay null so the line stops at "now".
                    'revenue' => $cursor <= $local ? 0.0 : null,
                    'orders' => $cursor <= $local ? 0 : null,
                ];
                $hourly ? $cursor->addHour() : $cursor->addDay();
            }

            $paidOrders = DB::table('orders')
                ->whereBetween('created_at', [$start, $now])
                ->where('order_status', '<>', 'rejected')
                ->whereIn('payment_status', ['fully_paid', '50_paid'])
                ->get(['created_at', 'payment_status', 'total_amount', 'dp_amount']);

            foreach ($paidOrders as $order) {
                $at = \Illuminate\Support\Carbon::parse($order->created_at, 'UTC')->setTimezone($tz);
                $key = $at->format($hourly ? 'Y-m-d H' : 'Y-m-d');
                if (! isset($buckets[$key]) || $buckets[$key]['revenue'] === null) {
                    continue;
                }
                $amount = $order->payment_status === 'fully_paid' ? $order->total_amount : $order->dp_amount;
                $buckets[$key]['revenue'] += (float) $amount;
                $buckets[$key]['orders']++;
            }
            $revenueTrend = array_values(array_map(function ($b) {
                if ($b['revenue'] !== null) {
                    $b['revenue'] = round($b['revenue'], 2);
                }

                return $b;
            }, $buckets));

            // TOP PERFORMING PRODUCTS — units actually sold on valid orders.
            /*
             * RAW SQL MUST NAME THE PREFIXED TABLES. Laravel adds the connection's
             * table prefix (`tbl_`) to every identifier it builds, but not to text
             * inside selectRaw/groupByRaw — so raw fragments take it from here.
             */
            $t = fn (string $table) => DB::getTablePrefix() . $table;
            $productName = "COALESCE({$t('products')}.name, {$t('order_items')}.product_name_snapshot)";
            $topProducts = DB::table('order_items')
                ->join('orders', 'orders.id', '=', 'order_items.order_id')
                ->leftJoin('products', 'products.id', '=', 'order_items.product_id')
                ->whereBetween('orders.created_at', [$start, $now])
                ->where('orders.order_status', '<>', 'rejected')
                ->whereIn('orders.payment_status', ['fully_paid', '50_paid'])
                ->selectRaw("{$productName} AS name")
                ->selectRaw("SUM({$t('order_items')}.quantity) AS units")
                ->groupByRaw($productName)
                ->orderByDesc('units')
                ->orderBy('name')
                ->limit(5)
                ->get()
                ->map(fn ($r) => ['name' => $r->name ?: 'Product', 'units' => (int) $r->units])
                ->values();

            /*
             * ORDER STATUS DISTRIBUTION. `ready_for_shipping` is still being
             * prepared, so it is folded into Processing; `rejected` is the
             * store's cancellation state and is shown as Cancelled.
             */
            $statusGroups = [
                'pending' => 'Pending',
                'processing' => 'Processing',
                'ready_for_shipping' => 'Processing',
                'shipped' => 'Shipped',
                'delivered' => 'Delivered',
                'rejected' => 'Cancelled',
            ];
            $statusCounts = array_fill_keys(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'], 0);
            DB::table('orders')
                ->whereBetween('created_at', [$start, $now])
                ->selectRaw('order_status, COUNT(*) AS total')
                ->groupBy('order_status')
                ->get()
                ->each(function ($r) use (&$statusCounts, $statusGroups) {
                    $label = $statusGroups[$r->order_status] ?? null;
                    if ($label) {
                        $statusCounts[$label] += (int) $r->total;
                    }
                });
            $orderStatus = collect($statusCounts)
                ->map(fn ($count, $status) => ['status' => $status, 'count' => $count])
                ->values();

            // AI TRY-ON PERFORMANCE — sessions per product (image columns never read).
            $tryOnProducts = collect(DB::select(
                "SELECT elem->>'name' AS name, COUNT(*) AS sessions
                   FROM {$t('try_on_sessions')} AS s,
                        json_array_elements(CASE WHEN json_typeof(s.garment_metadata_json) = 'array'
                                                 THEN s.garment_metadata_json ELSE '[]'::json END) AS elem
                  WHERE COALESCE(elem->>'name', '') <> ''
                    AND s.created_at BETWEEN ? AND ?
               GROUP BY elem->>'name'
               ORDER BY sessions DESC, name ASC
                  LIMIT 5",
                [$start, $now]
            ))->map(fn ($r) => ['name' => $r->name, 'sessions' => (int) $r->sessions])->values();

            // PRODUCT REVIEW RATINGS — 5★ first, every star present (0 if none).
            $ratingCounts = DB::table('product_reviews')
                ->whereBetween('created_at', [$start, $now])
                ->selectRaw('rating, COUNT(*) AS total')
                ->groupBy('rating')
                ->pluck('total', 'rating');
            $reviewRatings = collect([5, 4, 3, 2, 1])
                ->map(fn ($stars) => ['stars' => $stars, 'count' => (int) ($ratingCounts[$stars] ?? 0)])
                ->values();

            return response()->json([
                'period' => $period,
                'granularity' => $hourly ? 'hour' : 'day',
                'period_start' => $start->toIso8601String(),
                'period_end' => $now->toIso8601String(),
                'revenue_trend' => $revenueTrend,
                'top_products' => $topProducts,
                'order_status' => $orderStatus,
                'try_on_products' => $tryOnProducts,
                'review_ratings' => $reviewRatings,
            ]);
        } catch (\Throwable $e) {
            Log::error('Dashboard Charts Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to load the dashboard charts.'], 500);
        }
    }

    /**
     * GET /api/admin/analytics/overview
     *
     * Everything below the summary cards on the Master Console dashboard, in one
     * light request: recent try-ons, recent product reviews, inventory status,
     * try-on analytics and review analytics (all-time).
     *
     * Deliberately NOT built on tryOnActivity(): that endpoint is the full
     * analytics log and was measured at ~19s, which is why the dashboard used to
     * show "no recent activity". This reads five rows, never the image columns,
     * and pulls product names out of the small garment_metadata_json in SQL.
     */
    public function overview()
    {
        try {
            /*
             * RECENT TRY-ONS. Product names come from garment_metadata_json
             * (written by the Studio since it started recording products); older
             * sessions have none and fall back to their garment layers.
             */
            $recentTryOns = TryOnSession::query()
                ->select(['id', 'user_id', 'status', 'render_plan_json', 'garment_categories_json', 'created_at'])
                ->selectRaw(
                    "(SELECT string_agg(elem->>'name', ', ') FROM json_array_elements("
                    . "CASE WHEN json_typeof(garment_metadata_json) = 'array' THEN garment_metadata_json ELSE '[]'::json END"
                    . ") AS elem WHERE COALESCE(elem->>'name', '') <> '') AS product_names"
                )
                ->with('user:id,full_name,email')
                ->latest()
                ->limit(5)
                ->get()
                ->map(fn (TryOnSession $s) => [
                    'id' => $s->id,
                    'products' => $s->product_names
                        ?: (implode(', ', $this->garmentLayers($s)) ?: 'Garment'),
                    'customer' => $s->user?->full_name ?: $s->user?->email,
                    'status' => $s->status,
                    'created_at' => optional($s->created_at)->toIso8601String(),
                ]);

            $recentReviews = DB::table('product_reviews')
                ->leftJoin('users', 'users.id', '=', 'product_reviews.user_id')
                ->leftJoin('products', 'products.id', '=', 'product_reviews.product_id')
                ->leftJoin('order_items', 'order_items.id', '=', 'product_reviews.order_item_id')
                ->orderByDesc('product_reviews.created_at')
                ->limit(4)
                ->get([
                    'product_reviews.id',
                    'product_reviews.rating',
                    'product_reviews.comment',
                    'product_reviews.created_at',
                    'users.full_name as customer',
                    DB::raw('COALESCE(' . DB::getTablePrefix() . 'products.name, '
                        . DB::getTablePrefix() . 'order_items.product_name_snapshot) AS product_name'),
                ])
                ->map(fn ($r) => [
                    'id' => $r->id,
                    'rating' => (int) $r->rating,
                    'comment' => $r->comment,
                    'product_name' => $r->product_name ?: 'Product',
                    'customer' => $r->customer,
                    'created_at' => \Illuminate\Support\Carbon::parse($r->created_at)->toIso8601String(),
                ]);

            // Low stock = 1–4 units left; 0 is counted separately as out of stock.
            $inventory = DB::table('products')
                ->selectRaw('COUNT(*) AS active')
                ->selectRaw('SUM(CASE WHEN stock BETWEEN 1 AND 4 THEN 1 ELSE 0 END) AS low_stock')
                ->selectRaw('SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) AS out_of_stock')
                ->first();

            $tryOnStats = DB::table('try_on_sessions')
                ->selectRaw('COUNT(*) AS total')
                ->selectRaw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed")
                ->selectRaw("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed")
                ->first();

            // The product that appears in the most try-on sessions.
            $mostTried = DB::selectOne(
                "SELECT elem->>'name' AS name, COUNT(*) AS sessions
                   FROM " . DB::getTablePrefix() . "try_on_sessions,
                        json_array_elements(CASE WHEN json_typeof(garment_metadata_json) = 'array'
                                                 THEN garment_metadata_json ELSE '[]'::json END) AS elem
                  WHERE COALESCE(elem->>'name', '') <> ''
               GROUP BY elem->>'name'
               ORDER BY sessions DESC, name ASC
                  LIMIT 1"
            );

            $reviewStats = DB::table('product_reviews')
                ->selectRaw('COUNT(*) AS total, AVG(rating) AS average')
                ->selectRaw('SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS five_star')
                ->selectRaw('SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS needs_attention')
                ->first();

            return response()->json([
                'recent_try_ons' => $recentTryOns,
                'recent_reviews' => $recentReviews,
                'inventory' => [
                    'active' => (int) ($inventory->active ?? 0),
                    'low_stock' => (int) ($inventory->low_stock ?? 0),
                    'out_of_stock' => (int) ($inventory->out_of_stock ?? 0),
                ],
                'try_ons' => [
                    'total' => (int) ($tryOnStats->total ?? 0),
                    'completed' => (int) ($tryOnStats->completed ?? 0),
                    'failed' => (int) ($tryOnStats->failed ?? 0),
                    'most_tried' => $mostTried
                        ? ['name' => $mostTried->name, 'sessions' => (int) $mostTried->sessions]
                        : null,
                ],
                'reviews' => [
                    'total' => (int) ($reviewStats->total ?? 0),
                    'average' => $reviewStats->average !== null ? round((float) $reviewStats->average, 1) : null,
                    'five_star' => (int) ($reviewStats->five_star ?? 0),
                    'needs_attention' => (int) ($reviewStats->needs_attention ?? 0),
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('Dashboard Overview Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to load the dashboard overview.'], 500);
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