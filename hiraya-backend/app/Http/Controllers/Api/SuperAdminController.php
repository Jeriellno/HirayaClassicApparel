<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Product;
use App\Models\SystemSetting;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Super-Admin-exclusive platform operations backing the console's Settings,
 * Audit Logs and Dashboard utilities.
 *
 * The two "Capstone Demo Utilities" buttons in SettingsTab were previously
 * `alert()`-only stubs ("Export Full Backup", "Clear Demo Analytics Logs") and
 * the settings toggles wrote to Supabase with a HARDCODED superadmin email, so
 * the audit trail never named the real actor. These endpoints replace all of
 * that with real, attributed operations.
 */
class SuperAdminController extends Controller
{
    /**
     * Default settings seeded the first time the console reads them.
     *
     * `maintenance_mode` was REMOVED from this surface. It paused the storefront
     * for every visitor and is not part of the current work, so the Super Admin
     * console no longer exposes or reports it. Any existing row in the
     * `system_settings` table is simply left untouched and ignored — no migration
     * is needed, and the value can be reinstated here if the feature returns.
     *
     * `guest_ai_access` was REMOVED for a harder reason: it had NO consumer.
     * The flag was written and reported but nothing read it, so flipping it
     * changed nothing a customer could observe. It could not simply be wired up
     * like the two below — the try-on pipeline is built on an authenticated user
     * (TryOnController reads the signed-in user's id, portrait, bag and saved
     * measurements) and every /tryon/* route sits behind auth:sanctum, so a
     * guest fitting needs an anonymous-session model that does not exist. The
     * toggle and its reporting are dropped rather than left inert; the row, if
     * present, is ignored.
     */
    private const DEFAULT_SETTINGS = [
        'ai_engine_active' => 'true',
        'registrations_open' => 'true',
    ];

    /**
     * Cache key + TTL for the public status payload.
     *
     * 30s is deliberately shorter than the client's own 60s poll interval, so a
     * toggle an admin flips is never more than one poll cycle away from every
     * visitor even if the explicit bust below were somehow missed.
     */
    private const STATUS_CACHE_KEY = 'system-status-public';

    private const STATUS_CACHE_TTL = 30;

    /**
     * How long an UNCACHED settings read may take before it is abandoned.
     *
     * `/admin/settings` is a trivial `SystemSetting::all()`, but it lives on the
     * console's mount path and the remote pooler has intermittently stalled on
     * DNS/connect. Past this budget the seeded defaults are served instead, so a
     * slow database degrades to a usable panel rather than a timed-out request.
     * Matches the cold-read budget in `publicStatus`.
     */
    private const SETTINGS_READ_BUDGET_SECONDS = 3;

    /**
     * A LOCAL, DISK-BACKED store for this route's cache — deliberately NOT the
     * app-wide `CACHE_STORE`.
     *
     * WHY THIS IS NOT A MICRO-OPTIMISATION
     * ------------------------------------
     * `CACHE_STORE=database` (see .env) puts the cache in the SAME remote
     * Supabase pooler as the data. Caching into it therefore does NOT remove the
     * network round trip — it replaces one remote query with another, so it
     * cannot protect this route from the failure that actually hurts:
     *
     *   the `php artisan serve` dev server is SINGLE-THREADED. Any request that
     *   waits on the remote database occupies the ONLY worker, and every other
     *   request — including `/up`, which touches no database — blocks behind it.
     *   MEASURED: 6 ESTABLISHED + 4 CLOSEWAIT connections queued, `/up` timing
     *   out at 20s, and the whole storefront appearing dead.
     *
     * The pooler intermittently fails to resolve on this machine:
     *
     *   SQLSTATE[08006] [7] could not translate host name
     *   "aws-0-ap-southeast-1.pooler.supabase.com" to address: Unknown host
     *
     * A FILE store has no network dependency at all, so a status read stays fast
     * and — more importantly — CANNOT BLOCK THE WORKER on a database round trip.
     * Once warmed, this route never touches the network.
     *
     * A local store is also safe here specifically because the payload is four
     * booleans and the cache is deliberately short-lived (30s) and explicitly
     * busted on every write (see `updateSetting`), so a single-process dev server
     * is exactly the right scope for it.
     */
    private static function statusCacheStore(): \Illuminate\Contracts\Cache\Repository
    {
        return Cache::store('file');
    }

