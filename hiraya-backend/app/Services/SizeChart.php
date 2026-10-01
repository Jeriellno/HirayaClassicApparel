<?php

namespace App\Services;

/**
 * SizeChart — THE single source of truth for Hiraya's size bands.
 *
 * WHY THIS CLASS EXISTS
 * ---------------------
 * The same chest/waist thresholds were copy-pasted into four different places:
 *
 *   - TryOnController::recommendSize           (the stylist / size suggester)
 *   - ProcessTryOnJob::calculateSizeRecommendation  (the render job)
 *   - TryOnPreProcessor::sizeLabel             (the try-on pre-flight)
 *   - ProductController::DEFAULT_SIZE_CHART    (per-size fallback measurements)
 *
 * and a FIFTH time in the frontend as `recommendSizeFromMeasurements()`. They
 * had already started to drift (the frontend treated a missing axis as "no
 * constraint" while the backend required both), which is exactly the class of
 * bug that makes the Size Suggester chip disagree with the size in the render.
 *
 * Nothing here is per-customer or per-request: it is the store's sizing policy,
 * so it belongs in ONE place. Every PHP caller now delegates to this class, and
 * the frontend reads the band list from `GET /api/size-chart` instead of
 * carrying its own copy.
 *
 * The numbers are BODY measurements in centimetres, taken as the UPPER BOUND of
 * each size band. A garment's own measurements live on the product row and are
 * a separate concern — see Product::$size_measurements.
 */
class SizeChart
{
    /**
     * Ordered size labels, smallest first.
     *
     * `band` is the maximum chest_bust / waist (cm) that still fits the size.
     * `measurements` are the canonical GARMENT measurements used when a product
     * supplies none — kept here so the fallback and the bands can never disagree.
     *
     * @var array<string, array{band: array{chest_bust: float, waist: float}, measurements: array<string, float>}>
     */
    public const SIZES = [
        'XS' => [
            'band' => ['chest_bust' => 81.0, 'waist' => 63.0],
            'measurements' => ['chest_bust' => 81.0, 'waist' => 63.0, 'hips' => 87.0, 'shoulder_width' => 37.0, 'sleeve_length' => 57.0],
        ],
        'S' => [
            'band' => ['chest_bust' => 88.0, 'waist' => 70.0],
            'measurements' => ['chest_bust' => 88.0, 'waist' => 70.0, 'hips' => 94.0, 'shoulder_width' => 39.5, 'sleeve_length' => 59.5],
        ],
        'M' => [
            'band' => ['chest_bust' => 95.0, 'waist' => 77.0],
            'measurements' => ['chest_bust' => 95.0, 'waist' => 77.0, 'hips' => 101.0, 'shoulder_width' => 41.5, 'sleeve_length' => 61.5],
        ],
        'L' => [
            'band' => ['chest_bust' => 102.0, 'waist' => 84.0],
            'measurements' => ['chest_bust' => 102.0, 'waist' => 84.0, 'hips' => 108.0, 'shoulder_width' => 43.5, 'sleeve_length' => 63.5],
        ],
        'XL' => [
            'band' => ['chest_bust' => 109.0, 'waist' => 91.0],
            'measurements' => ['chest_bust' => 109.0, 'waist' => 91.0, 'hips' => 115.0, 'shoulder_width' => 45.5, 'sleeve_length' => 65.5],
        ],
        '2XL' => [
            'band' => ['chest_bust' => 116.5, 'waist' => 98.5],
            'measurements' => ['chest_bust' => 116.5, 'waist' => 98.5, 'hips' => 122.5, 'shoulder_width' => 47.5, 'sleeve_length' => 67.5],
        ],
    ];

    /**
     * Cap on how far hips may push a size up (see recommend()).
     *
     * The hip ceiling for each size, taken from the entries above.
     */
    private const HIPS_CEILING = [
        'XS' => 87.0,
        'S' => 94.0,
        'M' => 101.0,
        'L' => 108.0,
        'XL' => 115.0,
    ];

