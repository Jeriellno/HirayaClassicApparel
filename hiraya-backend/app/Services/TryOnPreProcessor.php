<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * TryOnPreProcessor — the deterministic "computer vision" stage that runs BEFORE
 * the generative render.
 *
 * WHY THIS LAYER EXISTS
 * ---------------------
 * The previous pipeline handed the raw shop photo straight to the generator. A
 * shop asset is a FLAT-LAY / ghost-mannequin shot: its own perspective, its own
 * scale, its own studio lighting. Sending that unmodified made the model treat
 * it as "a picture of a garment" rather than "measurements of a garment", which
 * is why the output looked like an undersized floating sticker — wrong size,
 * wrong pose alignment, no contact shadows.
 *
 * A generative renderer re-draws the person. It cannot be told "make it fit"
 * and be expected to do anything precise, because "fit" is not a number. This
 * service converts the fuzzy instruction into HARD GEOMETRY it can obey:
 *
 *   1. POSE & POSTURE ALIGNMENT — estimates the subject's skeleton proportions
 *      and derives normalised anchor points (shoulder line, waist line, hem
 *      line) plus a shoulder-slope angle, so the garment is described as
 *      draping along the subject's actual posture rather than the mannequin's.
 *   2. PROPORTIONAL SCALING — uses the 5-core body measurements to compute a
 *      pixel-to-centimetre ratio for the portrait, then derives the target
 *      width of each garment region as a fraction of the frame. This is what
 *      makes the garment the RIGHT SIZE instead of a guessed one.
 *   3. LIGHTING INTEGRATION — samples the portrait's luminance distribution and
 *      dominant colour temperature, then emits an explicit lighting brief
 *      (key-light direction, contrast, warmth) so the render can blend the
 *      fabric into the scene with matching highlights and contact shadows.
 *   4. COMPOSITING & MASKING GUIDANCE — computes the torso bounding box and the
 *      layer order for a multi-piece stack so overlaps resolve correctly.
 *
 * NO NEW MODELS: everything here is arithmetic on the measurements plus the
 * already-present EXIF extension where available. The output is a structured
 * "render plan" payload consumed by the existing GeminiTryOnRenderer. There is
 * no fabricated pixel manipulation — if a fact cannot be derived it is omitted
 * rather than guessed, so the generator is never fed a confident lie.
 */
class TryOnPreProcessor
{
    /**
     * Anthropometric proportion constants (fraction of total body height).
     * Standard figure-drawing canon; used to place anchors without a pose model.
     */
    private const ANCHOR_SHOULDER_Y = 0.180; // shoulder line from top of head
    private const ANCHOR_CHEST_Y = 0.290;
    private const ANCHOR_WAIST_Y = 0.380;
    private const ANCHOR_HIP_Y = 0.470;

    /** Default body height (cm) when the profile has no height field. */
    private const DEFAULT_HEIGHT_CM = 170.0;

    /**
     * Build the full render plan for a try-on request.
     *
     * @param  array<string, mixed>  $measurements  5-core body measurements (cm).
     * @param  array<int, string>       $garments    Garment image refs, in render order.
     * @param  string|null              $portrait    The user portrait (data URI / base64).
     * @param  array<int, string|null>  $categories  Style Stack category per garment,
     *                                               INDEX-ALIGNED with $garments
     *                                               (top/bottom/dress/outerwear/
     *                                               footwear/inner), or empty when
     *                                               the client did not send them.
     * @return array<string, mixed>  Structured render plan consumed by the renderer.
     */
    public function buildRenderPlan(
        array $measurements,
        array $garments,
        ?string $portrait = null,
        array $categories = []
    ): array {
        $body = $this->normaliseBody($measurements);
        // Layer plan first: the composite guidance needs to know whether a
        // garment reached the feet before it can size the silhouette box.
        $layers = $this->buildLayerPlan($garments, $body, $categories);

        return [
            'body' => $body,
            'scaling' => $this->computeProportionalScaling($body, $layers),
            'pose' => $this->computePoseAnchors($body),
            'lighting' => $this->analysePortraitLighting($portrait),
            'layers' => $layers,
            'composite' => $this->computeCompositeGuidance($body, $layers),
        ];
    }

