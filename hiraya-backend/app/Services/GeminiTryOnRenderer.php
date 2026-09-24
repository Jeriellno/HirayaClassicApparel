<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Support\LocalAsset;

/*
 * TryOnPreProcessor lives in this same namespace, so no `use` is required. It
 * is resolved through the container in render() so a test or a future caller
 * can swap in a different planner without touching this class.
 */

/**
 * GeminiTryOnRenderer — produces a REAL virtual try-on image using Google's
 * multimodal Gemini model.
 *
 * WHY GEMINI
 * ----------
 * The previous pipeline targeted `yisol/IDM-VTON` on Hugging Face. Two hard
 * blockers made that unusable on this deployment:
 *
 *   1. `api-inference.huggingface.co` no longer resolves (deprecated host), and
 *   2. IDM-VTON is not served by HF's free serverless tier — it needs a PAID
 *      dedicated Inference Endpoint. Even with a valid token you get 403.
 *
 * Gemini's `generateContent` accepts an image AND returns an image, and the
 * project already holds a working `GEMINI_API_KEY`. That makes it the only
 * provider that actually produces an AI fitting here without extra spend.
 *
 * HOW IT WORKS
 * ------------
 * The portrait and every selected garment are sent as inline image parts with a
 * tightly-scoped instruction to re-dress the person in those garments while
 * preserving their identity, pose and lighting. The model returns an inline
 * image part, which we convert to a data URI.
 *
 * FITTING ACCURACY
 * ----------------
 * A prompt alone cannot express "the right size" — the model needs OBSERVABLE
 * geometry to obey. This renderer therefore takes an optional `renderPlan`
 * produced by TryOnPreProcessor, which converts the user's body measurements
 * into frame-relative scale ratios, vertical pose anchors and a lighting brief.
 * Those numbers are compiled into the prompt as explicit, checkable rules, which
 * is what makes the garment land on the subject at the correct size and posture
 * instead of appearing as an undersized flat overlay.
 */
class GeminiTryOnRenderer
{
    /** Generation can be slow; give it a generous but finite window. */
    private const TIMEOUT_SECONDS = 120;

    /**
     * Upper bound on garments composited in ONE request.
     *
     * Raised from 4 to 6 so a complete look (top + bottom + dress + outerwear +
     * inner + footwear) can composite as a single outfit. The prompt stays
     * focused by naming each image and its target body region explicitly.
     */
    private const MAX_GARMENTS = 6;

