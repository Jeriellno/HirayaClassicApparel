<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Support\LocalAsset;

/**
 * VtonApiRenderer — a REAL virtual try-on render through a hosted VTON API.
 *
 * WHY THIS CLASS EXISTS NEXT TO GeminiTryOnRenderer
 * -------------------------------------------------
 * Gemini's multimodal model is a GENERAL image generator that we ask to re-dress
 * a person. It works, but it is not a try-on model: it has no concept of garment
 * deformation, so the fitted-ness of the result is whatever the prompt can coax
 * out of it. Image generation on Gemini is also BILLED-ONLY (a free-tier key
 * returns `429, limit: 0` for every image model — measured, see
 * ProcessTryOnJob), so it cannot be the free path.
 *
 * A DEDICATED VTON API is the correct tool. These services run purpose-built
 * try-on diffusion models (IDM-VTON, or FASHN VTON) whose entire training
 * objective is "the garment must deform onto THIS body". They also accept a
 * FLAT-LAY / GHOST-MANNEQUIN garment image, which is exactly what this catalog
 * stores in `ghost_mannequin_url`.
 *
 * PROVIDER-NEUTRAL BY DESIGN — AND SLOT-AWARE
 * --------------------------------------------
 * Multiple vendors expose the same shape (person image + garment image in,
 * image out) with only small differences in field names and auth. Instead of
 * writing one class per vendor, this renderer takes the endpoint, the field
 * names and the response path from CONFIG, so switching vendor is a .env change
 * and not a code change. The documented contracts are:
 *
 *   - FASHN       : POST https://api.fashn.ai/v1/run      { model_name, inputs }
 *   - PixelAPI    : POST https://api.pixelapi.dev/v1/virtual-tryon { person_image, garment_image, category }
 *
 * A "SLOT" is one vendor's configuration block under `config/services.php`.
 * `render()` takes the slot NAME (`'vton'` = PixelAPI, `'fashn'` = FASHN) and
 * every vendor read in this class is funnelled through `config($slot)`, so ONE
 * instance can render through either vendor. Which vendor actually runs is
 * decided by the CALLER's priority chain (`ProcessTryOnJob::callVtonApi()`),
 * not here.
 *
 * THE DEFAULT SLOT IS `'vton'` (PixelAPI), AND THAT IS LOAD-BEARING.
 * A caller that passes no slot — the historical 6-argument call — gets exactly
 * the behaviour this class had before the slot parameter existed: `services.vton.*`
 * for every read and PixelAPI's category vocabulary. Adding the parameter is
 * therefore purely additive.
 *
 * It deliberately does NOT hard-code a vendor key: the operator supplies one
 * and the renderer becomes live. With no key configured, `render()` returns a
 * clean `not_configured` result so the caller falls through to the next
 * provider instead of failing the session.
 *
 * ONE GARMENT PER CALL — AND WHY THAT IS HONEST
 * ---------------------------------------------
 * A VTON model dresses a person in ONE garment. The Style Stack can hold six
 * layers. Chaining them (dress -> result -> next garment) compounds error with
 * every hop, so this renderer sends the SINGLE most significant garment — the
 * dress if present, else the outerwear, else the top — and reports which layers
 * it could not include. Claiming a six-layer outfit from a one-garment call
 * would be the same class of dishonesty as the old SVG placeholder.
 *
 * TOP + BOTTOM: ProcessTryOnJob runs a supported upper + lower pair as TWO
 * single-garment calls (bottom, then top on that result) — see
 * App\Support\TryOnGarmentPlan. This class still renders one garment per call.
 */
class VtonApiRenderer
{
    /**
     * The DEFAULT configuration slot — PixelAPI.
     *
     * `render()`'s `$slot` parameter defaults to this, so every historical
     * caller (and every call site that predates FASHN) resolves the same config
     * keys, the same payload shape and the same category vocabulary it always
     * did. Nothing about the no-slot path changed; only callers that NAME a slot
     * can reach a different vendor.
     */
    private const DEFAULT_SLOT = 'vton';

    /**
     * The FASHN slot name — the one slot whose category fallbacks are FASHN's.
     *
     * Compared by NAME rather than by inspecting the resolved values, because
     * the vocabulary is a property of the VENDOR, not of whatever an operator
     * happens to have typed into the env. A deployment that blanks
     * `VTON_FASHN_CATEGORY_TOP` must still get `tops`, not PixelAPI's
     * `upperbody`.
     */
    private const FASHN_SLOT = 'fashn';

    /** VTON inference is slower than a text call; allow a generous window. */
    private const TIMEOUT_SECONDS = 180;

    /**
     * Ceiling for ONE garment image in the outgoing request body.
     *
     * Sits just under the portrait's 3.5 MB backstop so the two halves of the
     * payload are governed by comparable limits. See the guard in
     * `selectPrimaryGarment` for the measured failure this prevents.
     */
    private const MAX_GARMENT_BYTES = 3_000_000;

    /** Garments skipped by the size guard during the last `render()` call. */
    private array $oversizedGarments = [];

    /** Time spent downloading the provider's finished image in the last `render()`. */
    private float $downloadSeconds = 0.0;

    /**
     * How long to wait for an ASYNC job to finish before giving up.
     *
     * Both FASHN and PixelAPI are asynchronous: submit returns a job id, then a
     * status endpoint is polled.
     *
     * RAISED FROM 90s, THEN FROM 150s — BOTH MEASURED TOO SHORT.
     *
     * On this deployment a real PixelAPI try-on (submit -> queue -> render ->
     * download) runs ~90-100s when the provider is free, and a MEASURED ~155s
     * when its single-job queue has a render ahead — the provider SERIALISES
     * jobs, so a request that lands behind another genuinely takes longer, it is
     * not stuck. Both the 90s and 150s ceilings aborted renders that were still
     * legitimately running, which surfaced as `renderer_no_image` ("accepted the
     * request but returned no image") even though the render was about to land.
     *
     * RAISED TO 120s — THE PREVIOUS 60s WAS BELOW THE PROVIDER'S OWN FAST PATH.
     *
     * This is the one remaining measured defect (tracked as "the 60s poll"), and it
     * is a pure NUMBER MISMATCH rather than a logic error:
     *
     *   - a full render measures ~65s when PixelAPI's single-job queue is FREE,
     *     and ~90-100s when a job is ahead (a MEASURED ~155s in the worst case);
     *   - 60s therefore closed the window BEFORE the fastest possible render could
     *     land, guaranteeing a `renderer_busy` on the FIRST attempt even on an
     *     idle provider;
     *   - the client was told "busy, try again" while the render was in fact
     *     seconds away — the exact "first try always fails" symptom.
     *
     * RAISED TO 240s — 120s WAS STILL BELOW THE MEASURED WORST CASE.
     *
     * This is now a directly OBSERVED defect rather than an inference, so the
     * measurement is recorded here in full:
     *
     *   - a real end-to-end render was driven through this stack (a genuine JPEG
     *     portrait + a genuine JPEG garment, no stubs). It was picked up by the
     *     worker, entered `processing`, and was STILL RENDERING when the 120s
     *     window closed, 60s of which was spent before the provider even began
     *     the download;
     *   - the session came back `renderer_busy` at ~63s into a run that the
     *     provider had not finished, and the customer's canvas showed
     *     "FITTING INTERRUPTED — the try-on service is busy" for a render that
     *     was, in fact, seconds-to-a-couple-minutes from landing;
     *   - the figures above already conceded a ~155s worst case, so 120s was KNOWN
     *     to be under it. Any render that lands behind another job is therefore
     *     aborted by construction.
     *
     * 240s sits above the measured 155s worst case with ~85s of headroom, so even
     * a render queued behind another completes INSIDE a single attempt and is
     * painted — instead of being aborted, retried, and aborted again.
     *
     * RELATIONSHIP TO THE OTHER BUDGETS — all four must stay ordered:
     *
     *   poll window (240s) < client wait budget (~270s) < job timeout (300s)
     *                     < queue retry_after (330s)
     *
     * Every number below is derived from this one, so a change here requires the
     * matching change in `ProcessTryOnJob::$tries` / `$timeout` / `retryUntil()`
     * and in `useTryOnState`'s MAX_ATTEMPTS (see the note there).
     *
     *   - ABOVE the client's OLD 75s budget on purpose: the client's budget was
     *     raised in lockstep (useTryOnState: 55 x 3s = 165s) to cover poll +
     *     backoff + a second poll, so the widened server window is actually waited
     *     for rather than being dead work nobody observes.
     *   - BELOW the client budget so a render landing right on the deadline is still
     *     painted instead of racing a client timeout;
     *   - WELL UNDER the owning job's per-attempt ceiling (`$timeout = 300`), so the
     *     renderer always yields its real reason before the worker kills the job.
     */
    private const POLL_TIMEOUT_SECONDS = 240;
    private const POLL_INTERVAL_MS = 2500;