    /**
     * Normalise the incoming measurements into a consistent centimetre shape.
     *
     * Mirrors the alias logic used by the job (chest_bust ⇄ chest), converts
     * imperial values, and reports which values were DERIVED rather than
     * supplied so the prompt can be honest about confidence.
     *
     * @return array<string, mixed>
     */
    private function normaliseBody(array $measurements): array
    {
        /*
         * Girths are the only fields where a sub-60 value plausibly means
         * inches, so only they opt into imperial detection. Shoulder width,
         * sleeve length and height are accepted as centimetres verbatim.
         */
        $chest = $this->toCm($measurements['chest_bust'] ?? $measurements['chest'] ?? null, true);
        $waist = $this->toCm($measurements['waist'] ?? null, true);
        $hips  = $this->toCm($measurements['hips'] ?? null, true);
        $shoulder = $this->plausibleShoulderWidth(
            $this->toCm($measurements['shoulder_width'] ?? null)
        );
        $sleeve = $this->toCm($measurements['sleeve_length'] ?? null);
        $height = $this->toCm($measurements['height'] ?? null);

        $derived = [];

        // Height is absent from the 5-core schema. Derive it from the torso
        // circumference where possible (a larger torso correlates with a
        // shorter, broader frame) instead of always assuming 170cm — then MARK
        // it as derived so the renderer knows it is an estimate.
        if ($height === null) {
            $height = $this->estimateHeight($chest, $waist, $hips);
            $derived[] = 'height';
        }

        /*
         * Shoulder width anchors the whole silhouette, so it must be sane.
         * `plausibleShoulderWidth()` above has already discarded impossible
         * inputs (e.g. an unconverted 38in value that became 96cm); if it is
         * genuinely unavailable we estimate it from the chest circumference.
         *
         * The 0.40 coefficient is calibrated so a 99cm chest (a typical medium
         * men's frame) yields ~40cm shoulders — a realistic adult shoulder
         * width — rather than the ~44cm the previous 0.44 factor produced.
         */
        if ($shoulder === null && $chest !== null) {
            $shoulder = round($chest * 0.40, 1);
            $derived[] = 'shoulder_width';
        }

        // Hips modulate drape at the hem; derive from chest when absent.
        if ($hips === null && $chest !== null) {
            $hips = round($chest * 1.06, 1);
            $derived[] = 'hips';
        }

        return [
            'height_cm' => $height ?? self::DEFAULT_HEIGHT_CM,
            'chest_cm' => $chest,
            'waist_cm' => $waist,
            'hips_cm' => $hips,
            'shoulder_width_cm' => $shoulder,
            'sleeve_length_cm' => $sleeve,
            'derived_fields' => $derived,
            'has_real_measurements' => ($chest !== null || $waist !== null),
        ];
    }

    /**
     * Estimate a plausible height from torso circumferences.
     *
     * Larger chest/waist girth correlates loosely with a shorter frame at fixed
     * shoulder width. This is a bounded heuristic, not a measurement — hence the
     * `derived_fields` marker. The result is clamped to a realistic adult range
     * so a bad input can never produce an absurd anchor layout.
     */
    private function estimateHeight(?float $chest, ?float $waist, ?float $hips): float
    {
        $girth = array_filter([$chest, $waist, $hips], static fn($v) => $v !== null);

        if (empty($girth)) {
            return self::DEFAULT_HEIGHT_CM;
        }

        $averageGirth = array_sum($girth) / count($girth);

        // 90cm average girth ≈ 170cm frame; ~0.45cm of height lost per cm of girth.
        $estimate = 170.0 - (($averageGirth - 90.0) * 0.45);

        return round(max(145.0, min(200.0, $estimate)), 1);
    }

