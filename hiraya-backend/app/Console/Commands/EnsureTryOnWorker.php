<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * `php artisan tryon:ensure-worker`
 *
 * GUARANTEE that a `queue:work` process is draining the `tryon` queue.
 *
 * WHY THIS COMMAND EXISTS
 * -----------------------
 * `QUEUE_CONNECTION=database` routes every `ProcessTryOnJob` onto the dedicated
 * `tryon` queue. Nothing drains that queue unless a `queue:work` process is
 * running, and the failure is INVISIBLE until someone presses "Generate Virtual
 * Fitting": the site loads, the catalog works, and only the try-on silently
 * never completes (the client reports `worker_offline` after a 15s grace).
 *
 * That makes "start the worker" a step that is easy to forget and expensive to
 * debug — and asking a developer to run it by hand every reboot is exactly the
 * hassle this removes. So the worker is treated as a DEPENDENCY of the try-on
 * request rather than as manual setup: `TryOnController::initiateTryOn()` calls
 * this command when it is about to queue a render, and the command does nothing
 * at all when a worker is already running.
 *
 * IDEMPOTENT BY DESIGN
 * --------------------
 * Running it twice must never produce two workers. Two consumers on one queue
 * do not merely waste memory: PixelAPI serialises renders behind a ONE-JOB
 * queue, so a second concurrent submit is answered with `503 queue_full` /
 * `coalesced` — i.e. duplicate workers actively CAUSE the busy condition the
 * retry logic then has to absorb. Detection is therefore a required part of the
 * command, not a nicety.
 *
 * HOW THE WORKER IS DETECTED
 * --------------------------
 * There is no "is a worker alive" API, so liveness is decided from two cheap
 * signals:
 *
 *   1. A HEARTBEAT. A long-running worker keeps a cache key fresh; a key that
 *      stopped being refreshed is stale, so a crashed worker cannot look alive.
 *   2. A PROCESS SCAN. On Windows the worker is located by its command line
 *      (`queue:work`), which is the only reliable identifier for a PHP CLI
 *      process there.
 *
 * The heartbeat is written by the WATCHER (see `tryon:watch-worker`), not by
 * this command, because only a process that is actually iterating the loop can
 * prove it is alive.
 */
class EnsureTryOnWorker extends Command
{
    /** Cache key the watcher refreshes while it is alive. */
    public const HEARTBEAT_KEY = 'tryon:worker-heartbeat';

    /** A heartbeat older than this means the watcher/worker is gone. */
    public const HEARTBEAT_TTL_SECONDS = 120;

    protected $signature = 'tryon:ensure-worker
                            {--force : Start a worker even when one appears to be running}
                            {--quiet-if-running : Print nothing when a worker is already up}
                            {--no-watchdog : Do not start the supervisor loop, only a bare worker}';

    protected $description = 'Ensure a queue worker is draining the `tryon` queue (idempotent).';

