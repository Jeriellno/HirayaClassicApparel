<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persists the OUTAGE HISTORY of the third-party try-on provider (PixelAPI).
 *
 * WHY THIS TABLE EXISTS
 * ---------------------
 * A provider-side outage (`renderer_safety_unavailable`, `renderer_gateway_error`,
 * the provider's single-job queue) was only ever visible in two places:
 *
 *   1. a `Log::warning` line, which nobody reads unless they already suspect a
 *      problem, and which carries no queryable structure; and
 *   2. the customer's canvas, AFTER a real fitting had already failed.
 *
 * So a super admin could not answer the one question that matters during an
 * incident — "is the PROVIDER down for EVERYONE right now, or is this one
 * customer's photo?" — without waiting for a failure and reading it manually.
 * The existing API-status screen could not answer it either: its `tryon_ready`
 * flag is CONFIG-ONLY, so it stays green while the provider is degraded.
 *
 * This table is the missing memory. Two writers feed it:
 *
 *   - the scheduled `tryon:check-provider` command (a periodic liveness probe),
 *   - the render path itself (only for codes that mean "provider fault", never
 *     for a fault the customer can fix — see ProviderHealth::PROVIDER_FAULT_CODES).
 *
 * The rows are deliberately SMALL and time-stamped so the console can answer
 * "when did this start, how long did it last, how often does it happen" without
 * scanning logs.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('provider_health_events')) {
            return;
        }

        Schema::create('provider_health_events', function (Blueprint $table) {
            $table->id();

            // Which vendor — 'pixelapi' today; a column rather than a constant so
            // adding a second provider does not need a new table.
            $table->string('provider', 40);

            /*
             * WHO OBSERVED IT. The distinction is the whole point of the screen:
             *   probe  -> the scheduler checked and the provider was found degraded
             *   render -> a real customer fitting failed for a provider reason
             * A cluster of `render` events with no `probe` events is itself a
             * finding: it means the outage happened between two scheduled checks.
             */
            $table->string('source', 20); // probe | render

            // 'ok' | 'degraded' | 'down' | 'unconfigured'. Kept as a string rather
            // than an enum so a new state never needs a schema change.
            $table->string('state', 20);

            // HTTP status from the provider, when the observation involved a call.
            $table->unsignedSmallInteger('http_status')->nullable();

            // The renderer's own code vocabulary ('renderer_safety_unavailable',
            // 'renderer_gateway_error', 'renderer_busy', ...). Null for eager probes.
            $table->string('code', 60)->nullable();

            // The provider's own wording — precise and operator-safe. Truncated so
            // a hostile/huge upstream body cannot bloat the row.
            $table->text('message')->nullable();

            $table->timestamps(); // created_at is the observation time.

            /*
             * INDEXES MATCH THE TWO QUERIES THE CONSOLE ACTUALLY RUNS:
             *   - "most recent events, newest first"          -> (provider, created_at)
             *   - "how many DIFFERENT outages in 24h"         -> (provider, source, created_at)
             */
            $table->index(['provider', 'created_at'], 'provider_health_provider_time_idx');
            $table->index(['provider', 'source', 'created_at'], 'provider_health_source_time_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('provider_health_events');
    }
};