    /**
     * Categories this renderer knows how to map, in the order we prefer them
     * when a stack contains several. A dress is the most significant single
     * piece (it covers the whole torso), so it leads.
     */
    /*
     * MOST SIGNIFICANT LAYER FIRST. Two jobs share this order:
     *
     *   1. `resolveFamily` tests the family hints in this order, so a compound
     *      label resolves the same way the geometry planner resolves it
     *      ("baggy jeans" -> bottom rather than an accessory or a top).
     *   2. `preferGarment` ranks the stack by it, so the ONE piece the vendor is
     *      asked to render is the most significant one.
     *
     * `footwear` is present so a shoe RESOLVES (rather than falling to `(none)`),
     * but it ranks LAST: VTON APIs dress the upper or lower BODY and no vendor has
     * a footwear enum, so a shoe is the weakest thing to spend a render on.
     */
    private const PRIORITY = ['dress', 'outerwear', 'top', 'bottom', 'inner', 'footwear'];

    /**
     * GARMENT FAMILIES USED TO RESOLVE A FREE-TEXT CATEGORY.
     *
     * The Studio sends the product's OWN catalogue label ("TOPS", "Dresses",
     * "Pants"), not a normalised layer name. `mapCategory` and `preferGarment`
     * below must therefore resolve a label the same way the geometry planner does
     * (`TryOnPreProcessor::normaliseLayer`), instead of exact-matching a
     * normalised lowercase word.
     *
     * Kept in lockstep with `normaliseLayer` deliberately: when the two disagree a
     * piece is placed on one body region in the plan but declared as another to
     * the vendor.
     */
    private const FAMILIES = [
        'dress' => ['dress', 'gown'],
        'outerwear' => ['jacket', 'coat', 'blazer', 'outerwear', 'cardigan', 'hoodie', 'parka'],
        'top' => ['shirt', 'blouse', 'top', 'tee', 't-shirt', 'polo', 'tank', 'camisole', 'crop', 'inner', 'undershirt'],
        'bottom' => ['pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack'],
        'footwear' => ['shoe', 'footwear', 'sneaker', 'boot', 'sandal', 'loafer', 'heel', 'slipper'],
    ];

    /**
     * Resolve any incoming label to one of PRIORITY's layer names, or null.
     *
     * WHY SUBSTRING MATCHING, NOT EXACT MATCHING
     * ------------------------------------------
     * The exact `match` this replaces compared the WHOLE lowercased label against
     * a fixed word. That worked only while the client sent its own normalised
     * bucket name (`'top'`); the moment it sent the real catalogue label, every
     * value missed — `"TOPS"` is not `'top'`, `"Dresses"` is not `'dress'`,
     * `"Pants"` is not `'bottom'` — and every piece fell to the `default`, which
     * the vendor rejected outright.
     *
     * Family hints are tested in PRIORITY order so a compound label resolves the
     * same way the planner resolves it ("baggy jeans" -> bottom, not the
     * accessory bucket).
     */
    private function resolveFamily(?string $category): ?string
    {
        $needle = strtolower(trim((string) $category));
        if ($needle === '') {
            return null;
        }

        foreach (self::PRIORITY as $layer) {
            foreach (self::FAMILIES[$layer] ?? [] as $hint) {
                if (str_contains($needle, $hint)) {
                    return $layer;
                }
            }
        }

        return null;
    }

    /**
     * The garment family a catalogue label resolves to ('dress', 'outerwear',
     * 'top', 'bottom', 'footwear') or null when unknown. Public so the pair
     * planner (App\Support\TryOnGarmentPlan) classifies a stack with the SAME
     * table this renderer uses to pick the vendor category.
     */
    public function familyOf(?string $category): ?string
    {
        return $this->resolveFamily($category);
    }