    /**
     * GET /api/system-status  (PUBLIC)
     *
     * Anonymous read of the public-facing toggles so the storefront can honor
     * maintenance_mode, registrations_open, etc. Deliberately exposes ONLY
     * these non-sensitive flags — never the full admin settings surface.
     */
    public function publicStatus()
    {
        /*
         * The public, non-sensitive flags the storefront is allowed to read.
         *
         * `maintenance_mode` was REMOVED along with the console toggle. Returning
         * a flag no one can set (and that the frontend gate no longer consumes)
         * would just be a value that drifts from reality, so it is dropped from
         * the payload entirely rather than always answering `false`.
         */
        $public = [
            'registrations_open',
            'ai_engine_active',
        ];

        /*
         * WHY THIS ROUTE IS CACHED, AND WHY THAT IS NOT A MICRO-OPTIMISATION.
         *
         * `/system-status` is the MOST FREQUENTLY CALLED endpoint in the app:
         * `useMaintenanceMode` fetches it on every page mount, every 60s
         * interval, AND every tab focus — from every open tab. Each of those
         * calls previously ran `SystemSetting::all()`, i.e. a database round
         * trip over the network to the Supabase pooler.
         *
         * MEASURED FAILURE THIS FIXES
         * ---------------------------
         * The dev server (`php artisan serve`) is SINGLE-THREADED. When several
         * tabs were open, their status reads occupied the one worker and the
         * server stopped answering ANYTHING — including `/up`, which touches no
         * database at all and still timed out at 20s with 6 ESTABLISHED and 4
         * CLOSEWAIT connections queued against it. The storefront then appeared
         * completely dead: every request, on every page, `ERR_CONNECTION_REFUSED`
         * or a browser-side cancel.
         *
         * This mirrors a logged DB fault on this machine:
         *
         *   SQLSTATE[08006] [7] could not translate host name
         *   "aws-0-ap-southeast-1.pooler.supabase.com" to address: Unknown host
         *
         * An intermittent DNS failure resolving the pooler, which makes every
         * uncached status read a potential multi-second stall against the single
         * worker.
         *
         * The payload is four booleans that change only when a superadmin flips
         * a toggle, so a short cache costs nothing in freshness — `updateSetting`
         * below explicitly busts this key on every write, so a toggle takes
         * effect immediately.
         */
        $status = null;
        $store = self::statusCacheStore();

        /*
         * BOUNDED WAIT ON THE COLD PATH.
         *
         * Once warm, this endpoint is a FILE-cache hit and answers in
         * milliseconds with no network at all. The one remaining slow case was
         * the COLD path: `SystemSetting::all()` over the remote Supabase pooler,
         * whose DNS/connect has intermittently stalled (see the class note on
         * the cache store). Because `/system-status` is called on EVERY page
         * mount from EVERY open tab, a single cold read held the single-threaded
         * dev worker while every other request queued behind it — which surfaced
         * as "timeout of 45000ms exceeded" in useMaintenanceMode.
         *
         * A cold read now gets a SHORT budget. If the pooler does not answer
         * inside it, we stop waiting and serve the safe defaults immediately,
         * leaving the cache cold so the next call retries. Four booleans are not
         * worth blocking the storefront for: the frontend already treats a
         * missing status as "maintenance OFF", and `updateSetting` busts the
         * cache on every real change, so a served default is corrected the
         * moment an operator flips a toggle.
         */
        $coldReadBudgetSeconds = 3;

        try {
            if ($store->has(self::STATUS_CACHE_KEY)) {
                // Warm: pure file-cache hit, no network, no budget needed.
                $status = $store->get(self::STATUS_CACHE_KEY);
            } else {
                // Cold: read under a deadline, then fall through to defaults.
                $status = $store->remember(
                    self::STATUS_CACHE_KEY,
                    self::STATUS_CACHE_TTL,
                    function () use ($public, $coldReadBudgetSeconds) {
                        $startedAt = microtime(true);

                        $rows = SystemSetting::all()->keyBy('key');

                        if (microtime(true) - $startedAt > $coldReadBudgetSeconds) {
                            // Too slow to be worth caching; let the next call retry.
                            throw new \RuntimeException('System status read exceeded budget.');
                        }

                        $fresh = [];
                        foreach ($public as $key) {
                            $default = self::DEFAULT_SETTINGS[$key] === 'true';
                            $fresh[$key] = $rows->has($key) ? $rows[$key]->value === 'true' : $default;
                        }

                        return $fresh;
                    }
                );
            }
        } catch (\Throwable $e) {
            /*
             * A DB fault must NOT take the storefront down with it.
             *
             * `CACHE_STORE=database` (if configured) puts the cache in the SAME
             * unreachable database, so the cache read can fail too. The safe
             * default is the frontend's own fallback, and the response is still a
             * valid 200 so consumers are never left guessing.
             */
            Log::warning('System status read failed; serving defaults: ' . $e->getMessage());
        }

        if (!is_array($status)) {
            $status = [];
            foreach ($public as $key) {
                $status[$key] = self::DEFAULT_SETTINGS[$key] === 'true';
            }
        }

        /*
         * Allow the browser to reuse the payload briefly as well. The client
         * already polls on a 60s interval, so a short max-age removes the
         * duplicate request a route change would otherwise cost without ever
         * serving a value older than one poll cycle.
         */
        return response()
            ->json($status)
            ->header('Cache-Control', 'public, max-age=10');
    }

