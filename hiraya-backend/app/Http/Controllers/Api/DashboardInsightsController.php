<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * GET /api/admin/analytics/insights?period=today|week|month|all
 *
 * `week` and `month` are ROLLING windows (last 7 / 30 days), so the board is
 * never blank just because a new calendar month started this morning.
 *
 * EVERYTHING THE ONE-SCREEN DASHBOARD DRAWS, IN ONE REQUEST.
 *
 * The console dashboard is now an analytics board for BOTH admin and super
 * admin: KPI strip, revenue/orders/try-on line chart, order-status and try-on
 * outcome pies, product-review and customer-feedback star distributions, Style
 * Stack layer usage, most-tried pieces, and the work queue that used to be the
 * separate "Today's Work" tab.
 *
 * It is one endpoint on purpose: against the remote Supabase pooler each query
 * costs ~300 ms and `php artisan serve` is single-threaded, so six panels each
 * fetching their own data queued up behind each other. Here every source is
 * read once (rows, never image columns) and shaped in PHP.
 *
 * Demo orders (Orders Management -> Create demo order) are excluded everywhere.
 *
 * All time math is Asia/Manila, matching the existing summary/charts endpoints.
 */
class DashboardInsightsController extends Controller
{
    private const TZ = 'Asia/Manila';

    private const LOW_STOCK = 5;

    /** Order statuses as the customer-facing groups the pie shows. */
    private const STATUS_GROUPS = [
        'pending' => 'Pending',
        'processing' => 'Processing',
        'ready_for_shipping' => 'Processing',
        'shipped' => 'Shipped',
        'delivered' => 'Delivered',
        'rejected' => 'Cancelled',
    ];

    /** Try-on garment category labels -> Style Stack layer. */
    private const LAYER_LABELS = [
        'top' => 'Tops', 'tops' => 'Tops', 'upperbody' => 'Tops', 'upper_body' => 'Tops',
        'bottom' => 'Bottoms', 'bottoms' => 'Bottoms', 'lowerbody' => 'Bottoms', 'lower_body' => 'Bottoms',
        'outerwear' => 'Outerwear',
        'dress' => 'Dresses', 'dresses' => 'Dresses', 'full_body' => 'Dresses', 'fullbody' => 'Dresses',
        'formal_men' => 'Formal', 'formal_women' => 'Formal', 'formal' => 'Formal',
        'footwear' => 'Footwear', 'shoes' => 'Footwear',
        'accessories' => 'Accessories',
    ];