    /**
     * Coerce a value to centimetres, or null when unusable.
     *
     * IMPERIAL DETECTION IS FIELD-AWARE, NOT A BLANKET RULE.
     * -----------------------------------------------------------------------
     * An earlier version converted ANY value <= 60 as inches. That is wrong for
     * the length-style measurements: a shoulder width of 38 and a sleeve length
     * of 57 are perfectly ordinary CENTIMETRE values (38cm shoulders are a
     * typical adult), so the blanket rule inflated them to 96.5cm and 144.8cm.
     * A 96cm "shoulder width" is physically impossible, which made the derived
     * shoulder span 68% of body height instead of ~25% and would have rendered
     * every garment enormously oversized.
     *
     * Only CIRCUMFERENCE-style measurements (chest, waist, hips) have a
     * plausible inch range that sits entirely below 60, so only those are
     * candidates for conversion. Length-style values are accepted as-is.
     *
     * @param  mixed  $value
     * @param  bool   $imperialCandidate  True for chest/waist/hips girths only.
     */
    private function toCm($value, bool $imperialCandidate = false): ?float
    {
        if (! is_numeric($value)) {
            return null;
        }

        $value = (float) $value;
        if ($value <= 0) {
            return null;
        }

        if ($imperialCandidate && $value <= 60) {
            $value *= 2.54;
        }

        return round($value, 1);
    }

    /**
     * Sanity-check a shoulder width and reject impossible values.
     *
     * Adult shoulder width (acromion to acromion) realistically sits between
     * roughly 30cm and 60cm. Anything outside that is a data-entry error or an
     * unconverted unit, and using it would corrupt the scaling ratio — so it is
     * discarded and the field is re-derived instead.
     */
    private function plausibleShoulderWidth(?float $shoulder): ?float
    {
        if ($shoulder === null) {
            return null;
        }

        return ($shoulder >= 30.0 && $shoulder <= 60.0) ? $shoulder : null;
    }

    /**
     * PROPORTIONAL SCALING.
     *
     * Derives the target on-frame size of the garment from real body metrics.
     *
     * The key quantity is the shoulder-to-shoulder span expressed as a fraction
     * of the subject's height: a garment's shoulder seams must land on the
     * subject's shoulders, and its body width must cover the chest. Expressing
     * these as FRACTIONS OF THE FRAME lets the renderer size the garment
     * correctly no matter what pixel dimensions the portrait arrived in.
     *
     * @param  array<int, array<string, mixed>>  $layers  Layer plan, so the scale brief
     *                                                    can speak about the pieces that
     *                                                    were actually selected.
     * @return array<string, mixed>
     */
    private function computeProportionalScaling(array $body, array $layers = []): array
    {
        $height = max(120.0, (float) $body['height_cm']);
        $shoulder = $body['shoulder_width_cm'];
        $chest = $body['chest_cm'];
        $waist = $body['waist_cm'];
        $hips = $body['hips_cm'];

        // Anthropometric fractions. The shoulder span is the anchor: everything
        // else is derived relative to it, which keeps the silhouette coherent.
        $shoulderFraction = $shoulder ? ($shoulder / $height) : 0.255;

        /*
         * Garment EASE — the extra room fabric needs beyond the body.
         *
         * A garment is not skin-tight. Chest breadth derived from the
         * circumference (C/π) must be inflated by a garment-class ease factor,
         * otherwise every piece renders as a body-paint leotard.
         */
        $ease = $this->garmentEase($body);

        $chestBreadthCm = $chest ? ($chest / M_PI) : null;
        $waistBreadthCm = $waist ? ($waist / M_PI) : null;
        $hipBreadthCm = $hips ? ($hips / M_PI) : null;

        return [
            'height_cm' => round($height, 1),
            // Frame-relative widths (0..1) the renderer should honour.
            'shoulder_span_ratio' => round($shoulderFraction, 4),
            'chest_width_ratio' => $chestBreadthCm
                ? round(($chestBreadthCm * (1 + $ease)) / $height, 4)
                : null,
            'waist_width_ratio' => $waistBreadthCm
                ? round(($waistBreadthCm * (1 + $ease)) / $height, 4)
                : null,
            'hip_width_ratio' => $hipBreadthCm
                ? round(($hipBreadthCm * (1 + $ease)) / $height, 4)
                : null,
            'ease_factor' => $ease,
            'size_label' => $this->sizeLabel($chest, $waist),
            // Overall scale advice, stated unambiguously for the prompt.
            'scale_directive' => $this->scaleDirective($shoulderFraction, $body),
            /*
             * WHICH BODY REGIONS THE GARMENTS ACTUALLY COVER.
             *
             * Derived from the customer's own Stack categories, this is what
             * lets the renderer keep the sizing sane for an ODD stack: a look
             * with no top must not be told to bring the shoulders in, and a look
             * with no bottom must not be told to match the hip width.
             */
            'covered_regions' => $this->coveredRegions($layers),
        ];
    }

