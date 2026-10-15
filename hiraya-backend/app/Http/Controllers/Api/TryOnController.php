<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\TryOnSession;
use App\Jobs\ProcessTryOnJob;
use App\Services\SizeChart;
use App\Services\TryOnPreProcessor;
use App\Services\GeminiKeyPool;
use App\Support\LocalAsset;
use App\Support\TryOnGarmentPlan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class TryOnController extends Controller
{
    /**
     * HIRAYA-ONLY KNOWLEDGE BASE.
     *
     * The stylist is NOT a general fashion chatbot. It must answer from what
     * this storefront actually is: its garment domains, its size chart, its
     * measurement-driven fit logic and its virtual fitting flow. Without this
     * block the model improvised generic fashion advice (and, worse, told
     * customers about products the store does not stock).
     *
     * Kept as a single constant so the prompt and the fallback describe the
     * same store — the two answer paths can never drift apart.
     */
    /**
     * Static HIRAYA knowledge, WITHOUT the size numbers.
     *
     * The chart table is appended at runtime by `hirayaKnowledge()` so the model
     * is always quoting the SAME numbers the Size Suggester and the render use.
     * Hardcoding the table here would have re-created the duplication this
     * refactor removed — the AI would have kept reciting an old chart after the
     * store changed one.
     */
    private const HIRAYA_KNOWLEDGE = <<<'TXT'
ABOUT HIRAYA: A Filipino fashion storefront. The Studio pairs a customer's own
sizing profile with the garment's own measurements to recommend a size and
render a virtual fitting. Everything you say must stay inside this storefront.

GARMENT DOMAINS (what Hiraya sells): TOPS, BOTTOMS, OUTERWEAR, DRESSES, SHOES,
and ACCESSORIES. Do not offer categories outside these.

AVAILABLE SIZES ARE PER-GARMENT: the store stocks XS-2XL as a whole, but each
garment carries only the sizes the admin enabled for it (some pieces are
XS/S/M, others S/M/L/XL, shoes use EU numbers like 38-43). NEVER assume a
garment comes in a size — only claim a size exists if it is listed under
AVAILABLE_PIECES_IN_SIZE in the context you were given.

GARMENT MEASUREMENTS: each product stores its own per-size measurements
(chest_bust, waist, hips, shoulder_width, sleeve_length) taken flat. These are
the GARMENT's numbers, not the customer's. A size fits when the garment's
measures meet or exceed the customer's size band by a small ease margin.

VIRTUAL FITTING FLOW (how a customer gets a render):
  1. Sign in and record your sizing profile: an UPPER BODY SIZE and a LOWER
     BODY SIZE (XS-2XL, e.g. both M) in Account Settings. That is the only body
     information Hiraya stores — there are no centimetre measurements to enter.
  2. Pick garments from the bag into the style stack and choose a size per piece.
  3. Upload a full-body photo, then generate the virtual fitting.
Sizing is NEITHER required nor a blocker for rendering — it only powers the
size suggestion. Never tell a customer they cannot render without it.
TXT;

    /**
     * The full knowledge block: static prose + the LIVE size chart table.
     *
     * Built per call (it is cheap) so the model always quotes the store's
     * current chart, including any size added later.
     */
    private function hirayaKnowledge(): string
    {
        $lines = ['SIZE CHART (body measurements in cm — UPPER BOUND per size). This is the SAME',
            'chart the Size Suggester uses, so never contradict it:', ''];

        foreach (SizeChart::SIZES as $label => $entry) {
            $m = $entry['measurements'];
            $lines[] = sprintf(
                '  %-4s chest_bust %-6s waist %-6s hips %-7s shoulder %-6s sleeve %s',
                $label,
                $entry['band']['chest_bust'],
                $entry['band']['waist'],
                $m['hips'],
                $m['shoulder_width'],
                $m['sleeve_length'],
            );
        }

        $lines[] = '';
        $lines[] = 'Fit is driven by chest_bust + waist, and hips can only push the size UP (never';
        $lines[] = 'down) so a pear-shaped customer is not put in a top that is tight at the hip.';

        return self::HIRAYA_KNOWLEDGE . "\n\n" . implode("\n", $lines);
    }

    /**
     * Names of selected pieces that were dropped because they cannot be worn.
     *
     * Populated by `normaliseGarmentPhotos` and reported back as an asset
     * warning, so excluding a bag from the fitting is never silent.
     *
     * @var array<int, string>
     */
    private array $droppedNonWearables = [];

    /** Request-stage durations (ms) for the "TryOn request timings" log line. */
    private array $stageTimings = [];

    /**
     * Initiate a new virtual try-on session.
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function initiateTryOn(Request $request): JsonResponse
    {
        // System Settings -> "AI try-on & stylist". Enforced here, not only in the UI.
        if (! \App\Models\SystemSetting::isOn('ai_engine_active')) {
            return response()->json(['message' => 'The AI try-on and stylist are paused right now. Please try again later.'], 503);
        }

        /*
         * REMOVE THE PHP TIME LIMIT FOR THIS REQUEST.
         *
         * With `QUEUE_CONNECTION=sync` the render runs INLINE, inside this
         * request, for the whole PixelAPI round trip — measured at ~65s and up to
         * ~96s cold, and longer when the provider's one-job queue is busy. A PHP
         * `max_execution_time` of 60s (the default on many stacks, and the value
         * the built-in dev server enforces) therefore KILLS a render that is
         * about to succeed: "Maximum execution time of 60 seconds exceeded",
         * raised from inside the poll loop in VtonApiRenderer.
         *
         * The job paints its own ceiling — ProcessTryOnJob has a 300s timeout and
         * VtonApiRenderer polls with POLL_TIMEOUT_SECONDS — so an unbounded PHP
         * limit here cannot hang a request indefinitely. It only stops the
         * interpreter from aborting a legitimate render early.
         *
         * On a real queue this is a no-op (the request returns immediately).
         */
        @set_time_limit(0);

        // Request-stage timings, logged as "TryOn request timings".
        $requestStarted = microtime(true);
        $this->stageTimings = [];

        // Validate request payload.
        //
        // The Studio (useTryOnState.js) works in the app's canonical 5-core
        // CM schema, so we accept `user_photo` + `garments` + the 5-core
        // `measurements`. The legacy `*_base64` / `height` keys are still
        // accepted as aliases so older clients keep working.
        /*
         * THE PHOTO STRING SIZE CEILING, enforced by the validator.
         *
         * Both fields are Base64 data URIs, so a 5 MB upload is ~6.7 MB of
         * characters. Without a bound, a malformed or hostile client could post an
         * arbitrarily large string and have it carried into the job before the
         * renderers' byte guards ever run. `max:` counts CHARACTERS, and is set to
         * the Base64 equivalent of the 5 MB raw-file ceiling the frontend applies,
         * so a legitimately-sized photo can never trip it while an oversized one is
         * refused here with a clear, field-specific 422.
         */
        $maxPhotoChars = 7 * 1024 * 1024; // ~7 M chars ≈ a 5 MB binary photo in Base64

        $validated = $request->validate([
            'user_photo' => 'required_without:user_photo_base64|nullable|string|max:' . $maxPhotoChars,
            'user_photo_base64' => 'required_without:user_photo|nullable|string|max:' . $maxPhotoChars,

            // Garments may arrive as plain base64 strings (legacy) or as
            // objects { category, image, name } (current Studio payload).
            'garments' => 'required_without:garment_photos_base64|nullable|array|min:1',
            'garments.*' => 'nullable',
            /*
             * The CATEGORY is the body region the garment must be worn on, and
             * it is the difference between a correct render and a shoe being
             * described as an inner layer. It is optional only so legacy
             * clients keep working; when present it is validated against the
             * Studio's own category vocabulary.
             */
            /*
             * THE CATEGORY IS THE GARMENT'S OWN LABEL, NOT A STACK ROW.
             *
             * This was a closed enum of the six Studio ROW names, which had two
             * consequences. `accessories` failed validation outright (a bag in the
             * stack made the whole request a 422), and — worse — the enum was the
             * only thing the client could legally send, so the Studio sent its row
             * name `'top'` for every piece, including a dress or a pair of trousers
             * whose free-text label the mapper had not recognised.
             *
             * The renderer's own layer planner already resolves free-text labels
             * (`TryOnPreProcessor::normaliseLayer`) and explicitly rejects a
             * non-wearable, so the honest contract is: send the catalogue label, and
             * let the planner place it. Only a LENGTH bound is enforced here, so a
             * malformed/hostile value cannot bloat the stored payload; placement
             * itself is decided by the planner, never by this validator.
             */
            // Measurements are no longer accepted from the client. The customer
            // no longer types any: their sizing profile is two size labels
            // (upper_body_size / lower_body_size), and the centimetres the
            // renderer needs are DERIVED from the size chart below. A stale
            // client sending a `measurements` object is simply ignored — it can
            // no longer widen the attack surface by asserting a chest of 900.
            'garments.*.category' => 'nullable|string|max:64',
            /*
             * The CATALOG id of the piece, so the server can upgrade the input to
             * the product's prepared ghost-mannequin matte. The browser cannot
             * reliably fetch the catalog's absolute `127.0.0.1` asset URLs, so this
             * is what lets the backend supply a clean cut-out instead of the
             * marketing card the client fell back to (see `ghostMattesForProducts`).
             */
            'garments.*.product_id' => 'nullable|integer',
            // The colour chosen in the bag / by the stylist, so a colour VARIANT's
            // own cut-out is used instead of the primary colour's (see ghostMattesForProducts).
            'garments.*.color' => 'nullable|string|max:50',
            'garment_photos_base64' => 'required_without:garments|nullable|array|min:1',
            'garment_photos_base64.*' => 'string',
        ]);

        $user = $request->user();

        // Normalise the portrait to a single field name.
        $userPhoto = $validated['user_photo'] ?? $validated['user_photo_base64'] ?? null;

        if (blank($userPhoto) && ! empty($user->portrait_base64)) {
            // Fall back to the portrait the customer saved in Account Settings
            // so a returning user is not forced to re-upload every session.
            $userPhoto = $user->portrait_base64;
        }

        if (blank($userPhoto)) {
            return response()->json([
                'message' => 'A body photo is required to generate a fitting.',
                'errors' => ['user_photo' => ['Upload or capture your base body photo first.']],
            ], 422);
        }

        // Normalise garments into a flat list of image strings for the job.
        // When the client sends no usable image reference (e.g. a Saved item
        // whose Supabase path could not be fetched in-browser), we hydrate the
        // stack server-side straight from My Bag (cart_items) so the render
        // always has real pixels to work with.
        $this->droppedNonWearables = [];
        $submittedGarments = $validated['garments'] ?? $validated['garment_photos_base64'] ?? [];
        $stageStarted = microtime(true);
        [$garmentPhotos, $garmentCategories, $garmentProductIds] = $this->normaliseGarmentPhotos($submittedGarments);
        $this->stageTimings['garments_ms'] = (int) round((microtime(true) - $stageStarted) * 1000);
        $garmentMetadata = collect(is_array($submittedGarments) ? $submittedGarments : [])
            ->filter(fn ($garment) => is_array($garment) && !empty($garment['image']))
            ->map(fn ($garment) => [
                'name' => $garment['name'] ?? 'Garment',
                'category' => $garment['category'] ?? 'top',
                'product_id' => $garment['product_id'] ?? null,
            ])
            ->values()
            ->all();
        $historyTitle = collect($garmentMetadata)->pluck('name')->filter()->unique()->join(' + ');

        /*
         * Non-fatal input-quality notices, surfaced in the 202 response so the
         * UI can warn instead of silently rendering from a marketing card.
         *
         * Declared BEFORE the non-wearable loop below: that loop used to append
         * to `$assetWarnings` while this line reset it to `[]` two blocks later,
         * so every "accessory left out of the fitting" notice was thrown away
         * before the response was built. Initialising first preserves both kinds
         * of warning in one list.
         */
        $assetWarnings = [];

        /*
         * TELL THE CUSTOMER WHAT WAS LEFT OUT.
         *
         * A bag or a belt cannot be placed on a body, so it is not sent to the
         * renderer. Reporting it here (rather than dropping it quietly) is what
         * keeps the fitting honest: the customer sees that fewer pieces were worn
         * than they selected, and that the item is still in My Bag for checkout,
         * instead of wondering why their outfit looks incomplete.
         */
        foreach ($this->droppedNonWearables as $droppedName) {
            $assetWarnings[] = [
                'name' => $droppedName,
                'reason' => 'not-wearable',
                'message' => 'Accessories are not part of the AI fitting and were left out. The item stays in My Bag.',
            ];
        }

        if (empty($garmentPhotos)) {
            $garmentPhotos = $this->hydrateGarmentsFromBag($user, $assetWarnings);
            // A bag-hydrated stack carries no customer selection order, so the
            // categories stay unknown and the renderer falls back to a balanced
            // default look rather than mislabelling a piece.
            $garmentCategories = [];
            $garmentProductIds = [];
        }

        if (empty($garmentPhotos)) {
            return response()->json([
                'message' => 'At least one garment image is required.',
                'errors' => ['garments' => ['Add a garment to My Bag or select one from your Style Stack.']],
            ], 422);
        }

        /*
         * WHICH GARMENTS ONE FITTING CAN WEAR.
         *
         * One top (or outerwear) + one bottom, or one top over a dress, renders
         * as a two-pass pair; any other multi-garment stack is refused HERE, before anything is charged,
         * with a message the customer can act on — instead of rendering one piece
         * and silently dropping the rest (see TryOnGarmentPlan).
         */
        $garmentPlan = TryOnGarmentPlan::plan($garmentCategories);
        if ($garmentPlan['mode'] === TryOnGarmentPlan::MODE_UNSUPPORTED) {
            return response()->json([
                'message' => $garmentPlan['message'],
                'code' => 'unsupported_garment_combination',
                'reason' => $garmentPlan['code'],
                'errors' => ['garments' => [$garmentPlan['message']]],
            ], 422);
        }

        // Resolve the body metrics the renderer reads. These come from the
        // customer's SIZE profile via the size chart — see bodyMetricsFor().
        $measurements = $this->bodyMetricsFor($user);

        /*
         * DUPLICATE-RENDER PROTECTION (credit protection).
         *
         * Every render is a paid call to the try-on provider. Before paying,
         * look for THIS customer's own render of the exact same inputs: the
         * same source photo bytes, the same garment images/products/categories,
         * the same sizing profile and the same render pipeline version. The
         * fingerprint is a sha256 over the CONTENT, never a filename, so a
         * changed photo, garment, size or pipeline version is a new render.
         *
         * Matching is always scoped to user_id, so one customer's cached render
         * can never be served to another. A lock stops a double-click from
         * starting two identical paid renders.
         */
        // A top + bottom pair keeps PAIR_PIPELINE and a dress + top keeps OVER_DRESS_PIPELINE, so their fingerprints (and reuse) are unchanged.
        $fingerprint = $this->renderFingerprint($userPhoto, $garmentPhotos, $garmentCategories, $garmentProductIds, $measurements,
            $garmentPlan['mode'] === TryOnGarmentPlan::MODE_PAIR ? ($garmentPlan['pipeline'] ?? TryOnGarmentPlan::PAIR_PIPELINE) : null);
        $lock = Cache::lock('tryon-fp:' . $user->id . ':' . $fingerprint, 15);
        if (! $lock->get()) {
            return response()->json([
                'message' => 'This exact fitting is already being started. Please wait a moment.',
            ], 409);
        }

        try {
            if ($reused = $this->reusableRender($user->id, $fingerprint)) {
                return $reused;
            }

            $response = $this->startNewRender($user, $userPhoto, $garmentPhotos, $garmentCategories, $garmentMetadata,
                $historyTitle, $measurements, $fingerprint, $assetWarnings, $garmentPlan);

            Log::info('TryOn request timings', [
                'session' => $response->getData(true)['session_id'] ?? null,
                'mode' => $garmentPlan['mode'],
                'garments' => count($garmentPhotos),
                'total_ms' => (int) round((microtime(true) - $requestStarted) * 1000),
            ] + $this->stageTimings);

            return $response;
        } finally {
            $lock->release();
        }
    }

    /**
     * The rest of the original initiate flow: plan, store, dispatch the PAID render.
     * Unchanged apart from recording the fingerprint and vault-aware reads.
     */
    private function startNewRender($user, string $userPhoto, array $garmentPhotos, array $garmentCategories,
        array $garmentMetadata, string $historyTitle, array $measurements, string $fingerprint, array $assetWarnings,
        array $garmentPlan = ['mode' => TryOnGarmentPlan::MODE_SINGLE]): JsonResponse
    {
        $isPair = $garmentPlan['mode'] === TryOnGarmentPlan::MODE_PAIR;

        // Create unique session ID
        $sessionId = 'tryon_' . Str::uuid()->toString();

        /*
         * PRE-PROCESSING STAGE (computer-vision geometry plan).
         *
         * Build the render plan HERE, at request time, and persist it with the
         * session so the queued worker reads a frozen plan instead of
         * recomputing it. Two reasons this belongs in the controller:
         *
         *   1. It runs while the customer is still on the page, so the 202
         *      response stays instant and the worker does less work.
         *   2. The plan is derived from the SAME normalised measurements that
         *      are stored on the session, so the preview the UI shows and the
         *      geometry the renderer obeys can never disagree.
         *
         * This is what converts "a garment photo" into "a garment at <size>
         * anchored to <these landmarks> under <this lighting>" — the difference
         * between a flat overlay and a fitted render.
         */
        $renderPlan = null;
        $stageStarted = microtime(true);
        try {
            $renderPlan = app(TryOnPreProcessor::class)->buildRenderPlan(
                $measurements,
                $garmentPhotos,
                $userPhoto,
                $garmentCategories,
            );
        } catch (\Throwable $e) {
            // Planning is an enhancement, never a hard dependency: degrade to
            // the previous prompt-only render rather than refusing the request.
            Log::warning('TryOn pre-processing failed, falling back to prompt-only: ' . $e->getMessage());
        }
        $this->stageTimings['plan_ms'] = (int) round((microtime(true) - $stageStarted) * 1000);

        /*
         * Freeze the render pipeline on the session: a top + bottom pair (bottom
         * first) or a top / outerwear over a dress (dress first) renders in two
         * passes in this order (ProcessTryOnJob::renderPair). `layering` and
         * `outer` only pick the wording. Sessions without this key render a
         * single garment exactly as before.
         */
        $storedPlan = $renderPlan;
        if ($isPair) {
            $storedPlan = (array) ($renderPlan ?? []);
            $storedPlan['pipeline'] = [
                'mode' => TryOnGarmentPlan::MODE_PAIR,
                'order' => $garmentPlan['order'],
                'layering' => $garmentPlan['layering'] ?? TryOnGarmentPlan::LAYERING_OVER_BOTTOM,
                'first_pass' => null,
            ];
            if (isset($garmentPlan['outer'])) {
                $storedPlan['pipeline']['outer'] = $garmentPlan['outer'];
            }
        }
        $overDress = $isPair && ($garmentPlan['layering'] ?? null) === TryOnGarmentPlan::LAYERING_OVER_DRESS;
        $outerPiece = TryOnGarmentPlan::outerPiece($garmentPlan);

        // Create session record
        $stageStarted = microtime(true);
        $session = TryOnSession::create([
            'session_id' => $sessionId,
            'user_id' => $user->id,
            'user_photo_base64' => $userPhoto,
            'garment_photos_json' => $garmentPhotos,
            'garment_categories_json' => $garmentCategories ?: null,
            'garment_metadata_json' => $garmentMetadata ?: null,
            'history_title' => $historyTitle ?: null,
            'measurements_json' => $measurements,
            'render_plan_json' => $storedPlan,
            'status' => TryOnSession::STATUS_QUEUED,
            'is_favorite' => false,
            'render_fingerprint' => $fingerprint,
        ]);
        $this->stageTimings['store_ms'] = (int) round((microtime(true) - $stageStarted) * 1000);

        /*
         * GUARANTEE A WORKER IS DRAINING THE `tryon` QUEUE BEFORE DISPATCHING.
         *
         * WHY THIS BELONGS HERE
         * ---------------------
         * With `QUEUE_CONNECTION=database` the job below sits in the `jobs` table
         * until a `queue:work` process picks it up. If none is running, the
         * session stays `queued` forever and the customer sees `worker_offline`
         * ("the try-on queue has no worker process") — a failure that is invisible
         * until this exact moment, because nothing else in the app needs a worker.
         *
         * Treating the worker as a DEPENDENCY OF THIS REQUEST is what removes the
         * manual step: the customer presses Generate, the controller ensures a
         * consumer exists, and the render proceeds. The command is idempotent, so
         * on a deployment that already runs a worker (a supervisor-managed one,
         * or the watchdog) this call detects it and does nothing.
         *
         * IT NOW ENSURES THE WATCHDOG TOO, NOT JUST A BARE WORKER.
         *
         * A bare `queue:work` is a ONE-SHOT: when it dies, nothing revives it and
         * the next Generate reports `worker_offline` even though a worker had
         * been running when the previous render was submitted — the reported
         * symptom. `tryon:ensure-worker` therefore also starts `tryon:watch-worker`
         * when no supervisor is alive, so the crash self-heals instead of costing
         * the customer a failed fitting. Both halves stay idempotent, so this is
         * still safe to call on every request.
         *
         * FAILURE IS NON-FATAL. Starting a process is a best-effort convenience:
         * on a host where it is forbidden (a locked-down container, a read-only
         * filesystem) the render must still proceed and fail with its OWN reason
         * rather than a 500 from this call. The whole block is therefore guarded,
         * and a failure leaves the normal `worker_offline` path intact.
         */
        $stageStarted = microtime(true);
        if (config('queue.default') !== 'sync') {
            try {
                \Illuminate\Support\Facades\Artisan::call('tryon:ensure-worker', [
                    '--quiet-if-running' => true,
                ]);
            } catch (\Throwable $e) {
                Log::warning('Could not ensure a try-on worker is running: ' . $e->getMessage());
            }
        }
        $this->stageTimings['ensure_worker_ms'] = (int) round((microtime(true) - $stageStarted) * 1000);

        /*
         * Dispatch the render.
         *
         * On `QUEUE_CONNECTION=sync` this runs INLINE and the call below returns
         * only once the render has finished (or failed) — there is no worker on
         * this deployment and no `worker_offline` window. On a real queue
         * (database/redis) it returns immediately and the client polls
         * `/tryon/status`. The code handles BOTH without guessing which one is
         * configured.
         */
        ProcessTryOnJob::dispatch($session->id);

        // Re-read the row: an inline (sync) dispatch has already written a
        // terminal status onto it by the time we get here.
        $session->refresh();

        $isSync = config('queue.default') === 'sync';
        $completedInline = $session->status === TryOnSession::STATUS_COMPLETED
            && $session->hasResultImage();

        $payload = [
            'session_id' => $sessionId,
            'id' => $sessionId,
            'status' => $session->status ?: 'queued',
            'progress' => $completedInline ? 100 : 10,
            'garment_count' => count($garmentPhotos),
            /*
             * HOW MANY PROVIDER RENDERS THIS FITTING USES. A top + bottom pair is
             * two (one per piece) and takes about twice as long — the Studio says
             * so before Generate and scales its wait to match.
             */
            'render_passes' => $isPair ? 2 : 1,
            // Pieces the customer selected that a VTON render cannot wear.
            'excluded_non_wearables' => $this->droppedNonWearables,
            // Let the Studio label the render honestly: a fitting is only an AI
            // fitting when the Gemini image key is actually configured. Without
            // it the request will fail and the customer is told so, instead of
            // being shown a canvas drawing captioned as an AI render.
            'gemini_configured' => GeminiKeyPool::current() !== null,
            // Surface the geometry the render will use so the UI (and QA) can
            // confirm the garment is being sized from real measurements rather
            // than guessed.
            'fit_plan' => $renderPlan ? [
                'size' => $renderPlan['scaling']['size_label'] ?? null,
                'scale' => $renderPlan['scaling']['scale_directive'] ?? null,
                'measured_from_profile' => $renderPlan['body']['has_real_measurements'] ?? false,
                'derived_fields' => $renderPlan['body']['derived_fields'] ?? [],
                'layers' => count($renderPlan['layers'] ?? []),
            ] : null,
            /*
             * NON-FATAL INPUT-QUALITY NOTICES.
             *
             * One entry per garment that could not supply a clean
             * `ghost_mannequin_url` cut-out. The render still proceeds — this
             * exists so the Studio can TELL the customer the input was not
             * try-on ready (and which piece), instead of silently feeding the
             * model a framed marketing card and shipping the wrong result.
             */
            'asset_warnings' => $assetWarnings,
            /*
             * The render result, when it already exists.
             *
             * On `sync` the fitting is finished before this response is built, so
             * sending the image back here lets the Studio paint it immediately
             * instead of opening a poll loop for a render that is already done.
             * Absent (a real queue), the client polls as before — the fields are
             * simply omitted so nothing downstream can mistake `null` for a
             * finished-but-empty render.
             */
            'message' => $completedInline
                ? 'Virtual try-on render complete.'
                : ($isSync
                    ? 'Virtual try-on render did not produce an image.'
                    : ($isPair
                        ? ($overDress
                            ? "Rendering your dress, then your {$outerPiece} over it: two renders, one per piece."
                            : 'Rendering your top and bottom together: two renders, one per piece.')
                        : 'Virtual try-on session initiated. Processing started.')),
        ];

        if ($completedInline) {
            $image = $session->resultImage();
            $payload['result_image_base64'] = $image;
            $payload['result_image'] = $image;
            $payload['ai_feedback'] = $session->ai_feedback;
            $payload['recommended_size'] = $this->extractRecommendedSize($session);

            return response()->json($payload, 200);
        }

        // Inline render that produced nothing usable: report the failure now
        // rather than making the client poll a session that is already failed.
        if ($isSync && $session->status === TryOnSession::STATUS_FAILED) {
            $payload['progress'] = 0;
            $payload['message'] = $this->customerFacingTryOnError((string) $session->error_message);
            $payload['ai_feedback'] = $payload['message'];

            return response()->json($payload, 200);
        }

        return response()->json($payload, 202);
    }

    /**
     * Deterministic content fingerprint of a render request (sha256 hex).
     *
     * Covers everything that changes the output: the source photo bytes, each
     * garment image + its product id + its body region, the sizing profile the
     * renderer is given, and `tryon.render_version`.
     */
    private function renderFingerprint(string $userPhoto, array $garmentPhotos, array $garmentCategories,
        array $garmentProductIds, array $measurements, ?string $pipeline = null): string
    {
        $contentHash = function (string $value): string {
            $payload = str_starts_with($value, 'data:') && str_contains($value, ',')
                ? (base64_decode(substr($value, strpos($value, ',') + 1), true) ?: $value)
                : $value;

            return hash('sha256', $payload);
        };

        $garments = [];
        foreach (array_values($garmentPhotos) as $i => $photo) {
            $garments[] = [
                'image' => $contentHash((string) $photo),
                'category' => $garmentCategories[$i] ?? null,
                // Index-aligned with the kept images (a dropped accessory cannot shift it).
                'product_id' => $garmentProductIds[$i] ?? null,
            ];
        }

        $measurementsSorted = $measurements;
        ksort($measurementsSorted);

        $parts = [
            'v' => (string) config('tryon.render_version', 'v1'),
            'photo' => $contentHash($userPhoto),
            'garments' => $garments,
            'measurements' => $measurementsSorted,
        ];

        /*
         * A two-pass pair is a different render from the old single-garment
         * result of the same stack (which showed only one piece), so it must not
         * reuse it. Added only for pairs: single-garment fingerprints — and the
         * reuse of every existing single render — are unchanged.
         */
        if ($pipeline !== null) {
            $parts['pipeline'] = $pipeline;
        }

        return hash('sha256', json_encode($parts));
    }

    /**
     * The customer's own reusable render for this fingerprint, as a response —
     * or null when a new (paid) render is needed.
     *
     *  - a finished render (even one in Recently Deleted, which is restored)
     *    is returned as-is: no provider call, no credits;
     *  - an identical render still in flight (< 15 min old) is returned so the
     *    client polls that one instead of paying for a second.
     */
    private function reusableRender(int $userId, string $fingerprint): ?JsonResponse
    {
        $existing = TryOnSession::withTrashed()
            ->where('user_id', $userId)
            ->where('render_fingerprint', $fingerprint)
            ->whereIn('status', [TryOnSession::STATUS_COMPLETED, TryOnSession::STATUS_QUEUED, TryOnSession::STATUS_PROCESSING])
            ->latest()
            ->first();

        if (! $existing) {
            return null;
        }

        if ($existing->status === TryOnSession::STATUS_COMPLETED) {
            $image = $existing->hasResultImage() ? $existing->resultImage() : null;
            if (! $image) {
                return null; // stored object unreadable: render again
            }

            $restored = false;
            if ($existing->trashed()) {
                $existing->restore();
                $restored = true;
            }

            return response()->json([
                'session_id' => $existing->session_id,
                'id' => $existing->session_id,
                'status' => TryOnSession::STATUS_COMPLETED,
                'progress' => 100,
                'reused' => true,
                'restored_from_trash' => $restored,
                'result_image_base64' => $image,
                'result_image' => $image,
                'ai_feedback' => $existing->ai_feedback,
                'recommended_size' => $this->extractRecommendedSize($existing),
                'asset_warnings' => [],
                'excluded_non_wearables' => $this->droppedNonWearables,
                'message' => $restored
                    ? 'You already rendered this exact look — it was restored from Recently Deleted. No new render was charged.'
                    : 'You already rendered this exact look, so your saved result is shown. No new render was charged.',
            ], 200);
        }

        if (! $existing->trashed() && $existing->created_at && $existing->created_at->gt(now()->subMinutes(15))) {
            return response()->json([
                'session_id' => $existing->session_id,
                'id' => $existing->session_id,
                'status' => $existing->status,
                'progress' => 10,
                'reused' => true,
                'render_passes' => $existing->isPairRender() ? 2 : 1,
                'asset_warnings' => [],
                'excluded_non_wearables' => $this->droppedNonWearables,
                'message' => 'This exact fitting is already rendering. Showing its progress.',
            ], 202);
        }

        return null;
    }

    /**
     * Pull the authenticated user's My Bag (cart_items) as a fallback garment
     * source for the render pipeline.
     *
     * A customer who has filled their bag but has not yet tapped a piece on the
     * Style Stack carousel would otherwise get a hard 422. Resolving the bag
     * server-side makes "Generate" work from the bag state alone.
     *
     * @param  \App\Models\User  $user
     * @param  array<int, array>  $warnings  populated (by reference) with one
     *         entry per product that could NOT supply a clean VTON cut-out.
     * @return array<int, string>
     */
    private function hydrateGarmentsFromBag($user, array &$warnings = []): array
    {
        $images = [];

        // Loaded eagerly to avoid an N+1 across a multi-piece bag.
        $items = $user->cartItems()->with('product')->latest()->get();

        foreach ($items as $item) {
            $product = $item->product;
            if (! $product) {
                continue; // Orphaned row: product deleted by an admin.
            }

            /*
             * SOURCE PREFERENCE.
 *
             * `ghost_mannequin_url` is the BARE, transparent cut-out — the
             * documented input format for every VTON model, and the cleanest
             * possible input.
             *
             * `display_image_url` is the next best: the ghost-mannequin FRAME.
             * It is composed (black card, gold borders, logo, reflection), so a
             * model fed it may reproduce that artwork — but it is still only the
             * garment, and strictly cleaner than the raw marketing photo. It was
             * previously omitted here, which meant a product with a prepared
             * display card still fell through to the raw upload.
             *
             * `image_url` is the raw admin photograph — the LAST resort.
             */
            $isClean = is_string($product->ghost_mannequin_url) && trim($product->ghost_mannequin_url) !== '';

            $reference = $product->ghost_mannequin_url
                ?? $product->display_image_url
                ?? $product->image_url
                ?? $product->image_base64
                ?? null;

            if (! is_string($reference) || trim($reference) === '') {
                // No asset at all is a genuine failure the caller must see.
                $warnings[] = [
                    'product_id' => $product->id,
                    'name'       => $product->name,
                    'reason'     => 'no-asset',
                ];
                continue;
            }

            if (! $isClean) {
                /*
                 * A composed/raw image is a WARNING, not a failure: the render
                 * still runs, but the operator is told the input was not a clean
                 * cut-out, and why the fitting may copy the card's artwork.
                 * The real fix is a ghost-mannequin cut-out on the product.
                 */
                Log::warning('VTON input is not a clean cut-out', [
                    'product_id' => $product->id,
                    'name'       => $product->name,
                    'used'       => $product->display_image_url ? 'display_image_url' : 'image_url',
                ]);
                $warnings[] = [
                    'product_id' => $product->id,
                    'name'       => $product->name,
                    'reason'     => 'not-a-cut-out',
                ];
            }

            $images[] = $this->toBase64DataUri($reference);
        }

        return array_values(array_filter($images));
    }

    /**
     * Convert a stored public image path/URL into a Base64 data URI.
     *
     * Already-encoded data URIs pass straight through. Everything else is
     * resolved by `LocalAsset`, which reads a `/storage/...` asset STRAIGHT OFF
     * THE LOCAL DISK and only falls back to HTTP for a genuinely remote url.
     *
     * WHY NOT A PLAIN HTTP FETCH ANY MORE: the catalog stores an ABSOLUTE
     * `http://127.0.0.1:8000/storage/...` url, and on the single-threaded
     * `php artisan serve` a fetch of our own url blocks against the very process
     * that issued it — `cURL error 28: Operation timed out after 20016ms`, which
     * is what made every bag-hydrated garment resolve to an empty string and the
     * render fail as "unknown" (measured in storage/logs/laravel.log).
     *
     * Returns an empty string when the asset genuinely cannot be resolved so
     * callers can filter.
     */
    private function toBase64DataUri(string $reference): string
    {
        try {
            return LocalAsset::toDataUri($reference) ?? '';
        } catch (\Throwable $e) {
            Log::warning('TryOn garment hydration failed: ' . $e->getMessage());

            return '';
        }
    }

    /**
     * Reduce the incoming garment payload to a flat, INDEX-ALIGNED list of
     * images plus their categories.
     *
     * Accepts either plain base64 strings or Studio objects shaped like
     * { category, image, name } and skips anything without a usable image.
     *
     * The two returned arrays share their indexes: `$categories[$i]` is the body
     * region of `$images[$i]`, or null when the client did not send one. That
     * alignment is what allows the renderer to say "IMAGE 3 is the footwear"
     * instead of assigning regions by guesswork.
     *
     * A third array carries each kept garment's product id (index-aligned), for
     * the render fingerprint.
     *
     * @param  array<int, mixed>  $garments
     * @return array{0: array<int, string>, 1: array<int, string|null>, 2: array<int, int|null>}
     */
     private function normaliseGarmentPhotos(array $garments): array
    {
        $images = [];
        $categories = [];
        $productIds = [];

        // Every product's matte resolved up front: one query, cached, fetched in parallel.
        $mattes = $this->ghostMattesForProducts(array_map(
            fn ($garment) => is_array($garment)
                ? ['id' => $garment['product_id'] ?? null, 'color' => $garment['color'] ?? null]
                : ['id' => null, 'color' => null],
            $garments,
        ));

        foreach ($garments as $garment) {
            $clientImage = is_array($garment)
                ? ($garment['image'] ?? $garment['image_url'] ?? $garment['image_base64'] ?? null)
                : $garment;

            /*
             * SERVER-SIDE GHOST-MATTE UPGRADE.
             *
             * MEASURED: the browser cannot reliably fetch the catalog's
             * `ghost_mannequin_url` when it is an absolute `127.0.0.1:8000` URL
             * accessed from a different origin/device, so `prepareVtonGarment`
             * silently fell back to segmenting the MARKETING CARD — and the model
             * faithfully reproduced the card's HIRAYA logo, "CULTURE MEETS STYLE"
             * headline and torn alpha holes onto the customer's fitting (see the
             * session that shipped that render).
             *
             * The BACKEND has no such restriction — it just fetched the same matte
             * successfully. So when the client tells us WHICH product a piece is,
             * and the catalog holds a real ghost-mannequin matte for it, that matte
             * is used REGARDLESS of what image the client sent. A prepared cut-out
             * is strictly the correct VTON input, so this is never a downgrade.
             *
             * Absent a product id, or with no matte on the product, the client's
             * own image is used exactly as before.
             */
            $image = $clientImage;
            $productId = is_array($garment) && is_numeric($garment['product_id'] ?? null) ? (int) $garment['product_id'] : null;
            $matteKey = $productId !== null ? $this->matteKey($productId, is_array($garment) ? ($garment['color'] ?? null) : null) : null;
            if ($matteKey !== null && ($mattes[$matteKey] ?? '') !== '') {
                $image = $mattes[$matteKey];
            }

            if (!is_string($image) || trim($image) === '') {
                continue;
            }

            $category = is_array($garment)
                ? (isset($garment['category']) ? strtolower((string) $garment['category']) : null)
                : null;

            /*
             * NON-WEARABLES ARE DROPPED AT THE DOOR.
             *
             * A bag, a belt or a pair of sunglasses has no body region, so a VTON
             * model cannot be told to wear it. This is where the reported sleeve
             * bug originated: an unrecognised label ("BAG") reached the layer
             * planner, which assigned it the first free slot — `top`, described as
             * "sleeves down the arms" — and the render invented sleeves that no
             * selected garment had.
             *
             * Dropping the piece HERE, rather than later, is what keeps every
             * downstream list consistent. `garment_photos_json` and
             * `garment_categories_json` are index-aligned and are read directly by
             * the renderer to label "IMAGE 2 = ..."; filtering in one pass means
             * the planner, the prompt and the payload can never disagree about how
             * many garments there are or which image is which.
             *
             * The drop is NOT silent: the count is surfaced as an asset warning so
             * the Studio can tell the customer their bag was left out of the
             * fitting (and is still in My Bag) instead of quietly rendering fewer
             * pieces than they selected.
             */
            if ($this->isNonWearableCategory($category)) {
                $this->droppedNonWearables[] = is_array($garment)
                    ? (string) ($garment['name'] ?? 'Item')
                    : 'Item';
                continue;
            }

            $images[] = $image;
            $categories[] = $category;
            $productIds[] = $productId;
        }

        return [$images, $categories, $productIds];
    }

    /**
     * Resolve the prepared ghost-mannequin mattes of several products as Base64
     * data URIs, keyed by product id. A product with no matte, not found, or whose
     * asset cannot be read is simply absent, so the caller keeps the image it had.
     *
     * LATENCY (measured locally, 2026-10-03): fetching the two mattes of a top +
     * bottom one after another took 0.9–1.6 s EACH, on every Generate — even when
     * the same pieces were rendered a minute earlier. Now:
     *   - one query loads every product's matte URL;
     *   - a matte fetched in the last 10 minutes is reused from the cache (it is
     *     a public catalogue image, identical for every customer, keyed by URL so
     *     a replaced matte is never served stale under a new URL);
     *   - the remaining downloads run in parallel.
     *
     * WHY THE SERVER DOES THIS AND NOT THE BROWSER
     * --------------------------------------------
     * The catalog stores `ghost_mannequin_url` as an ABSOLUTE `http://127.0.0.1:8000`
     * URL. A browser on a different origin or device cannot fetch that address, so
     * the Studio's client-side attempt failed and its fallback segmented the
     * marketing card instead — which is how a HIRAYA logo and a "CULTURE MEETS
     * STYLE" headline ended up printed across a customer's rendered blouse.
     * PHP has no origin restriction, so the matte is fetched here instead.
     *
     * COLOUR VARIANTS. A product's `ghost_mannequin_url` is the PRIMARY colour's
     * cut-out. This used to be used for every request of that product, so a Navy
     * variant was rendered in White. The requested colour now selects the
     * variant's own cut-out; a variant without one keeps the client's image
     * rather than borrowing the wrong colour.
     *
     * @param  array<int, array{id: mixed, color: mixed}>  $requests
     * @return array<string, string>  keyed by matteKey(id, color)
     */
    private function ghostMattesForProducts(array $requests): array
    {
        $ids = array_values(array_unique(array_map('intval', array_filter(array_column($requests, 'id'), 'is_numeric'))));
        if ($ids === []) {
            return [];
        }

        try {
            $products = Product::whereIn('id', $ids)->get(['id', 'ghost_mannequin_url', 'color_variants'])->keyBy('id');
        } catch (\Throwable $e) {
            Log::warning('TryOn ghost-matte upgrade skipped: ' . $e->getMessage());

            return [];
        }

        $urls = [];
        foreach ($requests as $request) {
            if (! is_numeric($request['id'] ?? null) || ! ($product = $products->get((int) $request['id']))) {
                continue;
            }
            $color = is_string($request['color'] ?? null) ? $request['color'] : null;
            $url = trim((string) $product->ghost_mannequin_url);
            $variant = \App\Support\ProductVariants::indexFor($product, $color);
            if ($variant !== null) {
                $url = trim((string) (\App\Support\ProductVariants::all($product)[$variant]['ghost_mannequin_url'] ?? ''));
            }
            if ($url !== '') {
                $urls[$this->matteKey((int) $request['id'], $color)] = $url;
            }
        }

        $cacheKey = fn (string $url) => 'tryon-ghost-matte:' . sha1($url);
        $mattes = [];
        $remote = [];

        foreach ($urls as $id => $url) {
            $cached = Cache::get($cacheKey($url));
            if (is_string($cached) && $cached !== '') {
                $mattes[$id] = $cached;

                continue;
            }

            $fetchUrl = LocalAsset::remoteUrlFor($url);
            if ($fetchUrl === null) {
                $mattes[$id] = $this->toBase64DataUri($url); // data URI / local disk: no network
            } else {
                $remote[$id] = $fetchUrl;
            }
        }

        if ($remote !== []) {
            try {
                $responses = Http::pool(fn (\Illuminate\Http\Client\Pool $pool) => array_map(
                    fn ($id) => $pool->as((string) $id)->timeout(20)->get($remote[$id]),
                    array_keys($remote),
                ));
            } catch (\Throwable $e) {
                $responses = [];
            }

            foreach ($remote as $id => $fetchUrl) {
                $res = $responses[(string) $id] ?? null;
                if ($res instanceof \Illuminate\Http\Client\Response && $res->successful() && $res->body() !== '') {
                    $mime = explode(';', $res->header('Content-Type') ?: 'image/png')[0];
                    $mattes[$id] = 'data:' . $mime . ';base64,' . base64_encode($res->body());
                } else {
                    // Same resolver as before, one at a time, for anything the pool missed.
                    $mattes[$id] = $this->toBase64DataUri($urls[$id]);
                }

                if ($mattes[$id] !== '') {
                    Cache::put($cacheKey($urls[$id]), $mattes[$id], now()->addMinutes(10));
                }
            }
        }

        return array_filter($mattes, fn ($uri) => is_string($uri) && $uri !== '');
    }

    /** Lookup key for one product in one colour (see ghostMattesForProducts). */
    private function matteKey(int $productId, ?string $color): string
    {
        return $productId . '|' . strtolower(trim((string) $color));
    }

    /**
     * Is this incoming category one that can never be worn in a VTON render?
     *
     * Mirrors `TryOnPreProcessor::isNonWearable` so the controller can filter
     * before the plan is built. Deliberately narrow: only the families that are
     * certainly not garments, so a real (if oddly named) piece of clothing is
     * never dropped from a paid render.
     */
    private function isNonWearableCategory(?string $category): bool
    {
        if (!is_string($category) || trim($category) === '') {
            return false; // unknown is NOT the same as non-wearable
        }

        $category = strtolower($category);

        /*
         * GARMENT FAMILIES WIN FIRST.
         *
         * A substring test would otherwise misfile "Baggy Jeans" (contains
         * "bag") and "Sleeveless Blouse" as accessories. Checking the wearable
         * families first makes the common real-world labels resolve correctly.
         */
        foreach ([
            'shirt', 'blouse', 'top', 'tee', 'polo', 'tank', 'crop',
            'pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack',
            'dress', 'gown',
            'jacket', 'coat', 'blazer', 'outerwear', 'cardigan', 'hoodie', 'parka',
            'shoe', 'footwear', 'sneaker', 'boot', 'sandal', 'loafer', 'heel', 'slipper',
            'inner',
        ] as $wearable) {
            if (str_contains($category, $wearable)) {
                return false;
            }
        }

        foreach ([
            'bag', 'purse', 'accessor', 'jewel', 'watch', 'belt', 'scarf',
            'sunglass', 'wallet', 'earring', 'necklace', 'bracelet',
        ] as $accessory) {
            if (str_contains($category, $accessory)) {
                return true;
            }
        }

        return false;
    }

    /**
 * THE BODY METRICS THE RENDERER READS, DERIVED FROM THE CUSTOMER'S SIZES.
 *
 * The 5 Core Body Measurements are gone. A customer now stores an
 * `upper_body_size` and a `lower_body_size`, and every downstream consumer
 * (the size heuristics in ProcessTryOnJob, the drape geometry in
 * TryOnPreProcessor, the stylist prompt) still wants CENTIMETRES.
 *
 * So the centimetres are derived here, from the ONE size chart the rest of
 * the platform already uses, and stored on the session in the same shape the
 * renderer has always read. Both aliases are emitted (`chest` and `chest_bust`)
 * because two different consumers look for different names.
 *
 * A customer with no sizes on file gets an EMPTY array, which every consumer
 * already treats as "no measurements supplied, fall back to the subject's own
 * silhouette in the photo" — so a render is never blocked by a missing profile.
 *
 * @return array<string, float>
 */
    private function bodyMetricsFor($user = null): array
    {
        if (! $user) {
            return [];
        }

        $upper = SizeChart::normaliseLabel($user->upper_body_size);
        $lower = SizeChart::normaliseLabel($user->lower_body_size);

        // Prefer the lower body's band for the waist when both are set: the
        // waist is the lower body's own sizing axis, and a customer whose upper
        // and lower sizes differ should be measured on the axis that governs it.
        $waist = SizeChart::measurementsFor($lower ?? $upper ?? '');
        $chest = SizeChart::measurementsFor($upper ?? $lower ?? '');

        if (! $waist && ! $chest) {
            return [];
        }

        $metrics = array_filter([
            'chest' => $chest['chest_bust'] ?? null,
            'waist' => $waist['waist'] ?? null,
            'hips'  => $waist['hips'] ?? null,
            'shoulder_width' => $chest['shoulder_width'] ?? null,
            'sleeve_length'  => $chest['sleeve_length'] ?? null,
        ]);

        // Alias across both spellings so no consumer reads a missing field.
        if (isset($metrics['chest'])) {
            $metrics['chest_bust'] = $metrics['chest'];
        }

        // The size the customer actually wears, carried through so the render's
        // size recommendation agrees with the profile instead of re-deriving it.
        $metrics['size'] = $upper ?? $lower;

        return $metrics;
    }

    /**
     * Check the status of a try-on session.
     *
     * @param string $sessionId
     * @return JsonResponse
     */
    public function checkStatus(string $sessionId): JsonResponse
    {
        $session = TryOnSession::where('session_id', $sessionId)
            ->where('user_id', request()->user()->id)
            ->first();

        if (!$session) {
            return response()->json([
                'status' => 'error',
                'message' => 'Session not found.',
            ], 404);
        }

        $response = [
            'session_id' => $session->session_id,
            'status' => $session->status,
        ];

        // A two-piece pair (top + bottom, or top over a dress): which of its two renders is running.
        $pairPass = null;
        if ($session->isPairRender()) {
            $pairPass = empty($session->pipeline()['first_pass']['path']) ? 1 : 2;
            $response['render_passes'] = 2;
            $response['render_pass'] = $session->status === TryOnSession::STATUS_COMPLETED ? 2 : $pairPass;
        }

        if ($session->status === TryOnSession::STATUS_QUEUED) {
            // The renderer can sit behind other jobs on the 'tryon' queue, so
            // report indeterminate progress rather than a frozen 0%.
            $response['progress'] = 10;
            /*
             * HONEST STATUS TEXT. This used to say "Queued for the IDM-VTON
             * renderer", but IDM-VTON is no longer in the chain (Hugging Face
             * ZeroGPU is browser-only) and on `sync` the render is INLINE, not
             * queued at all. Say what is actually happening so a queued/taken
             * session is not mistaken for a stalled one.
             */
            $response['message'] = config('queue.default') === 'sync'
                ? 'Rendering your fitting on the try-on service.'
                : 'Queued for the try-on renderer.';

            /*
             * TELL THE CLIENT WHETHER A CONSUMER ACTUALLY EXISTS.
             *
             * WHY THIS FIELD IS NEEDED
             * ------------------------
             * The client cannot distinguish these two situations from `status`
             * alone, and they demand opposite copy:
             *
             *   A. `queued` AND a worker is alive  -> a render is genuinely in
             *      progress (PixelAPI runs one job at a time, so waiting is
             *      correct and "keep polling" is right).
             *
             *   B. `queued` AND no worker at all   -> nothing will EVER pick the
             *      job up. Waiting is pointless; the honest answer is a server
             *      config problem.
             *
             * Previously the client guessed: it declared `worker_offline` after a
             * fixed 15s of `queued`. That guess is wrong in the common case on this
             * deployment — PixelAPI can sit behind a job for minutes while the
             * worker is perfectly healthy — so a legitimate in-flight render was
             * reported as "the AI renderer is not running on the server", which is
             * exactly the misleading message that was reported. Probing liveness
             * here turns the guess into a fact.
             */
            $response['worker_running'] = $this->tryOnWorkerIsRunning();
        } elseif ($session->status === TryOnSession::STATUS_PROCESSING) {
            $response['progress'] = $this->estimateProgress($session);
            $response['message'] = 'Mapping garment drape to your body frame.';

            if ($pairPass !== null) {
                // Each pass ramps through its own half of the bar (20–55%, 55–90%).
                $half = ($this->estimateProgress($session) - 20) / 2;
                $response['progress'] = (int) round(($pairPass === 1 ? 20 : 55) + $half);
                // "(the bottom)" / "(the top)", or "(the dress)" first for a top or outerwear over a dress.
                $passLabels = TryOnGarmentPlan::passLabels($session->pipeline());
                $response['message'] = "Rendering piece {$pairPass} of 2 ({$passLabels[$pairPass - 1]}).";
            }
        } elseif ($session->status === TryOnSession::STATUS_COMPLETED) {
            $response['progress'] = 100;
            // Decrypted from the private vault for the OWNER only (query above
            // is scoped to request()->user()->id).
            $image = $session->resultImage();
            $response['result_image_base64'] = $image;
            // `result_image` kept as an alias so clients reading either key
            // keep rendering instead of showing an empty canvas.
            $response['result_image'] = $image;
            $response['ai_feedback'] = $session->ai_feedback;
            $response['recommended_size'] = $this->extractRecommendedSize($session);
        } elseif ($session->status === TryOnSession::STATUS_FAILED) {
            $response['progress'] = 0;
            /*
             * The stored `error_message` is for staff (it names the provider,
             * HTTP codes and credit state — see the API & AI console). The
             * shopper gets a plain sentence; photo problems stay specific
             * because those are things they can fix.
             */
            $friendly = $this->customerFacingTryOnError((string) $session->error_message);
            $response['ai_feedback'] = $friendly;
            $response['message'] = $friendly;
        }

        return response()->json($response);
    }

    /**
     * A failed render's reason, rewritten for the shopper.
     */
    private function customerFacingTryOnError(string $raw): string
    {
        $lower = Str::lower($raw);

        if (Str::contains($lower, ['person', 'body', 'pose', 'face', 'photo', 'image is', 'full-body'])
            && ! Str::contains($lower, ['api', 'http', 'credit', 'quota', 'timeout', 'exception', 'sql'])) {
            return $raw;
        }

        if (Str::contains($lower, ['402', 'credit', 'quota', '429', 'rate limit', 'overloaded', '503'])) {
            return 'The fitting service is busy right now. Please try again in a few minutes.';
        }

        return 'We could not finish this fitting. Please try again, or use a clearer full-body photo.';
    }

    /**
     * Is a `queue:work` process actually draining the `tryon` queue?
     *
     * Delegates to `tryon:ensure-worker`, which owns the ONE definition of
     * "a worker exists" (the same class the request-time hook uses), so the status
     * endpoint and the auto-start can never disagree about it.
     *
     * FAIL-SAFE DIRECTION: an undetectable worker reports `true`, not `false`.
     * A false "no worker" would abort a render that is genuinely in flight (the
     * costly error), whereas a missed "no worker" merely lets the client wait for
     * its normal timeout — the less bad failure by a wide margin.
     *
     * On `sync` there is no queue to drain: the render runs inline in the request
     * that created the session, so a worker is never needed and `true` is correct.
     */
    private function tryOnWorkerIsRunning(): bool
    {
        if (config('queue.default') === 'sync') {
            return true;
        }

        try {
            return app(\App\Console\Commands\EnsureTryOnWorker::class)->workerIsAlive();
        } catch (\Throwable $e) {
            Log::warning('Could not probe the try-on worker: ' . $e->getMessage());

            return true;
        }
    }

    /**
     * Crude but honest progress estimate for a session sitting in
     * 'processing': ramps toward 90% over ~2 minutes and stops there so the
     * bar never shows a false 100% before the image is actually stored.
     */
    private function estimateProgress(TryOnSession $session): int
    {
        $startedAt = $session->updated_at ?? $session->created_at;
        if (! $startedAt) {
            return 35;
        }

        $elapsed = max(0, $startedAt->diffInSeconds(now()));
        $ratio = min(1.0, $elapsed / 120);

        return (int) round(20 + ($ratio * 70)); // 20% -> 90%
    }

    /**
     * Read the size recommendation out of the stored AI feedback text.
     *
     * The job writes both a prose recommendation and a machine-readable
     * prefix; the prefix wins so the client gets a clean "M"/"XL" label rather
     * than a full sentence.
     */
    private function extractRecommendedSize(TryOnSession $session): ?string
    {
        $feedback = (string) $session->ai_feedback;

        if (preg_match('/SIZE:\s*([A-Z0-9]{1,4})/i', $feedback, $matches)) {
            return strtoupper($matches[1]);
        }

        return null;
    }

    /**
     * POST /api/tryon/retry/{sessionId}
     *
     * Re-queue a FAILED session in place so the customer keeps their uploaded
     * photo, garment stack and measurements instead of rebuilding the look.
     */
    public function retry(string $sessionId): JsonResponse
    {
        $session = TryOnSession::where('session_id', $sessionId)
            ->where('user_id', request()->user()->id)
            ->first();

        if (! $session) {
            return response()->json(['message' => 'Session not found.'], 404);
        }

        if ($session->status === TryOnSession::STATUS_COMPLETED) {
            return response()->json([
                'session_id' => $session->session_id,
                'status' => $session->status,
                'message' => 'This fitting has already completed.',
            ], 409);
        }

        // Reset the failure markers, then hand the row back to the worker.
        $session->update([
            'status' => TryOnSession::STATUS_QUEUED,
            'error_message' => null,
            'result_image_base64' => null,
            'result_image_path' => null,
        ]);

        ProcessTryOnJob::dispatch($session->id);

        return response()->json([
            'session_id' => $session->session_id,
            'status' => 'queued',
            'progress' => 10,
            'message' => 'Session re-queued for rendering.',
        ], 202);
    }

    /**
     * Get user's try-on history.
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function history(Request $request): JsonResponse
    {
        /*
         * A LIGHT LIST: ONE SMALL THUMBNAIL PER LOOK.
         *
         * This used to hydrate WHOLE rows — the customer photo, the render AND
         * every garment image (garment_photos_json averages ~640 KB) — and send
         * the full-size render and photo back for up to 50 looks: ~2.6 MB a row,
         * over the remote pooler and into the browser, to draw a grid of cards.
         *
         * Now only the render is read (the thumbnail needs it) and it leaves as a
         * ~20 KB JPEG. The full render and the before photo are fetched per look
         * by historyDetail() when the customer actually opens one.
         */
        $query = TryOnSession::where('user_id', $request->user()->id)
            ->where('status', TryOnSession::STATUS_COMPLETED)
            ->withRender()
            ->select(['id', 'session_id', 'is_favorite', 'history_title', 'garment_metadata_json', 'result_image_base64', 'result_image_path', 'created_at']);

        if ($request->boolean('favorites')) {
            $query->where('is_favorite', true);
        }

        $sessions = $query->latest()->paginate(min(max($request->integer('per_page', 12), 1), 24));

        $sessions->setCollection($sessions->getCollection()->map(function (TryOnSession $session) {
            $garments = $this->historyGarments($session);

            return [
                'session_id' => $session->session_id,
                'title' => $this->historyTitle($session, $garments),
                'garment_count' => count($garments),
                'is_favorite' => (bool) $session->is_favorite,
                'thumbnail' => $this->sessionThumbnail($session),
                'created_at' => optional($session->created_at)->toIso8601String(),
            ];
        }));

        return response()->json($sessions);
    }

    /**
     * GET /api/tryon/history-trash — the customer's "Recently Deleted" renders.
     *
     * Expired items (older than tryon.trash_retention_days) are purged for this
     * customer first, so the list never shows something about to vanish.
     */
    public function trash(Request $request): JsonResponse
    {
        $userId = $request->user()->id;
        $retention = max(1, (int) config('tryon.trash_retention_days', 30));
        self::purgeExpiredTrash($userId);

        $sessions = TryOnSession::onlyTrashed()
            ->where('user_id', $userId)
            ->where('status', TryOnSession::STATUS_COMPLETED)
            ->withRender()
            ->select(['id', 'session_id', 'history_title', 'garment_metadata_json', 'result_image_base64', 'result_image_path', 'created_at', 'deleted_at'])
            ->orderByDesc('deleted_at')
            ->paginate(min(max($request->integer('per_page', 12), 1), 24));

        $sessions->setCollection($sessions->getCollection()->map(function (TryOnSession $session) use ($retention) {
            $garments = $this->historyGarments($session);
            $purgeAt = $session->deleted_at?->copy()->addDays($retention);

            return [
                'session_id' => $session->session_id,
                'title' => $this->historyTitle($session, $garments),
                'garment_count' => count($garments),
                'thumbnail' => $this->sessionThumbnail($session),
                'created_at' => optional($session->created_at)->toIso8601String(),
                'deleted_at' => optional($session->deleted_at)->toIso8601String(),
                'purge_at' => optional($purgeAt)->toIso8601String(),
                'days_left' => $purgeAt ? max(0, (int) ceil(now()->diffInHours($purgeAt, false) / 24)) : null,
            ];
        }));

        return response()->json(array_merge($sessions->toArray(), ['retention_days' => $retention]));
    }

    /** POST /api/tryon/history/{sessionId}/restore — back to the Gallery. */
    public function restoreHistory(Request $request, string $sessionId): JsonResponse
    {
        $session = TryOnSession::onlyTrashed()
            ->where('session_id', $sessionId)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        $session->restore();

        return response()->json(['message' => 'Restored to your Gallery.', 'session_id' => $session->session_id]);
    }

    /**
     * DELETE /api/tryon/history/{sessionId}/permanent — gone for good.
     * Only items already in Recently Deleted can be purged; the encrypted
     * object is removed from storage by the model's forceDeleted hook.
     */
    public function forceDestroyHistory(Request $request, string $sessionId): JsonResponse
    {
        $session = TryOnSession::onlyTrashed()
            ->where('session_id', $sessionId)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        Cache::forget('tryon-thumb:' . $session->id);
        $session->forceDelete();

        return response()->json(status: 204);
    }

    /** DELETE /api/tryon/history-trash — empty Recently Deleted. */
    public function emptyTrash(Request $request): JsonResponse
    {
        $count = 0;
        TryOnSession::onlyTrashed()
            ->where('user_id', $request->user()->id)
            ->select(['id', 'result_image_path'])
            ->each(function (TryOnSession $session) use (&$count) {
                Cache::forget('tryon-thumb:' . $session->id);
                $session->forceDelete();
                $count++;
            });

        return response()->json(['message' => 'Recently Deleted is empty.', 'removed' => $count]);
    }

    /**
     * Permanently purge trashed renders past the retention window (one user,
     * or everyone when $userId is null — used by `tryon:purge-deleted`).
     */
    public static function purgeExpiredTrash(?int $userId = null): int
    {
        $cutoff = now()->subDays(max(1, (int) config('tryon.trash_retention_days', 30)));
        $count = 0;

        TryOnSession::onlyTrashed()
            ->when($userId, fn ($q) => $q->where('user_id', $userId))
            ->where('deleted_at', '<', $cutoff)
            ->select(['id', 'result_image_path'])
            ->each(function (TryOnSession $session) use (&$count) {
                Cache::forget('tryon-thumb:' . $session->id);
                $session->forceDelete();
                $count++;
            });

        return $count;
    }

    /**
     * A small JPEG thumbnail for a Gallery card. Cached ENCRYPTED (the cache is
     * a file store) so the vault is not re-read for every grid load.
     */
    private function sessionThumbnail(TryOnSession $session): ?string
    {
        $key = 'tryon-thumb:' . $session->id;
        $cached = Cache::get($key);
        if (is_string($cached)) {
            try {
                return Crypt::decryptString($cached);
            } catch (\Throwable $e) {
                Cache::forget($key);
            }
        }

        $thumb = $this->historyThumbnail($session->resultImage());
        if ($thumb) {
            Cache::put($key, Crypt::encryptString($thumb), now()->addDays(7));
        }

        return $thumb;
    }

    /**
     * GET /api/tryon/history/{sessionId}
     *
     * One look in full: the render, the before photo and the garments it wore.
     * garment_photos_json (the heavy garment images) is NOT read here; it is only
     * needed by reusableOutfit() when the outfit is loaded back into the Studio.
     */
    public function historyDetail(Request $request, string $sessionId): JsonResponse
    {
        $session = TryOnSession::where('session_id', $sessionId)
            ->where('user_id', $request->user()->id)
            ->where('status', TryOnSession::STATUS_COMPLETED)
            ->select(['id', 'session_id', 'is_favorite', 'history_title', 'garment_metadata_json', 'result_image_base64', 'result_image_path', 'user_photo_base64', 'created_at'])
            ->firstOrFail();

        $garments = $this->historyGarments($session);

        return response()->json([
            'session_id' => $session->session_id,
            'title' => $this->historyTitle($session, $garments),
            'is_favorite' => (bool) $session->is_favorite,
            'result_image_base64' => $session->resultImage(),
            'original_image_base64' => $session->user_photo_base64,
            'garments' => $garments,
            'created_at' => optional($session->created_at)->toIso8601String(),
        ]);
    }

    /**
     * The garments a session wore, from its small metadata column.
     *
     * @return array<int, array{name: string, category: ?string, product_id: mixed}>
     */
    public function historyGarments(TryOnSession $session): array
    {
        return collect(is_array($session->garment_metadata_json) ? $session->garment_metadata_json : [])
            ->filter(fn ($garment) => is_array($garment) && ! empty($garment['name']))
            ->map(fn ($garment) => [
                'name' => (string) $garment['name'],
                'category' => $garment['category'] ?? null,
                'product_id' => $garment['product_id'] ?? null,
            ])
            ->unique('name')
            ->values()
            ->all();
    }

    public function historyTitle(TryOnSession $session, array $garments): string
    {
        if ($session->history_title) {
            return $session->history_title;
        }

        return $garments ? implode(' + ', array_column($garments, 'name')) : 'Virtual Try-On';
    }

    /**
     * A ~360px-wide JPEG thumbnail of a stored render, as a data URI.
     *
     * Transparent renders are flattened onto black, the frame the Studio shows
     * every render on. If GD is unavailable or the image cannot be decoded, the
     * original is returned so the card still has a picture.
     */
    public function historyThumbnail(?string $source): ?string
    {
        if (! is_string($source) || $source === '') {
            return null;
        }

        if (! function_exists('imagecreatefromstring')) {
            return $source;
        }

        try {
            $payload = str_contains($source, ',') ? substr($source, strpos($source, ',') + 1) : $source;
            $image = @imagecreatefromstring(base64_decode($payload, true) ?: '');
            if (! $image) {
                return $source;
            }

            $width = imagesx($image);
            $height = imagesy($image);
            $targetWidth = min(360, $width);
            $targetHeight = max(1, (int) round($height * ($targetWidth / max(1, $width))));

            $thumb = imagecreatetruecolor($targetWidth, $targetHeight);
            imagefill($thumb, 0, 0, imagecolorallocate($thumb, 0, 0, 0));
            imagecopyresampled($thumb, $image, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);

            ob_start();
            imagejpeg($thumb, null, 80);
            $jpeg = ob_get_clean();

            imagedestroy($image);
            imagedestroy($thumb);

            return 'data:image/jpeg;base64,' . base64_encode($jpeg);
        } catch (\Throwable $e) {
            return $source;
        }
    }

    public function updateFavorite(Request $request, string $sessionId): JsonResponse
    {
        $validated = $request->validate(['is_favorite' => 'required|boolean']);
        $session = TryOnSession::where('session_id', $sessionId)
            ->where('user_id', $request->user()->id)
            ->where('status', TryOnSession::STATUS_COMPLETED)
            ->firstOrFail();

        $session->update(['is_favorite' => $validated['is_favorite']]);

        return response()->json(['id' => $session->session_id, 'is_favorite' => $session->is_favorite]);
    }

    /**
     * DELETE /api/tryon/history/{sessionId} — a SOFT delete: the render moves
     * to Recently Deleted (restorable until the retention window ends).
     */
    public function destroyHistory(Request $request, string $sessionId): JsonResponse
    {
        $session = TryOnSession::where('session_id', $sessionId)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        $session->delete();

        return response()->json(status: 204);
    }

    public function reusableOutfit(Request $request, string $sessionId): JsonResponse
    {
        $session = TryOnSession::where('session_id', $sessionId)
            ->where('user_id', $request->user()->id)
            ->where('status', TryOnSession::STATUS_COMPLETED)
            ->firstOrFail();

        $images = collect(is_array($session->garment_photos_json) ? $session->garment_photos_json : [])
            ->filter(fn ($image) => is_string($image) && trim($image) !== '')
            ->values();
        $metadata = collect(is_array($session->garment_metadata_json) ? $session->garment_metadata_json : [])
            ->values();
        $garments = $images->map(function ($image, $index) use ($metadata) {
            $item = is_array($metadata->get($index)) ? $metadata->get($index) : [];
            return [
                'id' => $item['product_id'] ?? null,
                'name' => $item['name'] ?? 'Saved garment',
                'category' => $item['category'] ?? 'top',
                'image_url' => $image,
            ];
        });

        if ($garments->isEmpty()) {
            return response()->json(['message' => 'The garments from this try-on are no longer available.'], 409);
        }

        return response()->json(['garments' => $garments]);
    }

    /**
     * POST /api/tryon/chat
     *
     * The Studio stylist chat. Two answer paths:
     *
     *   1. GEMINI (preferred) — when `GEMINI_API_KEY` is configured the message
     *      is sent to the text/vision model together with the customer's
     *      measurements and stack, so the reply is genuinely conversational and
     *      reacts to what was ASKED. This is the only path that reads the actual
     *      question.
     *   2. DETERMINISTIC FALLBACK — no key, a quota error, or any failure falls
     *      back to a rule-based responder so the panel ALWAYS returns something
     *      useful. The fallback is intent-routed too (size / occasion / colour /
     *      styling / greeting), so even without Gemini the reply is not one
     *      canned sentence.
     *
     * The response also carries `suggestions` (quick-reply chips the UI renders)
     * and `products` (catalog pieces available in the recommended size) so the
     * chat becomes a shopping surface, not a readout.
     */
    public function chat(Request $request): JsonResponse
    {
        // System Settings -> "AI try-on & stylist". Enforced here, not only in the UI.
        if (! \App\Models\SystemSetting::isOn('ai_engine_active')) {
            return response()->json(['message' => 'The AI try-on and stylist are paused right now. Please try again later.'], 503);
        }

        $validated = $request->validate([
            'message' => 'required|string|max:1000',
            'context' => 'nullable|array',
            'context.measurements' => 'nullable|array',
            'context.selected_garments' => 'nullable|array',
            'context.selected_garments.*' => 'nullable|string|max:255',
            'context.has_generated_image' => 'nullable|boolean',
            // `look_analysis` = sent by the Studio right after a render finishes.
            'context.mode' => 'nullable|string|in:chat,look_analysis',
            // The finished render's session (owner-checked below) for the look analysis.
            'context.session_id' => 'nullable|string|max:80',
        ]);

        $message = trim($validated['message']);
        $measurements = $validated['context']['measurements'] ?? [];
        $garments = array_values(array_filter($validated['context']['selected_garments'] ?? []));
        $hasImage = ! empty($validated['context']['has_generated_image']);
        $mode = $validated['context']['mode'] ?? 'chat';

        /*
         * NO CENTIMETRES SENT? USE THE SAVED PROFILE. Every account records an
         * upper and a lower size; the chart behind those labels supplies the
         * numbers, so a signed-in shopper is never told to "add your sizes".
         */
        $user = $request->user();
        if (empty($measurements) && $user && ($user->upper_body_size || $user->lower_body_size)) {
            $upper = SizeChart::measurementsFor((string) ($user->upper_body_size ?: $user->lower_body_size)) ?? [];
            $lower = SizeChart::measurementsFor((string) ($user->lower_body_size ?: $user->upper_body_size)) ?? [];
            $measurements = array_filter([
                'chest_bust' => $upper['chest_bust'] ?? null,
                'shoulder_width' => $upper['shoulder_width'] ?? null,
                'sleeve_length' => $upper['sleeve_length'] ?? null,
                'waist' => $lower['waist'] ?? null,
                'hips' => $lower['hips'] ?? null,
            ], fn ($v) => $v !== null);
        }

        $chest = $measurements['chest_bust'] ?? $measurements['chest'] ?? null;
        $waist = $measurements['waist'] ?? null;
        $hips  = $measurements['hips'] ?? null;

        // The size the rule engine recommends for these measurements (or null).
        $size = ($chest && $waist)
            ? $this->recommendSize((float) $chest, (float) $waist, $hips !== null ? (float) $hips : null)
            : null;

        /*
         * CATALOG MATCH: pieces that exist in the recommended size. Fetched up
         * front because BOTH the Gemini prompt and the fallback use them, and a
         * single query is cheaper than two. Silently empty on any failure — a
         * dead catalog must never break the chat.
         */
        /*
         * The shopper's saved profile fills what the request did not send: the
         * Studio only derives centimetres when it has them, but every account
         * now carries an upper size and a gender.
         */
        $size = $size ?? ($user?->upper_body_size ? Str::upper($user->upper_body_size) : null);

        /*
         * GARMENT PAIRINGS (Inventory -> Pair with). The pieces an admin paired
         * with what the customer is wearing are the stylist's first suggestions:
         * they are boosted into the product cards and named to the AI.
         */
        $pairedIds = $this->pairedIdsForStack($garments);

        $intent = $this->detectIntent($message);
        $season = $this->currentSeason();

        /*
         * CONTEXTUAL RECOMMENDATION CARDS.
         *
         * Cards used to be attached to EVERY reply ("hi" got four product cards).
         * Now:
         *   - after a render (look analysis, or a styling question about the
         *     rendered look) the cards are COMPLEMENTARY pieces for the worn
         *     garments — stylist pairings first, then missing layers, seasonal;
         *   - in normal chat, cards appear only when the message actually asks
         *     for pieces / an outfit / pairing / occasion ideas;
         *   - greetings, sizing explanations and HIRAYA questions get none.
         */
        $lookMode = $mode === 'look_analysis'
            || ($hasImage && ! empty($garments) && in_array($intent, ['style', 'color', 'occasion'], true));

        if ($lookMode) {
            $products = $this->complementaryForLook($garments, $user?->gender, $size, $pairedIds, $season, 4);
        } elseif ($this->wantsCards($intent, $message)) {
            $products = $this->catalogForChat($message, $size, $user?->gender, 4, $pairedIds);
        } else {
            $products = [];
        }

        // The finished render itself (owner-checked), for a vision read of the look.
        $lookImage = null;
        if ($mode === 'look_analysis' && ! empty($validated['context']['session_id']) && $user) {
            $session = TryOnSession::where('session_id', $validated['context']['session_id'])
                ->where('user_id', $user->id)
                ->where('status', TryOnSession::STATUS_COMPLETED)
                ->first();
            $lookImage = $session ? $this->historyThumbnail($session->resultImage()) : null;
        }

        $gemini = $this->geminiReply(
            $message,
            $intent,
            $measurements,
            $garments,
            $hasImage,
            $size,
            $products,
            $lookMode,
            $season,
            $lookImage,
        );

        $reply = $gemini ?? ($lookMode
            ? $this->lookAnalysisReply($garments, $products, $season)
            : $this->deterministicReply(
                $intent,
                $message,
                $chest,
                $waist,
                $hips,
                $size,
                $garments,
                $hasImage,
                $products,
            ));

        return response()->json([
            'reply' => $reply,
            'source' => $gemini !== null ? 'gemini' : 'rules',
            'intent' => $lookMode ? 'look_analysis' : $intent,
            // Quick-reply chips, context-aware (see suggestionsFor()).
            'suggestions' => $lookMode
                ? ['What shoes go with this?', 'Style this for the ' . $season['label'], 'Show more pieces that match']
                : $this->suggestionsFor($intent, $size, ! empty($garments)),
            // Recommendation cards — only when relevant (see above).
            'products' => $products,
            /*
             * DEEP LINKS for answers the chat should NOT recite.
             *
             * Some questions have long, constantly-changing answers — the full
             * stock list, the complete size guide, everything in a category.
             * Enumerating those inside a 2-4 sentence reply is both fragile
             * (stock is decremented manually, so it goes stale immediately) and
             * worse for the customer than the page that already owns that view.
             * The chat answers briefly and links to the source of truth.
             */
            'links' => $products ? $this->linksFor($intent, $size, $products) : [],
        ]);
    }

    /** Does this chat message actually ask for pieces to look at? */
    private function wantsCards(string $intent, string $message): bool
    {
        if (in_array($intent, ['style', 'occasion', 'color'], true)) {
            return true;
        }

        return (bool) preg_match(
            '/\b(show|recommend|suggest|pair|match|complete|outfit|look for|wear with|what to wear|available|options?|pieces?|meron|mayroon|ipakita)\b/i',
            $message
        );
    }

    /** The Philippine season right now (store time), for seasonal styling. */
    private function currentSeason(): array
    {
        $month = (int) now(config('payments.timezone', 'Asia/Manila'))->month;

        return match (true) {
            $month >= 6 && $month <= 11 => [
                'key' => 'rainy', 'label' => 'rainy season',
                'words' => ['jacket', 'outerwear', 'coat', 'long sleeve', 'trench', 'boots', 'layer'],
            ],
            $month >= 3 && $month <= 5 => [
                'key' => 'hot', 'label' => 'summer heat',
                'words' => ['linen', 'summer', 'shorts', 'short sleeve', 'cotton', 'sandals', 'resort'],
            ],
            default => [
                'key' => 'cool', 'label' => 'cool holiday season',
                'words' => ['knit', 'blazer', 'coat', 'formal', 'cardigan', 'long sleeve', 'holiday'],
            ],
        };
    }

    /** Coarse body layer of a catalogue piece, for "what is missing from this look". */
    private function layerOf(?string $category, ?string $name = null): string
    {
        $text = Str::lower(trim(($category ?? '') . ' ' . ($name ?? '')));

        return match (true) {
            (bool) preg_match('/shoe|sneaker|boot|sandal|heel|loafer|footwear/', $text) => 'footwear',
            (bool) preg_match('/dress|gown|terno|filipiniana|full_body|full body/', $text) => 'dress',
            (bool) preg_match('/jacket|coat|blazer|outerwear|cardigan|vest|hoodie/', $text) => 'outerwear',
            (bool) preg_match('/pant|trouser|short|skirt|jean|slack|bottom|cargo|chino/', $text) => 'bottom',
            (bool) preg_match('/bag|belt|hat|cap|accessor|scarf|tie|jewel|watch/', $text) => 'accessory',
            default => 'top',
        };
    }

    /**
     * COMPLEMENTARY HIRAYA PIECES for the rendered look.
     *
     * Ranked: stylist pairings of the worn garments first, then pieces that add
     * a layer the look does not have yet (e.g. outerwear or a bottom), then
     * seasonal relevance, the shopper's size and stock. Worn pieces and unrelated
     * categories that duplicate what is already worn are left out, so the cards
     * are never random.
     *
     * @return array<int, array<string, mixed>>
     */
    private function complementaryForLook(array $garments, ?string $gender, ?string $size, array $pairedIds, array $season, int $limit = 4): array
    {
        $worn = $this->stackGarmentDetails($garments);
        $wornNames = array_map(fn ($g) => Str::lower((string) $g['name']), $worn ?: array_map(fn ($n) => ['name' => $n], $garments));
        $wornLayers = array_values(array_unique(array_map(fn ($g) => $this->layerOf($g['category'] ?? null, $g['name'] ?? null), $worn)));
        $wearsDress = in_array('dress', $wornLayers, true);

        $wantGender = match (Str::lower((string) $gender)) {
            'male' => 'men',
            'female' => 'women',
            default => null,
        };

        try {
            $catalog = Product::query()->latest('id')->limit(120)->get();
        } catch (\Throwable $e) {
            return [];
        }

        $scored = [];
        foreach ($catalog as $product) {
            if (in_array(Str::lower((string) $product->name), $wornNames, true)) {
                continue;
            }
            $productGender = Str::lower((string) $product->gender);
            if ($wantGender && $productGender !== '' && $productGender !== 'unisex' && $productGender !== $wantGender) {
                continue;
            }

            $layer = $this->layerOf($product->category, $product->name);
            $paired = in_array((int) $product->id, $pairedIds, true);
            $addsLayer = ! in_array($layer, $wornLayers, true)
                // A dress already covers top + bottom.
                && ! ($wearsDress && in_array($layer, ['top', 'bottom'], true))
                // A top/bottom look does not need a dress.
                && ! (! $wearsDress && $layer === 'dress' && array_intersect(['top', 'bottom'], $wornLayers));

            if (! $paired && ! $addsLayer) {
                continue; // would duplicate what is already worn — not complementary
            }

            $haystack = Str::lower(implode(' ', array_filter([
                $product->name, $product->description, (string) $product->category, $product->background_occasion,
            ])));
            $seasonal = collect($season['words'])->contains(fn ($w) => str_contains($haystack, $w));
            $sizes = $this->normaliseSizeLabels($product->sizes);
            $fitsSize = $size && in_array(Str::upper($size), $sizes, true);
            $inStock = (int) ($product->stock ?? 0) > 0;

            $scored[] = [
                'product' => $product,
                'paired' => $paired,
                'seasonal' => $seasonal,
                'sizes' => $sizes,
                'score' => ($paired ? 10 : 0) + ($addsLayer ? 4 : 0) + ($seasonal ? 2 : 0) + ($fitsSize ? 2 : 0) + ($inStock ? 1 : 0),
            ];
        }

        usort($scored, fn ($a, $b) => $b['score'] <=> $a['score']);

        $out = [];
        foreach (array_slice($scored, 0, $limit) as $row) {
            $product = $row['product'];
            $out[] = [
                'id' => $product->id,
                'name' => $product->name,
                'category' => $product->category,
                'price' => (float) $product->price,
                'image_url' => $product->display_image_url ?: $product->image_url,
                'in_stock' => (int) ($product->stock ?? 0) > 0,
                'sizes' => $row['sizes'],
                'stock_in_this_size' => $size ? $this->stockForSize($product, Str::upper($size)) : null,
                'url' => '/product/' . $product->id,
                'pairs_with_your_stack' => $row['paired'],
                'seasonal' => $row['seasonal'],
            ];
        }

        return $out;
    }

    /** Rule-based look analysis (used when Gemini is unavailable). */
    private function lookAnalysisReply(array $garments, array $products, array $season): string
    {
        $worn = $garments ? implode(' + ', $garments) : 'your selected pieces';
        $lines = ['Your look is ready: ' . $worn . '.'];

        $layers = array_values(array_unique(array_map(
            fn ($g) => $this->layerOf($g['category'] ?? null, $g['name'] ?? null),
            $this->stackGarmentDetails($garments)
        )));
        if (count($layers) <= 1) {
            $lines[] = 'It reads clean and focused on one statement piece — adding a second layer or a contrasting bottom would give the outfit more structure.';
        } else {
            $lines[] = 'The layers work together as one outfit; keep the accessories minimal so the silhouette stays the focus.';
        }

        $lines[] = 'For the ' . $season['label'] . ', '
            . match ($season['key']) {
                'rainy' => 'a light outer layer and closed shoes keep the look practical.',
                'hot' => 'breathable fabrics and lighter tones keep it comfortable.',
                default => 'a knit or blazer layer makes it feel finished.',
            };

        if ($products) {
            $lines[] = 'Pieces from Hiraya that complete this look: '
                . implode(', ', array_map(fn ($p) => $p['name'], array_slice($products, 0, 3))) . '.';
        }

        return implode(' ', $lines);
    }

    /**
     * Where to send the customer when the complete answer lives on a page.
     *
     * Only ever emits that actually exist in the frontend router
     * (App.jsx): `/product/:id` and `/shop`. A link to a dead route is worse
     * than no link — the shopper taps it and lands on the wildcard redirect.
     *
     * @param  array<int, array<string, mixed>>  $products
     * @return array<int, array<string, string>>
     */
    private function linksFor(string $intent, ?string $size, array $products): array
    {
        $links = [];

        // A size question is best finished on the actual garment page.
        foreach (array_slice($products, 0, 3) as $p) {
            if (! empty($p['url'])) {
                $links[] = ['label' => $p['name'] . ' — details & stock', 'url' => $p['url']];
            }
        }

        // "What else do you have / show me more" -> the shop, optionally filtered.
        if (in_array($intent, ['size', 'style', 'general'], true) && empty($links)) {
            $links[] = [
                'label' => $size ? 'Browse the shop (size ' . $size . ')' : 'Browse the shop',
                'url' => '/shop',
            ];
        }

        return $links;
    }

    /**
     * Classify the user's message into one of a small set of intents.
     *
     * Deliberately keyword-based: no model call, no latency, and it can never
     * fail. The result drives BOTH the fallback copy and the quick-reply chips.
     */
    private function detectIntent(string $message): string
    {
        $m = Str::lower($message);

        /*
         * WHOLE WORDS ONLY. `str_contains` matched "fit" inside "outfit", so
         * "Can you suggest an outfit for the office?" was answered as a size
         * question; "hi" also matched inside "this" and "which".
         */
        $has = fn (array $words): bool => $this->containsWord($m, $words);

        if ($has(['size', 'sukat', 'fit', 'measurement', 'kasya', 'small', 'medium', 'large', 'xl', '2xl'])) {
            return 'size';
        }

        if ($has(['occasion', 'wedding', 'party', 'work', 'office', 'date', 'casual', 'formal', 'church', 'beach', 'event'])) {
            return 'occasion';
        }

        if ($has(['color', 'colour', 'kulay', 'match', 'pair', 'bagay', 'tone'])) {
            return 'color';
        }

        if ($has(['style', 'outfit', 'look', 'ensemble', 'suggest', 'recommend', 'ano', 'what should'])) {
            return 'style';
        }

        if ($has(['hi', 'hello', 'hey', 'kumusta', 'kamusta', 'good morning', 'good evening'])) {
            return 'greeting';
        }

        return 'general';
    }

    /**
     * Ask Gemini for a conversational styling reply.
     *
     * Returns null on ANY failure (no key, quota, network, unparsable body) so
     * the caller transparently falls back to the rule engine. Never throws.
     */
    private function geminiReply(
        string $message,
        string $intent,
        array $measurements,
        array $garments,
        bool $hasImage,
        ?string $size,
        array $products,
        bool $lookMode = false,
        array $season = [],
        ?string $lookImage = null,
    ): ?string {
        /*
         * POOL, NOT A SINGLE KEY — the key that answers comes from
         * App\Services\GeminiKeyPool, which rotates to the next key when the
         * current one's daily quota is drained (429). With no GEMINI_API_KEYS
         * configured this behaves exactly as a single GEMINI_API_KEY.
         */
        $apiKey = GeminiKeyPool::current();

        if (empty($apiKey)) {
            return null;
        }

        $model = (string) config('services.gemini.model', 'gemini-2.5-flash');

        $context = [
            'customer_measurements_cm' => $measurements ?: 'not provided',
            'recommended_size' => $size ?: 'unknown (measurements missing)',
            'style_stack' => $garments ?: 'empty',
            'fitting_rendered' => $hasImage,
            /*
             * LIVE CATALOG SNAPSHOT — read from the database on EVERY request.
             *
             * Stock is decremented manually as orders are placed, so any figure
             * baked into a prompt would be wrong within a day. Nothing about the
             * catalog is hardcoded: add a garment in the admin console and it is
             * here on the very next message.
             *
             * `available_pieces_in_size` covers the recommended size;
             * `garments_in_stack` covers what the customer actually picked — a
             * customer asking "may stock pa ba ito?" is asking about the LATTER,
             * which the previous context never included.
             */
            'available_pieces_in_size' => array_map(
                fn ($p) => [
                    'name' => $p['name'],
                    'category' => $p['category'],
                    'price' => $p['price'],
                    'sizes' => $p['sizes'] ?? [],
                    'in_stock' => $p['in_stock'] ?? null,
                    'pairs_with_your_stack' => $p['pairs_with_your_stack'] ?? false,
                ],
                $products,
            ),
            'garments_in_stack' => $this->stackGarmentDetails($garments),
            /*
             * The size labels the store actually holds right now. Handed to the
             * model so it can answer "do you have this in L?" honestly instead
             * of guessing — AVAILABLE SIZES ARE PER-GARMENT, so a size missing
             * from this list may simply not exist in the catalog today.
             */
            'sizes_present_in_catalog_now' => $this->sizesPresentInCatalog(),
            'total_garments_in_catalog' => $this->catalogCount(),
            'current_season_ph' => $season['label'] ?? null,
            'recommendation_cards_shown' => array_map(fn ($p) => $p['name'], $products),
        ];

        /*
         * The prompt is GROUNDED in HIRAYA_KNOWLEDGE. Earlier it only said
         * "you are Hiraya's stylist" and passed a product blob, so the model
         * invented generic fashion advice and even implied stock the store does
         * not carry. The knowledge block pins it to Hiraya's domains, its size
         * chart and its virtual fitting flow.
         *
         * Order matters for steerability: identity/rules first, store facts
         * second, live context third, the actual question last.
         */
        $prompt = "You are Hiraya's AI personal stylist and size advisor for a Filipino "
            . "fashion storefront. You answer ONLY from the HIRAYA KNOWLEDGE and the CONTEXT "
            . "below. If something is not covered there, say you cannot help with it rather "
            . "than guessing.\n\n"
            . "RULES:\n"
            . "- Never invent products, sizes, measurements or prices that are not in CONTEXT.\n"
            . "- A garment only comes in the sizes shown in CONTEXT; never assume a size exists.\n"
            . "- Never contradict the SIZE CHART — it is the same one the Size Suggester uses.\n"
            . "- Stock figures in CONTEXT are a live snapshot; if stock is not listed for a piece,\n"
            . "  say the exact count is on the product page instead of guessing.\n"
            . "- When the answer needs numbers you cannot state confidently (a full stock list, a\n"
            . "  size guide), point the customer to the relevant page rather than reciting it.\n"
            . "- When the customer asks what to wear with a piece, or for an outfit, recommend the\n"
            . "  stylist pairings first: the `stylist_pairs` of each garment in `garments_in_stack`\n"
            . "  and any piece marked `pairs_with_your_stack`. Say they were paired by Hiraya's stylists.\n"
            . "- SCOPE: answer only about HIRAYA, HIRAYA garments/products, styling, garment and fit\n"
            . "  combinations, sizing guidance and seasonal styling. For anything else, say briefly\n"
            . "  that you can only help with HIRAYA styling and suggest a related question.\n"
            . "- Only mention products by name if they are in CONTEXT; recommendation cards are shown\n"
            . "  to the customer only for `recommendation_cards_shown` — never point at cards otherwise.\n"
            . "- Answer the customer's message directly, warmly, in 2-4 short sentences.\n"
            . "- Plain text only. No markdown headings, no bullet lists.\n\n"
            . ($lookMode
                ? "LOOK ANALYSIS MODE: the customer just rendered a virtual try-on wearing `style_stack`"
                    . ($lookImage ? ' (the rendered image is attached)' : '') . ". Do NOT make the answer about the\n"
                    . "matched size. Give a short high-level read of the look (silhouette, proportion, colour\n"
                    . "balance, occasion it suits), one or two concrete styling observations, then recommend\n"
                    . "the complementary HIRAYA pieces in `recommendation_cards_shown` and why they complete\n"
                    . "this look. Mention the current season (`current_season_ph`) only if it is relevant.\n\n"
                : '')
            . $this->hirayaKnowledge() . "\n\n"
            . 'CONTEXT (JSON): ' . json_encode($context, JSON_UNESCAPED_SLASHES) . "\n\n"
            . 'CUSTOMER MESSAGE: ' . $message;

        $parts = [['text' => $prompt]];
        if ($lookImage && preg_match('#^data:(image/[a-z]+);base64,(.+)$#s', $lookImage, $m)) {
            $parts[] = ['inlineData' => ['mimeType' => $m[1], 'data' => $m[2]]];
        }

        try {
            // Key in a header, not the URL — URLs end up in logged exception messages.
            $response = Http::timeout(20)
                ->connectTimeout(8)
                ->acceptJson()
                ->withHeaders(['x-goog-api-key' => $apiKey])
                ->post(
                    'https://generativelanguage.googleapis.com/v1beta/models/'
                        . rawurlencode($model) . ':generateContent',
                    [
                        'contents' => [[
                            'parts' => $parts,
                        ]],
                        'generationConfig' => ['temperature' => 0.6],
                    ],
                );

            if (! $response->successful()) {
                Log::info('Stylist chat Gemini non-2xx: ' . $response->status());

                /*
                 * REPORT THE OUTCOME TO THE KEY POOL: a 429 puts THIS key on
                 * daily cooldown (the pool serves the NEXT call from the next
                 * key); a 401/403 sits the key out the same way (invalid key).
                 */
                if ($response->status() === 429) {
                    GeminiKeyPool::markRateLimited($apiKey);
                } elseif (in_array($response->status(), [401, 403], true)) {
                    GeminiKeyPool::markInvalid($apiKey);
                }

                return null;
            }

            $text = trim((string) data_get($response->json(), 'candidates.0.content.parts.0.text', ''));

            return $text !== '' ? $text : null;
        } catch (\Throwable $e) {
            // A stylist chat must never 500 on a vendor hiccup — fall back.
            Log::info('Stylist chat Gemini failed: ' . $e->getMessage());

            return null;
        }
    }

    /**
     * The rule-based responder, routed by intent.
     *
     * This is the guaranteed path: it always returns a useful, HONEST sentence
     * built from real data. It reads the question (via $intent) so it is not one
     * canned reply for every message.
     */
    private function deterministicReply(
        string $intent,
        string $message,
        mixed $chest,
        mixed $waist,
        mixed $hips,
        ?string $size,
        array $garments,
        bool $hasImage,
        array $products,
    ): string {
        $lines = [];

        $sizeSentence = null;
        if ($chest && $waist) {
            // Note the spaces: ', hips 95cm' — the earlier version emitted
            // 'Hips95cm' because the label ran straight into the value.
            $sizeSentence = sprintf(
                'Based on your measurements (chest %scm, waist %scm%s), your recommended size is **%s**.',
                $chest,
                $waist,
                $hips !== null && $hips !== '' ? ', hips ' . $hips . 'cm' : '',
                $size,
            );
        }

        switch ($intent) {
            case 'greeting':
                $lines[] = 'Hello! I am your Hiraya AI Stylist. Ask me about your size, how to style your stack, or what to wear for an occasion.';
                if ($sizeSentence) {
                    $lines[] = $sizeSentence;
                }
                break;

            case 'size':
                $lines[] = $sizeSentence
                    ?? 'Add your chest and waist measurements and I will give you an exact size.';
                if ($size && ! empty($products)) {
                    $lines[] = 'I found ' . count($products) . ' piece(s) in the catalog available in size ' . $size . '.';
                } elseif ($size) {
                    /*
                     * Honest dead end. The size chart gave an answer but no
                     * garment in the store carries that label right now (each
                     * garment only stocks the sizes its admin enabled). Saying
                     * "0 pieces found" used to read like a bug; this states the
                     * real reason and points at the next useful step.
                     */
                    $lines[] = 'No piece in the catalog is currently stocked in size ' . $size
                        . '. Sizes differ per garment, so try another piece from your bag or ask me to style what you have.';
                }
                break;

            case 'occasion':
                $occasion = $this->detectOccasion($message);
                $lines[] = $occasion
                    ? 'For a ' . $occasion . ' look, build the stack around one statement piece and keep the rest neutral.'
                    : 'Tell me the occasion and I will suggest how to build the stack for it.';
                $lines[] = $this->picksSentence($products, $size);
                break;

            case 'color':
                $lines[] = ! empty($garments)
                    ? 'Your stack has ' . count($garments) . ' piece(s): ' . implode(', ', $garments) . '. Keep one as the focal colour and ground the rest in neutral tones for a balanced palette.'
                    : 'Select a few pieces and I will advise on the colour palette.';
                break;

            case 'style':
                $lines[] = ! empty($garments)
                    ? 'For your current stack (' . implode(', ', $garments) . '), anchor the silhouette with the outermost layer and keep the fit through the waist clean.'
                    : 'Here is where I would start a look for you.';
                $lines[] = $this->picksSentence($products, $size);
                break;

            default:
                if (! preg_match('/hiraya|wear|outfit|style|size|fit|shirt|dress|pants|top|bottom|garment|clothes|damit|look|season|rain|summer|color|colour|fabric|shoe|jacket|barong|order/i', $message)) {
                    // Outside the stylist's scope: say so instead of improvising.
                    $lines[] = 'I can only help with HIRAYA styling — our pieces, sizing, fit and outfit combinations, and seasonal looks. Try asking what to pair with a piece, or which size to pick.';
                    break;
                }
                $lines[] = $sizeSentence
                    ?? 'Add your chest and waist measurements so I can recommend an exact size.';
                $lines[] = ! empty($garments)
                    ? 'I can see ' . count($garments) . ' piece(s) in your stack: ' . implode(', ', $garments) . '.'
                    : 'Select a few garments from your bag to build a complete look.';
        }

        if ($hasImage) {
            $lines[] = 'Your virtual fitting render is ready — check how the drape falls at the waist.';
        }

        // Stylist pairings for the pieces being worn ("Complete the Look").
        $paired = array_values(array_filter($products, fn ($p) => ! empty($p['pairs_with_your_stack'])));
        if ($paired) {
            $lines[] = 'Our stylists paired ' . implode(' and ', array_map(fn ($p) => $p['name'], array_slice($paired, 0, 2)))
                . ' with what you are wearing — tap a card below to view it.';
        }

        return implode("\n\n", array_filter($lines));
    }

    /**
     * One honest sentence about the catalog pieces attached to a styling reply:
     * name them when there are some, and say plainly when there are none for
     * this customer (their gender's pieces in their size) instead of
     * recommending something they did not ask for.
     *
     * @param  array<int, array<string, mixed>>  $products
     */
    private function picksSentence(array $products, ?string $size): string
    {
        if (! empty($products)) {
            $names = array_map(fn ($p) => '**' . $p['name'] . '**', array_slice($products, 0, 3));

            return 'From the Hiraya collection, start with ' . implode(', ', $names) . ' — tap a card below for details and stock.';
        }

        return 'I don\'t have a matching piece in your collection'
            . ($size ? ' in size ' . $size : '')
            . ' right now. New pieces are added regularly, so check the shop again soon.';
    }

    /**
     * Pull a plain occasion label out of the message, or null.
     */
    private function detectOccasion(string $message): ?string
    {
        $m = Str::lower($message);

        foreach (['wedding', 'party', 'work', 'office', 'date', 'casual', 'formal', 'church', 'beach', 'event'] as $occasion) {
            if ($this->containsWord($m, [$occasion])) {
                return $occasion;
            }
        }

        return null;
    }

    /**
     * Does the (lower-cased) text contain any of these words or phrases as WHOLE
     * words? Letters/digits on either side mean it is part of a longer word, so
     * "fit" is not found in "outfit" and "date" is not found in "update".
     *
     * @param  array<int, string>  $words
     */
    private function containsWord(string $text, array $words): bool
    {
        foreach ($words as $word) {
            $pattern = '/(?<![\p{L}\p{N}])' . preg_quote($word, '/') . '(?![\p{L}\p{N}])/u';
            if (preg_match($pattern, $text) === 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * Context-aware quick-reply chips for the UI.
     *
     * Only offers a chip when it can actually do something: a size chip is
     * withheld until measurements exist, and the style chip until a stack does.
     *
     * @return array<int, string>
     */
    private function suggestionsFor(string $intent, ?string $size, bool $hasStack): array
    {
        $chips = [];

        if ($size) {
            $chips[] = 'What is my size?';
        } else {
            $chips[] = 'How do I add my measurements?';
        }

        if ($hasStack) {
            $chips[] = 'Style this outfit';
        } else {
            $chips[] = 'What should I wear to a party?';
        }

        $chips[] = 'What colors suit me?';

        if ($size) {
            $chips[] = 'Show pieces in size ' . $size;
        }

        // Never echo the same chip back as the thing just asked.
        return array_values(array_unique(array_slice($chips, 0, 4)));
    }

    /**
     * Normalise a product's `sizes` column into a clean list of UPPERCASE labels.
     *
     * Handles BOTH shapes that exist in this database:
     *
     *   1. the intended LIST  -> ['XS','S','M']            (Admin console)
     *   2. the legacy MAP     -> ['XS' => 234]             (old SuperAdmin console)
     *
     * and also tolerates object rows -> [['size_label' => 'M', 'stock' => 5]].
     * A map yields its KEYS: iterating it as a plain array would hand back the
     * QUANTITIES (234), which match no size at all.
     *
     * @param  mixed  $raw
     * @return array<int, string>
     */
    private function normaliseSizeLabels($raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }

        if (! is_array($raw)) {
            return [];
        }

        $listLike = array_is_list($raw);
        $labels = [];

        foreach ($raw as $key => $value) {
            if (is_array($value)) {
                $label = $value['size_label'] ?? $value['size'] ?? ($listLike ? null : $key);
            } elseif ($listLike) {
                $label = $value;
            } else {
                // MAP shape: the size is the KEY, the value is the quantity.
                $label = $key;
            }

            if (is_scalar($label) && (string) $label !== '') {
                $labels[] = Str::upper(trim((string) $label));
            }
        }

        return array_values(array_unique($labels));
    }

    /**
     * Catalog pieces available in a given size label.
     *
     * `sizes` is a JSON array column; `size_stocks` a JSON map. A product
     * matches when the size label is present in `sizes` (or when `sizes` is
     * empty, in which case the product is treated as size-agnostic). In-stock
     * items are preferred but out-of-stock matches are still returned so the
     * customer can see what exists.
     *
     * LEGACY MAP SHAPE: rows written by the older SuperAdmin console stored the
     * stock MAP in `sizes` ({"XS":234}) instead of a label list. A map iterated
     * as a plain array yields its VALUES (234), so those products could never
     * match a size. Taking the KEYS when we see a map keeps every existing row
     * matchable while the data is repaired.
     *
     * Returns a small, UI-ready payload; never throws (an unreachable catalog
     * degrades to an empty list, not a failed chat).
     *
     * @return array<int, array<string, mixed>>
     */
    /**
     * CHAT RECOMMENDATIONS — catalogue pieces that answer what was ASKED.
     *
     * `catalogForSize` alone returned "the newest four in your size" whatever
     * the shopper typed, so "barong for a wedding" and "something casual" got
     * the same cards. This scores each product on the words in the message
     * (name, description, category, occasion / vibe, colours), keeps it to the
     * shopper's gender (Unisex always fits), and prefers pieces stocked in
     * their size. With no useful words it falls back to the size match.
     *
     * @return array<int, array<string, mixed>>
     */
    private function catalogForChat(string $message, ?string $size, ?string $gender, int $limit = 4, array $pairedIds = []): array
    {
        $synonyms = [
            'wedding' => ['formal', 'barong', 'gown', 'cultural', 'suit'],
            'kasal' => ['formal', 'barong', 'gown', 'cultural'],
            'office' => ['business', 'blazer', 'slacks', 'polo'],
            'work' => ['business', 'blazer', 'slacks', 'polo'],
            'trabaho' => ['business', 'polo', 'slacks'],
            'beach' => ['summer', 'shorts', 'linen'],
            'party' => ['formal', 'cocktail', 'streetwear'],
            'casual' => ['everyday', 'shirt', 'tee', 'jeans'],
            'filipino' => ['barong', 'filipiniana', 'cultural'],
            'traditional' => ['barong', 'filipiniana', 'cultural'],
        ];

        $words = array_values(array_filter(
            preg_split('/[^a-z0-9]+/', Str::lower($message)) ?: [],
            fn ($w) => strlen($w) >= 3 && ! in_array($w, ['the', 'and', 'for', 'what', 'can', 'you', 'show', 'recommend', 'something', 'with', 'size', 'mga', 'ano', 'para', 'ang', 'ko', 'please'], true)
        ));
        foreach ($words as $w) {
            foreach ($synonyms[$w] ?? [] as $extra) {
                $words[] = $extra;
            }
        }
        $words = array_unique($words);

        $wantGender = match (Str::lower((string) $gender)) {
            'male' => 'men',
            'female' => 'women',
            default => null,
        };

        try {
            $catalog = Product::query()->latest('id')->limit(80)->get();
        } catch (\Throwable $e) {
            Log::info('Stylist catalog lookup failed: ' . $e->getMessage());

            return [];
        }

        $scored = [];
        foreach ($catalog as $product) {
            $productGender = Str::lower((string) $product->gender);
            if ($wantGender && $productGender !== '' && $productGender !== 'unisex' && $productGender !== $wantGender) {
                continue;
            }

            $tags = is_array($product->ai_tags) ? $product->ai_tags : [];
            $haystack = Str::lower(implode(' ', array_filter([
                $product->name,
                $product->description,
                str_replace('_', ' ', (string) $product->category),
                $product->background_occasion,
                implode(' ', (array) ($tags['occasions'] ?? [])),
                implode(' ', (array) ($product->colors ?? [])),
            ])));

            $hits = 0;
            foreach ($words as $w) {
                if (str_contains($haystack, $w)) {
                    $hits++;
                }
            }

            $sizes = $this->normaliseSizeLabels($product->sizes);
            $fitsSize = $size && in_array(Str::upper($size), $sizes, true);

            // A stylist pairing of a piece in the customer's stack always qualifies
            // and ranks first.
            $paired = in_array((int) $product->id, $pairedIds, true);
            $scored[] = [
                'product' => $product,
                'hits' => $hits + ($paired ? 1 : 0),
                'paired' => $paired,
                'score' => $hits * 3 + ($fitsSize ? 2 : 0) + ((int) $product->stock > 0 ? 1 : 0) + ($paired ? 10 : 0),
                'sizes' => $sizes,
            ];
        }

        // Nothing in the message matched anything: answer with the size match
        // (still for the customer's gender — this fallback used to ignore it).
        if (! collect($scored)->contains(fn ($row) => $row['hits'] > 0)) {
            return $this->catalogForSize($size, $limit, $gender);
        }

        usort($scored, fn ($a, $b) => $b['score'] <=> $a['score']);

        $out = [];
        foreach ($scored as $row) {
            if ($row['hits'] === 0) {
                continue;
            }
            $product = $row['product'];
            $out[] = [
                'id' => $product->id,
                'name' => $product->name,
                'category' => $product->category,
                'price' => (float) $product->price,
                'image_url' => $product->display_image_url ?: $product->image_url,
                'in_stock' => (int) ($product->stock ?? 0) > 0,
                'sizes' => $row['sizes'],
                'stock_in_this_size' => $size ? $this->stockForSize($product, Str::upper($size)) : null,
                'url' => '/product/' . $product->id,
                // True when a stylist paired it with a piece in the customer's stack.
                'pairs_with_your_stack' => $row['paired'],
            ];
            if (count($out) >= $limit) {
                break;
            }
        }

        return $out;
    }

    private function catalogForSize(?string $size, int $limit = 4, ?string $gender = null): array
    {
        if (! $size) {
            return [];
        }

        // Same gender rule as catalogForChat(): Unisex and untagged pieces
        // always qualify; a piece cut for the other gender does not.
        $wantGender = match (Str::lower((string) $gender)) {
            'male' => 'men',
            'female' => 'women',
            default => null,
        };

        try {
            $products = Product::query()
                ->whereNotNull('sizes')
                ->latest('id')
                ->limit(60)
                ->get();
        } catch (\Throwable $e) {
            Log::info('Stylist catalog lookup failed: ' . $e->getMessage());

            return [];
        }

        $needle = Str::upper($size);
        $matches = [];

        foreach ($products as $product) {
            $productGender = Str::lower((string) $product->gender);
            if ($wantGender && $productGender !== '' && $productGender !== 'unisex' && $productGender !== $wantGender) {
                continue;
            }

            $sizes = $this->normaliseSizeLabels($product->sizes);

            if (! empty($sizes) && ! in_array($needle, $sizes, true)) {
                continue;
            }

            $matches[] = [
                'id' => $product->id,
                'name' => $product->name,
                'category' => $product->category,
                'price' => (float) $product->price,
                'image_url' => $product->display_image_url ?: $product->image_url,
                'in_stock' => (int) ($product->stock ?? 0) > 0,
                /*
                 * Per-size facts, live. The customer's next question after
                 * "what size am I?" is almost always "may stock ba sa XS?", so
                 * the exact per-size count rides along instead of being guessed.
                 */
                'sizes' => $sizes,
                'stock_in_this_size' => $this->stockForSize($product, $needle),
                /*
                 * A deep link to the answer. When the reply needs detail it
                 * cannot state confidently (the full size guide, a live stock
                 * list), the model points here instead of reciting numbers that
                 * would be stale by tomorrow.
                 */
                'url' => '/product/' . $product->id,
            ];

            if (count($matches) >= $limit) {
                break;
            }
        }

        return $matches;
    }

    /**
     * Distinct size labels that currently exist anywhere in the catalog.
     *
     * Read straight from `sizes` (the list column). Used to ground the stylist
     * when a customer asks whether the store carries a specific size — answers
     * come from real rows instead of the model's imagination.
     *
     * Never throws: an unreadable catalog degrades to an empty list.
     *
     * @return array<int, string>
     */
    private function sizesPresentInCatalog(): array
    {
        try {
            $rows = Product::query()->whereNotNull('sizes')->pluck('sizes');
        } catch (\Throwable $e) {
            Log::info('Stylist size lookup failed: ' . $e->getMessage());

            return [];
        }

        $found = [];

        /*
         * Routed through normaliseSizeLabels so a LEGACY MAP row yields its
         * KEYS (the size labels) rather than its quantities. Iterating the raw
         * column here reported the stock numbers — 12, 234, 110 — as if they
         * were sizes, which then got fed to the model as "sizes the store
         * carries".
         */
        foreach ($rows as $row) {
            foreach ($this->normaliseSizeLabels($row) as $label) {
                $found[$label] = true;
            }
        }

        return array_keys($found);
    }

    /**
     * How many units of `$size` a product currently holds, or null when that
     * cannot be stated.
     *
     * Prefers the per-size map (`size_stocks`), which is what checkout actually
     * decrements. Falls back to the aggregate `stock` ONLY when the product
     * carries a single size — otherwise the aggregate would be attributed to
     * every size and read as stock that does not exist.
     *
     * Returns null (not 0) when unknown, so the stylist can say "check the
     * product page" rather than falsely claim a piece is sold out.
     */
    private function stockForSize(Product $product, string $sizeLabel): ?int
    {
        $stocks = $this->decodeJsonArray($product->size_stocks);

        foreach ($stocks as $label => $qty) {
            if (Str::upper(trim((string) $label)) === $sizeLabel) {
                return max(0, (int) $qty);
            }
        }

        $sizes = $this->normaliseSizeLabels($product->sizes);

        if (count($sizes) === 1) {
            return max(0, (int) ($product->stock ?? 0));
        }

        return null;
    }

    /**
     * Live detail for the garments the customer actually put in the stack.
     *
     * Matched by NAME because that is all the Studio sends in
     * `context.selected_garments`. This is what lets the stylist answer
     * "may stock pa ba ito?" about the piece on screen — the previous context
     * only described OTHER products (the ones already in the recommended size).
     *
     * @param  array<int, string>  $names
     * @return array<int, array<string, mixed>>
     */
    private function stackGarmentDetails(array $names): array
    {
        if (empty($names)) {
            return [];
        }

        try {
            $rows = Product::query()
                ->with('pairedProducts')
                ->whereIn('name', $names)
                ->get(['id', 'name', 'category', 'price', 'sizes', 'size_stocks', 'stock']);
        } catch (\Throwable $e) {
            Log::info('Stylist stack lookup failed: ' . $e->getMessage());

            return [];
        }

        return $rows->map(function (Product $p) {
            $sizes = $this->normaliseSizeLabels($p->sizes);

            return [
                'name' => $p->name,
                'category' => $p->category,
                'sizes' => $sizes,
                'stock_total' => (int) ($p->stock ?? 0),
                'in_stock' => (int) ($p->stock ?? 0) > 0,
                'url' => '/product/' . $p->id,
                // Pieces an admin paired with this one ("Complete the Look").
                'stylist_pairs' => $p->pairedProducts->map(fn ($pair) => [
                    'name' => $pair->name,
                    'category' => $pair->category,
                    'price' => (float) $pair->price,
                    'in_stock' => (int) $pair->stock > 0,
                    'url' => '/product/' . $pair->id,
                ])->values()->all(),
            ];
        })->all();
    }

    /** Ids of every product paired with a garment (by name) in the style stack. */
    private function pairedIdsForStack(array $names): array
    {
        if (empty($names)) {
            return [];
        }
        try {
            return Product::query()
                ->with('pairedProducts')
                ->whereIn('name', $names)
                ->get(['id'])
                ->flatMap(fn (Product $p) => $p->pairedProducts->pluck('id'))
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * Total products in the catalog, so the stylist can speak about the store
     * as a whole without inventing a number. Never throws.
     */
    private function catalogCount(): int
    {
        try {
            return (int) Product::query()->count();
        } catch (\Throwable $e) {
            Log::info('Stylist catalog count failed: ' . $e->getMessage());

            return 0;
        }
    }

    /**
     * Decode a JSON column that may arrive as a string or an array.
     *
     * @return array<mixed>
     */
    private function decodeJsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);

            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    /**
     * Map the 5-core chest/waist measurements (cm) onto a Hiraya size label.
     *
     * DELEGATES to SizeChart — the single source of truth. The thresholds used
     * to be duplicated here (and in three other PHP files plus the frontend),
     * which is how the Size Suggester and the render could disagree.
     *
     * The hips value is passed through so a pear-shaped customer is not pushed
     * into a top that is too narrow through the hip — hips can only bump the
     * size UP, never down.
     *
     * Falls back to 'M' only when there is no measurement to work from at all,
     * which is the same neutral default the rest of the try-on flow assumes.
     */
    private function recommendSize(float $chest, float $waist, ?float $hips = null): string
    {
        return SizeChart::recommend($chest, $waist, $hips) ?? 'M';
    }
}