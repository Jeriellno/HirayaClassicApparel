<?php

use App\Console\Commands\RefreshApiKeys;
use App\Console\Commands\TryOnCheckProvider;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * SCHEDULED PROVIDER LIVENESS PROBE.
 *
 * The try-on render depends on PixelAPI, and that dependency can fail WITHOUT
 * ANYTHING in this application changing — its clothing-safety checker goes down,
 * its origin 522s, its single-job queue refuses a concurrent submit. When that
 * happens EVERY customer fitting fails, and before this schedule the only ways to
 * learn it were to notice it manually or to read it off a customer's canvas.
 *
 * Running the probe every five minutes makes the outage a recorded FACT with a
 * start time, so the super-admin console can show "the provider is degraded RIGHT
 * NOW" instead of a green "configured" verdict that is true but useless.
 *
 * FIVE MINUTES, NOT ONE. A try-on render itself takes 60-155s and the provider
 * serialises jobs, so probing harder would compete with real renders for the same
 * capacity and could CAUSE the busy condition the probe is meant to observe. Five
 * minutes still detects an outage long before a customer would report it.
 *
 * `withoutOverlapping()` matters here: a probe that hangs (the transport timeout
 * is 25s, and the scheduler could fire again while a wedged call is still open)
 * must not stack up parallel outbound calls to a provider that is already sick.
 *
 * THE LOCK EXPIRY IS SET EXPLICITLY, AND THAT IS NOT A DETAIL.
 *
 * Laravel's overlap lock defaults to a TWENTY-FOUR HOUR expiry, and it is released
 * by a callback when the command finishes. Backgrounding the command moves that
 * finish into a separate process, so if the child ever dies without finishing — a
 * killed process, a reboot, a PHP fatal — the release callback never runs and the
 * lock stays held until it expires. At the default that is a FULL DAY during which
 * every scheduled probe is silently skipped, which is precisely the "the checker
 * is not running" condition this feature exists to detect, self-inflicted.
 *
 * This is a documented hazard of combining the two, not a hypothetical: see the
 * maintainer's note that "if you fire withoutOverlapping() - a mutex is
 * definitely created. Especially if you combine it with runInBackground() ... if
 * the command dies your mutex remains for 24 hours"
 * (https://github.com/laravel/framework/pull/20389).
 *
 * TEN MINUTES = two missed probe cycles. Long enough that a genuinely slow probe
 * (up to the 25s transport timeout) is never overlapped, short enough that a stuck
 * lock self-heals within one scheduler tick or two instead of stalling detection
 * for a day.
 */
Schedule::command(TryOnCheckProvider::class, ['--quiet-ok'])
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    /*
     * `runInBackground()` keeps a slow probe from blocking the other scheduled
     * work in the same tick — the probe is a DIAGNOSTIC, and nothing else should
     * wait on a provider that is timing out. See the lock note above for the one
     * interaction this has to be protected against.
     */
    ->runInBackground();

/*
 * DYNAMIC API KEY ROTATION.
 *
 * The counterpart to the provider probe above: that command asks "is the vendor
 * up?", this one asks "are our credentials still valid, and if not, is there a
 * spare ready?". Between them, an expiring third-party key is handled before a
 * customer ever meets it.
 *
 * WHY THE DEFAULT RUN MAKES NO OUTBOUND CALL
 * ------------------------------------------
 * Without `--verify`, this only checks `expires_at` — data the vendor already gave
 * us — and rotates a local pointer when a key is past it. That is the whole
 * safety story: a key that dies at 14:00 is replaced at 13:55, with no deploy, no
 * .env edit and no failed request.
 *
 * Adding `--verify` would make it contact each vendor, and that is deliberately
 * NOT the default on a frequent schedule: the try-on provider serialises jobs, so
 * an unattended probe competes with real renders for the same capacity. Hourly is
 * also slow enough to catch a revoked key (a manual dashboard deletion, which no
 * expiry field would predict) well before anyone relies on it.
 *
 * FIVE MINUTES, matching the provider probe, and the same `withoutOverlapping(10)`
 * with an EXPLICIT short lock. The default overlap lock is 24 HOURS and is only
 * released by a finish callback — so a backgrounded command that dies without
 * finishing would silently suppress this schedule for a full day, which is the
 * exact condition the feature exists to prevent. See the long note above.
 */
Schedule::command(RefreshApiKeys::class, ['--quiet-ok' => true])
    ->hourly()
    ->withoutOverlapping(10);

Schedule::command(RefreshApiKeys::class, ['--verify' => true, '--quiet-ok' => true])
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->runInBackground();

/*
 * Expired login tokens (30-day Sanctum tokens) are dead rows: prune them daily
 * so `personal_access_tokens` does not grow forever.
 */
Schedule::command('sanctum:prune-expired', ['--hours' => 24])->daily();