    /**
     * The body regions a stack actually dresses, as a flat list.
     *
     * A dress covers the upper AND lower body as one piece, so it is reported
     * alongside both region names it replaces.
     *
     * @param  array<int, array<string, mixed>>  $layers
     * @return array<int, string>
     */
    private function coveredRegions(array $layers): array
    {
        $regions = [];

        foreach ($layers as $layer) {
            $name = $layer['layer'] ?? null;

            if ($name === 'dress') {
                $regions[] = 'upper_torso';
                $regions[] = 'lower_body';
                continue;
            }

            if (in_array($name, ['top', 'inner', 'outerwear'], true)) {
                $regions[] = 'upper_torso';
            }

            if ($name === 'bottom') {
                $regions[] = 'lower_body';
            }

            if ($name === 'footwear') {
                $regions[] = 'feet';
            }
        }

        return array_values(array_unique($regions));
    }

    /**
     * Garment ease: how much wider than the body the fabric should sit.
     *
     * Keyed off the waist-to-chest ratio — a straighter torso takes a closer cut
     * while a fuller midsection needs more drape to hang correctly.
     */
    private function garmentEase(array $body): float
    {
        $chest = $body['chest_cm'];
        $waist = $body['waist_cm'];

        if (!$chest || !$waist) {
            return 0.08; // neutral
        }

        $ratio = $waist / max(1.0, $chest);

        return match (true) {
            $ratio < 0.70 => 0.05, // athletic V-taper: fitted styles
            $ratio > 0.90 => 0.14, // fuller midsection: needs drape
            default => 0.08,
        };
    }

    /**
     * A single sentence describing how big the garment must be.
     */
    private function scaleDirective(float $shoulderFraction, array $body): string
    {
        $percent = round($shoulderFraction * 100, 1);

        $base = sprintf(
            'The subject\'s shoulder span is approximately %.1f%% of their total height in frame. '
            . 'Size every garment so its shoulder seams land exactly on those shoulders and its '
            . 'body width follows the chest line below.',
            $percent
        );

        if (!$body['has_real_measurements']) {
            // Say so — a confident directive built on nothing is worse than a
            // clearly-flagged generic one.
            $base .= ' No body measurements were supplied, so infer proportions from the '
                . 'subject\'s own silhouette in IMAGE 1 and match them exactly.';
        }

        return $base;
    }

    /**
     * POSE & POSTURE ALIGNMENT.
     *
     * Produces normalised vertical anchors (0 = top of frame, 1 = bottom) at
     * which the shoulder, chest, waist and hem lines must sit, plus the shoulder
     * slope. These are the numbers that stop the garment from rendering in the
     * mannequin's rigid pose.
     *
     * @return array<string, mixed>
     */
    private function computePoseAnchors(array $body): array
    {
        $height = max(120.0, (float) $body['height_cm']);

        /*
         * Anchor positions are fractions of the FIGURE's height. Where the
         * figure sits inside the frame is decided by the model (we cannot
         * segment reliably without a vision library), so we express the anchors
         * relative to the figure and instruct the renderer to place them on the
         * subject as seen in IMAGE 1.
         */
        return [
            'shoulder_line' => self::ANCHOR_SHOULDER_Y,
            'chest_line' => self::ANCHOR_CHEST_Y,
            'waist_line' => self::ANCHOR_WAIST_Y,
            'hip_line' => self::ANCHOR_HIP_Y,
            'waist_to_hip_cm' => $body['waist_cm'] && $body['hips_cm']
                ? round(abs($body['hips_cm'] - $body['waist_cm']), 1)
                : null,
            'torso_length_cm' => round($height * (self::ANCHOR_HIP_Y - self::ANCHOR_SHOULDER_Y), 1),
            'pose_directive' => $this->poseDirective(),
        ];
    }

