<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * `php artisan tryon:watch-worker`
 *
 * A SUPERVISOR for the try-on queue: keeps exactly ONE `queue:work` process
 * alive, restarting it when it dies.
 *
 * WHY A WATCHDOG IS NEEDED ON TOP OF THE REQUEST-TIME AUTO-START
 * --------------------------------------------------------------
 * `EnsureTryOnWorker` makes a worker exist whenever a customer presses Generate,
 * which covers the common case (a fresh machine, a reboot, a manual Ctrl+C).
 * It does NOT cover a worker that CRASHES MID-SESSION:
 *
 *   - the PHP process can be killed by the OS (memory pressure, an OOM),
 *   - a laptop that suspends and resumes can leave a half-dead child,
 *   - an unhandled fatal error exits the process.
 *
 * Each of those leaves the queue undrained, and with the request-time hook the
 * customer would still recover — but only on their NEXT Generate, and only after
 * the first attempt reports `worker_offline`. A running watchdog closes that gap
 * so the very first render works.
 *
 * This command IS the long-running process (like `queue:work` itself). It is
 * meant to be started once per machine — see `start-tryon.ps1`, which launches
 * it alongside the API server — and left running.
 *
 * THE HEARTBEAT
 * -------------
 * While looping, it refreshes `EnsureTryOnWorker::HEARTBEAT_KEY`. That key is the
 * liveness proof the ensure command reads, because a heartbeat that stopped
 * being refreshed is the only signal that distinguishes "the consumer is
 * iterating" from "a zombie process is still listed".
 */
class WatchTryOnWorker extends Command
{
    protected $signature = 'tryon:watch-worker
                            {--interval=10 : Seconds between health checks}
                            {--once : Run a single pass and exit (for tests/cron)}';

    protected $description = 'Supervise the `tryon` queue: keep exactly one worker alive.';

    public function handle(): int
    {
        $interval = max(3, (int) $this->option('interval'));
        $once = (bool) $this->option('once');

        if (config('queue.default') === 'sync') {
            $this->info('QUEUE_CONNECTION is `sync` — renders run inline; no watchdog is needed.');

            return self::SUCCESS;
        }

        $this->info("Watching the `tryon` queue every {$interval}s. Press Ctrl+C to stop.");

        do {
            $this->heartbeat();

            $started = $this->ensureWorker();

            if ($started) {
                $this->warn('[' . now()->format('H:i:s') . '] The try-on worker was down — restarted it.');
            }

            if ($once) {
                break;
            }

            /*
             * A SHORT SLEEP IN A LOOP, not a long one.
             *
             * The process must refresh its heartbeat often enough that the ensure
             * command never mistakes a LIVE watchdog for a dead one (the TTL is
             * 120s). It also has to notice a crashed worker promptly, so a few
             * seconds between passes is the right order of magnitude.
             */
            sleep($interval);
        } while (true);

        return self::SUCCESS;
    }

    /** Mark this watcher as alive, so `tryon:ensure-worker` can see it. */
    protected function heartbeat(): void
    {
        Cache::put(
            EnsureTryOnWorker::HEARTBEAT_KEY,
            now()->toIso8601String(),
            EnsureTryOnWorker::HEARTBEAT_TTL_SECONDS
        );
    }

    /**
     * Ensure exactly one worker is running. Returns true when one was started.
     *
     * The check is delegated to `EnsureTryOnWorker` so there is ONE definition of
     * "a worker is alive" in the codebase. Two independent detectors would sooner
     * or later disagree, and that disagreement is how a duplicate consumer (and
     * therefore a spurious `queue_full` from PixelAPI) gets created.
     */
    protected function ensureWorker(): bool
    {
        $ensure = app(EnsureTryOnWorker::class);

        if ($ensure->workerIsAlive()) {
            return false;
        }

        try {
            $this->call('tryon:ensure-worker', ['--quiet-if-running' => true]);
        } catch (\Throwable $e) {
            $this->error('Could not restart the worker: ' . $e->getMessage());

            return false;
        }

        return true;
    }
}
