<#
.SYNOPSIS
    Starts the Hiraya Laravel backend on port 8000 — killing any orphaned PHP
    process FIRST so the new server actually owns the port.

.DESCRIPTION
    WHY THIS SCRIPT EXISTS
    ======================
    `php artisan serve` on Windows does NOT die when its terminal closes or when
    the IDE restarts it. The process is left running, still holding port 8000.
    Starting a second one "succeeds" (the port is taken by a DIFFERENT process,
    so the new server silently binds nowhere or fails), and the ORIGINAL one —
    possibly hours old, possibly stuck on a dead Supabase pooler connection —
    keeps answering.

    Measured on this machine: SEVEN php.exe processes were alive at once, several
    from the early morning, with only PID 3720 holding 127.0.0.1:8000. That
    listener had HUNG: even GET /up — the framework's DB-free health route —
    timed out. Every endpoint the SuperAdmin console calls returned "The
    operation has timed out", which reads exactly like a code bug but was a
    zombie server.

    So the fix is not in the code — it is in HOW the server is started. Always
    start it through this script.

    WHY THE HEALTH CHECK PROBES /up AND NOT /api/system-status
    =========================================================
    An earlier revision of this script probed `/api/system-status` and it gave a
    FALSE NEGATIVE: that route sits behind the `throttle:120,1` middleware and
    reads `SystemSetting` over the REMOTE Supabase pooler, whose DNS has
    intermittently stalled on this machine. On a cold boot it therefore pays
    network cost before it can answer, and the script declared a perfectly
    healthy server dead.

    `/up` (see bootstrap/app.php -> health: '/up') touches NO database and is the
    SAME endpoint the project's own `php artisan hiraya:doctor` command times to
    detect a wedged server. That is the correct liveness signal for a start
    script: if `/up` answers, PHP is alive and serving.

.PARAMETER Port
    Port to listen on. Default 8000, matching VITE_API_BASE_URL.

.PARAMETER NoKill
    Skip the orphan cleanup and just start. Use only when you are certain no
    other PHP process is alive.

.EXAMPLE
    .\start-backend.ps1
    .\start-backend.ps1 -Port 8001
#>

param(
    [int]$Port = 8000,
    [switch]$NoKill
)

$ErrorActionPreference = 'Stop'

$backend = Join-Path $PSScriptRoot 'hiraya-backend'
$php = 'C:\php-8.3\php.exe'

if (-not (Test-Path $php)) {
    # Fall back to whatever `php` resolves to on PATH.
    $onPath = (Get-Command php -ErrorAction SilentlyContinue).Source
    if ($onPath) {
        $php = $onPath
    } else {
        Write-Error "php.exe not found at '$php' and not on PATH. Install PHP 8.3 or edit the `$php variable in this script."
        exit 1
    }
}

if (-not (Test-Path $backend)) {
    Write-Error "Backend directory not found: $backend"
    exit 1
}

# ---------------------------------------------------------------------------
# 1. KILL ORPHANED PHP PROCESSES
# ---------------------------------------------------------------------------
if (-not $NoKill) {
    $orphans = @(Get-Process -Name php -ErrorAction SilentlyContinue)

    if ($orphans.Count -gt 0) {
        Write-Host "Killing $($orphans.Count) orphaned php process(es):" -ForegroundColor Yellow
        $orphans | ForEach-Object {
            Write-Host ("  PID {0,-7} started {1}" -f $_.Id, $_.StartTime) -ForegroundColor DarkGray
        }

        $orphans | Stop-Process -Force -ErrorAction SilentlyContinue

        # Windows releases the listening socket a moment after the process dies.
        # Without this wait the new server can still find the port occupied and
        # die with "Address already in use".
        Start-Sleep -Seconds 2
    } else {
        Write-Host 'No orphaned php processes. Clean start.' -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------------------
# 2. CONFIRM THE PORT IS FREE
# ---------------------------------------------------------------------------
$stillHeld = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($stillHeld) {
    Write-Error "Port $Port is still held by PID $($stillHeld.OwningProcess) after cleanup. Kill it manually: Stop-Process -Id $($stillHeld.OwningProcess) -Force"
    exit 1
}

# ---------------------------------------------------------------------------
# 3. START THE SERVER
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "Starting Laravel on http://127.0.0.1:$Port ..." -ForegroundColor Cyan
Write-Host 'NOTE: `php artisan serve` is SINGLE-THREADED on Windows (no pcntl),' -ForegroundColor DarkGray
Write-Host '      so concurrent admin requests queue. Expect the console to be slow;' -ForegroundColor DarkGray
Write-Host '      that is the dev server, not a bug.' -ForegroundColor DarkGray

Push-Location $backend
try {
    Start-Process -FilePath $php `
        -ArgumentList 'artisan', 'serve', '--port', $Port `
        -WindowStyle Hidden
} finally {
    Pop-Location
}

# Give the process a moment to bind the port before we even try to talk to it.
Start-Sleep -Seconds 1

# ---------------------------------------------------------------------------
# 4. WAIT FOR IT TO ACTUALLY ANSWER
# ---------------------------------------------------------------------------
#
# PROBE `/up`, NOT `/api/system-status`.
#
# `/up` is the framework's health route (see bootstrap/app.php -> health: '/up')
# and it touches NO database. It is the SAME endpoint the project's own
# `php artisan hiraya:doctor` command times to detect a wedged server. If `/up`
# answers, the PHP process is alive and serving; that is exactly what a start
# script needs to know.
#
# `/api/system-status` was the earlier probe and it lied here: it sits behind the
# `throttle:120,1` middleware and the SystemSetting read path, so on a cold boot —
# when the remote Supabase pooler's DNS is still resolving (a logged fault on this
# machine) — it pays that cost before it can answer. The probe is NOT a health
# signal at that point; the app simply is not warm yet. `/up` short-circuits all
# of that.
#
# The loop is also forgiving on purpose. The FIRST request to a freshly started
# Laravel pays composer autoload + full boot; measured on this machine `/up`
# took ~4.4s even once the server was answering every other request in ~1s. A
# tight 0.7s/hard-5s loop spends its whole 30s budget on early failures and
# fails a server that was merely still booting.
$deadline = (Get-Date).AddSeconds(60)
$healthy = $false
$lastError = $null

while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/up" `
            -TimeoutSec 20 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {
        # Not up yet (or still booting) — remember why, then keep waiting.
        $lastError = $_.Exception.Message
    }

    Start-Sleep -Milliseconds 800
}

Write-Host ''
if ($healthy) {
    Write-Host "READY  ->  http://127.0.0.1:$Port" -ForegroundColor Green
    Write-Host 'Health check /up answered 200 (no database needed).' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host 'Remember: the try-on queue needs a worker if QUEUE_CONNECTION=database:' -ForegroundColor DarkGray
    Write-Host '  php artisan queue:work --queue=tryon,default' -ForegroundColor DarkGray
} else {
    Write-Error "Server did not answer /up within 60s. Last error: $lastError"
    Write-Host 'Diagnose with:' -ForegroundColor DarkGray
    Write-Host '  php artisan hiraya:doctor' -ForegroundColor DarkGray
    Write-Host 'Check hiraya-backend/storage/logs/laravel.log' -ForegroundColor DarkGray
    exit 1
}