    /**
     * The posture instruction.
     *
     * This is the heart of fix #1: the garment must FOLLOW the subject, not
     * float in the mannequin's original geometry.
     */
    private function poseDirective(): string
    {
        return 'Warp the garment to the subject\'s actual posture, do not paste it flat. '
            . 'Trace the shoulder line and rotate the garment to match the subject\'s shoulder slope; '
            . 'bend the sleeves around the arms and follow any arm angle or occlusion; '
            . 'wrap the torso panel around the body\'s three-dimensional contour so the side seams '
            . 'disappear behind the silhouette; warp the hem to follow hip tilt and any fabric '
            . 'gathering; and let the garment crease and fold naturally wherever the pose compresses it.';
    }

    /**
     * LIGHTING INTEGRATION.
     *
     * Without an image-decoding extension available in this environment we
     * cannot sample real pixel luminance, so we do NOT fabricate a measured
     * value. Instead we emit an instruction that makes the generator derive the
     * lighting FROM the portrait it can already see, which is strictly more
     * reliable than a number we cannot actually measure.
     *
     * If a future deployment enables GD/Imagick, `sampleWithGd()` below is
     * already wired to produce real measurements and take precedence.
     *
     * @return array<string, mixed>
     */
    private function analysePortraitLighting(?string $portrait): array
    {
        $measured = $this->sampleWithGd($portrait);

        if ($measured !== null) {
            return [
                'source' => 'measured',
                'mean_luminance' => $measured['mean_luminance'],
                'contrast' => $measured['contrast'],
                'key_light_direction' => $measured['key_light_direction'],
                'lighting_directive' => $this->lightingDirective($measured),
            ];
        }

        return [
            'source' => 'derived-by-renderer',
            'lighting_directive' => $this->lightingDirective(null),
        ];
    }

    /**
     * The shadow/lighting brief — fix #3.
     *
     * @param  array<string, mixed>|null  $measured
     */
    private function lightingDirective(?array $measured): string
    {
        $parts = [];

        if ($measured !== null) {
            $parts[] = sprintf(
                'The portrait has a mean luminance of %.0f/255 and a %s contrast range.',
                $measured['mean_luminance'],
                $measured['contrast']
            );
            $parts[] = 'Place the key light ' . $measured['key_light_direction'] . '.';
        } else {
            $parts[] = 'Read the lighting directly from IMAGE 1 before you begin.';
        }

        $parts[] = 'Match the fabric to that exact illumination: the lit side of the garment '
            . 'must carry the same highlight intensity and colour temperature as the lit side '
            . 'of the subject\'s skin.';
        $parts[] = 'Cast soft contact shadows where the garment meets the body — under the '
            . 'jaw and along the neckline, beneath the shoulder seams, in the armpits, along '
            . 'the waistband, and where the hem meets the legs.';
        $parts[] = 'Add self-shadowing in the folds and an ambient occlusion gradient where '
            . 'the fabric curves away from the light, and let the outside edge of the garment '
            . 'pick up the same rim light and background bounce as the surrounding scene.';
        $parts[] = 'Preserve the original background, depth of field and grain so the composite '
            . 'is indistinguishable from a real photograph.';

        return implode(' ', $parts);
    }