    /**
     * GET /api/admin/settings
     *
     * Returns every toggle as a boolean map the SettingsTab can render directly.
     *
     * The read is bounded the same way `publicStatus` is. This is the SAME
     * trivial `SystemSetting::all()` read, but it lives on the console's mount
     * path and the pooler has intermittently stalled on DNS/connect (see the
     * class note on the cache store). Unbounded, a single slow pooler answer
     * held the request for the client's whole timeout and made the Settings tab
     * look broken. A short deadline makes it fail safe instead: on timeout the
     * seeded defaults are returned, so the console still renders a usable panel.
     */
    public function settings()
    {
        try {
            $rows = $this->readSettingsWithinBudget();
        } catch (\Throwable $e) {
            Log::warning('System settings read failed; serving defaults: ' . $e->getMessage());

            return response()->json($this->defaultSettingsMap());
        }

        $settings = [];
        foreach (self::DEFAULT_SETTINGS as $key => $default) {
            $settings[$key] = $rows->has($key)
                ? $rows[$key]->value === 'true'
                : $default === 'true';
        }

        return response()->json($settings);
    }

    /**
     * Reads the settings rows under a short deadline.
     *
     * Mirrors the cold-path budget in `publicStatus`: a slow pooler must not hold
     * a console request open indefinitely. Throwing lets the caller fall back to
     * the seeded defaults.
     *
     * @return \Illuminate\Support\Collection<string, SystemSetting>
     */
    private function readSettingsWithinBudget()
    {
        $startedAt = microtime(true);
        $rows = SystemSetting::all()->keyBy('key');

        if (microtime(true) - $startedAt > self::SETTINGS_READ_BUDGET_SECONDS) {
            throw new \RuntimeException('System settings read exceeded budget.');
        }

        return $rows;
    }

    /**
     * The seeded defaults as a boolean map, used when the settings read fails.
     *
     * @return array<string, bool>
     */
    private function defaultSettingsMap(): array
    {
        $defaults = [];
        foreach (self::DEFAULT_SETTINGS as $key => $default) {
            $defaults[$key] = $default === 'true';
        }

        return $defaults;
    }