    /**
     * Render a try-on image through the configured VTON API.
     *
     * @param  string  $userPhoto   Data URI or raw base64 of the customer portrait.
     * @param  array<int, string>  $garments  Data URIs, INDEX-ALIGNED with $categories.
     * @param  array<string, mixed>  $measurements  5-core body measurements (cm).
     * @param  string|null  $recommendedSize  Size label (unused upstream; kept for parity).
     * @param  array|null  $renderPlan  Plan from TryOnPreProcessor (unused upstream).
     * @param  array<int, string|null>  $categories  Style Stack category per garment.
     * @param  string  $slot  Which config slot (vendor) to render through:
     *                        `'vton'` = PixelAPI (the DEFAULT, so an unqualified
     *                        call behaves exactly as it did before this parameter
     *                        existed), `'fashn'` = FASHN. Read as
     *                        `config("services.{$slot}.*")`.
     * @return array{success: bool, image_base64?: string, feedback?: string, error?: string, code?: string, placed?: array<int, string>}
     */
    public function render(
        string $userPhoto,
        array $garments,
        array $measurements = [],
        ?string $recommendedSize = null,
        ?array $renderPlan = null,
        array $categories = [],
        string $slot = self::DEFAULT_SLOT
    ): array {
        $slot = $this->normaliseSlot($slot);
        $config = $this->config($slot);

        if ($config['endpoint'] === '' || $config['token'] === '') {
            /*
             * NOT AN ERROR — an unconfigured optional provider.
             *
             * `not_configured` is in the job's non-retryable code set, so the
             * chain moves straight on to the next provider without burning
             * retries on a request we know cannot succeed. It is ALSO how the
             * priority chain SKIPS a slot whose token is empty: an absent key is
             * a known configuration, not a failure, so the chain simply reaches
             * the next engine.
             */
            return [
                'success' => false,
                'error' => $this->notConfiguredMessage($slot),
                'code' => 'not_configured',
            ];
        }

        // Reset the per-call record so a reused instance cannot report a garment
        // skipped by an earlier render.
        $this->oversizedGarments = [];
        $this->downloadSeconds = 0.0;

        $personPart = $this->toDataUri($userPhoto);
        if ($personPart === null) {
            return [
                'success' => false,
                'error' => 'The customer portrait is not a usable image.',
                'code' => 'bad_portrait',
            ];
        }

        // Pick the single most significant garment, keeping its category aligned.
        [$garmentPart, $category] = $this->selectPrimaryGarment($garments, $categories);
        if ($garmentPart === null) {
            /*
             * DISTINGUISH "NOTHING SUPPLIED" FROM "EVERYTHING WAS TOO LARGE".
             *
             * Both end with no garment, but they need different fixes: the first
             * means the stack was empty or unreadable, the second means the inputs
             * were too heavy and the customer should be told to try fewer/smaller
             * pieces. Reporting `bad_garment` for both sent the operator looking
             * for a missing asset when the actual cause was payload size.
             */
            if (!empty($this->oversizedGarments)) {
                return [
                    'success' => false,
                    'error' => 'Every garment image was too large to upload.',
                    'code' => 'garment_too_large',
                ];
            }

            return [
                'success' => false,
                'error' => 'No usable garment image was provided.',
                'code' => 'bad_garment',
            ];
        }

        $payload = $this->buildPayload($config, $personPart, $garmentPart, $category, $slot);

        /*
         * PAYLOAD SIZE GUARD.
         *
         * MEASURED FAILURE THIS CATCHES: a portrait with a ~4.8 MB Base64 body
         * makes the provider reset the connection mid-upload —
         * `cURL error 56: Recv failure: Connection was reset`. That surfaces as an
         * opaque "could not reach the service" with no hint that the IMAGE was the
         * cause, and the same portrait kept failing on every retry.
         *
         * The frontend now downscales the photo before upload (see
         * utils/prepareUserPhoto.js), so this should never fire in normal use. It
         * is the server-side backstop for the paths that bypass the browser resize
         * — a saved `portrait_base64`, a legacy client, a direct API call — so an
         * oversized image is reported as an oversized image instead of a
         * misleading network error.
         */
        $personBytes = strlen($personPart);
        $maxPersonBytes = 3_500_000; // ~2.6 MB of pixels; well under the reset threshold.

        if ($personBytes > $maxPersonBytes) {
            Log::warning('VTON portrait too large to upload', ['bytes' => $personBytes]);

            return [
                'success' => false,
                'error' => 'Your body photo is too large to upload (' . round($personBytes / 1048576, 1) . ' MB). Please use a smaller photo — a portrait under about 2 MB renders correctly.',
                'code' => 'portrait_too_large',
            ];
        }

        // Stage timings (submit / provider wait / result download), returned with
        // a successful render so the job can log where the time went.
        $submitStarted = microtime(true);

        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->acceptJson()
                ->withToken($config['token'])
                ->post($config['endpoint'], $payload);
        } catch (\Throwable $e) {
            Log::warning('VTON API unreachable: ' . $e->getMessage());

            /*
             * A TRANSPORT FAILURE IS A PROVIDER OUTAGE. Recording it here (not
             * only in the scheduled probe) means a provider that goes down between
             * two probes is still captured, from the render that discovered it.
             */
            $failure = [
                'success' => false,
                'error' => 'Could not reach the VTON rendering service.',
                'code' => 'renderer_unreachable',
            ];

            \App\Support\ProviderHealth::recordRenderFailure($failure, $slot);

            return $failure;
        }

        if ($response->failed()) {
            $failure = $this->describeHttpFailure($config, $response->status(), $response->json(), $slot);

            /*
             * REMEMBER A PROVIDER FAULT, AND ONLY A PROVIDER FAULT.
             *
             * This is the half of the outage record that the SCHEDULED probe
             * cannot see: a real customer render hitting a degraded provider
             * BETWEEN two scheduled probes. Without it, the console could show a
             * clean provider while customers were failing, because the probe's
             * sample happened to land in a gap.
             *
             * Whether a code counts as a provider fault is decided in ONE place
             * (ProviderHealth::PROVIDER_FAULT_CODES), and the write is best-effort —
             * health bookkeeping must never be able to fail a render.
             *
             * The SLOT is passed through so the row names the vendor that actually
             * faulted (FASHN vs PixelAPI) instead of always blaming PixelAPI.
             */
            \App\Support\ProviderHealth::recordRenderFailure($failure, $slot);

            return $failure;
        }

        $body = $response->json() ?? [];
        $submitSeconds = microtime(true) - $submitStarted;
        $waitStarted = microtime(true);

        /*
         * THE RESPONSE MAY BE SYNCHRONOUS OR ASYNCHRONOUS.
         *
         * Some deployments answer with the finished image on the first call.
         * Most (FASHN, PixelAPI) answer with a job id and require polling. We
         * check for an image FIRST, then fall back to treating the response as
         * a job handle, so one code path serves both shapes.
         */
        $image = $this->extractImage($body, $slot);

        /*
         * COALESCED SUBMIT — THE PROVIDER MERGED OUR REQUEST INTO ANOTHER JOB.
         *
         * MEASURED on PixelAPI: when a try-on is already running, a second submit
         * is NOT rejected and does NOT start a new render. The vendor answers with
         * the SAME job id and `coalesced: true` (credits_used: 0) — i.e. "I folded
         * your request into the job that is already in flight".
         *
         * Two things that means, and why each matters:
         *
         *  1. Polling that id is correct in spirit — the merged job WILL produce an
         *     image — so we keep polling. But even the full window (POLL_TIMEOUT_SECONDS)
         *     may not be enough if the other job only just started, and a timeout
         *     on a coalesced job is NOT a broken request. That is why this case
         *     reports `renderer_busy` (retryable) rather than a hard failure.
         *
         *  2. The bare `renderer_no_image` message ("accepted the request but
         *     returned no image") is misleading for this case — the request was
         *     ACCEPTED and MERGED, not lost. We report a distinct, actionable
         *     message so the customer (and whoever debugs this) knows to simply
         *     retry, and knows the provider was busy rather than broken.
         */
        $coalesced = (bool) data_get($body, 'coalesced', false);

        /*
         * POLL, AND REMEMBER WHY WE STOPPED.
         *
         * `timedOut` distinguishes "the provider is still working" from "the
         * provider finished and produced nothing". They need DIFFERENT codes:
         * `renderer_busy` is RETRYABLE, `renderer_no_image` is NOT. Collapsing
         * both into `renderer_no_image` (the old behaviour) turned a render that
         * was simply slow — MEASURED at 5m when PixelAPI had a job ahead — into a
         * permanent "Fitting Interrupted" the job never retried.
         */
        $timedOut = false;

        if ($image === null) {
            $jobId = $this->extractJobId($body, $slot);

            if ($jobId !== null) {
                [$image, $timedOut] = $this->pollForImage($config, $jobId, $slot);
            }
        }

