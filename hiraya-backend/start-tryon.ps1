# start-tryon.ps1 - bring up EVERYTHING the Virtual Try-On needs, in one command.

$ErrorActionPreference = 'Continue'

# --- Direct PHP Path --------------------------------------------------------
$PhpExe = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"

# The WinGet package folder is version-suffixed (PHP.PHP.8.3_...), so a fixed
# path breaks the moment PHP is upgraded. Fall back to a glob if it is missing.
if (-not (Test-Path $PhpExe)) {
    $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter 'php.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $PhpExe = $found.FullName }
}

if (-not (Test-Path $PhpExe)) {$cmd = Get-Command php -ErrorAction SilentlyContinue
    if ($cmd) {
        $PhpExe =$cmd.Source
    }
}

if (-not (Test-Path $PhpExe)) {
    Write-Host 'PHP was not found.' -ForegroundColor Red
    Write-Host 'Install PHP, or check your path.'
    exit 1
}

Write-Host "Using PHP: $PhpExe" -ForegroundColor Green
Set-Location -Path $PSScriptRoot

# --- Helper: is a `queue:work` process already running? ---------------------
#
# IDEMPOTENCE MATTERS HERE. This script used to `Start-Process` a worker
# unconditionally, so running it twice left TWO workers competing for the same
# `tryon` queue. We detect an existing worker by its command line instead, so
# re-running the script is safe and never doubles the consumer count.
function Get-WorkerProcess {
    Get-CimInstance Win32_Process -Filter "Name = 'php.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'queue:work' }
}

# --- 1. API server ----------------------------------------------------------
#
# Only start it when port 8000 is actually free. Starting a second `artisan
# serve` against a bound port fails silently, and the operator is then left
# with the OLD server (running the OLD code) while believing it was restarted.
$apiListening = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
# Declared up front so the health check can tell "we started it and it died" apart
# from "someone else's server was already up" (where there is no process to inspect).
$apiProc = $null
if ($apiListening) {
    Write-Host 'API server already listening on http://127.0.0.1:8000 - leaving it running.' -ForegroundColor Yellow
} else {
    Write-Host 'Starting the API server on http://127.0.0.1:8000 ...' -ForegroundColor Cyan
    # `--no-reload` IS REQUIRED HERE - WITHOUT IT `serve` FAILS ON THIS MACHINE.
    #
    # MEASURED: `php artisan serve --host=127.0.0.1 --port=8000` dies instantly
    # with the opaque
    #
    #     Failed to listen on 127.0.0.1:8000 (reason: ?)
    #
    # while `... --no-reload` prints "INFO Server running on [http://127.0.0.1:8000]".
    # The PORT IS NOT THE PROBLEM - 8000 binds cleanly, `netsh ... excludedportrange`
    # does not list it, and running the child command (`php -S 127.0.0.1:8000
    # server.php` from /public) by hand works. The cause is ServeCommand::startProcess()
    # on Windows: unless `--no-reload` is set it passes EVERY env var as `false`
    # except a small whitelist, and the stripped child process cannot start.
    #
    # The flag costs only `.env` hot-reload for this dev server. Restarting after an
    # .env change is a fair trade for a server that actually binds - and php -S is
    # single-threaded here anyway, so `PHP_CLI_SERVER_WORKERS` was never in play.
    $apiProc = Start-Process -FilePath $PhpExe `
        -ArgumentList 'artisan', 'serve', '--host=127.0.0.1', '--port=8000', '--no-reload' `
        -WorkingDirectory $PSScriptRoot -PassThru
}

