import { CheckCircle2, Sparkles, ThumbsUp, Ruler } from 'lucide-react';

/**
 * FitMatchBadge
 *
 * Pill-shaped badge that sits on a ProductCard to signal how well a
 * garment matches the logged-in user's 5 Core Body Measurements.
 *
 * WHERE IT SITS
 * -------------
 * The badge is a SIBLING of ProductCard's category tag. Both used to be pinned
 * to the same `absolute top-3 left-3` corner, so on every recommended card the
 * two drew on top of each other and neither was readable — the reported
 * "TOPS" / "... FIT  Size M" overlap.
 *
 * The category tag owns the top-left corner, so this badge is placed BELOW it
 * (`top-12`, clear of the tag's height) and the fit label is stacked over its
 * size chip instead of being laid out beside it. `positionClass` lets a caller
 * move it when a card variant reserves the space differently.
 *
 * Props
 * -----
 * - `score`  : integer 0-100 (the raw match score from the backend)
 * - `label`  : optional override (e.g."100% Fit Match","Perfect Size for You")
 * - `size`   :"M"   (fallback chip value when no `recommendedSize`)
 * - `variant`: 'gold' (default) | 'emerald' | 'subtle'
 * - `positionClass`: where to pin the badge on the card media.
 */
const FitMatchBadge = ({
    score = 0,
    label,
    size = 'M',
    recommendedSize,
    variant = 'gold',
    compact = false,
    positionClass = 'top-12 left-3',
}) => {
    // Pick the right label & icon based on the score if no explicit label given.
    let resolvedLabel = label;
    let Icon = Sparkles;

    if (!resolvedLabel) {
        if (score >= 95)      { resolvedLabel = '100% Fit Match';          Icon = CheckCircle2; }
        else if (score >= 85) { resolvedLabel = 'Perfect Size for You';    Icon = CheckCircle2; }
        else if (score >= 70) { resolvedLabel = 'Recommended for You';     Icon = ThumbsUp; }
        else if (score >= 60) { resolvedLabel = 'Close Fit';               Icon = Ruler; }
        else                  { resolvedLabel = 'Standard Fit';             Icon = Ruler; }
    }

    const palette = {
        gold:    'bg-[#E9C46A] text-black border-[#E9C46A]',
        emerald: 'bg-emerald-500/95 text-black border-emerald-400',
        subtle:  'bg-white/10 text-white border-white/20 backdrop-blur-md',
    }[variant] || 'bg-[#E9C46A] text-black border-[#E9C46A]';

    const sizeText = recommendedSize || size;

    return (
        <span
            className={`absolute ${positionClass} z-20 inline-flex items-center gap-1.5 rounded-full border font-extrabold uppercase tracking-widest shadow-lg whitespace-nowrap ${palette} ${
                compact ? 'px-2 py-0.5 text-[8px]' : 'px-2.5 py-1 text-[9px]'
            }`}
            title={`Match score: ${score}%`}
        >
            <Icon size={compact ? 9 : 11} />
            {/*
             * `sizeText` is always shown: it is the size the engine matched for
             * this shopper. `recommendedSize` only changes the chip's styling
             * (solid vs. muted), it no longer decides whether the chip exists —
             * previously a recommendation without a size rendered a bare label
             * and the component looked broken.
             */}
            <span>{resolvedLabel}</span>
            {sizeText && (
                <span
                    className={`ml-1 px-1.5 py-[1px] rounded-full text-[8px] tracking-widest ${
                        recommendedSize ? 'bg-black/15' : 'bg-black/10'
                    }`}
                >
                    Size {sizeText}
                </span>
            )}
        </span>
    );
};

export default FitMatchBadge;