        if ($image === null) {
            Log::warning('VTON API returned no image', ['body' => $this->redact($body), 'coalesced' => $coalesced, 'timed_out' => $timedOut]);

            /*
             * STILL RUNNING — a retryable condition, never a dead session.
             *
             * A coalesced request (folded into an in-flight job) and a poll that
             * ran out of window are the same class of event: the provider is
             * busy and the render has not landed YET. Both report `renderer_busy`
             * so the job's own retry/backoff picks it up, instead of being marked
             * non-retryable as `renderer_no_image`.
             */
            if ($coalesced || $timedOut) {
                $failure = [
                    'success' => false,
                    /*
                     * Same honesty rule as the 503 branch below: the previous
                     * "try again in a moment" understated a one-to-two-minute render
                     * and invited a retry that collides with the in-flight job.
                     */
                    'error' => $this->isFashn($slot)
                        ? 'The try-on service is still rendering — a full render takes a minute or two. Please wait a moment before retrying.'
                        : 'The try-on service (PixelAPI) is still rendering another fitting — it processes one at a time, and a full render takes a minute or two. Please wait a moment before retrying.',
                    'code' => 'renderer_busy',
                ];

                // The provider is serialised, not broken — recorded as `degraded`.
                \App\Support\ProviderHealth::recordRenderFailure($failure, $slot);

                return $failure;
            }

            $failure = [
                'success' => false,
                'error' => 'The try-on service accepted the request but returned no image.',
                'code' => 'renderer_no_image',
            ];

            // A provider hiccup: accepted the work and produced nothing.
            \App\Support\ProviderHealth::recordRenderFailure($failure, $slot);

            return $failure;
        }