    /**
     * Recommended size for a set of BODY measurements (cm).
     *
     * Fit is driven by chest_bust + waist. Hips can only push the size UP, never
     * down, so a pear-shaped customer is not put in a top that is tight at the
     * hip — matching the behaviour the stylist describes in its own knowledge
     * text.
     *
     * A null/zero axis is treated as "no constraint" rather than as zero, so a
     * customer who has entered only a chest still gets a usable answer instead
     * of the smallest size.
     */
    public static function recommend(?float $chest, ?float $waist, ?float $hips = null): ?string
    {
        $hasChest = $chest !== null && $chest > 0;
        $hasWaist = $waist !== null && $waist > 0;

        // Without any input there is no honest answer to give.
        if (! $hasChest && ! $hasWaist) {
            return null;
        }

        $size = null;

        foreach (self::SIZES as $label => $entry) {
            $fitsChest = ! $hasChest || $chest <= $entry['band']['chest_bust'];
            $fitsWaist = ! $hasWaist || $waist <= $entry['band']['waist'];

            if ($fitsChest && $fitsWaist) {
                $size = $label;
                break;
            }
        }

        // Beyond the largest band -> the largest size we actually offer.
        $size ??= array_key_last(self::SIZES);

        if ($hips !== null && $hips > 0) {
            $size = self::bumpForHips($size, $hips);
        }

        return $size;
    }

    /**
     * Push a size UP while the hips exceed that size's ceiling.
     *
     * Deliberately one-directional: a narrow hip must never shrink a size that
     * chest/waist already justified.
     */
    private static function bumpForHips(string $size, float $hips): string
    {
        $order = array_keys(self::SIZES);
        $index = array_search($size, $order, true);

        if ($index === false) {
            return $size;
        }

        while (isset(self::HIPS_CEILING[$size]) && $hips > self::HIPS_CEILING[$size]) {
            $index++;
            if (! isset($order[$index])) {
                return array_key_last(self::SIZES);
            }
            $size = $order[$index];
        }

        return $size;
    }

    /**
     * The canonical garment measurements for a size label, or null if unknown.
     *
     * Used as the per-size fallback when a product stores no measurements of its
     * own, so the fallback and the band table can never drift apart.
     *
     * @return array<string, float>|null
     */
    public static function measurementsFor(string $sizeLabel): ?array
    {
        return self::SIZES[strtoupper(trim($sizeLabel))]['measurements'] ?? null;
    }

    /**
     * Canonicalise a stored size label, or null when it is not one we stock.
     *
     * Now that a CUSTOMER's sizing profile is just two labels, every read of
     * `users.upper_body_size` / `users.lower_body_size` has to survive a stray
     * space, a lowercase letter or a legacy value. This is the one place that
     * decides what a label means, so a product's `sizes` list and a user's
     * profile are compared in the same vocabulary.
     *
     * @param  mixed  $label
     */
    public static function normaliseLabel($label): ?string
    {
        if (! is_string($label) && ! is_numeric($label)) {
            return null;
        }

        $candidate = strtoupper(trim((string) $label));

        // Return the LABEL itself. `self::SIZES[$candidate]` is the size's
        // band/measurements entry (an array), which broke the `?string` return
        // type with a TypeError for every customer who had a size on file —
        // a 500 from /outfits/recommended and the other callers.
        return array_key_exists($candidate, self::SIZES) ? $candidate : null;
    }

    /**
     * Every size label, smallest first.
     *
     * @return array<int, string>
     */
    public static function labels(): array
    {
        return array_keys(self::SIZES);
    }

    /**
     * The chart as a plain payload for the frontend.
     *
     * Shape (stable — the frontend builds its chips from this):
     *
     *   {
     *     "units": "cm",
     *     "sizes": [
     *       { "label": "S", "chest_bust_max": 88, "waist_max": 70, "measurements": {...} },
     *       ...
     *     ]
     *   }
     *
     * @return array<string, mixed>
     */
    public static function toArray(): array
    {
        $sizes = [];

        foreach (self::SIZES as $label => $entry) {
            $sizes[] = [
                'label' => $label,
                'chest_bust_max' => $entry['band']['chest_bust'],
                'waist_max' => $entry['band']['waist'],
                'measurements' => $entry['measurements'],
            ];
        }

        return [
            'units' => 'cm',
            'sizes' => $sizes,
        ];
    }
}