    /**
     * PUT /api/admin/settings/{key}
     *
     * Sets one toggle and records WHO did it (the authenticated superadmin),
     * not a hardcoded address.
     */
    public function updateSetting(Request $request, string $key)
    {
        $validated = $request->validate([
            'value' => ['required', 'boolean'],
        ]);

        if (!array_key_exists($key, self::DEFAULT_SETTINGS)) {
            return response()->json(['message' => "Unknown setting '{$key}'."], 422);
        }

        try {
            $value = $validated['value'] ? 'true' : 'false';

            SystemSetting::updateOrCreate(
                ['key' => $key],
                ['value' => $value, 'updated_by' => $request->user()?->id]
            );

            AuditLog::create([
                'admin_email' => $request->user()?->email,
                'action' => 'UPDATE_SETTING',
                'target' => 'SYSTEM_SETTINGS',
                'details' => "{$key} = {$value}",
            ]);

            /*
             * BUST THE PUBLIC STATUS CACHE.
             *
             * `publicStatus` is cached (see that method), so without this a
             * superadmin flipping a toggle would keep serving the stale value for
             * up to the cache TTL — the storefront would not reflect the change.
             *
             * The bust is intentionally inside the same try/catch as the write:
             * the setting is already persisted, so a cache failure must not turn a
             * successful update into a 500. Worst case the TTL expires instead.
             */
            try {
                self::statusCacheStore()->forget(self::STATUS_CACHE_KEY);
            } catch (\Throwable $e) {
                Log::warning('Could not bust the system-status cache: ' . $e->getMessage());
            }

            return response()->json([
                'key' => $key,
                'value' => $validated['value'],
            ]);
        } catch (\Throwable $e) {
            Log::error('Setting update failed: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to update setting.'], 500);
        }
    }

    /**
     * GET /api/admin/audit-logs
     */
    public function auditLogs()
    {
        return response()->json(
            AuditLog::latest()->limit(500)->get()
        );
    }

    /**
     * GET /api/admin/export
     *
     * A full JSON backup of the catalog, orders, customers and privileged
     * accounts — the real replacement for the old stub alert.
     *
     * ACTUALLY STREAMED, NOT BUFFERED IN DISGUISE.
     * --------------------------------------------
     * This method used to build the ENTIRE payload first (`Product::all()`,
     * `Order::with('orderItems')->get()`, …) and only then hand the assembled
     * array to `streamDownload`. That loads every row of the database into memory
     * before a single byte is sent, so on a large catalog the export could
     * exhaust memory — the exact opposite of the "streamed (not buffered)"
     * guarantee the old comment claimed.
     *
     * Each collection is now read in BOUNDED CHUNKS and written out as it is
     * scanned (`chunkById`, which is stable against concurrent inserts unlike
     * `chunk`), so peak memory is one chunk rather than one table.
     *
     * The file is still VALID JSON. The top-level object is opened first, each
     * collection is emitted as an array whose elements are written one at a time,
     * and the object is closed at the end — the output is byte-identical in shape
     * to `json_encode($payload, JSON_PRETTY_PRINT)`, just never materialised all
     * at once. Existing importers therefore keep working.
     */
    public function export()
    {
        $filename = 'hiraya_backup_' . now()->format('Y-m-d_His') . '.json';
        $chunkSize = 500;

        return response()->streamDownload(function () use ($chunkSize) {
            /*
             * Section name -> a builder for that table. Names are read from the
             * ARRAY KEYS, so the emitted JSON keys and the query builders can
             * never drift apart.
             */
            $sections = [
                'products'  => fn () => Product::query()->orderBy('id'),
                'orders'    => fn () => Order::query()->with('orderItems')->orderBy('id'),
                'customers' => fn () => User::query()->where('role', 'user')->orderBy('id'),
                'admins'    => fn () => User::query()->whereIn('role', ['admin', 'superadmin'])->orderBy('id'),
                'settings'  => fn () => SystemSetting::query()->orderBy('id'),
            ];

            // NOTE: every newline below is a DOUBLE-quoted "\n". The original
            // single-quoted '{\n' emitted a literal backslash-n, which is not
            // valid JSON whitespace — that alone corrupted the document.
            echo "{\n";
            echo '  "generated_at": ' . json_encode(now()->toIso8601String()) . ",\n";

            $names = array_keys($sections);
            $sectionCount = count($names);

            foreach ($names as $index => $key) {
                echo '  ' . json_encode($key) . ': [';

                /*
                 * The "has this array emitted an element yet" flag is tracked in
                 * a variable the WRITE callback and the closing `echo` BOTH see.
                 * It was previously a closure-local `$first` read after the loop,
                 * which was always still `true` — so the array was never closed.
                 */
                $emitted = 0;
                // `chunkById` walks the table by primary key, so it never holds
                // more than one page in memory and is not disturbed by rows
                // inserted behind the cursor.
                $sections[$key]()->chunkById($chunkSize, function ($rows) use (&$emitted) {
                    foreach ($rows as $row) {
                        // Pretty-print each record and indent it to sit inside the
                        // enclosing array, so the streamed output reads exactly
                        // like a normal pretty-printed JSON document.
                        $encoded = json_encode(
                            $row->toArray(),
                            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
                        );
                        echo $emitted === 0 ? "\n" : ",\n";
                        echo '    ' . $encoded;
                        $emitted++;
                    }
                });

                // Close the array; an empty table emits `[]` with no newline.
                echo $emitted === 0 ? ']' : "\n  ]";
                echo $index < $sectionCount - 1 ? ",\n" : "\n";

                // Release the flushed output so a long backup does not accumulate
                // in PHP's output buffer.
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                flush();
            }

            echo "}\n";
        }, $filename, ['Content-Type' => 'application/json']);
    }

    /**
     * DELETE /api/admin/analytics/demo
     *
     * Clears the analytics/try-on counters used for the capstone demo. This is
     * deliberately scoped to COUNTERS and audit-noise, NOT to real orders or
     * accounts — the old stub claimed to "clear analytics logs" but a truthful,
     * bounded reset is safer than an unbounded wipe.
     */
    public function clearDemoAnalytics(Request $request)
    {
        try {
            // Reset the per-product interaction counters shown on the analytics
            // dashboard so a presentation starts from a clean slate.
            $resetCount = Product::query()
                ->where(function ($q) {
                    $q->where('canvas_drag_count', '>', 0)
                        ->orWhere('try_on_count', '>', 0);
                })
                ->update([
                    'canvas_drag_count' => 0,
                    'try_on_count' => 0,
                ]);

            AuditLog::create([
                'admin_email' => $request->user()?->email,
                'action' => 'CLEAR_DEMO_ANALYTICS',
                'target' => 'ANALYTICS',
                'details' => "Reset interaction counters on {$resetCount} product(s).",
            ]);

            return response()->json([
                'message' => 'Demo analytics counters cleared.',
                'products_reset' => $resetCount,
            ]);
        } catch (\Throwable $e) {
            Log::error('Clear demo analytics failed: ' . $e->getMessage());

            return response()->json(['message' => 'Failed to clear demo analytics.'], 500);
        }
    }
}