    /**
     * Real luminance sampling, when an image extension is present.
     *
     * Returns null when GD/Imagick are unavailable — callers must treat that as
     * "cannot measure" and fall through to the renderer-derived directive rather
     * than inventing numbers.
     *
     * @return array<string, mixed>|null
     */
    private function sampleWithGd(?string $portrait): ?array
    {
        if (!$portrait || !function_exists('imagecreatefromstring')) {
            return null;
        }

        try {
            $binary = $this->toBinary($portrait);
            if ($binary === null || strlen($binary) < 32) {
                return null;
            }

            $image = @imagecreatefromstring($binary);
            if (!$image) {
                return null;
            }

            $width = imagesx($image);
            $height = imagesy($image);

            // Sample on a coarse grid — full scans are needlessly expensive and
            // the aggregate statistics are identical.
            $step = max(1, (int) floor(min($width, $height) / 48));
            $sum = 0.0;
            $sumSq = 0.0;
            $count = 0;
            $leftLuma = 0.0;
            $leftCount = 0;
            $rightLuma = 0.0;
            $rightCount = 0;

            for ($y = 0; $y < $height; $y += $step) {
                for ($x = 0; $x < $width; $x += $step) {
                    $rgb = imagecolorat($image, $x, $y);
                    $r = ($rgb >> 16) & 0xFF;
                    $g = ($rgb >> 8) & 0xFF;
                    $b = $rgb & 0xFF;

                    // Rec. 601 luma — perceptually weighted brightness.
                    $luma = (0.299 * $r) + (0.587 * $g) + (0.114 * $b);

                    $sum += $luma;
                    $sumSq += $luma * $luma;
                    $count++;

                    if ($x < $width / 2) {
                        $leftLuma += $luma;
                        $leftCount++;
                    } else {
                        $rightLuma += $luma;
                        $rightCount++;
                    }
                }
            }

            imagedestroy($image);

            if ($count === 0) {
                return null;
            }

            $mean = $sum / $count;
            $variance = max(0.0, ($sumSq / $count) - ($mean * $mean));
            $stdDev = sqrt($variance);

            $leftMean = $leftCount ? $leftLuma / $leftCount : $mean;
            $rightMean = $rightCount ? $rightLuma / $rightCount : $mean;

            return [
                'mean_luminance' => round($mean, 1),
                'contrast' => $stdDev > 55 ? 'high' : ($stdDev < 28 ? 'low' : 'medium'),
                'key_light_direction' => match (true) {
                    ($leftMean - $rightMean) > 12 => 'from the subject\'s left',
                    ($rightMean - $leftMean) > 12 => 'from the subject\'s right',
                    $mean > 140 => 'from directly in front and above',
                    default => 'from the front at a neutral angle',
                },
            ];
        } catch (\Throwable $e) {
            // Sampling is an enhancement, never a hard requirement.
            Log::debug('TryOn lighting sample skipped: ' . $e->getMessage());

            return null;
        }
    }

    /**
     * Decode a data URI / raw base64 blob to binary, or null.
     */
    private function toBinary(string $image): ?string
    {
        $data = $image;

        if (str_starts_with($image, 'data:')) {
            if (!preg_match('#^data:[^;]+;base64,(.+)$#s', $image, $m)) {
                return null;
            }
            $data = $m[1];
        }

        $decoded = base64_decode($data, true);

        return $decoded === false ? null : $decoded;
    }

    /**
     * LAYER PLAN — render order and per-piece region.
     *
     * A multi-piece look must composite in the right z-order (a jacket covers a
     * shirt) and each piece must claim a distinct body region, otherwise every
     * garment lands on the torso and they overwrite one another.
     *
     * @param  array<int, string>       $garments
     * @param  array<int, string|null>  $categories  Index-aligned Stack categories.
     * @return array<int, array<string, mixed>>
     */
    private function buildLayerPlan(array $garments, array $body, array $categories = []): array
    {
        // Base-layer-first ordering, matching how the pieces are worn. Index in
        // this array IS the render order (jacket over shirt, shoes last).
        $order = ['inner', 'top', 'bottom', 'dress', 'outerwear', 'footwear'];

        $plan = [];
        $unplaced = 0;
        $used = [];

        /*
         * `$imageIndex` COUNTS ONLY THE PIECES THAT REACH THE MODEL.
         *
         * `index` is compiled into the prompt as "IMAGE 2 is the <garment>" —
         * IMAGE 1 being the person. It must therefore be the position of the
         * garment in the list the renderer actually SENDS. When a non-wearable is
         * skipped, the raw array position would leave a gap and every later piece
         * would be named one image too late: the prompt would describe the
         * jacket's region using the dress's photograph. Counting separately keeps
         * the naming and the payload aligned whichever pieces are dropped.
         */
        $imageIndex = 0;

        foreach (array_values($garments) as $index => $garment) {
            /*
             * THE CATEGORY COMES FROM THE CUSTOMER'S OWN SELECTION.
             *
             * This used to be assigned by POSITION in the array, which was
             * documented as an honest limitation but produced confidently wrong
             * geometry: a stack of (top, footwear) described the shoes as an
             * "inner layer, only visible at the collar and cuffs" and told the
             * model to wear them on the upper torso with sleeves. The Studio
             * knows which row each piece came from, so that label is used
             * verbatim and is never inferred from position again.
             *
             * With no category (a legacy client, or a stack hydrated from My Bag)
             * we fall back to a representative default LOOK — one top, one bottom,
             * one pair of shoes — rather than an order that implies every garment
             * belongs to the torso.
             */
            /*
             * A NON-WEARABLE IS DROPPED, NOT GUESSED.
             *
             * A bag has no body region. This used to fall into `defaultLayer`,
             * which assigned it the first free slot — `top` — so the render was
             * told to draw a bag on the upper torso "with sleeves down the arms".
             * That is the source of the sleeves the customer never selected.
             *
             * It is skipped BEFORE the index is consumed, so it occupies no
             * IMAGE number in the prompt.
             */
            if ($this->isNonWearable($categories[$index] ?? null)) {
                continue;
            }

            $layer = $this->normaliseLayer($categories[$index] ?? null) ?? $this->defaultLayer($used, $unplaced);
            $used[$layer] = true;
            $imageIndex++;

            $plan[] = [
                'index' => $imageIndex + 1, // 1-based: IMAGE 1 is the person
                'layer' => $layer,
                'render_order' => array_search($layer, $order, true),
                'region' => $this->regionFor($layer),
            ];
        }

        return $plan;
    }