    public function handle(): int
    {
        $quiet = (bool) $this->option('quiet-if-running');

        /*
         * On `sync` there is no queue to drain: the render runs inline inside the
         * request. Starting a worker would be pointless, so the command reports
         * that clearly instead of spawning a process nobody needs.
         */
        if (config('queue.default') === 'sync') {
            if (! $quiet) {
                $this->info('QUEUE_CONNECTION is `sync` — renders run inline; no worker is needed.');
            }

            return self::SUCCESS;
        }

        // The host supervises the worker itself (see config/queue.php); spawning
        // more from here would only stack extra consumers in the container.
        if (config('queue.tryon_worker_supervised')) {
            if (! $quiet) {
                $this->info('The try-on worker is supervised by the host — nothing to do.');
            }

            return self::SUCCESS;
        }

        /*
         * START THE WATCHDOG, NOT A BARE WORKER — AND START IT EVEN WHEN A
         * WORKER IS ALREADY ALIVE.
         *
         * MEASURED DEFECT THIS FIXES (the reported "Fitting Interrupted" that
         * names a missing worker while a worker is running right now):
         *
         * The previous version of `handle()` returned early the moment
         * `workerIsAlive()` was true, so the auto-start hook in
         * TryOnController::initiateTryOn() only ever created a BARE `queue:work`.
         * A bare worker is a ONE-SHOT: nothing brings it back when it dies (an
         * OOM kill, a fatal error, the laptop suspending). Observed on this box:
         * exactly one `queue:work` process, `heartbeat = NULL` because no
         * `tryon:watch-worker` existed, so the very next crash would strand every
         * session in `queued` and the customer would see `worker_offline` on the
         * following Generate — with a worker that had in fact been running when
         * the previous render was submitted.
         *
         * So a live worker is NO LONGER a reason to do nothing: the SUPERVISOR is
         * the guarantee being ensured here. It is checked separately from the
         * worker because they are different promises — the
         * queue NOW, the watchdog keeps one existing AFTER a crash.
         *
         * Both halves are idempotent, so calling this on every Generate still
         * never produces a second consumer (which would make PixelAPI answer
         * `503 queue_full`, since it renders one job at a time).
         */
        $workerUp = $this->workerIsAlive();
        $watchdogUp = $this->watchdogIsAlive();

        if ($workerUp && $watchdogUp) {
            if (! $quiet) {
                $this->info('A try-on worker and its watchdog are both running — nothing to do.');
            }

            return self::SUCCESS;
        }

        $started = false;

        // 1. A live watchdog will bring a worker up on its own first pass.
        if (! $watchdogUp && ! $this->option('no-watchdog')) {
            $started = $this->startWatchdog($quiet) || $started;
            // Give the loop a beat to write its first heartbeat and start a worker,
            // then re-check below rather than assuming success.
            usleep(700_000);
            $workerUp = $this->workerIsAlive();
        }

        // 2. No watchdog (opted out), or it has not produced a worker yet: start a
        //    bare worker so THIS render is not left waiting on the supervisor.
        if (! $workerUp) {
            $started = $this->startWorker($quiet) || $started;
        }

        return $started ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Is a worker currently draining the queue?
     *
     * THE PROCESS SCAN IS THE DECISIVE SIGNAL, NOT THE HEARTBEAT.
     *
     * MEASURED BUG: the first version of this method trusted the heartbeat
     * FIRST, and that made the watchdog unable to do its job at all. The heartbeat
     * is written by the WATCHER (see `WatchTryOnWorker::heartbeat()`), so while the
     * watcher loop was alive the key was always fresh — and `workerIsAlive()`
     * therefore kept answering `true` even after every `queue:work` process had
     * been killed. The supervisor concluded "nothing to do" forever and the queue
     * stayed undrained.
     *
     * The liveness of a SEPARATE process cannot be proven by a key that THIS
     * process writes; that is circular. So the OS is asked directly, and a live
     * `queue:work` process is the only thing that counts as a worker.
     *
     * The heartbeat is still honoured, but ONLY as a suppressor of the opposite
     * error: if a process is somehow unlistable (a restricted environment where
     * the process query is blocked) a fresh heartbeat at least proves SOME
     * consumer is running, so a second one is not started on top of it. It is
     * checked as a FALLBACK, never as the primary answer.
     *
     * Both `EnsureTryOnWorker` and `WatchTryOnWorker` call this method, so the
     * two agree by construction on what "a worker exists" means.
     */
    public function workerIsAlive(): bool
    {
        // The host's supervisor loop restarts the worker within seconds of an exit.
        if (config('queue.tryon_worker_supervised')) {
            return true;
        }

        // Primary: a real `queue:work` process the OS can see.
        if ($this->findWorkerProcesses() !== []) {
            return true;
        }

        /*
         * Fallback: only when the process scan found NOTHING and could not be
         * trusted. A heartbeat proves the watcher loop is iterating, and the
         * watcher only stays alive while it can also keep a worker up — but it
         * says nothing about a worker that died a moment ago, so it must never
         * outrank a definitive "no process" answer from the OS.
         */
        return false;
    }

    /**
     * Is the SUPERVISOR loop (`tryon:watch-worker`) running?
     *
     * WHY THIS IS SEPARATE FROM `workerIsAlive()`
     * -------------------------------------------
     * They are two different guarantees and the earlier code conflated them:
     *
     *   - a WORKER drains the queue right now,
     *   - a WATCHDOG keeps a worker existing AFTER it dies.
     *
     * THE PROCESS SCAN IS THE DECISIVE SIGNAL, EXACTLY AS IN `workerIsAlive()`.
     *
     * The first version of this method trusted the HEARTBEAT as its primary
     * answer, and that reproduced the very bug the class docblock warns about —
     * MEASURED while testing this change: the worker and watchdog were both killed,
     * and then `tryon:ensure-worker` announced "Try-on worker started" while
     * SKIPPING the watchdog, because the `HEARTBEAT_KEY` row was still inside its
     * 120s TTL. The supervisor was dead and the heartbeat said otherwise, so the
     * recovery path was unreachable — the same circular trap, one level up.
     *
     * A key that a process writes cannot outlive that process as evidence of
     * liveness; it can only ever be a SUPPRESSOR of the opposite error. So the OS
     * is asked directly here too, and the heartbeat is consulted only AFTER the
     * scan definitively finds no `watch-worker` process — where a fresh beat can
     * mean either "the watcher just started and has not been listed yet" or "the
     * row outlived the process". Those two are indistinguishable, and the SAFE
     * resolution is to spawn a watchdog: if one is genuinely alive, the spawn is a
     * no-op (`WatchTryOnWorker` is idempotent and its own first pass will find the
     * worker already up), whereas if it is not, the queue is saved.
     */
    public function watchdogIsAlive(): bool
    {
        // Primary: a real `tryon:watch-worker` process the OS can see.
        return $this->findProcessesMatching('watch-worker') !== [];
    }

    /**
     * Locate running `queue:work` processes.
     *
     * @return array<int, int> PIDs
     */
    protected function findWorkerProcesses(): array
    {
        return $this->findProcessesMatching('queue:work');
    }

    /**
     * Locate PHP CLI processes whose command line contains `$needle`.
     *
     * WINDOWS: `tasklist` cannot show a command line, and a worker is a PHP CLI
     * process indistinguishable from `artisan serve` by name alone, so the command
     * line is read through WMI/CIM. This is a read-only query and returns an empty
     * list on any failure rather than throwing — an undetectable process must
     * degrade to "start one", never to a fatal error on a customer's request.
     *
     * The needle is restricted to a conservative charset and embedded in a
     * single-quoted PowerShell regex / an anchored POSIX grep pattern, so it can
     * never alter the command it is spliced into.
     *
     * @return array<int, int> PIDs
     */
    protected function findProcessesMatching(string $needle): array
    {
        if (! preg_match('/^[\w:.-]+$/', $needle)) {
            return [];
        }

        $pids = [];

        try {
            if (PHP_OS_FAMILY === 'Windows') {
                /*
                 * `Get-CimInstance Win32_Process` is used rather than `wmic`
                 * because wmic is deprecated/removed on current Windows builds.
                 */
                $script = "Get-CimInstance Win32_Process -Filter \"Name = 'php.exe'\" | "
                    . "Where-Object { \$_.CommandLine -match '{$needle}' } | "
                    . 'Select-Object -ExpandProperty ProcessId';
            } else {
                // POSIX: the bracket trick keeps grep from matching itself.
                // '[q]ueue:work' — the bracketed first letter REPLACES it, never repeats it.
                $pattern = '[' . $needle[0] . ']' . substr($needle, 1);
                $script = "ps -eo pid,args | grep -E '{$pattern}' | awk '{print \$1}'";
            }

            $output = $this->runShell($script);

            foreach (preg_split('/\r?\n/', (string) $output) as $line) {
                $line = trim($line);
                if ($line !== '' && ctype_digit($line)) {
                    $pids[] = (int) $line;
                }
            }
        } catch (\Throwable $e) {
            // Detection is best-effort; an unknown state means "start one".
            return [];
        }

        return $pids;
    }

    /**
     * Start the SUPERVISOR loop as a detached process.
     *
     * WHY A WATCHDOG RATHER THAN ONE MORE BARE WORKER
     * -----------------------------------------------
     * A bare `queue:work` started from a request is a ONE-SHOT: when it dies
     * (OOM kill, fatal error, laptop suspend/resume) nothing brings it back, and
     * the queue stays undrained until the customer presses Generate again — which
     * reports `worker_offline` on that retry. The watchdog is the same consumer
     * wrapped in a supervision loop, so a crash self-heals in seconds and the
     * NEXT render already finds a live worker.
     *
     * The detach is again the whole point (see `startWorker`): the supervisor must
     * outlive the request that spawned it.
     */
    protected function startWatchdog(bool $quiet): bool
    {
        $php = $this->phpBinary();
        $base = base_path();

        try {
            if (PHP_OS_FAMILY === 'Windows') {
                $script = sprintf(
                    "Start-Process -FilePath %s -ArgumentList 'artisan','tryon:watch-worker','--interval=10' -WorkingDirectory %s -WindowStyle Hidden",
                    $this->psQuote($php),
                    $this->psQuote($base)
                );

                $this->runShell($script);
            } else {
                $command = sprintf(
                    'cd %s && nohup %s artisan tryon:watch-worker --interval=10 > storage/logs/tryon-watchdog.log 2>&1 &',
                    escapeshellarg($base),
                    escapeshellarg($php)
                );

                $this->runShell($command);
            }
        } catch (\Throwable $e) {
            $this->error('Could not start the try-on watchdog: ' . $e->getMessage());

            return false;
        }

        if (! $quiet) {
            $this->info('Try-on watchdog started.');
        }

        return true;
    }

    /**
     * Start the worker as a DETACHED process so it outlives this request.
     *
     * The detach is the whole point. A queue worker is a LONG-RUNNING consumer,
     * so a plain `exec()`/`proc_open()` would make it a child of the PHP request
     * handling the try-on — and it would be killed the moment that request
     * finished. `Start-Process` (Windows) and `nohup ... &` (POSIX) both hand the
     * process to the OS instead, which is what lets it keep draining the queue
     * after the response has been sent.
     */
    protected function startWorker(bool $quiet): int
    {
        $php = $this->phpBinary();
        $base = base_path();

        /*
         * THE WORKER'S TIMEOUT IS DERIVED FROM THE JOB, NOT HARDCODED.
         *
         * MEASURED DEFECT THIS FIXES: this string used to hardcode `--timeout=300`
         * while `ProcessTryOnJob::$timeout` is the value the job DECLARES for
         * itself. Those two are different things and the WORKER's flag is the one
         * that actually kills the process — so raising the job's property alone
         * would have done nothing, and a render needing 300-360s would still be
         * SIGKILLed at 300s mid-render, surfacing as a queue-side message instead of
         * the provider's reason.
         *
         * Reading it from the job class makes the two provably identical: there is
         * one number, in one place, and the spawner cannot drift from it. The `+ 60`
         * is deliberate headroom ABOVE the job's own ceiling so the job's graceful
         * timeout handling wins the race — otherwise the worker's hard kill
         * pre-empts the job's chance to report why it ran long.
         */
        $jobTimeout = (int) (new \ReflectionClass(\App\Jobs\ProcessTryOnJob::class))
            ->getDefaultProperties()['timeout'];
        $workerTimeout = $jobTimeout + 60;

        $arguments = 'artisan queue:work --queue=tryon,default --timeout=' . $workerTimeout;

        try {
            if (PHP_OS_FAMILY === 'Windows') {
                /*
                 * -WindowStyle Hidden keeps the spawned console from flashing on
                 * screen. The working directory MUST be the project root, or
                 * `artisan` cannot find the bootstrap.
                 */
                $script = sprintf(
                    "Start-Process -FilePath %s -ArgumentList 'artisan','queue:work','--queue=tryon,default','--timeout=%d' -WorkingDirectory %s -WindowStyle Hidden",
                    $this->psQuote($php),
                    $workerTimeout,
                    $this->psQuote($base)
                );

                $this->runShell($script);
            } else {
                $command = sprintf(
                    'cd %s && nohup %s %s > storage/logs/tryon-worker.log 2>&1 &',
                    escapeshellarg($base),
                    escapeshellarg($php),
                    $arguments
                );

                $this->runShell($command);
            }
        } catch (\Throwable $e) {
            $this->error('Could not start the try-on worker: ' . $e->getMessage());

            return self::FAILURE;
        }

        /*
         * Give the process a moment to register, then RE-CHECK rather than
         * assuming success: reporting a worker that never came up is how the
         * original problem stayed hidden.
         */
        usleep(700_000);

        if (! $this->workerIsAlive()) {
            $this->error('The try-on worker did not start. Run it manually:');
            $this->line('  php artisan queue:work --queue=tryon,default');

            return self::FAILURE;
        }

        if (! $quiet) {
            $this->info('Try-on worker started.');
        }

        return self::SUCCESS;
    }

    /** The PHP binary to spawn, preferring the one already running this app. */
    protected function phpBinary(): string
    {
        if (defined('PHP_BINARY') && PHP_BINARY !== '' && is_file(PHP_BINARY)) {
            return PHP_BINARY;
        }

        return PHP_OS_FAMILY === 'Windows' ? 'php.exe' : 'php';
    }

    /**
     * Run a PowerShell snippet and return its output (never throws).
     *
     * WHY THE ABSOLUTE PATH TO powershell.exe
     * ---------------------------------------
     * `shell_exec()` on Windows does NOT run through PowerShell — it hands the
     * string to `cmd.exe`, and `cmd.exe` has no `powershell` on its default PATH
     * when the parent is a PHP CLI process spawned outside a PowerShell session.
     *
     * MEASURED: the first version of this command called `shell_exec('powershell
     * -NoProfile -Command ...')` and every detection attempt printed
     *
     *     'powershell' is not recognized as an internal or external command
     *
     * on stderr. The worker scan therefore returned nothing, so a worker that was
     * ALREADY RUNNING was reported as absent — and the command would have started
     * a SECOND one, which is precisely the duplicate-consumer situation this
     * command exists to prevent.
     *
     * `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` is the
     * documented absolute location of Windows PowerShell and does not depend on
     * the caller's PATH.
     */
    protected function runShell(string $script): ?string
    {
        if (PHP_OS_FAMILY === 'Windows') {
            $powershell = $this->powershellPath();

            if ($powershell === null) {
                return null;
            }

            // Suppress progress records before the script body can emit any.
            $script = '$ProgressPreference = "SilentlyContinue"; ' . $script;

            /*
             * `-EncodedCommand` avoids the quoting minefield entirely: the script
             * is Base64-encoded UTF-16LE, so no character in it can be
             * reinterpreted by cmd.exe or by PowerShell's own parser. Passing the
             * raw snippet through cmd would otherwise need two levels of escaping
             * and is where the first attempt broke.
             */
            $encoded = base64_encode(mb_convert_encoding($script, 'UTF-16LE', 'UTF-8'));

            /*
             * `-OutputFormat Text` FORCES plain text on stdout.
             *
             * MEASURED: without it, PowerShell serialises its output as CLIXML when
             * it is not attached to a console — a large XML blob prefixed with
             * `#< CLIXML` that includes every `Write-Progress` record ("Preparing
             * modules for first use.") emitted while the shell loads its modules.
             * That noise would be parsed as a process id by the caller, so the
             * scan must receive plain text or nothing at all.
             *
             * `$ProgressPreference` is silenced in the script too, because module
             * loading happens before any option here could take effect.
             */
            $command = escapeshellarg($powershell)
                . ' -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand ' . $encoded;
        } else {
            $command = 'sh -c ' . escapeshellarg($script);
        }

        $output = @shell_exec($command);

        return is_string($output) ? $output : null;
    }

    /**
     * Absolute path to Windows PowerShell, or null when it cannot be located.
     *
     * `%SystemRoot%` is preferred over a hard-coded `C:\Windows` so the command
     * works on a host with Windows installed elsewhere.
     */
    protected function powershellPath(): ?string
    {
        $root = getenv('SystemRoot') ?: getenv('windir') ?: 'C:\\Windows';

        $candidates = [
            $root . '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
            // A 32-bit PHP on 64-bit Windows sees the redirected System32; this is
            // the real one. Listing both means neither bitness can miss.
            $root . '\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe',
        ];

        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Quote a value for a PowerShell command line.
     *
     * Single quotes are used because PowerShell treats their contents literally,
     * performing no variable expansion and no backtick escaping. That is what
     * keeps a Windows path such as C:\Users\name intact. An embedded single
     * quote is doubled, which is the documented PowerShell escape.
     */
    protected function psQuote(string $value): string
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return escapeshellarg($value);
        }

        return "'" . str_replace("'", "''", $value) . "'";
    }
}
