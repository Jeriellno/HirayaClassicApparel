<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * `php artisan hiraya:doctor`
 *
 * One-shot health check for the exact failure mode that produced:
 *
 *   axios.js:130 Request to "/products" timed out after 15000ms
 *   axios.js:130 Request to "/register" timed out after 20000ms
 *
 * Those errors look like a frontend/Axios problem but they are not. They mean
 * the backend never finished the request. The two realistic causes are:
 *
 *   1. The Supabase pooler is slow/cold, so a request's many sequential queries
 *      exceed the client's timeout; and because `php artisan serve` is
 *      SINGLE-THREADED, that one slow request also blocks every other request
 *      the browser has open.
 *
 *   2. A previous request wedged the dev server, so NOTHING answers — which is
 *      detectable by timing the DB-free `/up` health endpoint.
 *
 * This command times both the database and the HTTP surface so the culprit is
 * named explicitly instead of guessed at.
 */
class Doctor extends Command
{
    protected $signature = 'hiraya:doctor {--url=http://127.0.0.1:8000 : Base URL of the running API}';

    protected $description = 'Diagnose slow/hung API requests (database latency + server responsiveness).';

    public function handle(): int
    {
        $this->newLine();
        $this->line('<options=bold>Hiraya doctor</> — locating the source of timed-out API requests');
        $this->line(str_repeat('─', 64));

        $dbHealthy = $this->checkDatabase();
        $httpHealthy = $this->checkHttp();

        $this->line(str_repeat('─', 64));

        if (!$dbHealthy) {
            $this->error('DATABASE is the bottleneck — this is what times out /products and /register.');
        }

        if (!$httpHealthy) {
            $this->error('The dev server is NOT answering /up. Restart it (see notes below).');
        }

        if ($dbHealthy && $httpHealthy) {
            $this->info('Backend looks healthy: database is fast and the server answers quickly.');
        }

        $this->newLine();
        $this->comment('Notes:');
        $this->line('  • `php artisan serve` handles ONE request at a time. Under a React Query');
        $this->line('    SPA that opens several parallel requests, one slow query stalls them all.');
        $this->line('  • Prefer a multi-process server for development, e.g. `php artisan serve`');
        $this->line('    is fine for a single tab, but for parallel requests run Laravel Octane,');
        $this->line('    or a real web server (nginx + php-fpm) which handles requests concurrently.');

        return ($dbHealthy && $httpHealthy) ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Time a connect, a no-op query, and a real table read.
     *
     * A no-op `SELECT 1` should be ~1-2ms. Anything in the hundreds of ms means
     * the pooler is remote/cold and EVERY query in every request pays that cost.
     */
    private function checkDatabase(): bool
    {
        $this->newLine();
        $this->line('<options=bold>Database</>');

        try {
            $connectStart = microtime(true);
            $connection = DB::connection();
            $connection->getPdo();
            $connectMs = $this->ms($connectStart);

            $pingStart = microtime(true);
            $connection->select('SELECT 1');
            $pingMs = $this->ms($pingStart);

            $countStart = microtime(true);
            $productCount = $connection->table('products')->count();
            $countMs = $this->ms($countStart);

            $this->report('connect', $connectMs, 2000);
            $this->report('SELECT 1', $pingMs, 200);
            $this->report('COUNT(products)=' . $productCount, $countMs, 500);

            /*
             * The meaningful budget is the WORST query, not the average: a
             * request issues several, and it is the total that must fit inside
             * the client's timeout. 500ms+ on a trivial read is unhealthy.
             */
            $healthy = $pingMs < 200 && $countMs < 500;

            if (!$healthy) {
                $this->warn('  → Query latency is high. Each API request issues several');
                $this->warn('    queries, so they add up past the client timeout.');
            }

            return $healthy;
        } catch (Throwable $e) {
            $this->line(' <fg=red>FAILED</> ' . $e->getMessage());

            return false;
        }
    }

    /**
     * Time the `/up` health endpoint.
     *
     * `/up` touches NO database, so if it is slow or times out the problem is
     * the server process itself (wedged, not merely busy) — not the database.
     */
    private function checkHttp(): bool
    {
        $this->newLine();
        $this->line('<options=bold>HTTP</>');
        $base = rtrim((string) $this->option('url'), '/');

        try {
            $start = microtime(true);
            $response = Http::timeout(10)->get($base . '/up');
            $elapsedMs = $this->ms($start);

            $this->report('/up (no DB access)', $elapsedMs, 1500);

            if ($response->failed()) {
                $this->warn('  → Non-2xx response: HTTP ' . $response->status());

                return false;
            }

            return $elapsedMs < 5000;
        } catch (Throwable $e) {
            $this->line(' <fg=red>TIMED OUT</> ' . $e->getMessage());
            $this->line('  → /up needs no database, so the server process itself is stuck.');
            $this->line('    Restart it:  Ctrl+C, then `php artisan serve` again.');

            return false;
        }
    }

    private function ms(float $startedAt): int
    {
        return (int) round((microtime(true) - $startedAt) * 1000);
    }

    private function report(string $label, int $elapsedMs, int $budgetMs): void
    {
        $colour = $elapsedMs <= $budgetMs ? 'green' : 'yellow';
        $this->line(sprintf(
            '  %-28s <fg=%s>%5d ms</> <fg=gray>(budget %d ms)</>',
            $label,
            $colour,
            $elapsedMs,
            $budgetMs
        ));
    }
}