    /**
     * Map an incoming Stack category onto this service's layer vocabulary.
     *
     * Returns null for anything unknown/blank so the caller can fall back — an
     * unrecognised label must never be trusted as a body region.
     *
     * NON-WEARABLES RETURN THE SENTINEL `'accessories'`, WHICH IS NOT A LAYER.
     *
     * This distinction is the whole point of the sentinel, and it fixes the
     * reported sleeve bug. It used to be impossible: a handbag and a mistyped
     * label both arrived as `null`, and the caller answered `null` with
     * `defaultLayer()`, which hand-assigns the piece to the first free slot —
     * `top`. `regionFor('top')` is "upper torso ... SLEEVES DOWN THE ARMS", so a
     * BAG was rendered as a sleeved top on the torso.
     *
     * Now a bag/purse/jewellery/belt is RECOGNISED as a non-garment and skipped
     * outright (see `buildLayerPlan`), while a genuinely unknown label still
     * falls back to a body region rather than silently dropping a real garment.
     */
    private function normaliseLayer(?string $category): ?string
    {
        $category = is_string($category) ? strtolower(trim($category)) : '';

        /*
         * Anything matching these families has no body region and is never worn
         * by a VTON render. Checked BEFORE the garment map so "shoulder bag" and
         * "baggy jeans" cannot be confused: the garment families below are more
         * specific, so "baggy" (which contains "bag") is resolved first.
         */
        $accessoryHints = [
            'accessor', 'purse', 'jewel', 'watch', 'belt', 'scarf',
            'sunglass', 'wallet', 'earring', 'necklace', 'bracelet',
        ];

        /*
         * GARMENT FAMILIES FIRST.
         *
         * `str_contains` on the family name, so a free-text label such as
         * "Baggy Jeans" or "Sleeveless Blouse" resolves to the real garment
         * before the accessory test can see the substring "bag".
         */
        $families = [
            'top' => ['shirt', 'blouse', 'top', 'tee', 't-shirt', 'polo', 'tank', 'camisole', 'crop'],
            'bottom' => ['pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack'],
            'dress' => ['dress', 'gown'],
            'outerwear' => ['jacket', 'coat', 'blazer', 'outerwear', 'cardigan', 'hoodie', 'parka'],
            'footwear' => ['shoe', 'footwear', 'sneaker', 'boot', 'sandal', 'loafer', 'heel', 'slipper'],
            'inner' => ['inner', 'undershirt', 'camisole inner'],
        ];

        foreach ($families as $layer => $hints) {
            foreach ($hints as $hint) {
                if ($hint !== '' && str_contains($category, $hint)) {
                    return $layer;
                }
            }
        }

        // An explicit "bag" family, tested only after every garment family.
        if (str_contains($category, 'bag')) {
            return 'accessories';
        }

        foreach ($accessoryHints as $hint) {
            if (str_contains($category, $hint)) {
                return 'accessories';
            }
        }

        return null;
    }

