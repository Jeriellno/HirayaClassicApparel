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
 * that result (an untucked top sits over the waistband).
 *
 * A dress and ONE top (a bolero or cropped top over a strapless dress) or ONE
 * outerwear piece (a jacket or coat over it) — both pairings admins can set —
 * render the same way: the dress first, then the top or outerwear on that
 * result as an upper-body pass, so it is the OUTER layer and the dress shows
 * below it. The vendor dresses outerwear as `upperbody`, so a long coat may
 * come back hip-length over the dress, as it does over trousers.
 *
 * Those are the only multi-garment combinations accepted. Anything else would
 * make the second pass overwrite the first, so it is refused with a message the
 * customer can act on instead of being rendered incompletely.
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

    /** The fingerprint marker of a top layered over a dress (dress pass first). */
    public const OVER_DRESS_PIPELINE = 'pair:dress-then-top:v1';

    /** The fingerprint marker of outerwear layered over a dress (dress pass first). */
    public const OUTERWEAR_OVER_DRESS_PIPELINE = 'pair:dress-then-outerwear:v1';

    /*
     * WHICH KIND OF PAIR a session is, stored as `pipeline.layering`. Only the
     * customer-facing copy (pass labels, feedback) reads it; the pass order
     * itself is `pipeline.order`. A session without the key is a top + bottom
     * pair, so every pair stored before this existed keeps its old wording.
     */
    public const LAYERING_OVER_BOTTOM = 'over_bottom';
    public const LAYERING_OVER_DRESS = 'over_dress';

    /*
     * WHAT IS LAYERED OVER A DRESS, stored as `pipeline.outer` on an
     * `over_dress` pair. Copy only — both render the same way. A session
     * without the key is a top over a dress (it predates outerwear).
     */
    public const OUTER_TOP = 'top';
    public const OUTER_OUTERWEAR = 'outerwear';

    private const MESSAGES = [
        'dress_combo' => 'A dress can be tried on with one top or one outerwear piece layered over it — like a bolero, cardigan or jacket — but not with a bottom or footwear. Remove the extra piece to render your fitting.',
        'footwear_combo' => 'Footwear can’t be rendered together with other pieces yet. Remove the footwear to render the rest of your look.',
        'two_upper' => 'The AI try-on can wear one upper-body piece at a time. Keep either the top or the outerwear, and add a bottom if you like.',
        'two_lower' => 'The AI try-on can wear one bottom at a time. Keep one of them, and add a top if you like.',
        'too_many' => 'The AI try-on renders up to two pieces together: one top (or outerwear) with one bottom, or one top (or outerwear) layered over a dress. Remove the extra pieces and try again.',
    ];

    /**
     * @param  array<int, string|null>  $categories  index-aligned with the garment images
     * @return array{mode: string, order?: array{0:int, 1:int}, pipeline?: string, layering?: string, outer?: string, code?: string, message?: string}
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
            /*
             * ONE TOP OR ONE OUTERWEAR PIECE OVER ONE DRESS: the dress first,
             * then the upper piece on that result, so it is drawn over the dress
             * the way a top is drawn over a bottom. "Upper" here is anything the
             * renderer dresses as a top (an unknown label included — the Studio
             * files those under Tops too) or as outerwear. Outerwear gets its
             * own fingerprint marker, so a dress + top keeps its old one.
             */
            $dress = (int) array_search('full', $regions, true);
            $other = 1 - $dress;

            if ($regions[$other] === 'upper') {
                $outerwear = self::isOuterwear($categories[$other]);

                return [
                    'mode' => self::MODE_PAIR,
                    'order' => [$dress, $other],
                    'pipeline' => $outerwear ? self::OUTERWEAR_OVER_DRESS_PIPELINE : self::OVER_DRESS_PIPELINE,
                    'layering' => self::LAYERING_OVER_DRESS,
                    'outer' => $outerwear ? self::OUTER_OUTERWEAR : self::OUTER_TOP,
                ];
            }

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

        return [
            'mode' => self::MODE_PAIR,
            'order' => [(int) $lower, (int) $upper],
            'pipeline' => self::PAIR_PIPELINE,
            'layering' => self::LAYERING_OVER_BOTTOM,
        ];
    }

    /**
     * What each pass of a stored pair dresses, for the progress copy:
     * ['the bottom', 'the top'], ['the dress', 'the top'] or
     * ['the dress', 'the outerwear'].
     *
     * @param  array<string, mixed>  $pipeline  the session's `render_plan_json.pipeline`
     * @return array{0: string, 1: string}
     */
    public static function passLabels(array $pipeline): array
    {
        return ($pipeline['layering'] ?? null) === self::LAYERING_OVER_DRESS
            ? ['the dress', 'the ' . self::outerPiece($pipeline)]
            : ['the bottom', 'the top'];
    }

    /**
     * The piece layered over a dress, for the customer-facing copy: 'top' or
     * 'outerwear'. Reads a stored pipeline or a fresh plan (both carry `outer`).
     *
     * @param  array<string, mixed>  $pipeline
     */
    public static function outerPiece(array $pipeline): string
    {
        return ($pipeline['outer'] ?? null) === self::OUTER_OUTERWEAR ? self::OUTER_OUTERWEAR : self::OUTER_TOP;
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

    private static function isOuterwear(?string $category): bool
    {
        return app(VtonApiRenderer::class)->familyOf($category) === 'outerwear';
    }

    private static function refuse(string $code): array
    {
        return ['mode' => self::MODE_UNSUPPORTED, 'code' => $code, 'message' => self::MESSAGES[$code]];
    }
}
