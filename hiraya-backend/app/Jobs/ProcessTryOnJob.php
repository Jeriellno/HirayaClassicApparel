<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Models\TryOnSession;
use App\Services\GeminiTryOnRenderer;
use App\Services\HuggingFaceVtonRenderer;
use App\Services\GeminiKeyPool;
use App\Services\SizeChart;
use App\Services\TryOnPreProcessor;
use App\Services\VtonApiRenderer;
use Illuminate\Support\Facades\Cache;

class ProcessTryOnJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /*
     * PER-ATTEMPT CEILING.
     *
     * This bounds ONE attempt, and it MUST stay above the renderer's own poll
     * window (VtonApiRenderer::POLL_TIMEOUT_SECONDS) so the renderer always gives
     * up with its real reason BEFORE the worker kills the job. If this ceiling is
     * reached first, the worker terminates the process mid-render and the session
     * fails with the queue's bookkeeping message instead of the provider's reason,
     * which is strictly less useful.
     *
     * RAISED 300s -> 360s BECAUSE THE POLL WINDOW WENT 120s -> 240s.
     *
     * These two are a PAIR: the poll window is now above the measured ~155s
     * worst-case render, so an attempt can legitimately occupy ~240s of polling
     * alone. Adding the submit round trip and the image download, 300s would leave
     * only ~60s of cover — too tight, and the failure mode is the worker killing a
     * render that was about to land. 360s restores ~120s of headroom.
     *
     * MUST also stay BELOW the queue connection's `retry_after`
     * (config/queue.php sets 330s) or a still-running job is treated as abandoned
     * and double-picked — which on PixelAPI actively causes `queue_full`.
     *
     * 360 > 330, SO `retry_after` MUST BE RAISED IN LOCKSTEP with this change; the
     * two are updated together and must never be edited apart. See the note at
     * `config/queue.php`'s `retry_after` for the paired value and the reasoning.
     */
    public int $timeout = 360; // 6 minutes max per attempt
    /*
     * ATTEMPTS — TWO, AND THE REASON `$tries = 1` WAS WRONG.
     *
     * The Studio's budget, expressed in the poll window that actually applies:
     *
     *   1st try  -> up to the renderer's poll window (240s), which is ABOVE the
     *               MEASURED ~155s worst-case PixelAPI render, so an ordinary
     *               render queued behind one other job lands INSIDE one attempt
     *   2nd try  -> another poll window, spent only when the provider reported a
     *               transient condition (busy / unreachable)
     *
     * TWO IS THE RIGHT NUMBER, and the 240s window is what makes it sufficient.
     * The earlier "two tries" was insufficient NOT because two is too few but
     * because each try was given only 120s — under the worst case — so both
     * attempts could expire on a render the provider was still completing. With a
     * 240s window the FIRST attempt already covers the realistic case and the
     * second exists purely to absorb a genuine transient refusal.
     *
     * What was WRONG is that `$tries = 1` made the job's own retry machinery
     * UNREACHABLE, and this is a MEASURED defect, not a matter of taste.
     *
     * `handle()` has a whole branch for a transient provider condition:
     *
     *     } elseif ($this->isRetryableFailure($result) && $this->attemptsLeft()) {
     *         $session->update(['status' => STATUS_QUEUED, ...]);
     *         $this->release($this->backoff);   // <- re-queues the SAME session
     *         return;
     *
     * With `$tries = 1` and `attemptsLeft()` defined as `attempts() < $tries`,
     * the FIRST run has `attempts() === 1`, so `1 < 1` is FALSE. The condition is
     * never true on any run. The release branch is DEAD CODE, and EVERY
     * `renderer_busy` result — the DOMINANT real-world outcome on PixelAPI, which
     * serialises renders behind a one-job queue — falls through to `markFailed()`
     * and a terminal "Fitting Interrupted".
     *
     * That is exactly what was observed on this deployment: the vendor answered
     * `503 queue_full` ("Virtual Try-On is very busy right now... your credits
     * have NOT been charged") and the session was marked FAILED immediately,
     * with no attempt to wait the few seconds the vendor asked for.
     *
     * WHY TWO AND NOT THREE (the original value that caused "paulit-ulit")
     * -------------------------------------------------------------------
     * The `$tries = 3` regression was real: three attempts x a 300s ceiling is up
     * to ~15 minutes of server work behind one spinner. But that number was
     * dangerous because the CEILING was reachable, not because retrying is wrong.
     * Two bounds the worst case to 2 x $timeout while still letting the transient
     * case recover once without the customer doing anything.
     *
     * A terminal failure (a rejected payload, an expired token, an unusable
     * image) is NOT retried at all — `isRetryableFailure()` admits only
     * `renderer_busy` and `renderer_unreachable` — so this cannot mask a real
     * error or burn minutes on an answer that will not change.
     */
    public int $tries = 2;
    public int $backoff = 15;

    protected int $sessionId;

    /** Stage timings of the current attempt (logged as "TryOn render timings"). */
    protected array $timings = [];

    public function __construct(int $sessionId)
    {
        $this->sessionId = $sessionId;
        $this->queue = 'tryon'; // Use dedicated tryon queue
    }

    public function handle(): void
    {
        $session = TryOnSession::find($this->sessionId);

        if (!$session) {
            Log::error("TryOn session {$this->sessionId} not found");
            return;
        }

        // Mark as processing
        $session->markProcessing();

        $attemptStarted = microtime(true);
        $pushedAt = $this->pushedAt();
        $this->timings = [
            'queue_wait_ms' => $pushedAt ? max(0, (int) round(($attemptStarted - $pushedAt->getTimestamp()) * 1000)) : null,
        ];

        try {
            /*
             * A top + bottom look renders in two passes (see renderPair); every
             * other session is the single-garment render it always was.
             */
            $result = $session->isPairRender()
                ? $this->renderPair($session)
                : $this->timedRender($session, null, 'single');

            if (! empty($result['handed_off'])) {
                // Pass 1 is stored and pass 2 was queued as its own job.
                $this->logTimings($session, $attemptStarted, $result);

                return;
            }

            if ($result['success']) {
                // Generate AI fit feedback based on body metrics
                $aiFeedback = $this->generateAiFitFeedback($session, $result);

                $storeStarted = microtime(true);
                $session->markCompleted($result['image_base64'], $aiFeedback);
                $this->timings['store_ms'] = (int) round((microtime(true) - $storeStarted) * 1000);

                if ($session->isPairRender()) {
                    // The intermediate (first-pass) image is no longer needed.
                    \App\Support\RenderVault::delete($session->pipeline()['first_pass']['path'] ?? null);
                    $session->updatePipeline(['first_pass' => null, 'completed' => true]);
                }

                // Clear any non-retryable mark now that the render succeeded.
                Cache::forget('tryon-noretry-' . $this->sessionId);
                $this->logTimings($session, $attemptStarted, $result);
            } elseif ($this->isRetryableFailure($result) && $this->attemptsLeft()) {
                /*
                 * TRANSIENT FAILURE WITH ATTEMPTS LEFT — PUT IT BACK ON THE QUEUE.
                 *
                 * MEASURED BUG THIS FIXES: a provider-busy / still-rendering result
                 * used to fall straight into `markFailed()`, which ends the job with
                 * a terminal failure and NEVER touches the retry machinery. So a
                 * render that PixelAPI was still working on became a dead "Fitting
                 * Interrupted" the moment the poll window closed.
                 *
                 * Releasing re-queues the SAME session for another attempt; the
                 * status goes back to `queued` so the client keeps polling instead
                 * of seeing a premature failure.
                 *
                 * WHY `attemptsLeft()` IS CHECKED HERE AND NOT LEFT TO LARAVEL:
                 * `retryUntil()` is non-null (see below), and Laravel's worker uses
                 * `retryUntil()` INSTEAD OF the `$tries` counter — `! $job->retryUntil()
                 * && ... $job->attempts() >= $maxTries` (Worker::markJobAsFailedIf...).
                 * A non-null deadline therefore DISABLES the attempt cap, and a
                 * released job loops until the wall-clock deadline (observed: 21
                 * runs). The attempt cap has to be enforced HERE to keep the retry
                 * count bounded as well as the total time.
                 */
                Log::warning("TryOn session {$this->sessionId}: retryable provider condition — releasing for another attempt.", [
                    'code' => $result['code'] ?? null,
                    'attempt' => $this->attempts(),
                ]);

                /*
                 * Keep the provider's reason on the session WITHOUT marking it
                 * failed. `error_message` is what `checkStatus` surfaces for a
                 * terminal failure and what `failed()` below re-reads, so it is
                 * the durable place for "why the last attempt did not land".
                 * The STATUS is what tells the UI a render is still in progress —
                 * `queued` keeps the client polling instead of showing an error.
                 */
                $session->update([
                    'status' => TryOnSession::STATUS_QUEUED,
                    'error_message' => $result['error'] ?? 'The try-on service is still rendering this fitting.',
                ]);

                $this->logTimings($session, $attemptStarted, $result);

                // Releases with the job's own `$backoff`, then re-picks it.
                $this->release($this->backoff);

                return;
            } else {
                /*
                 * TERMINAL — either not retryable at all, or the attempts are used
                 * up. Report the PROVIDER's reason, which is what the customer can
                 * act on, rather than a queue-internal message.
                 */

                $session->markFailed($result['error'] ?? 'VTON processing failed.', $result['feedback'] ?? null);
                $this->logTimings($session, $attemptStarted, $result);
            }
        } catch (\Exception $e) {
            Log::error("TryOn job failed for session {$this->sessionId}: " . $e->getMessage());

            $session->markFailed('Processing error: ' . $e->getMessage());
        }
    }

    /**
     * Is this a failure the queue should RETRY rather than surface as terminal?
     *
     * Only conditions that clear on their own belong here:
     *
     *  - `renderer_busy` — PixelAPI runs ONE job at a time, so a submit that is
     *    refused (503 queue_full), folded into an in-flight job (`coalesced`), or
     *    whose poll window closed while it was still working is the provider
     *    telling us "not yet", not "never". MEASURED as the dominant real-world
     *    failure on this deployment.
     *
     *  - `renderer_unreachable` — a connection reset / DNS blip / timeout is a
     *    network hiccup, not a verdict on the input. A retry is exactly what
     *    clears it, and it costs one submit.
     *
     *  - `renderer_safety_unavailable` — PixelAPI's clothing-safety service is
     *    briefly down (MEASURED: `vton_safety_unavailable; Clothing safety checks
     *    are temporarily unavailable. No credits were charged. Please retry.`).
     *    The vendor explicitly asks for a retry, charges nothing, and the outage
     *    clears on its own. It used to be folded into `renderer_busy`, which is why
     *    it is listed here rather than being a new class of behaviour: the RETRY
     *    was always right, only the DESCRIPTION and the CODE were wrong.
     *
     * Deliberately NOT retryable: `renderer_no_image` (the provider ran and gave
     * us nothing), `renderer_rejected` (a validation decision on this payload),
     * `not_configured`, auth/quota codes — retrying those burns minutes for the
     * same answer.
     */
    protected function isRetryableFailure(array $result): bool
    {
        return in_array($result['code'] ?? null, ['renderer_busy', 'renderer_unreachable', 'renderer_safety_unavailable'], true);
    }

    /**
     * Are there attempts left to spend on a transient failure?
     *
     * Enforces the `$tries` cap explicitly, because `retryUntil()` being non-null
     * makes Laravel's own attempt check dead (see the note in the retry branch).
     * `attempts()` counts the runs ALREADY made, so the job may retry while the
     * count is below `$tries`.
     *
     * NOTE THE INTERACTION WITH `$tries`: this is why raising `$tries` from 1 to 2
     * is what actually SWITCHES ON the release branch. The method itself is
     * unchanged and correct; it was `$tries = 1` that made it always return false.
     */
    protected function attemptsLeft(): bool
    {
        /*
         * Outside a worker (`$this->job` is null) there is no attempts counter, so
         * `attempts()` cannot be trusted. Returning false keeps the previous
         * behaviour for that case: do not try to release, just report the failure.
         * (Reaching here without a job only happens in a direct/unit invocation.)
         */
        if ($this->job === null) {
            return false;
        }

        return $this->attempts() < $this->tries;
    }

    /**
     * TOP + BOTTOM IN ONE IMAGE — two single-garment passes on the same photo.
     *
     * The providers dress ONE garment per job, so a supported pair (one upper +
     * one lower, see App\Support\TryOnGarmentPlan) is rendered as:
     *
     *   pass 1: the customer's photo  + the BOTTOM  -> intermediate image
     *   pass 2: the intermediate image + the TOP    -> the final fitting
     *
     * CREDIT SAFETY. Each pass is exactly one provider job (the customer is told
     * up front that this look uses two renders). Pass 1's image is stored in the
     * encrypted RenderVault and recorded on the session BEFORE pass 2 starts, so a
     * busy/failed pass 2 — retried by the queue or by the customer — resumes at
     * pass 2 and never pays for pass 1 twice.
     *
     * ONE PROVIDER RENDER PER JOB ATTEMPT. Pass 2 runs as a fresh job, so each
     * attempt stays inside the per-attempt timeout and retry budget that were
     * sized for a single render. If the vault cannot store pass 1, pass 2 runs
     * here instead so the paid first pass is not lost.
     */
    protected function renderPair(TryOnSession $session): array
    {
        $input = $this->renderInputFor($session);
        $pipeline = $session->pipeline();
        [$firstIndex, $secondIndex] = array_map('intval', (array) ($pipeline['order'] ?? [0, 1]));

        if (! isset($input['garments'][$firstIndex], $input['garments'][$secondIndex])) {
            return [
                'success' => false,
                'error' => 'This fitting is missing one of its two garments. Please select them again.',
                'code' => 'bad_garment',
            ];
        }

        $pick = fn (int $i, string $person) => [
            'person' => $person,
            'garments' => [$input['garments'][$i]],
            'categories' => [$input['categories'][$i] ?? null],
        ];

        $firstPass = $pipeline['first_pass'] ?? null;
        $person = null;

        if (! empty($firstPass['path'])) {
            // Resume: pass 1 was already rendered (and paid for).
            $person = \App\Support\RenderVault::get($firstPass['path']);
            if (! $person) {
                $session->updatePipeline(['first_pass' => null]);

                return [
                    'success' => false,
                    'error' => 'The first half of this two-piece fitting could not be read back. Please try again.',
                    'code' => 'pair_resume_failed',
                ];
            }
        } else {
            $first = $this->timedRender($session, $pick($firstIndex, $input['person']), 'pair-1');
            if (empty($first['success'])) {
                return $first;
            }

            $path = null;
            try {
                $path = \App\Support\RenderVault::put($first['image_base64']);
            } catch (\Throwable $e) {
                Log::warning("TryOn session {$this->sessionId}: first pass could not be vaulted; continuing in this attempt.");
            }

            if ($path) {
                $session->updatePipeline(['first_pass' => [
                    'path' => $path,
                    'engine' => $first['engine'] ?? null,
                    'category' => $input['categories'][$firstIndex] ?? null,
                ]]);

                // Pass 2 gets its own job (own timeout, own retry budget).
                self::dispatch($session->id);

                return ['success' => false, 'handed_off' => true, 'code' => 'pair_first_pass_done'];
            }

            $person = $first['image_base64'];
        }

        $second = $this->timedRender($session, $pick($secondIndex, $person), 'pair-2');
        if (empty($second['success'])) {
            return $second;
        }

        $second['pair'] = true;
        $second['placed'] = [$input['categories'][$firstIndex] ?? null, $input['categories'][$secondIndex] ?? null];

        return $second;
    }

    /**
     * The person image, garments and categories a render is given — the
     * session's own inputs, index-aligned.
     */
    protected function renderInputFor(TryOnSession $session): array
    {
        $garments = array_values((array) ($session->garment_photos_json ?? []));
        $categories = array_values((array) ($session->garment_categories_json ?? []));
        $categories = array_slice(array_pad($categories, count($garments), null), 0, count($garments));

        return [
            'person' => (string) $session->user_photo_base64,
            'garments' => $garments,
            'categories' => $categories,
        ];
    }

    /** One provider render (the full tier chain), with its duration recorded. */
    protected function timedRender(TryOnSession $session, ?array $input, string $stage): array
    {
        $started = microtime(true);
        $result = $this->callVtonApi($session, $input);

        $this->timings['passes'][] = [
            'stage' => $stage,
            'engine' => $result['engine'] ?? null,
            'ok' => ! empty($result['success']),
            'code' => $result['code'] ?? null,
            'provider_ms' => (int) round((microtime(true) - $started) * 1000),
        ] + (array) ($result['timings'] ?? []);

        return $result;
    }

    /**
     * Where the time went, per attempt: queue wait, each provider pass (submit /
     * provider wait / result download), storing the result, and the total since
     * the customer pressed Generate. Image data never reaches the log.
     */
    protected function logTimings(TryOnSession $session, float $attemptStarted, array $result): void
    {
        Log::info('TryOn render timings', [
            'session' => $session->session_id,
            'mode' => $session->isPairRender() ? 'pair' : 'single',
            'outcome' => ! empty($result['handed_off']) ? 'first-pass-stored' : (! empty($result['success']) ? 'completed' : ($result['code'] ?? 'failed')),
            'attempt' => $this->job ? $this->attempts() : null,
            'attempt_ms' => (int) round((microtime(true) - $attemptStarted) * 1000),
            'since_request_ms' => $session->created_at ? (int) round((microtime(true) - $session->created_at->getTimestamp()) * 1000) : null,
        ] + $this->timings);
    }

    /**
     * Select and call a VTON provider.
     *
     * PROVIDERS ARE TRIED IN ORDER AND WE FALL THROUGH ON FAILURE.
     *
     * The previous version returned the FIRST configured provider's result
     * unconditionally. With a token present but unusable, every render failed
     * hard — e.g. `HUGGINGFACE_API_TOKEN` set to an expired/unauthorised key
     * produced `HF API error: 403` and the customer saw a failed fitting even
     * though a perfectly good local renderer was available.
     *
     * Now a provider failure is logged and the chain continues, so the Studio
     * always returns SOMETHING renderable instead of a dead end.
     */
    protected function callVtonApi(TryOnSession $session, ?array $input = null): array
    {
        /*
         * THREE TIERS, IN PRIORITY ORDER — FASHN, THEN PIXELAPI, THEN HUGGING FACE.
         *
         * THE ORDER IS SLOT-DRIVEN, NOT HARD-CODED TO A VENDOR. Each tier is a
         * `config/services.php` SLOT (`services.fashn`, `services.vton`) handed to
         * the SAME renderer, `VtonApiRenderer`, which reads every endpoint, field
         * name and category vocabulary from that slot. So "which engine is
         * primary" is decided entirely by which slot has a token:
         *
         *   VTON_FASHN_API_TOKEN absent (TODAY)
         *     -> the FASHN slot returns `not_configured` and is skipped
         *     -> PIXELAPI renders, exactly as before this change
         *
         *   VTON_FASHN_API_TOKEN present (paste the key, `config:clear && config:cache`)
         *     -> FASHN renders FIRST, with PixelAPI behind it as the fallback.
         *        No code change, no deploy — the .env value is the switch.
         *
         * A SLOT WITH NO TOKEN IS SKIPPED, NOT FAILED. `not_configured` is in the
         * job's NON-RETRYABLE code set and simply continues the chain, so an
         * absent key on an OPTIONAL provider never burns a retry or ends a
         * session. That is what keeps today's behaviour identical.
         *
         * FALL-THROUGH RULE, UNCHANGED IN SPIRIT: any non-success from a tier is
         * logged and the chain continues, so a customer render never dies on the
         * primary — it only fails when EVERY configured tier cannot serve it.
         *
         * LICENSING CAVEAT (Hugging Face tier): IDM-VTON's weights are
         * CC BY-NC-SA — NON-COMMERCIAL. Free of charge is not free of licence: a
         * commercial storefront must render through the paid tiers, which is why
         * Hugging Face now ranks LAST, behind both paid slots.
         *
         * WHAT THE TWO PAID TIERS ARE FOR: a purpose-built VTON model (IDM-VTON /
         * FASHN VTON behind a hosted API) was trained to deform a garment onto a
         * body, which is exactly the job. Gemini (billed-only image generation,
         * `429, limit: 0` on a free key) and the local browser composite stay out
         * of the chain for the same measured reasons as before.
         */

        /*
         * TIER 1 + TIER 2 — THE PAID VTON SLOTS, HIGHEST PRIORITY FIRST.
         *
         * Both are driven through the SAME method (`callVtonApiRenderer()`) and
         * differ only by the SLOT NAME, so there is exactly one render path to
         * reason about, test and fix. Adding a third paid slot later is one entry
         * here plus one config block — no new renderer.
         *
         * EACH ENTRY IS GATED ON ITS OWN TOKEN. The gate is deliberately reading
         * the same key the renderer reads, so "the chain skips it" and "the
         * renderer would report not_configured" can never disagree.
         */
        $paidSlots = [
            ['slot' => 'fashn', 'engine' => 'FASHN'],
            ['slot' => 'vton', 'engine' => 'PixelAPI'],
        ];

        // The most informative failure from a CONFIGURED tier (see the tail note).
        $lastConfiguredFailure = null;

        foreach ($paidSlots as $tier) {
            $slot = $tier['slot'];

            if (trim((string) config("services.{$slot}.token")) === '') {
                // No credential — this tier is simply not in play today.
                continue;
            }

            $result = $this->callVtonApiRenderer($session, $slot, $input);

            if (! empty($result['success'])) {
                $result['engine'] = $tier['engine'];

                return $result;
            }

            Log::warning("TryOn tier {$tier['engine']} ({$slot}) failed — falling through.", [
                'code' => $result['code'] ?? null,
                'error' => $result['error'] ?? null,
            ]);

            $lastConfiguredFailure = $result;
        }

        /*
         * TIER 3 — HUGGING FACE (the free, non-commercial tier).
         *
         * ITS GUARD IS PRESERVED VERBATIM AND IS NOT A TOKEN CHECK.
         *
         * `config('services.huggingface.vton_space')` DEFAULTS to 'yisol/IDM-VTON'
         * (config/services.php), so it is never empty and this tier is effectively
         * always "configured". That is intentional and load-bearing: the guard is
         * left exactly as it was so that today's behaviour is unchanged, and the
         * SKIPPING of an unusable HF Space is left to the renderer's own
         * `not_configured` verdict rather than being duplicated here. Tightening
         * it into a token check would silently remove a tier that is currently
         * reachable, which is a behaviour change this task must not make.
         */
        $hfResult = null;

        if (config('services.huggingface.vton_space') || config('services.huggingface.vton_base')) {
            $hfResult = $this->callHuggingFaceSpaceVton($session, $input);

            if (! empty($hfResult['success'])) {
                $hfResult['engine'] = 'HuggingFace';

                return $hfResult;
            }

            Log::warning('Hugging Face VTON failed — no tiers left.', [
                'code' => $hfResult['code'] ?? null,
                'error' => $hfResult['error'] ?? null,
            ]);
        }

        /*
         * EVERY TIER FAILED — report the MOST INFORMATIVE reason.
         *
         * Precedence is by how much the reason tells the operator AND the retry
         * policy:
         *
         *  1. A CONFIGURED PAID TIER'S OWN FAILURE WINS. PixelAPI (or FASHN) is
         *     the production engine, its codes drive `isRetryableFailure()`, and
         *     its message is what the customer can act on. This is the pre-existing
         *     rule, now expressed across two slots instead of one.
         *  2. OTHERWISE THE HF FAILURE IS SURFACED — it is a real render attempt
         *     that produced a real reason, whereas the paid tiers' `not_configured`
         *     would bury it behind a missing-env-var message.
         *  3. OTHERWISE THE LAST PAID RESULT (today: PixelAPI's `not_configured`),
         *     which is the honest answer when NOTHING is configured.
         */
        if ($lastConfiguredFailure !== null) {
            return $lastConfiguredFailure;
        }

        if ($hfResult !== null) {
            return $hfResult;
        }

        /*
         * NO PAID SLOT WAS CONFIGURED AND THE HF GUARD DID NOT ADMIT IT EITHER.
         *
         * Reached only when every paid token is empty AND the HF guard is falsy —
         * which, given the guard's own default, means an operator actively cleared
         * `HUGGINGFACE_VTON_SPACE` and `HUGGINGFACE_VTON_BASE`. Returning a
         * `not_configured` here (rather than an empty array) keeps the caller's
         * contract intact: `handle()` always receives a `code`, so the session
         * fails with a real reason instead of an "Undefined array key" fatal.
         */
        Log::error('TryOn: no VTON provider is configured — every tier was skipped.');

        return [
            'success' => false,
            'engine' => 'none',
            'error' => 'No try-on engine is configured on this deployment. Set VTON_FASHN_API_TOKEN (FASHN) or VTON_API_TOKEN (PixelAPI), or configure the Hugging Face Space.',
            'code' => 'not_configured',
        ];
    }

    /**
     * Free-tier render through the yisol/IDM-VTON Hugging Face Space.
     *
     * The transport (upload -> submit -> SSE stream) lives entirely in
     * App\Services\HuggingFaceVtonRenderer, so this stays a thin orchestrator
     * with the same session-unpacking shape as callVtonApiRenderer.
     *
     * LICENSING CAVEAT — carried here because this is the call site: IDM-VTON
     * is CC BY-NC-SA 4.0. Renders from this Space are for development/demo use;
     * commercial production must run the paid VtonApiRenderer path.
     */
    protected function callHuggingFaceSpaceVton(TryOnSession $session, ?array $input = null): array
    {
        $measurements = $session->measurements_json ?? [];
        // `$input` carries ONE pass of a two-piece look; null = the session's own inputs.
        $input ??= $this->renderInputFor($session);

        return app(HuggingFaceVtonRenderer::class)->render(
            $input['person'],
            $input['garments'],
            (array) $measurements,
            null,
            $session->render_plan_json,
            $input['categories'],
        );
    }

    /**
     * LEGACY CHAIN — RETAINED, NO LONGER CALLED.
     *
     * Kept (rather than deleted) so the historical provider code and its measured
     * rationale stay readable for whoever re-enables a tier later. `callVtonApi`
     * no longer invokes this; PixelAPI is the only engine in use.
     */
    protected function callVtonApiChain(TryOnSession $session): array
    {
        $preferred = strtolower((string) config('services.tryon.provider', 'auto'));
        $chain = [];

        /*
         * PROVIDER REGISTRY
         * -----------------
         * `replicate` – IDM-VTON. Kept wired so a paid key just works.
         * `composite` – offline local renderer. Always available.
         *
         * GEMINI WAS REMOVED FROM THE CHAIN, and this is a MEASURED decision, not
         * a preference. Image generation on Google's API is BILLED-ONLY: the
         * free tier reports `limit: 0` for every image model, so a free key can
         * never render. Probed directly against this project's key:
         *
         *   gemini-2.5-flash-image        -> 429, limit: 0
         *   gemini-3-pro-image            -> 429, limit: 0
         *   nano-banana-pro-preview       -> 429, limit: 0
         *   gemini-3.1-flash-lite-image   -> 429, limit: 0
         *   gemini-3.1-flash-image-preview-> 429, limit: 0
         *
         * `limit: 0` means the quota is ZERO, not exhausted — retrying, backing
         * off and cycling model IDs cannot ever succeed. Keeping the tier only
         * added a guaranteed 20-30s of wasted latency to every failed fitting
         * before the browser renderer ran. The renderer class is left in place so
         * a BILLED key can be re-enabled by adding it back here.
         *
         * HUGGING FACE IDM-VTON was also removed. The Space `yisol/IDM-VTON` is
         * alive on a free ZeroGPU GPU and its /upload and /call/tryon endpoints
         * accept requests, but `/queue/join` — the WebSocket that carries the
         * render result — answers HTTP 403 to every non-browser client, including
         * with a valid token in both the query string and the Authorization
         * header. ZeroGPU gates GPU work behind an authenticated BROWSER session,
         * so it cannot be driven from a PHP backend at all.
         */
        /*
         * THE DEDICATED VTON TIER LEADS THE CHAIN.
         *
         * A purpose-built try-on model (FASHN VTON / IDM-VTON behind a hosted
         * API) is strictly the right tool for this job: it was trained to deform
         * a garment onto a body, and it accepts the flat-lay / ghost-mannequin
         * imagery this catalog stores. Gemini, by contrast, is a general image
         * generator being asked to re-dress a person, and its image generation is
         * BILLED-ONLY on a free-tier key (see the note below).
         *
         * So when a VTON endpoint is configured it is tried FIRST, and Gemini
         * remains as the next option for deployments that have billing enabled.
         * When no VTON token is set the tier is skipped entirely — an
         * unconfigured option must never cost a round-trip.
         */
        if (config('services.vton.endpoint') && config('services.vton.token')) {
            $chain['VtonApi'] = fn () => $this->callVtonApiRenderer($session);
        }

        // Gemini is tried when its image key is configured (it is billed-only).
        if (GeminiKeyPool::current() && config('services.gemini.image_model')) {
            $chain['Gemini'] = fn () => $this->callGeminiVton($session);
        }

        if (config('services.replicate.token')) {
            $chain['Replicate'] = fn () => $this->callReplicateVton($session);
        }

        // An explicit provider choice runs ALONE; `auto` runs the whole chain.
        if ($preferred !== 'auto' && isset($chain[ucfirst($preferred)])) {
            $chain = [ucfirst($preferred) => $chain[ucfirst($preferred)]];
        }

        foreach ($chain as $name => $call) {
            try {
                $result = $call();

                if (! empty($result['success'])) {
                    $result['engine'] = $name;
                    return $result;
                }

                /*
                 * A TEXT-ONLY ANSWER IS A REFUSAL, NOT A TRANSIENT ERROR.
                 *
                 * The multimodal model came back with prose instead of an image
                 * (Google's non-configurable content filters do this: the
                 * `finishReason` is SAFETY / PROHIBITED_CONTENT / IMAGE_SAFETY).
                 * Retrying a refusal costs minutes and always returns the same
                 * answer, so the session is marked here and the queue stops.
                 */
                /*
                 * NON-RETRYABLE CODES ARE THE ONES THAT CANNOT IMPROVE ON RETRY.
                 *
                 * `not_configured` is deliberately NOT in this list. It means an
                 * OPTIONAL provider has no credentials, which is not a failure of
                 * the request — the chain must simply continue to the next
                 * provider. Marking it non-retryable would abort the remaining
                 * tiers and hand the customer a dead canvas for a missing env
                 * var.
                 *
                 * A text-only refusal and an unavailable model ARE non-retryable:
                 * the multimodal model answering with prose is a content-filter
                 * decision, and retrying it burns minutes for the same answer.
                 */
                if (in_array($result['code'] ?? null, ['renderer_no_image', 'model_unavailable', 'model_no_image', 'renderer_unauthorized', 'renderer_payment_required'], true)) {
                    Cache::put('tryon-noretry-' . $this->sessionId, true, now()->addMinutes(10));
                }

                /*
                 * NOTE ON THE TRANSIENT PROVIDER-BUSY / REJECTED CODES.
                 *
                 * NEITHER `renderer_busy` NOR `renderer_rejected` is marked
                 * non-retryable, and both are deliberate:
                 *
                 *  - `renderer_busy` — PixelAPI runs one job at a time, so a
                 *    second submit is refused (503 queue_full / coalesced) while the
                 *    first is running. It clears within seconds.
                 *
                 *  - `renderer_rejected` — a 422 on the SAME payload proven to
                 *    succeed minutes later (measured: sessions #51-#53 rejected at
                 *    20:49-21:10, then re-submitted unchanged, queued, rendered in
                 *    42s and completed). The rejection is provider-side validation
                 *    flaking, not a permanent property of the input.
                 *
                 * Letting the job's own retry/backoff handle both gives automatic
                 * recovery instead of a dead session the customer must retry by
                 * hand. `renderer_rejected` previously shared `renderer_no_image`,
                 * so it was treated as permanent — which is exactly how a transient
                 * 422 became a hard "Fitting Interrupted".
                 */

                Log::warning("TryOn provider {$name} failed: " . ($result['error'] ?? 'unknown') . ' — falling back.');
            } catch (\Throwable $e) {
                Log::warning("TryOn provider {$name} threw: " . $e->getMessage() . ' — falling back.');
            }
        }

        /*
         * NO PROVIDER SUCCEED.
         *
         * This used to end in `mockVtonResponse()`, which returned a DRAWN SVG
         * PLACEHOLDER with `success: true`. Marking a placeholder as a success
         * was actively harmful: the session went `completed`, the controller
         * handed the client an `data:image/svg+xml` payload, and the canvas
         * rendered an empty blue-grey card while the customer's own photo and
         * garments were sitting right there unused. It LOOKED like "nothing
         * happened" — because, in every sense that matters, it did.
         *
         * The honest signal is FAILURE. A failed session tells the client "the
         * server cannot render this", which is exactly true, and the client then
         * draws the fitting locally from the customer's real photo — a strictly
         * better outcome than a fake success.
         *
         * The SVG mock is kept ONLY as a diagnostic payload in `feedback`, so an
         * operator reading the session row can see WHY the server declined.
         */
        $mock = $this->mockVtonResponse($session);

        return [
            'success' => false,
            'engine' => 'Composite',
            'error' => 'No server-side AI engine is available on this deployment. '
                . 'Falling back to the local browser composite.',
            'feedback' => $mock['feedback'] ?? null,
        ];
    }

    /**
     * REAL AI try-on via a dedicated VTON API (FASHN VTON / IDM-VTON hosted).
     *
     * This is the tier that actually answers "the garment is WORN, not pasted").
     * The model was trained to deform a garment onto a body, and it accepts a
     * flat-lay / ghost-mannequin garment image — exactly what this catalog stores.
     *
     * The transport, async polling and response-shape walking live in
     * App\Services\VtonApiRenderer, so this job stays a thin orchestrator and a
     * vendor swap is a config change rather than a code change.
     *
     * THE SLOT PARAMETER IS WHAT MAKES ONE METHOD SERVE EVERY PAID TIER.
     * It is passed straight through to the renderer, which reads THAT slot's
     * endpoint, field names, payload shape and category vocabulary — so FASHN and
     * PixelAPI run through this identical code path and differ only by the name.
     *
     * THE DEFAULT IS 'vton' (PixelAPI), WHICH IS THE HISTORICAL BEHAVIOUR. Any
     * existing caller that omits the slot gets exactly what it got before this
     * parameter existed; there is no call site that can drift onto FASHN by
     * accident.
     *
     * @param  string  $slot  `'fashn'` or `'vton'` — a config slot name.
     */
    protected function callVtonApiRenderer(TryOnSession $session, string $slot = 'vton', ?array $input = null): array
    {
        $measurements = $session->measurements_json ?? [];
        // `$input` carries ONE pass of a two-piece look; null = the session's own inputs.
        $input ??= $this->renderInputFor($session);

        return app(VtonApiRenderer::class)->render(
            $input['person'],
            $input['garments'],
            (array) $measurements,
            null,
            $session->render_plan_json,
            $input['categories'],
            $slot,
        );
    }

    /**
     * REAL AI render via Gemini's multimodal image model.
     *
     * The heavy lifting (prompt construction, image parts, response parsing)
     * lives in App\Services\GeminiTryOnRenderer so this job stays a thin
     * orchestrator.
     */
    protected function callGeminiVton(TryOnSession $session): array
    {
        $metrics = $this->resolveBodyMetrics($session);
        $size = $this->calculateSizeRecommendation($metrics['height'], $metrics['waist'], $metrics['chest']);

        $measurements = $session->measurements_json ?? [];
        $garments = $session->garment_photos_json ?? [];

        /*
         * KEEP THE GARMENT LIST AND ITS CATEGORIES ALIGNED.
         *
         * A session stored before categories existed (or one whose images were
         * filtered during normalisation) must still line up index-for-index, so
         * the categories are rebuilt to the length of the garment list. Without
         * this, image 3 could be labelled with image 2's body region.
         */
        $categories = $session->garment_categories_json ?? [];
        $categories = array_values((array) $categories);
        $categories = array_pad($categories, count($garments), null);
        $categories = array_slice($categories, 0, count($garments));

        /*
         * Run the CV pre-processing stage and hand the resulting render plan to
         * the generator.
         *
         * This is the fix for the "undersized floating sticker" output: the
         * planner converts the customer's real body measurements into
         * frame-relative scale ratios and vertical pose anchors, which the
         * renderer compiles into explicit, checkable prompt rules. Without it
         * the model receives only a vague "make it fit" instruction and guesses.
         *
         * Wrapped defensively: planning is an ENHANCEMENT, so a failure here must
         * degrade to the previous prompt-only behaviour rather than lose the
         * whole render.
         */
        $renderPlan = null;
        try {
            $renderPlan = app(TryOnPreProcessor::class)->buildRenderPlan(
                (array) $measurements,
                (array) $garments,
                (string) $session->user_photo_base64,
                $categories,
            );

            Log::info('TryOn render plan built', [
                'session' => $session->session_id,
                'scale' => $renderPlan['scaling']['scale_directive'] ?? null,
                'derived' => $renderPlan['body']['derived_fields'] ?? [],
            ]);
        } catch (\Throwable $e) {
            Log::warning('TryOn pre-processing skipped: ' . $e->getMessage());
        }

        $renderer = app(GeminiTryOnRenderer::class);

        return $renderer->render(
            (string) $session->user_photo_base64,
            (array) $garments,
            (array) $measurements,
            $size,
            $renderPlan,
            $categories,
        );
    }

    /**
     * Call Replicate API for Virtual Try-On using cuuupid/idm-vton model
     */
    protected function callReplicateVton(TryOnSession $session): array
    {
        $apiUrl = 'https://api.replicate.com/v1/predictions';
        $token = config('services.replicate.token');
        $model = config('services.replicate.vton_model', 'cuuupid/idm-vton');

        $userPhotoDataUrl = $session->user_photo_base64;
        $garmentPhotos = $session->garment_photos_json;

        // Use the first garment image (primary garment for try-on)
        // For multi-garment stack, we'll use the topmost layer (outerwear > top > dress > bottom)
        $primaryGarment = $garmentPhotos[0] ?? null;

        if (!$primaryGarment) {
            return ['success' => false, 'error' => 'No garment images provided'];
        }

        $response = Http::withToken($token)
            ->timeout(10)
            ->post($apiUrl, [
                'version' => $model,
                'input' => [
                    'person_image' => $userPhotoDataUrl,
                    'garment_image' => $primaryGarment,
                ],
            ]);

        if ($response->successful()) {
            $prediction = $response->json();
            $predictionUrl = $prediction['urls']['get'];

            // Poll for completion
            return $this->pollReplicatePrediction($predictionUrl, $token);
        }

        Log::error('Replicate API error: ' . $response->body());
        return ['success' => false, 'error' => 'Replicate API error: ' . $response->status()];
    }

    /**
     * Poll Replicate prediction until complete
     */
    protected function pollReplicatePrediction(string $predictionUrl, string $token): array
    {
        $maxAttempts = 60; // 5 minutes max (60 * 5s)
        $attempt = 0;

        while ($attempt < $maxAttempts) {
            sleep(5);
            $attempt++;

            $response = Http::withToken($token)->get($predictionUrl);

            if (!$response->successful()) {
                continue;
            }

            $data = $response->json();
            $status = $data['status'];

            if ($status === 'succeeded') {
                $outputUrl = $data['output'][0] ?? null;
                if ($outputUrl) {
                    // Download and convert to Base64
                    $imageResponse = Http::get($outputUrl);
                    if ($imageResponse->successful()) {
                        $imageBase64 = 'data:image/png;base64,' . base64_encode($imageResponse->body());
                        return [
                            'success' => true,
                            'image_base64' => $imageBase64,
                            'feedback' => 'Generated via Replicate IDM-VTON',
                        ];
                    }
                }
                return ['success' => false, 'error' => 'No output image'];
            }

            if ($status === 'failed' || $status === 'canceled') {
                return ['success' => false, 'error' => 'Prediction ' . $status . ': ' . ($data['error'] ?? 'Unknown')];
            }
        }

        return ['success' => false, 'error' => 'Prediction timeout'];
    }

    /**
     * Call Hugging Face Inference API for Virtual Try-On (Fallback)
     */
    protected function callHuggingFaceVton(TryOnSession $session): array
    {
        /*
         * Build the endpoint from CONFIG, not a hard-coded host.
         *
         * `api-inference.huggingface.co` is deprecated and does not resolve on
         * many networks — every render died with:
         *
         *   cURL error 6: Could not resolve host: api-inference.huggingface.co
         *
         * `config/services.php` already defines the current router host
         * (`huggingface.inference_base`) for exactly this reason, but this job
         * never read it. Using the configured base means the host can be changed
         * in .env without touching code.
         */
        $base = rtrim((string) config('services.huggingface.inference_base'), '/');
        $model = config('services.huggingface.vton_model', 'yisol/IDM-VTON');
        $apiUrl = $base . '/' . ltrim($model, '/');

        $token = config('services.huggingface.token');

        $userPhotoBase64 = $session->user_photo_base64;
        $garmentPhotos = $session->garment_photos_json;
        $primaryGarment = $garmentPhotos[0] ?? null;

        if (!$primaryGarment) {
            return ['success' => false, 'error' => 'No garment images provided'];
        }

        // Convert Base64 to binary for API call
        $userPhotoBinary = base64_decode(preg_replace('#^data:image/\w+;base64,#', '', $userPhotoBase64));
        $garmentPhotoBinary = base64_decode(preg_replace('#^data:image/\w+;base64,#', '', $primaryGarment));

        $response = Http::withToken($token)
            ->timeout(120)
            ->attach('image', $userPhotoBinary, 'user.jpg')
            ->attach('garment', $garmentPhotoBinary, 'garment.jpg')
            ->post($apiUrl);

        if ($response->successful()) {
            $resultImageBase64 = base64_encode($response->body());
            return [
                'success' => true,
                'image_base64' => 'data:image/png;base64,' . $resultImageBase64,
                'feedback' => 'Generated via Hugging Face IDM-VTON',
            ];
        }

        Log::error('Hugging Face VTON API error: ' . $response->body());
        return ['success' => false, 'error' => 'HF API error: ' . $response->status()];
    }

    /**
     * Mock response for development/testing without external API keys
     */
    protected function mockVtonResponse(TryOnSession $session): array
    {
        $metrics = $this->resolveBodyMetrics($session);
        $height = $metrics['height'];
        $waist = $metrics['waist'];
        $chest = $metrics['chest'];

        // Generate a more realistic mock based on measurements
        $sizeRecommendation = $this->calculateSizeRecommendation($height, $waist, $chest);

        $placeholderSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">
            <defs>
                <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#0a0a1a"/>
                    <stop offset="100%" style="stop-color:#1a1a3e"/>
                </linearGradient>
                <filter id="glow">
                    <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <rect fill="url(#bgGrad)" width="512" height="768"/>
            <!-- Body silhouette -->
            <ellipse cx="256" cy="200" rx="80" ry="70" fill="#2a2a4a" filter="url(#glow)"/>
            <path d="M176 270 Q140 400 180 600 Q200 700 256 720 Q312 700 332 600 Q372 400 336 270 Z" fill="#2a2a4a" filter="url(#glow)"/>
            <!-- Garment overlay -->
            <path d="M176 270 Q160 320 170 420 Q185 500 256 520 Q327 500 342 420 Q352 320 336 270 Z" fill="#F5EBE0" opacity="0.3" filter="url(#glow)"/>
            <text x="256" y="200" font-family="Arial, sans-serif" font-size="28" fill="#F5EBE0" text-anchor="middle" font-weight="bold">Virtual Try-On</text>
            <text x="256" y="240" font-family="Arial, sans-serif" font-size="16" fill="#888" text-anchor="middle">AI Generated Preview</text>
            <text x="256" y="280" font-family="Arial, sans-serif" font-size="14" fill="#666" text-anchor="middle">Session: ' . $session->session_id . '</text>
            <text x="256" y="310" font-family="Arial, sans-serif" font-size="13" fill="#F5EBE0" text-anchor="middle" font-weight="bold">' . $sizeRecommendation . '</text>
            <text x="256" y="340" font-family="Arial, sans-serif" font-size="12" fill="#888" text-anchor="middle">Waist: ' . $waist . 'cm | Chest: ' . $chest . 'cm</text>
            <text x="256" y="370" font-family="Arial, sans-serif" font-size="11" fill="#666" text-anchor="middle">[External VTON API not configured - Mock Renderer]</text>
            <!-- Decorative elements (luxury cream accents) -->
            <circle cx="100" cy="150" r="30" fill="none" stroke="#F5EBE0" stroke-width="1" opacity="0.2"/>
            <circle cx="412" cy="150" r="30" fill="none" stroke="#F5EBE0" stroke-width="1" opacity="0.2"/>
            <circle cx="100" cy="650" r="25" fill="none" stroke="#F5EBE0" stroke-width="1" opacity="0.15"/>
            <circle cx="412" cy="650" r="25" fill="none" stroke="#F5EBE0" stroke-width="1" opacity="0.15"/>
        </svg>';

        $placeholderBase64 = 'data:image/svg+xml;base64,' . base64_encode($placeholderSvg);

        return [
            'success' => true,
            'image_base64' => $placeholderBase64,
            'feedback' => 'Mock VTON result - configure Replicate or Hugging Face API for real generation. ' . $sizeRecommendation,
        ];
    }

    /**
     * Generate AI Fit Feedback based on body metrics and VTON result
     */
    protected function generateAiFitFeedback(TryOnSession $session, array $vtonResult): string
    {
        $metrics = $this->resolveBodyMetrics($session);
        $height = $metrics['height'];
        $waist = $metrics['waist'];
        $chest = $metrics['chest'];
        $hips = $metrics['hips'];

        $sizeRecommendation = $this->calculateSizeRecommendation($height, $waist, $chest);
        $fitAnalysis = $this->analyzeFit($height, $waist, $chest);

        $feedback = "✨ **Virtual Fitting Complete**\n\n";
        // Machine-readable prefix: TryOnController extracts this for the
        // `recommended_size` field the UI renders as a clean size chip.
        $feedback .= "SIZE: {$sizeRecommendation}\n\n";
        $feedback .= "**AI Size Recommendation:** Size {$sizeRecommendation}\n\n";
        $feedback .= "**Fit Analysis:** {$fitAnalysis}\n\n";
        $feedback .= "**Body Metrics:** Chest {$chest}cm | Waist {$waist}cm" . ($hips ? " | Hips {$hips}cm" : '') . "\n\n";

        /*
         * SAY WHICH PIECES WERE ACTUALLY RENDERED. The renderer's own note about
         * omitted layers used to be discarded here, so a multi-piece stack that
         * rendered one garment said nothing about the others.
         */
        $names = collect((array) ($session->garment_metadata_json ?? []))->pluck('name')->filter()->values();
        if (! empty($vtonResult['pair'])) {
            $feedback .= '**Rendered pieces:** ' . ($names->count() >= 2 ? $names->join(' + ') : 'top + bottom') . " (one pass each)\n\n";
        } elseif (count((array) ($session->garment_photos_json ?? [])) > 1 && ! empty($vtonResult['feedback'])) {
            $feedback .= '**Note:** ' . $vtonResult['feedback'] . "\n\n";
        }

        $feedback .= "💡 *Tip: For best results, ensure your portrait is front-facing with good lighting.*";

        return $feedback;
    }

    /**
     * Resolve the session's measurements into the single canonical CM shape the
     * sizing heuristics read (height/waist/chest/hips).
     *
     * The session carries centimetres the controller DERIVED from the customer's
     * size profile (see TryOnController::bodyMetricsFor) — there is no typed
     * measurement and no height anywhere in the schema. Reading `waist ?? 30`
     * therefore used to interpret a 70cm waist as 30 and mis-size every render.
     * This normaliser aliases chest_bust -> chest, derives a height from
     * shoulder/sleeve proportions when it is absent, and only falls back to a
     * neutral average body when a metric is truly missing.
     *
     * @return array{height: int, waist: int, chest: int, hips: int}
     */
    protected function resolveBodyMetrics(TryOnSession $session): array
    {
        $m = $session->measurements_json ?? [];

        $chest = $m['chest'] ?? $m['chest_bust'] ?? null;
        $waist = $m['waist'] ?? null;
        $hips  = $m['hips'] ?? null;
        $height = $m['height'] ?? null;

        // Historical records may have been stored in inches (<= 60). Anything
        // in that range is converted to cm so old sessions still size sanely.
        $chest = $this->toCentimetres($chest, 90.0);
        $waist = $this->toCentimetres($waist, 74.0);
        $hips  = $this->toCentimetres($hips, 96.0);

        if (! $height) {
            // No height field exists. Estimate a neutral 170cm frame rather than
            // assuming a value that contradicts the sizes the customer chose.
            $height = 170;
        }

        return [
            'height' => (int) round($height),
            'waist'  => (int) round($waist),
            'chest'  => (int) round($chest),
            'hips'   => (int) round($hips),
        ];
    }

    /**
     * Coerce a raw measurement to centimetres.
     *
     * Values above 60 are assumed to already be cm; smaller values are treated
     * as inches and converted (1in = 2.54cm). Missing values take the fallback.
     */
    protected function toCentimetres($value, float $fallback): float
    {
        if (! is_numeric($value)) {
            return $fallback;
        }

        $value = (float) $value;
        if ($value <= 0) {
            return $fallback;
        }

        return $value <= 60 ? $value * 2.54 : $value;
    }

    /**
     * Calculate size recommendation based on body metrics.
     *
     * DELEGATES to SizeChart so the size the AI reports is produced by the SAME
     * function the Size Suggester and the stylist use. These thresholds used to
     * be copied here, which meant a chart change could leave the render and the
     * chip reporting different sizes for the same body.
     *
     * The signature is kept as-is because callers pass ints from the session;
     * `$height` is used elsewhere in the fit analysis and is not part of sizing.
     */
    protected function calculateSizeRecommendation(int $height, int $waist, int $chest): string
    {
        return SizeChart::recommend((float) $chest, (float) $waist) ?? 'M';
    }

    /**
     * Analyze fit characteristics
     */
    protected function analyzeFit(int $height, int $waist, int $chest): string
    {
        $analyses = [];

        // Height analysis
        if ($height < 160) {
            $analyses[] = "Petite frame - shorter hemlines and proportionate scaling recommended";
        } elseif ($height > 185) {
            $analyses[] = "Tall frame - longer lengths and extended proportions advised";
        } else {
            $analyses[] = "Standard height - regular proportions apply";
        }

        // Waist-to-chest ratio analysis. Guard the divisor so a zero/unset
        // chest can never raise a DivisionByZeroError and fail the job.
        $ratio = $chest > 0 ? $waist / $chest : 0.8;
        if ($ratio < 0.7) {
            $analyses[] = "Athletic build - fitted styles enhance V-taper silhouette";
        } elseif ($ratio > 0.9) {
            $analyses[] = "Fuller midsection - structured tailoring with drape recommended";
        } else {
            $analyses[] = "Balanced proportions - versatile fit options available";
        }

        // Waist-specific (cm scale).
        if ($waist > 91) {
            $analyses[] = "Consider elastic waistbands or adjustable closures for comfort";
        }

        return implode(". ", $analyses) . ".";
    }

    /**
     * The WALL-CLOCK DEADLINE for this job's whole retry cycle.
     *
     * CRITICAL — READ BEFORE CHANGING THIS.
     *
     * Laravel's worker consults `retryUntil()` INSTEAD OF the `$tries` counter,
     * not as well as it. See Illuminate\Queue\Worker:
     *
     *     if (! $job->retryUntil() && $maxTries > 0 && $job->attempts() >= $maxTries) {
     *         // ...mark as failed
     *
     * `$job->retryUntil()` truthy SHORT-CIRCUITS the max-attempts check entirely.
     * So while this method returns a NON-NULL date, `$tries` is IGNORED.
     *
     * That is exactly why the previous `return now()->addMinutes(4)` was wrong in
     * two ways:
     *
     *   1. It was SMALLER than a single render (measured ~5 minutes under load),
     *      so the job was already past its deadline before the first attempt
     *      ended, and every retry died as "attempted too many times".
     *   2. It recomputed `now() + N` on EVERY attempt, so it always described a
     *      FRESH deadline — an unbounded loop if N is large (observed: 21 runs of
     *      the same job).
     *
     * The fix is to base the deadline on the JOB'S OWN PUSH TIME, not on `now()`,
     * so it is a single absolute instant for the whole retry cycle and does not
     * move forward when the job is re-picked.
     *
     * Returns `null` when there is no deadline to enforce — a non-retryable
     * refusal must not be resurrected by a grant of more time, so in that case we
     * return an instant that has already passed.
     */
    public function retryUntil(): ?\DateTimeInterface
    {
        // A hard refusal: kill the retry loop now (a past date is already expired).
        if (Cache::has('tryon-noretry-' . $this->sessionId)) {
            return now()->subSecond();
        }

        /*
         * DEADLINE = PUSH TIME + 15 MINUTES.
         *
         * RAISED FROM 5 MINUTES BECAUSE THE POLL WINDOW WENT 120s -> 240s.
         *
         * This deadline is the WALL-CLOCK bound on the job's whole retry cycle, so
         * it must cover the WORST CASE the retry policy can actually produce. That
         * worst case is now:
         *
         *   attempt 1  -> up to 240s of polling
         *   backoff    -> 15s
         *   attempt 2  -> up to 240s of polling
         *   plus submit round trips and image downloads
         *   ------------------------------------------------
         *   ~8-9 minutes in total
         *
         * The old 5 minutes was derived from a `$tries = 1` job with a 120s poll
         * window, and it is now SMALLER than a single worst-case attempt pair — the
         * exact class of bug the note below describes (a deadline under one render).
         * 15 minutes covers the pair twice over, which leaves room for the download
         * and prohibits an unbounded loop.
         *
         * WHY NOT MERELY "BIGGER": because a deadline that never expires is the
         * unbounded-loop half of the same bug. It must be large enough to admit the
         * legitimate worst case and small enough that a wedged job is still reaped.
         * 15 minutes is comfortably inside both bounds.
         *
         * The deadline is still anchored to the job's PUSH time (not `now()`), so it
         * is one absolute instant rather than a sliding one.
         */
        $pushedAt = $this->pushedAt();

        return ($pushedAt ?? now())->copy()->addMinutes(15);
    }

    /**
     * The instant this job was first pushed onto the queue.
     *
     * Read from the job payload so the value is STABLE across retries (unlike
     * `now()`), which is what makes `retryUntil()` behave as one absolute deadline
     * rather than a sliding one. Falls back to null outside a worker (e.g. a
     * direct `handle()` call in a test), where the caller substitutes `now()`.
     */
    protected function pushedAt(): ?\Illuminate\Support\Carbon
    {
        try {
            $payload = $this->job?->payload();
            // Laravel's payload key is `createdAt` (older releases: `pushedAt`).
            $pushed = is_array($payload) ? ($payload['pushedAt'] ?? $payload['createdAt'] ?? null) : null;

            return $pushed ? \Illuminate\Support\Carbon::createFromTimestamp((int) $pushed) : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function failed(\Throwable $exception): void
    {
        $session = TryOnSession::find($this->sessionId);
        if (! $session) {
            return;
        }

        /*
         * REPORT THE PROVIDER'S REASON, NOT THE QUEUE'S BOOKKEEPING.
         *
         * When every attempt ends in a retryable provider condition (PixelAPI
         * busy / slower than the poll window), the exception that finally lands
         * here is `MaxAttemptsExceededException` — "attempted too many times".
         * That string describes the QUEUE, not the RENDER, and tells the customer
         * (and whoever debugs this) nothing about what actually happened.
         *
         * The last real reason the renderer produced is kept on the session, so
         * prefer it. The generic fallback remains for genuine unexpected throws.
         */
        $lastReason = trim((string) $session->error_message);

        $session->markFailed(
            $lastReason !== ''
                ? $lastReason
                : 'Job failed: ' . $exception->getMessage()
        );
    }
}