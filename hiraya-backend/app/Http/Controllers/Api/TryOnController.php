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

    /**
     * Initiate a new virtual try-on session.
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function initiateTryOn(Request $request): JsonResponse
    {
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
             * marketing card the client fell back to (see `ghostMatteForProduct`).
             */
            'garments.*.product_id' => 'nullable|integer',
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
        [$garmentPhotos, $garmentCategories] = $this->normaliseGarmentPhotos($submittedGarments);
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
        }

        if (empty($garmentPhotos)) {
            return response()->json([
                'message' => 'At least one garment image is required.',
                'errors' => ['garments' => ['Add a garment to My Bag or select one from your Style Stack.']],
            ], 422);
        }

        // Resolve the body metrics the renderer reads. These come from the
        // customer's SIZE profile via the size chart — see bodyMetricsFor().
        $measurements = $this->bodyMetricsFor($user);

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

        // Create session record
        $session = TryOnSession::create([
            'session_id' => $sessionId,
            'user_id' => $user->id,
            'user_photo_base64' => $userPhoto,
            'garment_photos_json' => $garmentPhotos,
            'garment_categories_json' => $garmentCategories ?: null,
            'garment_metadata_json' => $garmentMetadata ?: null,
            'history_title' => $historyTitle ?: null,
            'measurements_json' => $measurements,
            'render_plan_json' => $renderPlan,
            'status' => TryOnSession::STATUS_QUEUED,
            'is_favorite' => false,
        ]);

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
        if (config('queue.default') !== 'sync') {
            try {
                \Illuminate\Support\Facades\Artisan::call('tryon:ensure-worker', [
                    '--quiet-if-running' => true,
                ]);
            } catch (\Throwable $e) {
                Log::warning('Could not ensure a try-on worker is running: ' . $e->getMessage());
            }
        }

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
            && ! empty($session->result_image_base64);

        $payload = [
            'session_id' => $sessionId,
            'id' => $sessionId,
            'status' => $session->status ?: 'queued',
            'progress' => $completedInline ? 100 : 10,
            'garment_count' => count($garmentPhotos),
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
                    : 'Virtual try-on session initiated. Processing started.'),
        ];

        if ($completedInline) {
            $payload['result_image_base64'] = $session->result_image_base64;
            $payload['result_image'] = $session->result_image_base64;
            $payload['ai_feedback'] = $session->ai_feedback;
            $payload['recommended_size'] = $this->extractRecommendedSize($session);

            return response()->json($payload, 200);
        }

        // Inline render that produced nothing usable: report the failure now
        // rather than making the client poll a session that is already failed.
        if ($isSync && $session->status === TryOnSession::STATUS_FAILED) {
            $payload['progress'] = 0;
            $payload['message'] = $session->error_message;
            $payload['ai_feedback'] = $session->ai_feedback ?? $session->error_message;

            return response()->json($payload, 200);
        }

        return response()->json($payload, 202);
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
     * @param  array<int, mixed>  $garments
     * @return array{0: array<int, string>, 1: array<int, string|null>}
     */
     private function normaliseGarmentPhotos(array $garments): array
    {
        $images = [];
        $categories = [];

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
            if (is_array($garment) && isset($garment['product_id'])) {
                $upgraded = $this->ghostMatteForProduct($garment['product_id']);
                if ($upgraded !== '') {
                    $image = $upgraded;
                }
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
        }

        return [$images, $categories];
    }

    /**
     * Resolve a product's prepared ghost-mannequin matte as a Base64 data URI.
     *
     * Returns an empty string when the product has no matte, was not found, or the
     * asset cannot be read, so the caller keeps whatever image it already had.
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
     * @param  mixed  $productId
     */
    private function ghostMatteForProduct($productId): string
    {
        if (!is_numeric($productId)) {
            return '';
        }

        try {
            $product = \App\Models\Product::find((int) $productId);
            if (!$product) {
                return '';
            }

            $ghost = trim((string) $product->ghost_mannequin_url);
            if ($ghost === '') {
                return '';
            }

            /*
             * A real matte must be transparent; a URL that merely EXISTS proves
             * nothing. Guard against an opaque stand-in so a product whose "matte"
             * is actually a composed card is not blindly preferred over the
             * client's own (possibly segmented) image. The byte-level alpha probe
             * lives in the Job/Renderer path, so here we only require that the asset
             * resolves — `toBase64DataUri` already returns '' on any failure.
             */
            return $this->toBase64DataUri($ghost);
        } catch (\Throwable $e) {
            Log::warning('TryOn ghost-matte upgrade skipped: ' . $e->getMessage());

            return '';
        }
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
        } elseif ($session->status === TryOnSession::STATUS_COMPLETED) {
            $response['progress'] = 100;
            $response['result_image_base64'] = $session->result_image_base64;
            // `result_image` kept as an alias so clients reading either key
            // keep rendering instead of showing an empty canvas.
            $response['result_image'] = $session->result_image_base64;
            $response['ai_feedback'] = $session->ai_feedback;
            $response['recommended_size'] = $this->extractRecommendedSize($session);
        } elseif ($session->status === TryOnSession::STATUS_FAILED) {
            $response['progress'] = 0;
            $response['ai_feedback'] = $session->ai_feedback ?? $session->error_message;
            $response['message'] = $session->error_message;
        }

        return response()->json($response);
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
            ->whereNotNull('result_image_base64')
            ->select(['id', 'session_id', 'is_favorite', 'history_title', 'garment_metadata_json', 'result_image_base64', 'created_at']);

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
                'thumbnail' => $this->historyThumbnail($session->result_image_base64),
                'created_at' => optional($session->created_at)->toIso8601String(),
            ];
        }));

        return response()->json($sessions);
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
            ->select(['id', 'session_id', 'is_favorite', 'history_title', 'garment_metadata_json', 'result_image_base64', 'user_photo_base64', 'created_at'])
            ->firstOrFail();

        $garments = $this->historyGarments($session);

        return response()->json([
            'session_id' => $session->session_id,
            'title' => $this->historyTitle($session, $garments),
            'is_favorite' => (bool) $session->is_favorite,
            'result_image_base64' => $session->result_image_base64,
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
    private function historyGarments(TryOnSession $session): array
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

    private function historyTitle(TryOnSession $session, array $garments): string
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
    private function historyThumbnail(?string $source): ?string
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
        $validated = $request->validate([
            'message' => 'required|string|max:1000',
            'context' => 'nullable|array',
            'context.measurements' => 'nullable|array',
            'context.selected_garments' => 'nullable|array',
            'context.has_generated_image' => 'nullable|boolean',
        ]);

        $message = trim($validated['message']);
        $measurements = $validated['context']['measurements'] ?? [];
        $garments = array_values(array_filter($validated['context']['selected_garments'] ?? []));
        $hasImage = ! empty($validated['context']['has_generated_image']);

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
        $products = $this->catalogForSize($size);

        $intent = $this->detectIntent($message);

        $gemini = $this->geminiReply(
            $message,
            $intent,
            $measurements,
            $garments,
            $hasImage,
            $size,
            $products,
        );

        $reply = $gemini ?? $this->deterministicReply(
            $intent,
            $message,
            $chest,
            $waist,
            $hips,
            $size,
            $garments,
            $hasImage,
            $products,
        );

        return response()->json([
            'reply' => $reply,
            'source' => $gemini !== null ? 'gemini' : 'rules',
            'intent' => $intent,
            // Quick-reply chips, context-aware (see suggestionsFor()).
            'suggestions' => $this->suggestionsFor($intent, $size, ! empty($garments)),
            // Catalog pieces in the recommended size, for clickable cards.
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
            'links' => $this->linksFor($intent, $size, $products),
        ]);
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

        $has = function (array $words) use ($m): bool {
            foreach ($words as $w) {
                if (str_contains($m, $w)) {
                    return true;
                }
            }

            return false;
        };

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
            . "- Answer the customer's message directly, warmly, in 2-4 short sentences.\n"
            . "- Plain text only. No markdown headings, no bullet lists.\n\n"
            . $this->hirayaKnowledge() . "\n\n"
            . 'CONTEXT (JSON): ' . json_encode($context, JSON_UNESCAPED_SLASHES) . "\n\n"
            . 'CUSTOMER MESSAGE: ' . $message;

        try {
            $response = Http::timeout(20)
                ->connectTimeout(8)
                ->acceptJson()
                ->post(
                    'https://generativelanguage.googleapis.com/v1beta/models/'
                        . rawurlencode($model) . ':generateContent?key=' . rawurlencode($apiKey),
                    [
                        'contents' => [[
                            'parts' => [['text' => $prompt]],
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
                if ($sizeSentence) {
                    $lines[] = $sizeSentence;
                }
                break;

            case 'color':
                $lines[] = ! empty($garments)
                    ? 'Your stack has ' . count($garments) . ' piece(s): ' . implode(', ', $garments) . '. Keep one as the focal colour and ground the rest in neutral tones for a balanced palette.'
                    : 'Select a few pieces and I will advise on the colour palette.';
                break;

            case 'style':
                $lines[] = ! empty($garments)
                    ? 'For your current stack (' . implode(', ', $garments) . '), anchor the silhouette with the outermost layer and keep the fit through the waist clean.'
                    : 'Add pieces from your bag to your stack and I will style a complete look.';
                if ($sizeSentence) {
                    $lines[] = $sizeSentence;
                }
                break;

            default:
                $lines[] = $sizeSentence
                    ?? 'Add your chest and waist measurements so I can recommend an exact size.';
                $lines[] = ! empty($garments)
                    ? 'I can see ' . count($garments) . ' piece(s) in your stack: ' . implode(', ', $garments) . '.'
                    : 'Select a few garments from your bag to build a complete look.';
        }

        if ($hasImage) {
            $lines[] = 'Your virtual fitting render is ready — check how the drape falls at the waist.';
        }

        return implode("\n\n", array_filter($lines));
    }

    /**
     * Pull a plain occasion label out of the message, or null.
     */
    private function detectOccasion(string $message): ?string
    {
        $m = Str::lower($message);

        foreach (['wedding', 'party', 'work', 'office', 'date', 'casual', 'formal', 'church', 'beach', 'event'] as $occasion) {
            if (str_contains($m, $occasion)) {
                return $occasion;
            }
        }

        return null;
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
    private function catalogForSize(?string $size, int $limit = 4): array
    {
        if (! $size) {
            return [];
        }

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
            ];
        })->all();
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