    /**
     * Render a try-on image.
     *
     * @param  string  $userPhoto  Data URI (or raw base64) of the customer portrait.
     * @param  array<int, string>  $garments  Data URIs of the selected garments.
     * @param  array<string, mixed>  $measurements  5-core body measurements (cm).
     * @param  string|null  $recommendedSize  Size label to bake into the prompt.
     * @param  array<int, string|null>  $categories  Style Stack category per garment,
     *                                                INDEX-ALIGNED with $garments.
     *                                                Optional; when absent the
     *                                                layer is inferred from the plan.
     * @return array{success: bool, image_base64?: string, feedback?: string, error?: string}
     */
    public function render(
        string $userPhoto,
        array $garments,
        array $measurements = [],
        ?string $recommendedSize = null,
        ?array $renderPlan = null,
        array $categories = []
    ): array {
        $apiKey = config('services.gemini.key');

        if (empty($apiKey)) {
            return ['success' => false, 'error' => 'Gemini API key is not configured.'];
        }

        $personPart = $this->imagePart($userPhoto);
        if (!$personPart) {
            return [
                'success' => false,
                'error' => 'The customer portrait is not a usable image.',
                'code' => 'bad_portrait',
            ];
        }

        $garmentParts = [];
        foreach (array_slice($garments, 0, self::MAX_GARMENTS) as $garment) {
            $part = $this->imagePart($garment);
            if ($part) {
                $garmentParts[] = $part;
            }
        }

        if (empty($garmentParts)) {
            return [
                'success' => false,
                'error' => 'No usable garment image was provided.',
                'code' => 'bad_garment',
            ];
        }

        /*
         * Content order matters: the person FIRST, then each garment, then the
         * instruction. Naming the images lets the prompt refer to them precisely.
         *
         * Each garment is labelled with the BODY REGION it belongs to. This image
         * label is the strongest placement signal the model receives — stronger
         * than any later sentence — so it must never be generic. Telling it
         * "IMAGE 3 = a garment" for a pair of shoes is exactly how a look ends up
         * with trousers worn as a shirt.
         */
        $layerLabels = $this->garmentLabels($garmentParts, $renderPlan, $categories);

        $parts = [['text' => 'IMAGE 1 = the person.']];
        $parts[] = $personPart;

        foreach ($garmentParts as $index => $part) {
            $parts[] = ['text' => 'IMAGE ' . ($index + 2) . ' = ' . ($layerLabels[$index + 1] ?? 'a garment') . '.'];
            $parts[] = $part;
        }

        /*
         * Build the geometry plan if the caller did not supply one. Doing it
         * here keeps the renderer usable standalone (and keeps every existing
         * caller working) while the controller/job path passes in a plan that
         * was computed once and persisted with the session.
         */
        $renderPlan = $renderPlan ?? app(TryOnPreProcessor::class)->buildRenderPlan(
            $measurements,
            $garments,
            $userPhoto
        );

        $parts[] = ['text' => $this->buildPrompt($garmentParts, $measurements, $recommendedSize, $renderPlan, $layerLabels)];

        /*
         * WALK THE MODEL CHAIN.
         *
         * A hard-coded model ID is a single point of failure here: the image
         * models are preview/moving targets, so one 404 used to fail every
         * render until someone edited the file. Each candidate is tried in turn
         * and the first that actually returns an IMAGE wins; the model that did
         * is reported back so an operator can see which one to pin.
         */
        $models = $this->candidateModels();
        $attempted = [];
        $lastFailure = null;

        foreach ($models as $model) {
            $result = $this->renderWithModel($apiKey, $model, $parts, $attempted);

            if ($result['success']) {
                $result['model'] = $model;
                return $result;
            }

            /*
             * A REFUSAL IS NOT A MODEL PROBLEM.
             *
             * The model answered with prose instead of an image (Google's
             * content filters set `finishReason` to SAFETY / IMAGE_SAFETY).
             * Trying the next model would produce the same refusal, and it would
             * also hide the real reason from the customer — so the chain stops
             * and the refusal is reported verbatim.
             */
            if (($result['code'] ?? null) === 'renderer_no_image') {
                return $result;
            }

            $lastFailure = $result;

            // Only a missing/unsupported model justifies moving to the next ID.
            if (! in_array($result['code'] ?? null, ['model_unavailable', 'model_no_image'], true)) {
                break;
            }
        }

        if ($lastFailure) {
            $lastFailure['attempted_models'] = $attempted;

            return $lastFailure;
        }

        return [
            'success' => false,
            'error' => 'No Gemini image-generation model is available for this API key.',
            'code' => 'model_unavailable',
            'attempted_models' => $attempted,
        ];
    }

    /**
     * The image models to try, in order.
     *
     * `image_model` (a single explicit choice) always leads, then the configured
     * `image_models` chain. Duplicates are dropped so an operator who sets the
     * same ID in both keys does not pay for the attempt twice.
     *
     * @return array<int, string>
     */
    private function candidateModels(): array
    {
        $models = array_merge(
            [(string) config('services.gemini.image_model', 'gemini-2.5-flash-image')],
            (array) config('services.gemini.image_models', [])
        );

        return array_values(array_unique(array_filter(array_map('trim', $models))));
    }