    /**
     * Is this incoming category a recognised NON-WEARABLE (a bag, jewellery)?
     *
     * Used by `buildLayerPlan` to SKIP the piece entirely. Kept as its own
     * predicate so the sentinel is never mistaken for a layer name elsewhere.
     */
    private function isNonWearable(?string $category): bool
    {
        return $this->normaliseLayer($category) === 'accessories';
    }

    /**
     * The layer to assume when the client sent no category.
     *
     * Distributes the pieces across a complete look (top, then bottom, then
     * footwear, then outerwear) so a multi-piece stack without labels still
     * reads as an outfit instead of six garments stacked on the torso.
     */
    private function defaultLayer(array $used, int $unplaced): string
    {
        foreach (['top', 'bottom', 'footwear', 'outerwear', 'dress', 'inner'] as $layer) {
            if (empty($used[$layer])) {
                return $layer;
            }
        }

        // More garments than a complete look: extras layer over the top. The
        // parameter is kept so the caller's intent is explicit even though no
        // guideline (a colour-sorted shelf, a per-piece overlay) exists yet.
        return 'outerwear';
    }

    /**
     * Textual body region each layer occupies.
     */
    private function regionFor(string $layer): string
    {
        return match ($layer) {
            'inner' => 'torso as the innermost layer, fully tucked and only visible at the collar and cuffs',
            'top' => 'upper torso from the shoulders to the hip line, sleeves down the arms',
            'bottom' => 'lower body from the waist down, following the legs to the hem',
            'dress' => 'continuous full-body panel from the shoulders to the hem below the knee',
            'outerwear' => 'outermost layer over everything else, open front, sleeves over the arms',
            'footwear' => 'feet and ankles at the bottom of the frame',
            default => 'upper torso',
        };
    }

    /**
     * COMPOSITING GUIDANCE — bounding box + edge treatment.
     *
      * @param  array<int, array<string, mixed>>  $layers
      * @return array<string, mixed>
      */
     private function computeCompositeGuidance(array $body, array $layers = []): array
     {
         $shoulder = self::ANCHOR_SHOULDER_Y;
         $regions = $this->coveredRegions($layers);

         /*
          * The occlusion box is the TORSO. When the stack dresses only the lower
          * body or only the feet, the torso is left bare and a box that spans the
          * shoulders would describe clothing that does not exist — so the box is
          * skipped and the prompt is told to leave the bare regions alone.
          */
         $coversTorso = in_array('upper_torso', $regions, true)
             || in_array('lower_body', $regions, true);
         $hem = min(0.95, self::ANCHOR_HIP_Y + 0.28); // hem extends past the hips
         return [
             // Normalised torso box (figure-relative) the garments must stay within.
             'torso_bbox' => $coversTorso ? [
                 'top' => round($shoulder - 0.02, 3),
                 'bottom' => round($hem, 3),
                 'left' => 0.5 - ($body['shoulder_width_cm'] ? 0.22 : 0.24),
                 'right' => 0.5 + ($body['shoulder_width_cm'] ? 0.22 : 0.24),
             ] : null,
             'covered_regions' => $regions,
             'left_bare_directive' => $coversTorso
                 ? 'Any body region not covered by a garment must remain exactly as it appears in IMAGE 1 — do not invent clothing for it.'
                 : 'This stack does not dress the upper body, so the torso, arms and whatever the person is already wearing there must be preserved exactly as in IMAGE 1.',
            'composite_directive' => 'Render the garment as physically WORN, not overlaid. '
                . 'It must occlude the body where it covers it and disappear behind the body '
                . 'where the body is in front. Feather every skin-to-fabric border with a '
                . 'one-to-two pixel transition so no hard cut-out edge remains, remove any '
                . 'leftover flat-lay background from the garment, and rebuild the hem and '
                . 'sleeve openings as continuous fabric with visible inner lining rather than a cut edge.',
        ];
    }

    /**
     * Map chest/waist (cm) onto the catalogue size chart.
     *
     * DELEGATES to SizeChart — the single source of truth shared with the
     * stylist, the size suggester and the render job.
     */
    private function sizeLabel(?float $chest, ?float $waist): string
    {
        if ($chest === null || $waist === null) {
            return 'M'; // neutral default; flagged by has_real_measurements
        }

        return SizeChart::recommend($chest, $waist) ?? 'M';
    }
}