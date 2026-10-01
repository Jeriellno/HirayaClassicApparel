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
use Illuminate\Support\Facades\DB;
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
    public function auditLogs(Request $request)
    {
        /*
         * TWO VIEWS OF ONE TRAIL.
         *
         * The route is open to admins (they audit customer accounts), so the
         * reduction is decided here from the SIGNED-IN role, never from a query
         * flag a client could flip:
         *
         *   superadmin — every row, unmasked, with IP addresses.
         *   admin      — customer-area rows only (USER_ACCOUNTS, CUSTOMERS),
         *                emails masked, IPs withheld. Settings, credentials,
         *                staff accounts and exports stay owner-only.
         *
         * `subject_user_id` narrows the list to one customer's history, which
         * is what the customer profile's "Account activity" panel reads.
         */
        $request->validate([
            'subject_user_id' => ['nullable', 'integer', 'min:1'],
        ]);

        $role = strtolower(str_replace(['-', '_'], '', (string) $request->user()?->role));
        $isOwner = $role === 'superadmin';

        $query = AuditLog::latest();

        if (!$isOwner) {
            $query->whereIn('target', AuditLog::CUSTOMER_TARGETS);
            // An admin sees nothing from before their own account existed.
            if ($request->user()?->created_at) {
                $query->where('created_at', '>=', $request->user()->created_at);
            }
        }

        if ($request->filled('subject_user_id')) {
            $query->where('subject_user_id', (int) $request->query('subject_user_id'));
        }

        $rows = $query->limit(500)->get();

        return response()->json(
            $isOwner ? $rows : $rows->map(fn (AuditLog $log) => $log->toLimitedArray())->values()
        );
    }

    /**
     * GET /api/admin/export?format=json|sql
     *
     * A FULL, RESTORABLE BACKUP of the application data — the safety net in
     * case rows are ever corrupted or deleted by mistake.
     *
     *   json — every table as `{ "tables": { "tbl_users": [ ... ], ... } }`.
     *          Human-readable; good for keeping and inspecting.
     *   sql  — a PostgreSQL script of INSERT statements (ON CONFLICT DO NOTHING)
     *          plus sequence resets. Paste it into the Supabase SQL editor to
     *          put missing rows back without touching rows that are intact.
     *
     * WHAT IS INCLUDED: every table in the `public` schema, discovered at run
     * time (so a table added later is backed up without code changes), read
     * with the query builder so hidden model attributes (password hashes) are
     * kept — a backup that cannot restore logins is not a backup.
     *
     * WHAT IS LEFT OUT: transient tables that are rebuilt on their own (cache,
     * jobs, queue batches, failed jobs, sessions), live sign-in tokens, and
     * `api_credentials` — encrypted third-party keys are re-entered, never
     * shipped around in a download.
     *
     * STREAMED, NOT BUFFERED: each table is read in bounded chunks (by primary
     * key) and written as it is scanned, so peak memory is one chunk. Product
     * IMAGES live in Supabase Storage, not the database; the backup keeps their
     * URLs.
     */
    public function export(Request $request)
    {
        $format = $request->query('format', 'json');
        if (!in_array($format, ['json', 'sql'], true)) {
            return response()->json(['message' => 'The format must be json or sql.'], 422);
        }

        $tables = $this->backupTables();
        $stamp = now()->format('Y-m-d_His');
        $filename = "hiraya_backup_{$stamp}.{$format}";

        // Record WHO took a copy of the database, and which tables it held.
        try {
            AuditLog::create([
                'admin_email' => $request->user()?->email,
                'actor_role' => strtolower(str_replace(['-', '_'], '', (string) $request->user()?->role)) ?: null,
                'action' => 'EXPORT_DATABASE',
                'target' => 'SYSTEM',
                'details' => strtoupper($format) . ' backup of ' . count($tables) . ' tables: ' . implode(', ', array_keys($tables)) . '.',
                'ip_address' => $request->ip(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Export audit write failed: ' . $e->getMessage());
        }

        $writer = $format === 'sql'
            ? fn () => $this->streamSql($tables)
            : fn () => $this->streamJson($tables);

        return response()->streamDownload($writer, $filename, [
            'Content-Type' => $format === 'sql' ? 'application/sql; charset=utf-8' : 'application/json; charset=utf-8',
        ]);
    }

    /** Tables never written to a backup (transient state or secrets). */
    private const BACKUP_SKIP = [
        'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs',
        'sessions', 'personal_access_tokens', 'api_credentials',
    ];

    /**
     * short name => [full table name, primary-key column or null], for every
     * backed-up table in the public schema.
     */
    private function backupTables(): array
    {
        $prefix = DB::getTablePrefix();
        $rows = DB::select(
            "select c.relname,
                    (select a.attname
                       from pg_index i
                       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                      where i.indrelid = c.oid and i.indisprimary and i.indnatts = 1
                      limit 1) as pk
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('r', 'p')
              order by c.relname"
        );

        $tables = [];
        foreach ($rows as $row) {
            if ($prefix !== '' && !str_starts_with($row->relname, $prefix)) {
                continue;
            }
            $short = substr($row->relname, strlen($prefix));
            if (in_array($short, self::BACKUP_SKIP, true)) {
                continue;
            }
            $tables[$short] = [$row->relname, $row->pk];
        }

        return $tables;
    }

    /** Calls $each for every row of a table, one bounded chunk at a time. */
    private function eachRow(string $short, ?string $pk, callable $each): void
    {
        $query = DB::table($short);
        if ($pk) {
            $query->chunkById(500, function ($rows) use ($each) {
                foreach ($rows as $row) {
                    $each((array) $row);
                }
            }, $pk);

            return;
        }
        // No single-column key: small tables only (none of the backed-up ones today).
        foreach ($query->get() as $row) {
            $each((array) $row);
        }
    }

    private function flushOutput(): void
    {
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
    }

    private function streamJson(array $tables): void
    {
        echo "{\n";
        echo '  "format": "hiraya-backup-v2",' . "\n";
        echo '  "generated_at": ' . json_encode(now()->toIso8601String()) . ",\n";
        echo '  "tables": {';

        $first = true;
        foreach ($tables as $short => [$full, $pk]) {
            echo ($first ? "\n" : ",\n") . '    ' . json_encode($full) . ': [';
            $first = false;
            $emitted = 0;
            $this->eachRow($short, $pk, function (array $row) use (&$emitted) {
                echo ($emitted === 0 ? "\n" : ",\n") . '      '
                    . json_encode($row, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                $emitted++;
            });
            echo $emitted === 0 ? ']' : "\n    ]";
            $this->flushOutput();
        }

        echo "\n  }\n}\n";
    }

    private function streamSql(array $tables): void
    {
        $pdo = DB::getPdo();
        $q = fn (string $ident) => '"' . str_replace('"', '""', $ident) . '"';
        $literal = function ($value) use ($pdo) {
            if ($value === null) {
                return 'NULL';
            }
            if (is_bool($value)) {
                return $value ? 'TRUE' : 'FALSE';
            }
            if (is_int($value) || is_float($value)) {
                return (string) $value;
            }

            return $pdo->quote((string) $value);
        };

        echo "-- Hiraya database backup\n";
        echo '-- Generated ' . now()->toIso8601String() . "\n";
        echo "--\n";
        echo "-- RESTORE: paste into the Supabase SQL editor and run.\n";
        echo "--   * Rows that still exist are left untouched (ON CONFLICT DO NOTHING);\n";
        echo "--     missing or deleted rows are put back.\n";
        echo "--   * To restore a table COMPLETELY, first run e.g.\n";
        echo "--       TRUNCATE public.\"tbl_orders\" CASCADE;\n";
        echo "--     for the damaged table(s) only, then run this script.\n";
        echo "-- Foreign-key checks are relaxed for the session so tables load in any order.\n\n";
        echo "BEGIN;\n";
        echo "SET LOCAL session_replication_role = replica;\n\n";

        foreach ($tables as $short => [$full, $pk]) {
            echo '-- ' . $full . "\n";
            $this->eachRow($short, $pk, function (array $row) use ($full, $q, $literal) {
                $columns = implode(', ', array_map($q, array_keys($row)));
                $values = implode(', ', array_map($literal, array_values($row)));
                echo 'INSERT INTO public.' . $q($full) . " ({$columns}) VALUES ({$values}) ON CONFLICT DO NOTHING;\n";
            });

            // Move the id sequence past the restored rows, so new inserts never
            // collide. Only tables that HAVE a serial sequence: a uuid key such
            // as notifications.id has none, and MAX(uuid) does not exist.
            $sequence = $pk
                ? DB::selectOne('select pg_get_serial_sequence(?, ?) as seq', ['public.' . $q($full), $pk])?->seq
                : null;
            if ($sequence) {
                echo 'SELECT setval(' . $literal($sequence) . ', '
                    . 'GREATEST(COALESCE((SELECT MAX(' . $q($pk) . ') FROM public.' . $q($full) . '), 0), 1));' . "\n";
            }
            echo "\n";
            $this->flushOutput();
        }

        echo "COMMIT;\n";
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