    /**
     * One render attempt against ONE model.
     *
     * @param  array<int, array<string, mixed>>  $parts  Gemini content parts.
     * @param  array<int, string>  $attempted  Accumulator of the model IDs tried.
     * @return array{success: bool, image_base64?: string, feedback?: string, error?: string, code?: string, model?: string}
     */
    private function renderWithModel(string $apiKey, string $model, array $parts, array &$attempted): array
    {
        $attempted[] = $model;

        $endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
            . $model . ':generateContent?key=' . urlencode($apiKey);

        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->acceptJson()
                ->post($endpoint, [
                    'contents' => [['role' => 'user', 'parts' => $parts]],
                    'generationConfig' => [
                        /*
                         * The model must return an IMAGE. `responseModalities`
                         * with IMAGE lets the multimodal model emit picture
                         * bytes instead of only prose.
                         */
                        'responseModalities' => ['IMAGE'],
                        'temperature' => 0.4,
                    ],
                ]);
        } catch (\Throwable $e) {
            // DNS/socket/timeout failures must return a clean error, never a 500.
            Log::warning('Gemini try-on connection failed: ' . $e->getMessage());

            return [
                'success' => false,
                'error' => 'Could not reach the Gemini rendering service.',
                'code' => 'renderer_unreachable',
            ];
        }

        if ($response->failed()) {
            $upstream = (string) data_get($response->json(), 'error.message', 'Unknown Gemini error');
            $status = $response->status();

            Log::warning('Gemini try-on render failed', [
                'status' => $status,
                'model' => $model,
                'error' => $upstream,
            ]);

            /*
             * 404 means THIS model ID is not served to this key, which is the
             * documented signal to move on to the next candidate. 400 does too:
             * the endpoint rejects a model that does not accept the requested
             * response modality, which is exactly the `gemini-2.5-flash` case
             * ("image generation: Not supported").
             */
            $code = match (true) {
                $status === 404 => 'model_unavailable',
                $status === 400 => 'model_no_image',
                default => 'renderer_http_' . $status,
            };

            $message = match (true) {
                $status === 404 => "The Gemini image model '{$model}' is not available for this API key.",
                $status === 400 => "The model '{$model}' does not support image output (image generation is a separate capability from the text models).",
                in_array($status, [401, 403], true) => 'The Gemini API key is invalid or lacks image permissions.',
                $status === 429 => 'The Gemini image-generation quota was reached (429). This is a quota limit, not a billing error — retry shortly or lower the request rate.',
                default => 'The AI renderer could not produce a fitting. ' . $upstream,
            };

            return [
                'success' => false,
                'error' => $message,
                'code' => $code,
            ];
        }

        $imageData = $this->extractImage($response->json());

        if (!$imageData) {
            // The model answered with text only (e.g. it refused). Surface the
            // text so the customer learns WHY instead of seeing a blank canvas.
            $text = $this->extractText($response->json());
            Log::warning('Gemini returned no image part', [
                'model' => $model,
                'text' => $text,
            ]);

            return [
                'success' => false,
                'error' => $text
                    ? 'The AI renderer declined this request: ' . mb_substr($text, 0, 200)
                    : 'The AI renderer returned no image.',
                'code' => 'renderer_no_image',
            ];
        }