# A second `artisan serve` against an already-bound port exits immediately and
# silently, leaving the OLD server (running OLD code) in place. Confirm the port
# is genuinely LISTENING before moving on, so a failed start is loud instead of
# surfacing later as ERR_CONNECTION_REFUSED in the browser console.
$apiBound = $false
for ($i = 0; $i -lt 10; $i++) {
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
        $apiBound = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

if ($apiBound) {
    Write-Host 'API server is listening on http://127.0.0.1:8000.' -ForegroundColor Green
} else {
    Write-Host 'API server FAILED to bind port 8000.' -ForegroundColor Red
    Write-Host '  Port 8000 is held by another process, or serve exited on startup.' -ForegroundColor Yellow
    Write-Host '  Inspect the holder with:' -ForegroundColor DarkGray
    Write-Host '    Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess' -ForegroundColor DarkGray
    Write-Host '  Then stop it (Stop-Process -Id <pid> -Force) and re-run this script.' -ForegroundColor DarkGray
}

# --- 2. Queue worker WATCHDOG ------------------------------------------------
#
# `QUEUE_CONNECTION=database` (see .env) puts every `ProcessTryOnJob` on the
# dedicated `tryon` queue. Nothing drains that queue unless a `queue:work`
# process is running, so WITHOUT a worker every try-on session stays `queued`
# forever and the Studio reports `worker_offline`.
#
# WHY A WATCHDOG AND NOT A BARE `queue:work`
# ------------------------------------------
# A plain `queue:work` started here would be a ONE-SHOT: if the process later
# dies (crash, an out-of-memory kill, the laptop sleeping and resuming) nothing
# brings it back, and the try-on silently stops working until something is
# restarted by hand. That is exactly the hassle this replaces.
#
# `tryon:watch-worker` is the same long-running consumer PLUS a supervisor loop:
# it verifies a worker is alive every few seconds and restarts one if not, so a
# crash self-heals in seconds instead of waiting for a manual fix.
#
# It is idempotent for the same reason the worker itself is: two consumers on one
# queue cause PixelAPI to answer with `queue_full` / `coalesced`, so a duplicate
# must never be created. An already-running watchdog is detected by command line.
#
# THE DETECTION IS DELEGATED TO THE APP, NOT RE-IMPLEMENTED HERE.
#
# `tryon:ensure-worker` already owns the single definition of "a worker exists"
# (and now also "a watchdog exists"), and it is what the app itself calls on every
# Generate. Keeping a SECOND, drifting copy of that logic in this script is how the
# two would eventually disagree. This script therefore just asks the app to do it;
# the command is idempotent, so this is still safe to run repeatedly.
function Get-WatcherProcess {
    Get-CimInstance Win32_Process -Filter "Name = 'php.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'watch-worker' }
}

$existingWatchers = @(Get-WatcherProcess).Count
if ($existingWatchers -gt 0) {
    Write-Host ("Try-on worker WATCHDOG already running ({0} process found) - not starting another." -f $existingWatchers) -ForegroundColor Yellow
} else {
    Write-Host 'Starting the try-on worker WATCHDOG (keeps exactly one queue:work alive) ...' -ForegroundColor Cyan
    Push-Location $PSScriptRoot
    & $PhpExe artisan tryon:ensure-worker 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Pop-Location
}

Start-Sleep -Seconds 5

# --- 3. Health check --------------------------------------------------------
Write-Host ''
Write-Host 'Health check:' -ForegroundColor Cyan

# 3a. API check
try {
    $up = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/up' -UseBasicParsing -TimeoutSec 10
    Write-Host ("  API server           : OK (" + $up.StatusCode + ")") -ForegroundColor Green
} catch {
    Write-Host ('  API server           : NOT REACHABLE - ' + $_.Exception.Message) -ForegroundColor Red
    # Name the ONE failure that actually happens here, with its fix. Without this
    # the operator sees only "NOT REACHABLE" and starts guessing at ports/DNS,
    # when the cause is known and has a one-token fix.
    if ($apiProc -and $apiProc.HasExited) {
        Write-Host '        The serve process exited immediately (classic Failed to listen).' -ForegroundColor Yellow
        Write-Host '        That is the env-stripping bug that --no-reload avoids. Retry with:' -ForegroundColor Yellow
        Write-Host ('          & "{0}" artisan serve --host=127.0.0.1 --port=8000 --no-reload' -f $PhpExe) -ForegroundColor DarkGray
    }
}

# 3b. Database check
try {
    Push-Location $PSScriptRoot
    $db = &$PhpExe artisan tinker --execute="try { DB::connection()->getPdo(); echo 'OK'; } catch (\Throwable \$e) { echo 'FAIL: '.\$e->getMessage(); }" 2>&1
    Pop-Location
    $dbText = ($db | Out-String).Trim()
    if ($dbText -match 'OK') {
        Write-Host '  Database connection  : OK' -ForegroundColor Green
    } else {
        Write-Host ('  Database connection  : FAILED - ' + $dbText) -ForegroundColor Red
        Write-Host '        Check DB_HOST / DNS / VPN.' -ForegroundColor Yellow
    }
} catch {
    Write-Host ('  Database connection  : could not probe - ' + $_.Exception.Message) -ForegroundColor Yellow
}

# 3c. Queue worker + watchdog check
#
# Reported explicitly because a missing worker is INVISIBLE from the UI until a
# render is attempted - the app boots, the catalog works, and only the try-on
# silently never completes. Surfacing it at startup is what turns a 5-minute
# debugging session into a one-line fix.
#
# The WATCHDOG is reported separately from the WORKER because they are different
# guarantees: the worker is what drains the queue right now, and the watchdog is
# what keeps a worker existing after a crash. A worker with no watchdog still
# works until the first crash, so the two are worth distinguishing.
$workerCount = @(Get-WorkerProcess).Count
$watcherCount = @(Get-WatcherProcess).Count
if ($workerCount -gt 0) {
    Write-Host ("  Queue worker         : OK ({0} running)" -f $workerCount) -ForegroundColor Green
} else {
    Write-Host '  Queue worker         : NOT RUNNING - try-on sessions will stay queued until a render is requested.' -ForegroundColor Yellow
    Write-Host '        (The app auto-starts one on Generate; run the watchdog below to avoid the wait.)' -ForegroundColor DarkGray
}

if ($watcherCount -gt 0) {
    Write-Host ("  Worker watchdog      : OK ({0} running) - auto-restarts the worker if it dies." -f $watcherCount) -ForegroundColor Green
} else {
    Write-Host '  Worker watchdog      : NOT RUNNING - a worker crash will not self-heal.' -ForegroundColor Yellow
    Write-Host '        Start it with: php artisan tryon:watch-worker' -ForegroundColor Yellow
}

# 3d. PixelAPI check
#
# `Join-Path` (and the `-Path` parameter below) MUST be followed by whitespace.
# They were written as `Join-Path$PSScriptRoot` / `-Path$envPath`, which
# PowerShell reads as a SINGLE token — so this whole check threw
# "The term 'Join-Path$PSScriptRoot' is not recognized" and the PixelAPI
# credential was never reported. A missing token is exactly the condition this
# check exists to make visible, so the bug hid its own purpose.
$envPath = Join-Path $PSScriptRoot '.env'
if (Test-Path $envPath) {
    $tokenMatches = Select-String -Path $envPath -Pattern '^VTON_API_TOKEN=(.+)$'
    $urlMatches = Select-String -Path $envPath -Pattern '^VTON_API_URL=(.+)$'
    $token = if ($tokenMatches) { $tokenMatches[0].Matches.Groups[1].Value } else { "" }
    $url = if ($urlMatches) { $urlMatches[0].Matches.Groups[1].Value } else { "" }

    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Host '  PixelAPI token       : MISSING (VTON_API_TOKEN is empty)' -ForegroundColor Red
    } else {
        Write-Host ('  PixelAPI token       : set (' + $token.Substring(0, [Math]::Min(8,$token.Length)) + '...)') -ForegroundColor Green
    }
    Write-Host ('  PixelAPI endpoint    : ' + $url)
}

Write-Host ''
Write-Host 'Ready. Now run the Studio flow:' -ForegroundColor Green
Write-Host '  1) Upload a full-body photo'
Write-Host '  2) Select at least one garment'
Write-Host '  3) Tap "Generate Virtual Fitting"'