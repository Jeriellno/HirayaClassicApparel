<?php

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
