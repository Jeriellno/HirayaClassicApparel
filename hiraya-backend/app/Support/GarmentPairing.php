<?php

namespace App\Support;

/**
 * Which garments may be PAIRED with each other.
 *
 * Mirrored by `src/utils/garmentPairing.js` on the frontend (the admin picker
 * only offers compatible pieces); this copy is the one that is enforced.
 *
 * THE RULE
 * --------
 * A pairing is an outfit suggestion, so the two pieces must be worn on
 * DIFFERENT layers of the body:
 *
 *   top       (TOPS)                 pairs with outerwear, bottom
 *   bottom    (BOTTOMS)              pairs with top, outerwear
 *   outerwear (OUTERWEAR)            pairs with anything except outerwear
 *   full      (DRESSES, FULL_BODY)   pairs with outerwear only — a dress
 *                                    already covers the top and bottom
 *   formal    (FORMAL_MEN/WOMEN)     pairs with anything except formal
 *
 * Two tops, two coats or a dress with trousers are refused: none of those is
 * an outfit the try-on could actually layer.
 */
class GarmentPairing
{
    public const MAX_PAIRS = 8;

    private const LAYER_BY_CATEGORY = [
        'TOPS' => 'top',
        'BOTTOMS' => 'bottom',
        'OUTERWEAR' => 'outerwear',
        'DRESSES' => 'full',
        'FULL_BODY' => 'full',
        'FORMAL_MEN' => 'formal',
        'FORMAL_WOMEN' => 'formal',
    ];

    public static function layerOf(?string $category): string
    {
        $key = strtoupper(trim((string) $category));

        return self::LAYER_BY_CATEGORY[$key] ?? ('other:' . $key);
    }

    public static function compatible(?string $a, ?string $b): bool
    {
        $la = self::layerOf($a);
        $lb = self::layerOf($b);

        if ($la === $lb) {
            return false;
        }

        if ($la === 'full' || $lb === 'full') {
            return $la === 'outerwear' || $lb === 'outerwear';
        }

        return true;
    }
}
