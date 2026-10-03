<?php

namespace App\Support;

use App\Services\VtonApiRenderer;

/**
 * WHICH STYLE STACK SELECTIONS ONE TRY-ON CAN WEAR — AND IN WHAT ORDER.
 *
 * The hosted try-on models (FASHN, PixelAPI) dress ONE garment per job, so a
 * two-piece look used to be rendered as its single "most significant" piece and
 * the other was dropped (measured: session #141, Barong Tagalog + trousers,
 * came back wearing only one of them).
 *
 * A top and a bottom occupy different body regions, so they CAN be rendered
 * faithfully as two passes on the same photo: the bottom first, then the top on
 * that result (an untucked top sits over the waistband). That is the only
 * multi-garment combination accepted. Anything else would make the second pass
 * overwrite the first, so it is refused with a message the customer can act on
 * instead of being rendered incompletely.
 *
 * Planning applies only when EVERY garment carries a category. Legacy requests
 * without categories (bare base64 lists, the bag-hydration fallback) keep the
 * old single-garment behaviour.
 */
final class TryOnGarmentPlan
{
    public const MODE_SINGLE = 'single';
    public const MODE_PAIR = 'pair';
    public const MODE_UNSUPPORTED = 'unsupported';

    /** Part of the render fingerprint, so a pair render never reuses a one-garment result. */
    public const PAIR_PIPELINE = 'pair:lower-then-upper:v1';

    private const MESSAGES = [
        'dress_combo' => 'A dress already covers the top and the bottom, so it can’t be tried on together with another piece. Remove one of them to render your fitting.',
        'footwear_combo' => 'Footwear can’t be rendered together with other pieces yet. Remove the footwear to render the rest of your look.',
        'two_upper' => 'The AI try-on can wear one upper-body piece at a time. Keep either the top or the outerwear, and add a bottom if you like.',
        'two_lower' => 'The AI try-on can wear one bottom at a time. Keep one of them, and add a top if you like.',
        'too_many' => 'The AI try-on renders up to two pieces together: one top (or outerwear) and one bottom. Remove the extra pieces and try again.',
    ];

    /**
     * @param  array<int, string|null>  $categories  index-aligned with the garment images
     * @return array{mode: string, order?: array{0:int, 1:int}, code?: string, message?: string}
     */
    public static function plan(array $categories): array
    {
        $categories = array_values($categories);
        $count = count($categories);

        if ($count <= 1) {
            return ['mode' => self::MODE_SINGLE];
        }

        foreach ($categories as $category) {
            if (! is_string($category) || trim($category) === '') {
                return ['mode' => self::MODE_SINGLE]; // legacy: no categories to plan with
            }
        }

        $regions = array_map([self::class, 'regionOf'], $categories);

        if ($count > 2) {
            return self::refuse('too_many');
        }

        if (in_array('full', $regions, true)) {
            return self::refuse('dress_combo');
        }

        if (in_array('feet', $regions, true)) {
            return self::refuse('footwear_combo');
        }

        if ($regions[0] === $regions[1]) {
            return self::refuse($regions[0] === 'upper' ? 'two_upper' : 'two_lower');
        }

        // One upper + one lower: bottom first, then the top over it.
        $lower = array_search('lower', $regions, true);
        $upper = array_search('upper', $regions, true);

        return ['mode' => self::MODE_PAIR, 'order' => [(int) $lower, (int) $upper]];
    }

    /**
     * Body region of a catalogue label: 'upper' | 'lower' | 'full' | 'feet'.
     * Unknown labels count as upper — the same default the renderer sends to
     * the vendor (`upperbody`), and the same row the Studio files them under.
     */
    public static function regionOf(?string $category): string
    {
        return match (app(VtonApiRenderer::class)->familyOf($category)) {
            'dress' => 'full',
            'bottom' => 'lower',
            'footwear' => 'feet',
            default => 'upper',
        };
    }

    private static function refuse(string $code): array
    {
        return ['mode' => self::MODE_UNSUPPORTED, 'code' => $code, 'message' => self::MESSAGES[$code]];
    }
}