        return [
            'success' => true,
            'image_base64' => $imageData,
            'feedback' => "Generated via {$model} multimodal rendering",
        ];
    }

    /**
     * The instruction sent alongside the images.
     *
     * It is deliberately explicit about IDENTITY PRESERVATION because an
     * unconstrained edit drifts the customer's face/body, which looks broken
     * rather than stylish.
     */
    private function buildPrompt(
        array $garmentParts,
        array $measurements,
        ?string $recommendedSize,
        array $renderPlan,
        array $layerLabels = []
    ): string {
        $garmentCount = count($garmentParts);

        // `$pieces` already carries its article, so the prompt must not add
        // another one — "dress them in the garments" was the giveaway.
        $pieces = $garmentCount === 1 ? 'the garment' : 'the garments';

        $prompt = "You are a professional virtual fitting-room compositor. ";
        $prompt .= "Take IMAGE 1 (the person) and dress them in {$pieces} shown in the following images. ";
        $prompt .= "Return ONE photorealistic image of that same person actually wearing the clothing.\n\n";

        /*
         * ORDER OF INSTRUCTION MATTERS.
         *
         * The failure modes this pipeline fixes — floating placement, wrong
         * scale, flat perspective, pasted-on lighting and garments landing on
         * the wrong body part — are each addressed by a dedicated, explicit
         * section below. Vague wording like "fit it realistically" was the
         * original problem: it gives the model nothing to obey. Every
         * instruction here names an OBSERVABLE outcome, and the geometry the
         * model is asked to honour is stated as numbers it can check itself
         * against rather than as adjectives.
         */
        $prompt .= "=== STEP 1. BODY ANALYSIS & RECONSTRUCTION ===\n";
        $prompt .= "Read the person's pose, posture and camera angle from IMAGE 1, then:";
        $prompt .= $this->bodySection($renderPlan, $measurements);

        // --- FIX 2: PROPORTIONAL SCALING -------------------------------------
        $prompt .= "\n=== STEP 2. GARMENT TRANSFER, WARPING & ALIGNMENT ===\n";
        $prompt .= $this->scalingSection($renderPlan, $measurements, $recommendedSize);

        // --- FIX 1: POSE & POSTURE WARPING ------------------------------------
        $prompt .= '- ' . ($renderPlan['pose']['pose_directive'] ?? '') . "\n";
        $prompt .= $this->poseSection($renderPlan);

        // --- FIX 4: LAYERING ------------------------------------------------
        $prompt .= "\n=== STEP 3. LAYERING & COMPOSITING ===\n";
        $prompt .= $this->layerSection($renderPlan, $layerLabels);
        $prompt .= '- ' . ($renderPlan['composite']['composite_directive'] ?? '') . "\n";
        if (!empty($renderPlan['composite']['left_bare_directive'])) {
            $prompt .= '- ' . $renderPlan['composite']['left_bare_directive'] . "\n";
        }
        $prompt .= "- The garment must read as WORN fabric with weight: it responds to the body underneath and is never a flat rectangular overlay.\n";

        // --- FIX 3: LIGHTING, TEXTURE & SHADOWS ------------------------------
        $prompt .= "\n=== STEP 4. LIGHTING, TEXTURE & SHADOWS ===\n";
        $prompt .= '- ' . ($renderPlan['lighting']['lighting_directive'] ?? '') . "\n";
        $prompt .= "- Rebuild the fabric's own texture and material at this scale: weave, knit, sheen, drape stiffness and any twist, knot or gathered detail must survive the transfer ON THE GARMENT'S OWN PANELS, not as a printed picture of the garment.\n";
        $prompt .= "- Give any structural detail (a bust twist, a pleat, a belt) its own cast shadow so it reads as having depth rather than being painted flat.\n";

        $prompt .= "\n=== STEP 5. DO NOT CHANGE ===\n";
        $prompt .= "- PRESERVE the person's face, hairstyle, skin tone, pose position and framing EXACTLY. Do not beautify, slim, reshape or re-imagine their identity.\n";
        $prompt .= "- Preserve the original background and camera perspective. Do not re-frame, crop or zoom.\n";
        $prompt .= "- If part of the body is outside the frame, the garment must be cut off at the same boundary.\n";

        /*
         * STEP 6 — THE ANTI-ERROR CHECK.
         *
         * Each line names a failure that was actually observed in a produced
         * render, phrased as something to VERIFY rather than as a prohibition,
         * because a model that has already drawn the image is more reliable at
         * checking a stated outcome than at obeying a negative instruction.
         */
        $prompt .= "\n=== STEP 6. VERIFY BEFORE RETURNING ===\n";
        $prompt .= "- Every garment is on the CORRECT body region, and nothing is placed on the wrong part of the body (never a top on the legs, never shoes on the torso).\n";
        $prompt .= "- The head, hands and feet are still inside the frame and are NOT cropped out.\n";
        $prompt .= "- The garment is fully WORN: no part of the body shows through the fabric where it should be covered, and no fabric floats detached from the body.\n";
        $prompt .= "- The scale is correct for this person's body: the garment is not undersized, and it is not stretched to fill the frame.\n";
        $prompt .= "- The result is a photograph of a person wearing clothes, NOT a picture of the garment pasted onto a body like a sticker.\n";
        $prompt .= "- No flat-lay or product-shot background, watermark or packaging from the garment images remains anywhere in the output.";

        return $prompt;
    }

    /**
     * STEP 1 — the body brief.
     *
     * States the measurements as the ground truth for the silhouette and asks
     * for the volume to match them, while keeping the subject's own anatomy.
     * Deliberately framed as "read the pose, then apply these numbers" so the
     * model does not treat the supplied measurements as a reason to invent a
     * different person.
     */
    private function bodySection(array $renderPlan, array $measurements): string
    {
        $body = $renderPlan['body'] ?? [];
        $out = '';

        $hints = [];
        foreach ([
            'chest_cm' => 'chest/bust',
            'waist_cm' => 'waist',
            'hips_cm' => 'hips',
            'shoulder_width_cm' => 'shoulder width',
        ] as $key => $label) {
            if (!empty($body[$key])) {
                $hints[] = $label . chr(32) . $body[$key] . "cm";
            }
        }

        if (!empty($measurements['sleeve_length'])) {
            $hints[] = 'sleeve length ' . $measurements['sleeve_length'] . 'cm';
        }

        if ($hints) {
            $out .= "\n- The subject's body measurements are " . implode(', ', $hints)
                . ". Treat these as ground truth for the body's volume and curvature.\n";
        }

        $out .= "\n- Keep the subject's own bone structure, height and pose; adjust only the volume and curvature of the bust, waist and hips so they read as the measurements above.\n";

        if (empty($body['has_real_measurements'])) {
            // No real numbers were supplied, so the prompt must not claim any.
            $out .= "\n- No reliable measurements were supplied for this session, so DO NOT reshape the body: use the subject's visible silhouette in IMAGE 1 as the only source of truth.\n";
        }

        if (!empty($body['derived_fields'])) {
            $out .= "\n- These were estimated rather than measured and are therefore weak:"
                . implode(', ', $body['derived_fields'])
                . " Where they disagree with the subject's visible silhouette in IMAGE 1, the silhouette wins.\n";
        }

        $out .= "\n- The subject may be any body type. That is the point: render THEIR shape, at THEIR size, and never substitute a thinner, taller or otherwise idealised body.\n";

        return $out;
    }

    /**
     * Section 2 — the size instruction.
     *
     * Translates the pre-processor's ratios into language the model acts on.
     * Ratios alone are abstract, so each one is restated as a physical check
     * ("the shoulders must line up with the shoulders").
     */
    private function scalingSection(array $renderPlan, array $measurements, ?string $recommendedSize): string
    {
        $scaling = $renderPlan['scaling'] ?? [];
        $body = $renderPlan['body'] ?? [];
        $out = '';

        $out .= '- ' . ($scaling['scale_directive'] ?? 'Match the garment to the subject\'s own proportions.') . "\n";

        if (!empty($scaling['shoulder_span_ratio'])) {
            $out .= sprintf(
                "- The garment's shoulder seams MUST land on the subject's shoulders, spanning about %.1f%% of their full height. Do not shrink the garment to fit inside the frame — it must sit ON the body at full size.\n",
                $scaling['shoulder_span_ratio'] * 100
            );
        }

        if (!empty($scaling['chest_width_ratio'])) {
            $out .= sprintf(
                "- The torso panel must cover the chest fully, reaching approximately %.1f%% of body height in width, with the side seams on the sides of the body and not across the front.\n",
                $scaling['chest_width_ratio'] * 100
            );
        }

        if (!empty($scaling['waist_width_ratio'])) {
            $out .= sprintf(
                "- At the waist the garment should follow the waistline at roughly %.1f%% of body height in width; where the body narrows, let the fabric take up the slack in folds instead of collapsing the garment.\n",
                $scaling['waist_width_ratio'] * 100
            );
        }

        $hints = [];
        if (!empty($body['chest_cm'])) {
            $hints[] = 'chest ' . $body['chest_cm'] . 'cm';
        }
        if (!empty($body['waist_cm'])) {
            $hints[] = 'waist ' . $body['waist_cm'] . 'cm';
        }
        if (!empty($body['hips_cm'])) {
            $hints[] = 'hips ' . $body['hips_cm'] . 'cm';
        }
        if (!empty($body['shoulder_width_cm'])) {
            $hints[] = 'shoulder width ' . $body['shoulder_width_cm'] . 'cm';
        }

        if ($hints) {
            $out .= '- These are the subject\'s real body measurements: ' . implode(', ', $hints)
                . ". Treat them as ground truth for how wide the garment must be.\n";
        }

        if (!empty($body['derived_fields'])) {
            $out .= '- The following were estimated rather than supplied, so prefer the subject\'s visible silhouette in IMAGE 1 where the two disagree: '
                . implode(', ', $body['derived_fields']) . ".\n";
        }

        if ($recommendedSize) {
            $out .= "- Render the garment at catalogue size {$recommendedSize}.\n";
        }

        return $out;
    }

    /**
     * Section 3 — the geometry/pose anchors.
     */
    private function poseSection(array $renderPlan): string
    {
        $pose = $renderPlan['pose'] ?? [];
        $out = '';

        if (isset($pose['shoulder_line'], $pose['waist_line'])) {
            $out .= sprintf(
                "- Anchor the garment vertically: the shoulder seam sits at about %.0f%% of the figure's height from the top of the head, the waistline at %.0f%%, and the hem falls below the hip line (%.0f%%).\n",
                $pose['shoulder_line'] * 100,
                $pose['waist_line'] * 100,
                $pose['hip_line'] * 100
            );
        }

        if (!empty($pose['torso_length_cm'])) {
            $out .= '- The subject\'s shoulder-to-hip torso length is approximately '
                . $pose['torso_length_cm'] . "cm; scale the garment's torso panel to that length so the hem does not ride up or sag.\n";
        }

        $out .= "- Match the subject's shoulder slope. Most people's shoulders are not level — rotate the garment to the same tilt instead of keeping it horizontal.\n";
        $out .= "- Follow every arm: bend the sleeve fabric around the upper arm, elbow and forearm, and if an arm is crossed, raised or behind the body, wrap or occlude the sleeve accordingly.\n";

        return $out;
    }

    /**
     * Section 5 — how multiple pieces stack and overlap.
     */
    private function layerSection(array $renderPlan, array $layerLabels = []): string
    {
        $layers = $renderPlan['layers'] ?? [];

        if (count($layers) <= 1) {
            return "- This is a single garment; there is no layering to resolve.\n";
        }

        $out = "- Layer the pieces in this exact order, innermost first, so overlaps are correct:\n";

        // Sort by render_order so the instructions read top-to-bottom logically.
        usort($layers, static fn ($a, $b) => ($a['render_order'] ?? 0) <=> ($b['render_order'] ?? 0));

        foreach ($layers as $layer) {
            $out .= sprintf(
                "    • IMAGE %d → %s, covering the %s.\n",
                $layer['index'],
                $layerLabels[$layer['index']] ?? ('worn as the ' . $layer['layer']),
                $layer['region']
            );
        }

        $out .= "- Each outer layer must visibly occlude the one beneath it at the collar, cuffs and hem.\n";

        return $out;
    }

    /**
     * The label given to each garment image, keyed by 1-based image number
     * (IMAGE 1 is always the person, so indexing starts at 2).
     *
     * Both sources are index-aligned: the Stack `$categories` are the customer's
     * own selection, while `renderPlan['layers']` carries the region the geometry
     * was computed for. A category the plan does not recognise is still
     * reported, because it came from the Studio's own vocabulary.
     *
     * @param  array<int, array<string, mixed>>  $garmentParts
     * @param  array<int, string|null>           $categories
     * @return array<int, string>
     */
    private function garmentLabels(array $garmentParts, ?array $renderPlan, array $categories): array
    {
        $labels = [];

        foreach ($garmentParts as $index => $part) {
            $imageNumber = $index + 2;
            $category = $categories[$index] ?? null;
            $layer = $renderPlan['layers'][$index]['layer'] ?? null;

            $labels[$imageNumber] = $this->labelFor($category, $layer);
        }

        return $labels;
    }

    /**
     * Turn a Stack category / plan layer into a placement instruction the model
     * can act on.
     *
     * Deliberately spelled out per region and in words, because the label sits
     * next to the image and is read as "what this picture IS".
     */
    private function labelFor(?string $category, ?string $layer): string
    {
        $name = strtolower(trim((string) ($category ?: $layer)));

        return match ($name) {
            'top' => 'a garment to be worn on the UPPER body (torso, shoulders and arms)',
            'inner' => 'a garment to be worn on the UPPER body as the innermost layer',
            'outerwear', 'jacket', 'coat', 'blazer' => 'a garment to be worn on the UPPER body as an OUTER layer, over everything else',
            'bottom', 'pants', 'trousers', 'skirt', 'jeans' => 'a garment to be worn on the LOWER body (hips, legs, waistband at the natural waist)',
            'dress', 'gown' => 'a DRESS — a single continuous garment to be worn on the FULL body, from the shoulders to the hem, replacing any top and bottom',
            'footwear', 'shoes', 'shoes/feet' => 'a pair of SHOES to be worn on the FEET at the bottom of the frame (never on the torso or legs)',
            default => 'a garment to put on the person',
        };
    }

    /**
     * Convert a data URI / raw base64 blob into a Gemini inlineData part.
     *
     * @return array<string, mixed>|null
     */
    private function imagePart(?string $image): ?array
    {
        if (!is_string($image) || trim($image) === '') {
            return null;
        }

        $mime = 'image/png';
        $data = $image;

        if (str_starts_with($image, 'data:')) {
            // data:image/jpeg;base64,XXXX
            if (!preg_match('#^data:([^;]+);base64,(.+)$#s', $image, $m)) {
                return null;
            }
            $mime = $m[1];
            $data = $m[2];
        } elseif (preg_match('#^https?://#i', $image)) {
            /*
             * A remote URL is NOT acceptable as inlineData, so it must be turned
             * into Base64 bytes. `LocalAsset` reads a `/storage/...` asset
             * STRAIGHT OFF THE LOCAL DISK first and only goes over HTTP for a
             * genuinely remote url — an `Http::get()` of our OWN `127.0.0.1` url
             * blocks against the single-threaded `php artisan serve` process
             * (measured `cURL error 28`) and dropped the garment entirely.
             */
            $resolved = LocalAsset::toDataUri($image);
            if ($resolved === null || ! preg_match('#^data:([^;]+);base64,(.+)$#s', $resolved, $m)) {
                return null;
            }

            $mime = $m[1];
            $data = $m[2];
        }

        // Gemini accepts png/jpeg/webp. Anything else is coerced to png defensively.
        if (!in_array($mime, ['image/png', 'image/jpeg', 'image/webp'], true)) {
            $mime = 'image/png';
        }

        if (base64_decode($data, true) === false) {
            return null;
        }

        return ['inlineData' => ['mimeType' => $mime, 'data' => $data]];
    }

    /**
     * Pull the first inline image out of a generateContent response.
     */
    private function extractImage(array $payload): ?string
    {
        $parts = data_get($payload, 'candidates.0.content.parts', []);

        if (!is_array($parts)) {
            return null;
        }

        foreach ($parts as $part) {
            $inline = $part['inlineData'] ?? $part['inline_data'] ?? null;

            if (is_array($inline) && !empty($inline['data'])) {
                $mime = $inline['mimeType'] ?? $inline['mime_type'] ?? 'image/png';
                return 'data:' . $mime . ';base64,' . $inline['data'];
            }
        }

        return null;
    }

    /**
     * Concatenate any text parts — used to explain a text-only refusal.
     */
    private function extractText(array $payload): ?string
    {
        $parts = data_get($payload, 'candidates.0.content.parts', []);

        if (!is_array($parts)) {
            return null;
        }

        $text = '';
        foreach ($parts as $part) {
            if (!empty($part['text'])) {
                $text .= $part['text'] . ' ';
            }
        }

        return trim($text) ?: null;
    }
}