    public function show(Request $request): JsonResponse
    {
        $period = $request->query('period', 'month');
        if (!in_array($period, ['today', 'week', 'month', 'all'], true)) {
            return response()->json([
                'message' => 'The period must be today, week, month or all.',
                'errors' => ['period' => ['Choose a valid period.']],
            ], 422);
        }

        try {
            [$start, $end, $prevStart, $prevEnd, $buckets, $bucketFormat] = $this->window($period);
            $range = [$start->copy()->utc(), $end->copy()->utc()];

            // ---- ORDERS (one row read per order in range) -------------------
            $orders = DB::table('orders')
                ->where('is_demo', false)
                ->whereBetween('created_at', $range)
                ->get(['created_at', 'payment_status', 'order_status', 'total_amount', 'dp_amount']);

            $paidAmount = fn ($o) => $o->order_status === 'rejected' ? 0.0 : match ($o->payment_status) {
                'fully_paid' => (float) $o->total_amount,
                '50_paid' => (float) $o->dp_amount,
                default => 0.0,
            };

            $statusCounts = array_fill_keys(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'], 0);
            $revenue = 0.0;
            foreach ($orders as $o) {
                $amount = $paidAmount($o);
                $revenue += $amount;
                $label = self::STATUS_GROUPS[$o->order_status] ?? null;
                if ($label) {
                    $statusCounts[$label]++;
                }
                $key = $this->bucketKey($o->created_at, $bucketFormat);
                if (isset($buckets[$key]) && $buckets[$key]['orders'] !== null) {
                    $buckets[$key]['orders']++;
                    $buckets[$key]['revenue'] += $amount;
                }
            }

            $prev = $prevStart
                ? DB::table('orders')
                ->where('is_demo', false)
                    ->whereBetween('created_at', [$prevStart->copy()->utc(), $prevEnd->copy()->utc()])
                    ->selectRaw('COUNT(*) AS orders')
                    ->selectRaw(
                        'COALESCE(SUM(CASE WHEN order_status = ? THEN 0 ELSE CASE payment_status WHEN ? THEN total_amount WHEN ? THEN dp_amount ELSE 0 END END), 0) AS revenue',
                        ['rejected', 'fully_paid', '50_paid']
                    )
                    ->first()
                : null;

            // ---- TRY-ONS (status + layers + garment names; no images) -------
            $sessions = DB::table('try_on_sessions')
                ->whereBetween('created_at', $range)
                ->get(['created_at', 'status', 'garment_categories_json', 'garment_metadata_json']);

            $tryOnStatus = ['Completed' => 0, 'Failed' => 0, 'In progress' => 0];
            $layers = [];
            $tried = [];
            foreach ($sessions as $s) {
                $status = match ($s->status) {
                    'completed' => 'Completed',
                    'failed' => 'Failed',
                    default => 'In progress',
                };
                $tryOnStatus[$status]++;

                foreach ($this->jsonList($s->garment_categories_json) as $cat) {
                    $raw = strtolower(trim((string) $cat));
                    $label = self::LAYER_LABELS[$raw] ?? ucwords(str_replace('_', ' ', $raw));
                    if ($label !== '') {
                        $layers[$label] = ($layers[$label] ?? 0) + 1;
                    }
                }
                foreach ($this->jsonList($s->garment_metadata_json) as $meta) {
                    $name = is_array($meta) ? trim((string) ($meta['name'] ?? '')) : '';
                    if ($name !== '') {
                        $tried[$name] = ($tried[$name] ?? 0) + 1;
                    }
                }

                $key = $this->bucketKey($s->created_at, $bucketFormat);
                if (isset($buckets[$key]) && $buckets[$key]['try_ons'] !== null) {
                    $buckets[$key]['try_ons']++;
                }
            }
            arsort($layers);
            arsort($tried);

            $prevTryOns = $prevStart
                ? DB::table('try_on_sessions')->whereBetween('created_at', [$prevStart->copy()->utc(), $prevEnd->copy()->utc()])->count()
                : null;

            // ---- RATINGS: product reviews + customer feedback, 5 -> 1 -------
            $starRows = fn (string $table) => DB::table($table)
                ->whereBetween('created_at', $range)
                // Customers Feedback is named-only: anonymous legacy rows are left out.
                ->when($table === 'feedbacks', fn ($q) => $q->whereNotNull('user_id'))
                ->whereNotNull('rating')
                ->selectRaw('rating, COUNT(*) AS total')
                ->groupBy('rating')
                ->pluck('total', 'rating');

            $stars = function ($rows) {
                $dist = [];
                $sum = 0;
                $count = 0;
                foreach ([5, 4, 3, 2, 1] as $n) {
                    $c = (int) ($rows[$n] ?? 0);
                    $dist[] = ['stars' => $n, 'count' => $c];
                    $sum += $n * $c;
                    $count += $c;
                }

                return ['total' => $count, 'average' => $count ? round($sum / $count, 1) : null, 'distribution' => $dist];
            };
            $reviewStars = $stars($starRows('product_reviews'));
            $feedbackStars = $stars($starRows('feedbacks'));

            // ---- CUSTOMERS ----------------------------------------------------
            $customers = DB::table('users')
                ->where('role', 'user')
                ->selectRaw('COUNT(*) AS total')
                ->selectRaw('SUM(CASE WHEN created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS new_in_period', $range)
                ->selectRaw('SUM(CASE WHEN suspended_at IS NOT NULL THEN 1 ELSE 0 END) AS suspended')
                ->first();

            // ---- WORK QUEUE (current state, not the period) -------------------
            $queue = DB::table('orders')
                ->where('is_demo', false)
                ->where('order_status', '<>', 'rejected')
                ->selectRaw('SUM(CASE WHEN payment_status IN (?, ?) AND dp_proof_image_path IS NOT NULL THEN 1 ELSE 0 END) AS verify_dp', ['pending', 'needs_review'])
                ->selectRaw('SUM(CASE WHEN payment_status = ? AND full_payment_proof_image_path IS NOT NULL THEN 1 ELSE 0 END) AS verify_balance', ['50_paid'])
                ->selectRaw('SUM(CASE WHEN payment_status = ? AND order_status IN (?, ?) THEN 1 ELSE 0 END) AS to_ship', ['fully_paid', 'processing', 'ready_for_shipping'])
                ->selectRaw('SUM(CASE WHEN order_status = ? THEN 1 ELSE 0 END) AS in_transit', ['shipped'])
                ->first();

            // ---- CATALOG: stock + canvas engagement (lifetime counters) -------
            $products = DB::table('products')
                ->get(['id', 'name', 'stock', 'size_stocks', 'color_variants', 'canvas_drag_count', 'try_on_count']);

            $lowStock = 0;
            $outOfStock = 0;
            foreach ($products as $p) {
                if ((int) $p->stock <= 0) {
                    $outOfStock++;
                }
                foreach ($this->sizeStocks($p) as $qty) {
                    if ($qty <= self::LOW_STOCK) {
                        $lowStock++;
                    }
                }
            }
            $canvas = $products
                ->sortByDesc(fn ($p) => (int) $p->canvas_drag_count + (int) $p->try_on_count)
                ->filter(fn ($p) => ((int) $p->canvas_drag_count + (int) $p->try_on_count) > 0)
                ->take(5)
                ->map(fn ($p) => [
                    'name' => $p->name,
                    'canvas' => (int) $p->canvas_drag_count,
                    'try_ons' => (int) $p->try_on_count,
                ])
                ->values();

            $change = fn ($current, $previous) => ($previous !== null && $previous > 0)
                ? (int) round((($current - $previous) / $previous) * 100)
                : null;

            $tryOnTotal = $sessions->count();

            return response()->json([
                'period' => $period,
                'granularity' => $bucketFormat,
                'kpis' => [
                    'orders' => ['total' => $orders->count(), 'change_pct' => $change($orders->count(), $prev ? (int) $prev->orders : null)],
                    'revenue' => ['total' => round($revenue, 2), 'change_pct' => $change($revenue, $prev ? (float) $prev->revenue : null)],
                    'try_ons' => [
                        'total' => $tryOnTotal,
                        'success_rate' => $tryOnTotal ? (int) round($tryOnStatus['Completed'] / $tryOnTotal * 100) : null,
                        'change_pct' => $change($tryOnTotal, $prevTryOns),
                    ],
                    'customers' => [
                        'total' => (int) ($customers->total ?? 0),
                        'new' => (int) ($customers->new_in_period ?? 0),
                        'suspended' => (int) ($customers->suspended ?? 0),
                    ],
                    'review_rating' => ['average' => $reviewStars['average'], 'total' => $reviewStars['total']],
                    'feedback_rating' => ['average' => $feedbackStars['average'], 'total' => $feedbackStars['total']],
                ],
                'trend' => array_values(array_map(function ($b) {
                    if ($b['revenue'] !== null) {
                        $b['revenue'] = round($b['revenue'], 2);
                    }
                    return $b;
                }, $buckets)),
                'order_status' => collect($statusCounts)->map(fn ($c, $s) => ['name' => $s, 'value' => $c])->values(),
                'try_on_status' => collect($tryOnStatus)->map(fn ($c, $s) => ['name' => $s, 'value' => $c])->values(),
                'stack_layers' => collect($layers)->map(fn ($c, $s) => ['name' => $s, 'value' => $c])->values(),
                'most_tried' => collect($tried)->take(5)->map(fn ($c, $n) => ['name' => $n, 'sessions' => $c])->values(),
                'canvas_engagement' => $canvas,
                'review_stars' => $reviewStars,
                'feedback_stars' => $feedbackStars,
                'queue' => [
                    'verify_dp' => (int) ($queue->verify_dp ?? 0),
                    'verify_balance' => (int) ($queue->verify_balance ?? 0),
                    'to_ship' => (int) ($queue->to_ship ?? 0),
                    'in_transit' => (int) ($queue->in_transit ?? 0),
                    'low_stock_sizes' => $lowStock,
                    'out_of_stock' => $outOfStock,
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('Dashboard Insights Error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to load the dashboard analytics.'], 500);
        }
    }

    /**
     * GET /api/admin/work-summary — the ADMIN (staff) dashboard.
     *
     * Admins run the shop floor; the analytics board (revenue, ratings,
     * customer trends) is the owner's. This returns only what an admin acts
     * on: the order work queue, inventory status with the sizes running low,
     * and the orders waiting on them.
     */
    public function work(): JsonResponse
    {
        try {
            $queue = DB::table('orders')
                ->where('order_status', '<>', 'rejected')
                ->selectRaw('SUM(CASE WHEN payment_status IN (?, ?) AND dp_proof_image_path IS NOT NULL THEN 1 ELSE 0 END) AS verify_dp', ['pending', 'needs_review'])
                ->selectRaw('SUM(CASE WHEN payment_status = ? AND full_payment_proof_image_path IS NOT NULL THEN 1 ELSE 0 END) AS verify_balance', ['50_paid'])
                ->selectRaw('SUM(CASE WHEN payment_status = ? AND order_status IN (?, ?) THEN 1 ELSE 0 END) AS to_ship', ['fully_paid', 'processing', 'ready_for_shipping'])
                ->selectRaw('SUM(CASE WHEN order_status = ? THEN 1 ELSE 0 END) AS in_transit', ['shipped'])
                ->first();

            $products = DB::table('products')->get(['id', 'name', 'stock', 'size_stocks', 'color_variants', 'colors']);
            $low = [];
            $out = 0;
            foreach ($products as $p) {
                // Sold out only when NO colour has units left (main + variants).
                $variantUnits = 0;
                foreach ((array) (is_string($p->color_variants) ? json_decode($p->color_variants, true) : $p->color_variants) as $v) {
                    $variantUnits += max(0, (int) ($v['stock'] ?? array_sum(array_map('intval', (array) ($v['size_stocks'] ?? [])))));
                }
                if ((int) $p->stock + $variantUnits <= 0) {
                    $out++;
                }
                $sizes = is_string($p->size_stocks) ? json_decode($p->size_stocks, true) : (array) $p->size_stocks;
                foreach ((array) $sizes as $size => $qty) {
                    if ((int) $qty <= self::LOW_STOCK) {
                        $low[] = ['product_id' => $p->id, 'name' => $p->name, 'color' => null, 'size' => (string) $size, 'qty' => (int) $qty];
                    }
                }
                $variants = is_string($p->color_variants) ? json_decode($p->color_variants, true) : (array) $p->color_variants;
                foreach ((array) $variants as $v) {
                    foreach ((array) ($v['size_stocks'] ?? []) as $size => $qty) {
                        if ((int) $qty <= self::LOW_STOCK) {
                            $low[] = ['product_id' => $p->id, 'name' => $v['name'] ?? $p->name, 'color' => $v['color'] ?? null, 'size' => (string) $size, 'qty' => (int) $qty];
                        }
                    }
                }
            }
            usort($low, fn ($a, $b) => $a['qty'] <=> $b['qty']);

            $needsAction = DB::table('orders')
                ->where('order_status', '<>', 'rejected')
                ->where(function ($q) {
                    $q->where(fn ($w) => $w->whereIn('payment_status', ['pending', 'needs_review'])->whereNotNull('dp_proof_image_path'))
                        ->orWhere(fn ($w) => $w->where('payment_status', '50_paid')->whereNotNull('full_payment_proof_image_path'))
                        ->orWhere(fn ($w) => $w->where('payment_status', 'fully_paid')->whereIn('order_status', ['processing', 'ready_for_shipping']));
                })
                ->orderBy('created_at')
                ->limit(6)
                ->get(['id', 'customer_name', 'payment_status', 'order_status', 'total_amount', 'is_demo', 'created_at']);

            return response()->json([
                'queue' => [
                    'verify_dp' => (int) ($queue->verify_dp ?? 0),
                    'verify_balance' => (int) ($queue->verify_balance ?? 0),
                    'to_ship' => (int) ($queue->to_ship ?? 0),
                    'in_transit' => (int) ($queue->in_transit ?? 0),
                ],
                'inventory' => [
                    'products' => $products->count(),
                    'low_stock_sizes' => count($low),
                    'out_of_stock' => $out,
                    'low_stock' => array_slice($low, 0, 8),
                ],
                'needs_action' => $needsAction,
            ]);
        } catch (\Throwable $e) {
            Log::error('Work summary error: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to load your work summary.'], 500);
        }
    }

    /**
     * The period window, the matching previous window (null for "all"), and
     * the empty trend buckets keyed by their format.
     */
    private function window(string $period): array
    {
        $now = now(self::TZ);

        [$start, $format, $step, $labelFmt, $fullFmt, $end] = match ($period) {
            'today' => [$now->copy()->startOfDay(), 'Y-m-d H', 'addHour', 'g A', 'M j, g:00 A', $now->copy()->endOfDay()],
            'week' => [$now->copy()->subDays(6)->startOfDay(), 'Y-m-d', 'addDay', 'D', 'l, M j', $now->copy()->endOfDay()],
            'month' => [$now->copy()->subDays(29)->startOfDay(), 'Y-m-d', 'addDay', 'M j', 'l, M j', $now->copy()->endOfDay()],
            'all' => [$now->copy()->subMonths(11)->startOfMonth(), 'Y-m', 'addMonth', 'M', 'F Y', $now->copy()->endOfMonth()],
        };

        $prevStart = match ($period) {
            'today' => $start->copy()->subDay(),
            'week' => $start->copy()->subDays(7),
            'month' => $start->copy()->subDays(30),
            'all' => null,
        };
        // Same elapsed time into the previous period, so the % change is fair.
        $prevEnd = $prevStart?->copy()->addSeconds($start->diffInSeconds($now));

        $buckets = [];
        for ($cursor = $start->copy(); $cursor <= $end; $cursor->{$step}()) {
            $past = $cursor <= $now;
            $buckets[$cursor->format($format)] = [
                'label' => $cursor->format($labelFmt),
                'full_label' => $cursor->format($fullFmt),
                // Future buckets stay null so the lines stop at "now".
                'revenue' => $past ? 0.0 : null,
                'orders' => $past ? 0 : null,
                'try_ons' => $past ? 0 : null,
            ];
        }

        // "All time" really means all time for the totals; the chart shows 12 months.
        $rangeStart = $period === 'all' ? Carbon::create(2000, 1, 1, 0, 0, 0, self::TZ) : $start;

        return [$rangeStart, $now, $prevStart, $prevEnd, $buckets, $format];
    }

    private function bucketKey($createdAt, string $format): string
    {
        return Carbon::parse($createdAt, 'UTC')->setTimezone(self::TZ)->format($format);
    }

    private function jsonList($value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }

        return is_array($value) ? array_values($value) : [];
    }

    /** Every per-size stock count of a product, including its colour variants. */
    private function sizeStocks(object $p): array
    {
        $out = [];
        foreach ([$p->size_stocks] as $raw) {
            foreach ((array) (is_string($raw) ? json_decode($raw, true) : $raw) as $qty) {
                $out[] = (int) $qty;
            }
        }
        $variants = is_string($p->color_variants) ? json_decode($p->color_variants, true) : $p->color_variants;
        foreach ((array) $variants as $v) {
            foreach ((array) ($v['size_stocks'] ?? []) as $qty) {
                $out[] = (int) $qty;
            }
        }

        return $out;
    }
}