        return [
            'success' => true,
            'image_base64' => $image,
            'feedback' => $this->feedback($category, count($garments)),
            'placed' => [$category],
            'timings' => [
                'submit_ms' => (int) round($submitSeconds * 1000),
                // Provider queue + render + status polling, excluding the download.
                'provider_wait_ms' => (int) round(max(0, microtime(true) - $waitStarted - $this->downloadSeconds) * 1000),
                'download_ms' => (int) round($this->downloadSeconds * 1000),
            ],
        ];
    }

    /**
     * Coerce a slot name to a non-empty string, defaulting to PixelAPI's slot.
     *
     * A blank name (`render(..., slot: '')`) is treated as "no slot given"
     * rather than as a distinct vendor, because an empty string cannot address a
     * config block — `config('services..token')` resolves to null and every read
     * would fall to this class's own fallbacks. Falling back to the default slot
     * keeps that degenerate case on the well-tested PixelAPI path.
     */
    private function normaliseSlot(string $slot): string
    {
        $slot = trim($slot);

        return $slot === '' ? self::DEFAULT_SLOT : $slot;
    }

    /** Is this slot FASHN's? Used only for vendor-specific wording and vocabulary. */
    private function isFashn(string $slot): bool
    {
        return $slot === self::FASHN_SLOT;
    }

    /**
     * The `not_configured` message for a slot.
     *
     * Names the slot's OWN env variables, so an operator reading a log or a
     * failed session is told which keys would enable the tier that was skipped
     * instead of being pointed at PixelAPI's variables for a FASHN slot.
     */
    private function notConfiguredMessage(string $slot): string
    {
        $keys = $this->isFashn($slot)
            ? 'VTON_FASHN_API_URL and VTON_FASHN_API_TOKEN'
            : 'VTON_API_URL and VTON_API_TOKEN';

        return "No VTON API endpoint/token is configured for the '{$slot}' slot. Set {$keys} to enable this tier.";
    }

    /**
     * Resolve the endpoint/field configuration for a slot, with defaults matching
     * the documented vendor contract of THAT slot.
     *
     * @param  string  $slot  `'vton'` (PixelAPI, the default) or `'fashn'`.
     * @return array<string, mixed>
     */
    private function config(string $slot = self::DEFAULT_SLOT): array
    {
        $slot = $this->normaliseSlot($slot);

        return [
            'endpoint' => trim((string) config("services.{$slot}.endpoint", '')),
            'token' => trim((string) config("services.{$slot}.token", '')),
            'model_name' => trim((string) config("services.{$slot}.model_name", 'tryon-v1.6')),
            'person_field' => trim((string) config("services.{$slot}.person_field", 'model_image')),
            'garment_field' => trim((string) config("services.{$slot}.garment_field", 'garment_image')),
            'category_field' => trim((string) config("services.{$slot}.category_field", 'category')),
            'job_id_path' => trim((string) config("services.{$slot}.job_id_path", 'id')),
            // Kept for parity; polling reads `status_endpoint` directly (below).
            'status_path' => trim((string) config("services.{$slot}.status_endpoint", '')),
            'image_path' => trim((string) config("services.{$slot}.image_path", '')),
            /*
             * QUALITY KNOBS (documented by the vendors, previously unused).
             *
             * Both are optional on the wire; `null` means "do not send the field"
             * so a vendor that does not define it is never sent an unknown
             * parameter. PixelAPI documents:
             *   n_steps   — diffusion steps, default 20, higher = better quality
             *   n_samples — images to generate (default 1, max 4)
             * FASHN exposes its own equivalents, sent inside the `inputs`
             * envelope; the SLOT decides which key is read.
             */
            'n_steps' => $this->optionalInt(config("services.{$slot}.n_steps")),
            'n_samples' => $this->optionalInt(config("services.{$slot}.n_samples")),
        ];
    }

    /**
     * Read an optional positive integer from config, or null when unset/zero.
     *
     * Returning null (rather than 0) is deliberate: the field is omitted from
     * the payload entirely, so an unconfigured deployment sends exactly what it
     * sent before and no vendor receives a parameter it never defined.
     */
    private function optionalInt(mixed $value): ?int
    {
        if ($value === null || $value === '' || $value === false) {
            return null;
        }

        $int = (int) $value;

        return $int > 0 ? $int : null;
    }

    /**
     * Assemble the request body for the configured vendor shape.
     *
     * The SHAPE is decided by the slot's own `model_name`, not by the slot name:
     * a non-empty `model_name` means a wrapper-style vendor (FASHN) whose
     * arguments go inside `inputs`; an empty one means a flat vendor (PixelAPI).
     * That keeps the shape a CONFIG property, so pointing either slot at a vendor
     * with the other shape is still a .env change.
     *
     * @param  array<string, mixed>  $config
     * @param  string  $slot  passed through to `mapCategory()` for the vocabulary.
     * @return array<string, mixed>
     */
    private function buildPayload(array $config, string $person, string $garment, string $category, string $slot = self::DEFAULT_SLOT): array
    {
        $inputs = [
            $config['person_field'] => $person,
            $config['garment_field'] => $garment,
            $config['category_field'] => $this->mapCategory($category, $slot),
        ];

        /*
         * Add the quality knobs ONLY when configured. `n_steps` raises detail on
         * a garment with pattern or texture; `n_samples` asks the vendor for
         * more than one candidate. Omitting them keeps the default vendor
         * behaviour, so this is purely additive.
         */
        if ($config['n_steps'] !== null) {
            $inputs['n_steps'] = $config['n_steps'];
        }

        if ($config['n_samples'] !== null) {
            $inputs['n_samples'] = $config['n_samples'];
        }

        /*
         * FASHN wraps its arguments in `{ model_name, inputs }`; PixelAPI posts
         * the arguments flat. `model_name` being non-empty is the signal that the
         * operator is talking to a wrapper-style API, so we honour that shape
         * without needing a separate vendor switch.
         */
        if ($config['model_name'] !== '') {
            return [
                'model_name' => $config['model_name'],
                'inputs' => $inputs,
            ];
        }

        return $inputs;
    }

    /**
     * Map an incoming garment category onto the vocabulary the configured VTON
     * API accepts.
     *
     * The value sent here must be one of the SLOT'S OWN vendor enum values.
     * PixelAPI (the `'vton'` slot, and the default) accepts ONLY `upperbody` |
     * `lowerbody` | `dress` — it has no `auto`, so an unresolved label is rejected
     * with a 422 and the customer sees a dead canvas. FASHN (the `'fashn'` slot)
     * accepts `tops|bottoms|one-pieces`. The slot is read HERE rather than inferred
     * from the resolved config, so the two vocabularies can never be swapped by an
     * .env edit: whichever slot renders, only its own words are ever emitted.
     *
     * A FOOTWEAR piece has no vendor equivalent: VTON APIs dress the upper or
     * lower BODY, and shoes are neither. Sending a shoe as `upperbody` is how the
     * renderer invents a sleeved top. It maps to `lowerbody` — the closest true
     * region (feet sit at the bottom of the figure and its guidance reads "the
     * legs to the hem") — and, when the piece IS the lower region, the model
     * places it there instead of on the torso.
     *
     * NOTE: with PixelAPI the caller never actually renders footwear (see
     * `preferGarment`), so this branch exists for the FASHN configuration.
     *
     * THE SECOND ARGUMENT OF `config()` MATTERS AS MUCH AS THE FIRST — AND SO
     * DOES THE SLOT.
     * -----------------------------------------------------------------------
     * These fallbacks were `'one-pieces'` / `'tops'` / `'bottoms'` — FASHN's
     * vocabulary — while the active vendor is PixelAPI, whose accepted set is
     * `upperbody | lowerbody | dress | saree | lehenga | kurti | sherwani`.
     *
     * They are only reached when `config/services.php` itself has no value for
     * the key, so they were a second, independent copy of the same wrong
     * vocabulary: fixing the defaults in `config/services.php` alone would have
     * left this method still able to emit `tops` at PixelAPI. Both copies are
     * now PixelAPI's, so there is no path left that sends FASHN a word PixelAPI
     * rejects with a 422.
     *
     * WITH TWO SLOTS THERE ARE NOW TWO CORRECT ANSWERS, so the fallback depends
     * on which vendor is being addressed:
     *
     *   slot `'vton'` (PixelAPI, the default) -> `upperbody` / `lowerbody` / `dress`
     *   slot `'fashn'`                        -> `tops` / `bottoms` / `one-pieces`
     *
     * Each slot's second argument matches its OWN config block's default, so the
     * two copies of a slot's vocabulary always agree. A FASHN slot must never fall
     * back to PixelAPI's words (and vice versa) — that is the 422 this whole
     * section exists to prevent.
     */
    private function mapCategory(?string $category, string $slot = self::DEFAULT_SLOT): string
    {
        $slot = $this->normaliseSlot($slot);

        if ($this->isFashn($slot)) {
            return match ($this->resolveFamily($category)) {
                'dress' => (string) config("services.{$slot}.category_dress", 'one-pieces'),
                'top' => (string) config("services.{$slot}.category_top", 'tops'),
                'bottom', 'footwear' => (string) config("services.{$slot}.category_bottom", 'bottoms'),
                // OUTERWEAR IS DRESSED ON THE UPPER BODY (FASHN: `tops`).
                'outerwear' => (string) config("services.{$slot}.category_top", 'tops'),
                // Unresolved label — FASHN's safest guess is `tops`, for the same
                // reasons PixelAPI's is `upperbody` (see the default branch below).
                default => (string) config("services.{$slot}.category_top", 'tops'),
            };
        }

        return match ($this->resolveFamily($category)) {
            'dress' => (string) config('services.vton.category_dress', 'dress'),
            'top' => (string) config('services.vton.category_top', 'upperbody'),
            'bottom', 'footwear' => (string) config('services.vton.category_bottom', 'lowerbody'),
            /*
             * OUTERWEAR IS DRESSED ON THE UPPER BODY. A jacket/coat/blazer is a
             * torso layer, so `upperbody` is the correct region — no vendor has
             * an `outerwear` enum.
             */
            'outerwear' => (string) config('services.vton.category_top', 'upperbody'),
            /*
             * UNRESOLVED LABEL — `upperbody` IS THE SAFEST GUESS, AND THE
             * PLANNER IS WHAT KEEPS IT HONEST.
             *
             * `default` is reached only when `resolveFamily()` matched none of
             * the garment families, i.e. the label is empty or truly unknown
             * ("BAG", "Misc"). PixelAPI has NO `auto` value, so one of its
             * enums must be sent — an omitted/invalid category is a hard 422 and
             * a dead canvas.
             *
             * `upperbody` is chosen because the catalog's default product IS
             * clothing and the vast majority of real pieces are torso layers.
             * The dangerous case — an accessory being dressed as a sleeved top,
             * the reported "may sleeve sa output kahit wala sa selected
             * garments" — is prevented UPSTREAM and not by this guess:
             *
             *   - `TryOnController::isNonWearableCategory()` drops a bag/belt/
             *     sunglasses before the session is even created, and
             *   - `TryOnPreProcessor::buildLayerPlan()` refuses to assign a body
             *     region to a non-wearable.
             *
             * So this default can no longer invent a garment that was not
             * selected; it only decides which of PixelAPI's enums a genuinely
             * unlabelled piece is sent as.
             */
            default => (string) config('services.vton.category_top', 'upperbody'),
        };
    }

    /**
     * Choose the ONE garment to render, preferring the most significant layer.
     *
     * Returns the image and its category together so they can never drift apart.
     * The image is sent as a data URI: these APIs accept a `data:image/...`
     * Base64 string directly, and it avoids handing an external service a
     * Supabase URL it may not be able to fetch (see the CORS note in
     * compositeTryOn.js for why that is a real failure mode on this catalog).
     *
          * @param  array<int, string>  $garments
          * @param  array<int, string|null>  $categories
          * @return array{0: string|null, 1: string}
          */
     private function selectPrimaryGarment(array $garments, array $categories): array
     {
         $best = null;
         $bestRank = PHP_INT_MAX;

         foreach ($garments as $index => $garment) {
             if (!is_string($garment) || trim($garment) === '') {
                 continue;
             }

             /*
              * GARMENT PAYLOAD SIZE GUARD — the counterpart of the portrait guard.
              *
              * The portrait has had a 3.5 MB ceiling for a while (see the
              * $maxPersonBytes check in render()). The GARMENT had none, and both
              * travel in the SAME request body, so an oversized cut-out could
              * trigger the identical provider-side reset the portrait guard was
              * written to prevent:
              *
              *     cURL error 56: Recv failure: Connection was reset
              *
              * reported as an opaque `renderer_unreachable` with the IMAGE as the
              * real cause and no hint of it. The guard existed on one half of the
              * payload and not the other.
              *
              * WHY THIS IS REACHABLE IN PRACTICE: `prepareVtonGarment` encodes the
              * segmented cut-out as PNG (it needs the alpha channel), and PNG is the
              * worst format for a photograph — measured cut-outs run several MB.
              * The frontend resize (`prepareUserPhoto`) only covers the PORTRAIT, so
              * nothing downscales the garment before it gets here.
              *
              * A garment is NOT dropped for being too large — it is skipped, so a
              * stack of five still renders from the four that fit. Only when NO
              * garment fits is the render refused, and then with a code that names
              * the real cause.
              */
             $garmentBytes = strlen($this->toDataUri($garment) ?? '');
             if ($garmentBytes > self::MAX_GARMENT_BYTES) {
                 Log::warning('VTON garment too large to upload; skipping it', [
                     'index' => $index,
                     'bytes' => $garmentBytes,
                     'limit' => self::MAX_GARMENT_BYTES,
                 ]);

                 $this->oversizedGarments[] = [
                     'index' => $index,
                     'bytes' => $garmentBytes,
                 ];

                 continue;
             }

             $category = strtolower((string) ($categories[$index] ?? ''));

            /*
             * Resolve the label through the SAME family table `mapCategory` uses,
             * so ranking and the value sent to the vendor can never disagree about
             * what a piece is.
             */
            $layer = $this->resolveFamily($category) ?? '';
            $rank = array_search($layer, self::PRIORITY, true);

            // Unknown category: usable, but ranked last so a known layer wins.
            $rank = $rank === false ? count(self::PRIORITY) : $rank;

            if ($rank < $bestRank) {
                $bestRank = $rank;
                $best = ['image' => $garment, 'category' => $category];
            }
        }

        if ($best === null) {
            return [null, ''];
        }

        return [$this->toDataUri($best['image']), $best['category']];
    }

    /**
     * Garments skipped by the size guard during the last render().
     * Read by callers that want to tell the customer a piece was omitted.
     *
     * @return array<int, array{index:int, bytes:int}>
     */
    public function oversizedGarments(): array
    {
        return $this->oversizedGarments;
    }

    /**
     * Normalise any image reference into a data URI these APIs accept.
     *
     * Already-encoded data URIs pass through. Raw base64 is given a PNG prefix.
     * A remote URL is fetched and inlined for the reason given in
     * `selectPrimaryGarment`.
     */
    private function toDataUri(string $image): ?string
    {
        /*
         * `LocalAsset` resolves a `/storage/...` reference OFF THE LOCAL DISK
         * before ever touching the network. That matters here: this renderer
         * runs inside the queue worker, and on the single-threaded
         * `php artisan serve` an `Http::get()` of our OWN `127.0.0.1` url blocks
         * against the process that is already running this job — the measured
         * `cURL error 28` that rejected every bag-hydrated garment.
         */
        return LocalAsset::toDataUri($image);
    }

    /**
     * Walk a response for the first plausible image, using the configured path
     * first and then a small set of documented shapes.
     *
     * @param  array<string, mixed>  $body
     * @param  string  $slot  which vendor's config supplies the pinned path.
     */
    private function extractImage(array $body, string $slot = self::DEFAULT_SLOT): ?string
    {
        $slot = $this->normaliseSlot($slot);
        $path = (string) config("services.{$slot}.image_path", '');

        $candidates = [];
        if ($path !== '') {
            $candidates[] = data_get($body, $path);
        }

        /*
         * Documented / commonly-returned shapes.
         *
         * MEASURED on a real PixelAPI job: a completed response is
         *   { job_id, status: "completed", output_url: "https://.../x.png",
         *     result_image_b64: null, credits_used: 40, ... }
         * so the render lives at `output_url` — a URL. The vendor tutorial's
         * mention of an `output` field did NOT match the live API (`output` and
         * `result_image_b64` were both null), which is why `output_url` is listed
         * first and the others are kept only as fallbacks for other revisions or
         * for FASHN (whose `output` is an array of URLs).
         * `asImageString()` follows a URL or decodes a base64 blob, so listing all
         * of them covers both vendors without a vendor switch.
         */
        $candidates = array_merge($candidates, [
            // PixelAPI: a real completed job puts the render at `output_url`
            // (MEASURED — `output` and `result_image_b64` were null).
            data_get($body, 'output_url'),
            data_get($body, 'data.output_url'),
            data_get($body, 'output.0'),
            data_get($body, 'output'),
            data_get($body, 'result_image_b64'),
            data_get($body, 'result_url'),
            data_get($body, 'images.0'),
            data_get($body, 'image'),
            data_get($body, 'result'),
            data_get($body, 'data.0.url'),
            data_get($body, 'data.url'),
            data_get($body, 'data.result_url'),
            data_get($body, 'data.result_image_b64'),
        ]);

        foreach ($candidates as $candidate) {
            $resolved = $this->asImageString($candidate);
            if ($resolved !== null) {
                return $resolved;
            }
        }

        return null;
    }

    /**
     * Coerce a response value into a data URI, following a returned URL and
     * re-encoding it so the client receives a single self-contained payload.
     */
    private function asImageString(mixed $value): ?string
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        $value = trim($value);

        if (str_starts_with($value, 'data:image')) {
            return $value;
        }

        // A base64 blob with no prefix and no scheme.
        if (!str_contains($value, '://')) {
            if (preg_match('#^[A-Za-z0-9+/=\s]+$#', $value) && strlen($value) > 256) {
                return 'data:image/png;base64,' . preg_replace('/\s+/', '', $value);
            }

            return null;
        }

        $downloadStarted = microtime(true);

        try {
            $res = Http::timeout(self::TIMEOUT_SECONDS)->get($value);
            $this->downloadSeconds += microtime(true) - $downloadStarted;
            if ($res->successful() && strlen($res->body()) > 0) {
                $mime = $res->header('Content-Type') ?: 'image/png';
                $mime = str_contains($mime, 'jpeg') || str_contains($mime, 'jpg') ? 'image/jpeg' : 'image/png';

                return 'data:' . $mime . ';base64,' . base64_encode($res->body());
            }
        } catch (\Throwable $e) {
            Log::warning('VTON result download failed: ' . $e->getMessage());
        }

        return null;
    }

    /**
     * Read a job id out of an async submit response, if there is one.
     *
     * @param  array<string, mixed>  $body
     * @param  string  $slot  which vendor's config supplies the pinned path.
     */
    private function extractJobId(array $body, string $slot = self::DEFAULT_SLOT): ?string
    {
        $slot = $this->normaliseSlot($slot);
        $path = (string) config("services.{$slot}.job_id_path", 'id');

        foreach ([$path, 'id', 'job_id', 'prediction_id', 'data.id'] as $candidate) {
            if ($candidate === '') {
                continue;
            }

            $value = data_get($body, $candidate);
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
            if (is_int($value)) {
                return (string) $value;
            }
        }

        return null;
    }

    /**
     * Poll the status endpoint until the job yields an image or the window
     * closes — and report WHY it stopped, so the caller can tell a still-running
     * job from a genuinely failed one.
     *
     * Returns `[image, timedOut]`, never throwing:
     *   - `[<dataUri>, false]` — the render landed.
     *   - `[null, true]`       — the window closed with the job STILL RUNNING (a
     *                            transient, retryable condition).
     *   - `[null, false]`      — the provider reported a genuine terminal failure
     *                            (failed/error/cancelled) or is misconfigured.
     *
     * THE TWO null SHAPES ARE NOT THE SAME. The caller maps `timedOut` to the
     * retryable `renderer_busy` code and a real failure to the non-retryable
     * `renderer_no_image`; conflating them is what made a slow render permanent.
     *
     * @param  array<string, mixed>  $config
     * @param  string  $slot  which vendor's config supplies the status endpoint;
     *                        the polled response is also walked with that slot's
     *                        image path.
     * @return array{0: string|null, 1: bool}
     */
    private function pollForImage(array $config, string $jobId, string $slot = self::DEFAULT_SLOT): array
    {
        $slot = $this->normaliseSlot($slot);
        $template = (string) config("services.{$slot}.status_endpoint", '');
        if ($template === '') {
            // No polling endpoint configured: a real failure, not a running job.
            return [null, false];
        }

        $url = str_replace('{id}', rawurlencode($jobId), $template);
        $deadline = microtime(true) + self::POLL_TIMEOUT_SECONDS;

        while (microtime(true) < $deadline) {
            usleep(self::POLL_INTERVAL_MS * 1000);

            try {
                $res = Http::timeout(30)->acceptJson()->withToken($config['token'])->get($url);
            } catch (\Throwable $e) {
                /*
                 * A single failed poll is NOT the end of the job — the render may
                 * still be running. Keep polling until the window closes, so a
                 * blip does not cut a healthy render short.
                 */
                Log::warning('VTON poll failed: ' . $e->getMessage());

                continue;
            }

            if ($res->failed()) {
                /*
                 * 404/5xx on a status read is transient for the same reason: the
                 * job row may not be visible yet. Keep polling.
                 */
                Log::warning('VTON poll returned ' . $res->status());

                continue;
            }

            $body = $res->json() ?? [];

            $image = $this->extractImage($body, $slot);
            if ($image !== null) {
                return [$image, false];
            }

            $status = strtolower((string) data_get($body, 'status', data_get($body, 'data.status', '')));
            if (in_array($status, ['failed', 'error', 'canceled', 'cancelled'], true)) {
                Log::warning('VTON job ' . $jobId . ' reported status: ' . $status);

                return [null, false];
            }
        }

        Log::warning('VTON job ' . $jobId . ' still running after ' . self::POLL_TIMEOUT_SECONDS . 's — reporting retryable busy');

        return [null, true];
    }

    /**
     * Is this upstream reason PixelAPI's clothing-safety outage?
     *
     * PixelAPI reports it as a 503 whose `error.message` carries the sentinel
     * `vton_safety_unavailable` followed by prose. The sentinel is what is matched,
     * not the prose, because the wording may change while the code does not.
     *
     * MEASURED verbatim during testing:
     *
     *     vton_safety_unavailable; Clothing safety checks are temporarily
     *     unavailable. No credits were charged. Please retry.
     *
     * The "No credits were charged" clause is worth noting: this failure costs
     * nothing, which is exactly why the honest response is to wait and retry rather
     * than to treat the render as spent.
     */
    private function isSafetyUnavailable(string $upstream): bool
    {
        return str_contains(strtolower($upstream), 'safety_unavailable');
    }

    /**
     * Translate an HTTP failure into the job's non-retryable code vocabulary.
     *
     * @param  array<string, mixed>  $config
     * @param  array<string, mixed>|null  $body
     * @param  string  $slot  used ONLY to name the right vendor in the copy the
     *                        customer reads; the code taxonomy is shared.
     * @return array{success: bool, error: string, code: string}
     */
    private function describeHttpFailure(array $config, int $status, ?array $body, string $slot = self::DEFAULT_SLOT): array
    {
        $slot = $this->normaliseSlot($slot);
        $upstream = $this->upstreamReason($body);

        Log::warning('VTON API render failed', ['status' => $status, 'error' => $upstream]);

        $code = match (true) {
            $status === 401 || $status === 403 => 'renderer_unauthorized',
            $status === 402 => 'renderer_payment_required',
            $status === 429 => 'renderer_no_image',
            /*
             * 422 — A REJECTED REQUEST, AND ITS OWN CODE (was `renderer_no_image`).
             *
             * MEASURED on this deployment: the SAME payload that PixelAPI 422'd
             * three times in a row (sessions #51/#52/#53, 20:49-21:10) was
             * re-submitted unchanged and ACCEPTED minutes later — it queued,
             * rendered in 42s and completed with a real image. So this 422 is
             * TRANSIENT vendor-side validation, not a permanent property of the
             * images.
             *
             * It used to share `renderer_no_image`, which ProcessTryOnJob marks
             * NON-RETRYABLE — so a transient rejection killed the session on the
             * first attempt and the customer had to click Retry by hand. Its own
             * code takes it off that list and lets the job's own retry/backoff
             * recover automatically, exactly like `renderer_busy`.
             */
            $status === 422 => 'renderer_rejected',
            /*
             * 503 — NOT ALWAYS "BUSY". READ THE PROVIDER'S REASON FIRST.
             *
             * MEASURED DEFECT THIS FIXES (the reported "Fitting Interrupted"):
             * the ONLY response PixelAPI actually produced during this session's
             * testing was
             *
             *     503 "vton_safety_unavailable; Clothing safety checks are
             *          temporarily unavailable. No credits were charged.
             *          Please retry."
             *
             * ...which is a PROVIDER-SIDE OUTAGE of its clothing-safety service —
             * nothing to do with the request, the photos, or concurrency. But every
             * 503 was collapsed into the single code `renderer_busy` and then given a
             * hardcoded "it renders one fitting at a time... please try again in a
             * few seconds" message, so the customer was told to retry for a
             * concurrency problem WHILE the real reason sat unread in the body.
             *
             * That is worse than unhelpful: `renderer_busy` invites an immediate
             * retry, and the safety checker stays down for minutes, so the retry
             * burns the attempt budget and the customer is left with a spinner that
             * dies on a fault they cannot influence.
             *
             * The safety outage therefore gets its OWN code. It stays RETRYABLE
             * (the vendor says "Please retry", and it does clear), but it is no
             * longer described as a busy queue — the distinction matters because the
             * honest advice is "the provider is temporarily broken, wait" rather than
             * "you collided with another render".
             */
            $status === 503 && $this->isSafetyUnavailable($upstream) => 'renderer_safety_unavailable',
            $status === 503 => 'renderer_busy',
            /*
             * Cloudflare gateway codes (520-527) mean the VENDOR's origin is
             * down or unreachable — 522 in particular is "origin connection
             * timed out". This is a PixelAPI-side outage, not a bad request from
             * us, so it gets its own code and a message that says so instead of
             * the generic "Unknown error" the 5xx fallthrough produced.
             */
            $status >= 520 && $status <= 527 => 'renderer_gateway_error',
            /*
             * Any other 5xx is still a PROVIDER fault, not a client fault, so it
             * gets the same treatment (the "Unknown error" text is the vendor's
             * own empty body, not something we can act on).
             */
            $status >= 500 => 'renderer_gateway_error',
            default => 'renderer_http_' . $status,
        };

        $message = match (true) {
            $status === 401 || $status === 403 => 'The VTON API token is invalid or lacks permission.',
            $status === 402 => 'The VTON API returned payment-required (402). The account has no remaining credits.',
            $status === 429 => 'The VTON API quota was reached (429). This is a quota limit, not a billing error — retry shortly or lower the request rate.',
            /*
             * 422 — THE VENDOR'S OWN VALIDATION MESSAGE IS THE ANSWER.
             *
             * MEASURED against the live PixelAPI: a 422 is returned for a
             * REJECTED FIELD, and the offending field is named in the body. It is
             * NOT always the images — a wrong `category` value produces the same
             * 422 (measured: `category must be upperbody, lowerbody, dress, ...`).
             * Saying "rejected the input images" for a category rejection sent
             * whoever debugged this looking at the photos for a bug that was in the
             * payload. The upstream text is now carried through verbatim so the
             * message states the REAL reason.
             */
            $status === 422 => 'The try-on service rejected the request. ' . $upstream,
            /*
             * A SAFETY-SERVICE OUTAGE IS NOT A BUSY QUEUE.
             *
             * The provider's own text is carried through (it is precise and
             * customer-safe: "Clothing safety checks are temporarily unavailable.
             * No credits were charged."), with only a sentence added to set an honest
             * expectation. Telling the customer "busy, try again in a few seconds"
             * here would be false twice over — it names the wrong cause and the
             * wrong duration.
             */
            $status === 503 && $this->isSafetyUnavailable($upstream)
                => 'The try-on service\'s clothing-safety check is temporarily unavailable (this is on the provider side and no credits were charged). A full render takes a minute or two once it recovers, so please wait a moment before retrying.',
            /*
             * HONEST COPY — THE OLD "in a few seconds" WAS DEMONSTRABLY FALSE.
             *
             * This exact string is what the customer saw on the canvas (the
             * reported "Fitting Interrupted"): "...renders one fitting at a time and
             * another request is already running. Please try again in a few
             * seconds." A real render was MEASURED still working when the window
             * closed, having spent ~60s before the provider even began — so "a few
             * seconds" described neither the cause nor the remedy.
             *
             * It is also DANGEROUS advice: because the provider is serialised,
             * retrying "in a few seconds" lands the new request while the previous
             * render still occupies the single slot, so it is refused or coalesced
             * and the retry budget is spent on a condition the hasty retry caused.
             * The copy now states the real timing so the customer waits.
             */
            $status === 503 => $this->isFashn($slot)
                ? 'The try-on service is still rendering — a full render takes a minute or two. Please wait a moment before retrying so this fitting is not refused again.'
                : 'The try-on service (PixelAPI) is still rendering another fitting — it processes one at a time, and a full render takes a minute or two. Please wait a moment before retrying so this fitting is not refused again.',
            $status >= 520 && $status <= 527 => $this->isFashn($slot)
                ? 'The try-on service is temporarily unavailable — its servers are not responding (HTTP ' . $status . '). This is on the provider side; please retry in a few minutes.'
                : 'The try-on service (PixelAPI) is temporarily unavailable — its servers are not responding (HTTP ' . $status . '). This is on the provider side; please retry in a few minutes.',
            $status >= 500 => $this->isFashn($slot)
                ? 'The try-on service returned a server error (HTTP ' . $status . '). This is on the provider side; please retry in a few minutes.'
                : 'The try-on service (PixelAPI) returned a server error (HTTP ' . $status . '). This is on the provider side; please retry in a few minutes.',
            default => 'The try-on service could not produce a fitting. ' . $upstream,
        };

        return ['success' => false, 'error' => $message, 'code' => $code];
    }

    /**
     * Extract the provider's OWN reason from a failed response body.
     *
     * WHY THIS EXISTS — THE "Unknown error" BUG
     * ------------------------------------------
     * The renderer used to read only `error.message` and `message`. MEASURED
     * against the live PixelAPI, NEITHER key exists: its errors are FastAPI /
     * Pydantic shaped, e.g.
     *
     *   422  {
     *          "detail": [{
     *            "loc": ["body", "category"],
     *            "msg": "Value error, category must be upperbody, lowerbody, dress, ...",
     *            "input": "tops"
     *          }],
     *          "friendly_message": "Please check the photos and try again."
     *        }
     *
     *   400  { "detail": "garment_image is not a valid JPEG/PNG/WebP image" }
     *
     * So every rejection fell through to the literal placeholder `Unknown error`
     * and the customer saw "The VTON API rejected the input images. Unknown error"
     * for causes that were neither about the images nor unknown. The real reason
     * was in the body the whole time, discarded.
     *
     * All four shapes are now read, most specific first:
     *   1. `detail` STRING        (PixelAPI's image-decode 400)
     *   2. `detail[]` ARRAY       (FastAPI validation, naming field + message)
     *   3. `error.message`        (OpenAI-ish / Replicate-ish vendors)
     *   4. `message`              (generic)
     * and `friendly_message` is appended only when it adds information.
     *
     * @param  array<string, mixed>|null  $body
     */
    private function upstreamReason(?array $body): string
    {
        $body = $body ?? [];

        $reason = '';

        // 1. `detail` as a plain string.
        $detail = data_get($body, 'detail');
        if (is_string($detail) && trim($detail) !== '') {
            $reason = trim($detail);
        }

        // 2. `detail` as the FastAPI validation array.
        if ($reason === '' && is_array($detail) && $detail !== []) {
            $parts = [];
            foreach ($detail as $entry) {
                if (!is_array($entry)) {
                    if (is_string($entry) && trim($entry) !== '') {
                        $parts[] = trim($entry);
                    }
                    continue;
                }

                /*
                 * Include WHICH field failed (`body.category`) — that is the single
                 * most useful token for diagnosing a rejected payload, and it is
                 * what distinguishes a bad `category` from a bad image.
                 */
                $field = data_get($entry, 'loc');
                $field = is_array($field) ? implode('.', array_map('strval', $field)) : (string) $field;
                $field = trim($field, ".");

                $msg = trim((string) data_get($entry, 'msg', ''));
                if ($msg === '') {
                    $msg = trim((string) data_get($entry, 'message', ''));
                }

                if ($msg === '') {
                    continue;
                }

                $parts[] = $field !== '' ? ($field . ': ' . $msg) : $msg;
            }

            $reason = implode('; ', $parts);
        }

        // 3 + 4. The classic nested/plain message keys.
        if ($reason === '') {
            $reason = trim((string) data_get($body, 'error.message', data_get($body, 'message', '')));
        }

        /*
         * A vendor `friendly_message` is ADDED, not substituted: PixelAPI's is a
         * generic "Please check the photos and try again." that names no field, so
         * on its own it would repeat the old problem in friendlier words. Appended
         * after a specific reason it is confirmatory context.
         */
        $friendly = trim((string) data_get($body, 'friendly_message', ''));
        if ($friendly !== '' && ! str_contains($reason, $friendly)) {
            $reason = $reason !== '' ? ($reason . ' — ' . $friendly) : $friendly;
        }

        return $reason !== '' ? $reason : 'The service gave no reason.';
    }

    /**
     * A consistent, honest note about what the render did and did not include.
     *
     * A one-garment VTON call cannot dress a six-layer stack, so when the stack
     * held more than one piece the feedback says so rather than implying the
     * whole outfit was rendered.
     */
    private function feedback(string $category, int $garmentCount): string
    {
        $label = $category !== '' ? $category : 'garment';

        if ($garmentCount > 1) {
            return 'AI try-on rendered the ' . $label . '. '
                . 'The other ' . ($garmentCount - 1) . ' layer(s) in your stack were not included — '
                . 'each try-on renders one garment at a time.';
        }

        return 'AI try-on rendered the ' . $label . ' on your photo.';
    }

    /**
     * Strip base64 payloads out of a response before it reaches the log.
     *
     * An unredacted VTON response can carry megabytes of image data and would
     * make the log unreadable (and expensive).
     *
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    private function redact(array $body): array
    {
        $walk = function ($value, int $depth = 0) use (&$walk) {
            if ($depth > 5) {
                return '…';
            }

            if (is_string($value)) {
                return strlen($value) > 120 ? '<' . strlen($value) . ' chars>' : $value;
            }

            if (is_array($value)) {
                $out = [];
                foreach ($value as $k => $v) {
                    $out[$k] = $walk($v, $depth + 1);
                }

                return $out;
            }

            return $value;
        };

        return $walk($body);
    }
}
