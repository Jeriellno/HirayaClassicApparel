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
 *
 * FIT STYLE
 * ---------
 * When the backend has compared the shopper's chosen fit against the garment's
 * AI-tagged `fit_type`, it sends both down. `customerFit` (SLIM / REGULAR /
 * LOOSE) and `garmentFit` are then used to name the match in the shopper's own
 * words — "Recommended for slims" — because a score out of 100 tells them
 * nothing about WHY a piece was picked. When either is missing the badge falls
 * back to the score bands, which is the pre-fit-style behaviour.
 */
const FIT_WORDS = {
    SLIM: 'slim',
    REGULAR: 'regular',
    LOOSE: 'oversized',
};

const FitMatchBadge = ({
    score = 0,
    label,
    size = 'M',
    recommendedSize,
    customerFit,
    garmentFit,
    variant = 'gold',
    compact = false,
    positionClass = 'top-12 left-3',
}) => {
    // Pick the right label & icon based on the score if no explicit label given.
    let resolvedLabel = label;
    let Icon = Sparkles;

    if (!resolvedLabel) {
        // An exact fit-style match outranks a size-only match at the same
        // score, because it is the reason the shopper is now looking at the
        // garment at all.
        const exactFitMatch = customerFit && garmentFit && customerFit === garmentFit;

        if (exactFitMatch) {
            const word = FIT_WORDS[garmentFit] || 'you';
            resolvedLabel = `Recommended for ${word}s`;
            Icon = Sparkles;
        } else if (score >= 95) { resolvedLabel = '100% Fit Match';          Icon = CheckCircle2; }
        else if (score >= 85) { resolvedLabel = 'Perfect Size for You';    Icon = CheckCircle2; }
        else if (score >= 70) { resolvedLabel = 'Recommended for You';     Icon = ThumbsUp; }
        else if (score >= 60) { resolvedLabel = 'Close Fit';               Icon = Ruler; }
        else                  { resolvedLabel = 'Standard Fit';             Icon = Ruler; }
    }

    const palette = {
        /*
         * THE BADGE IS A PILL — AND THAT IS DELIBERATE.
         *
         * This system reserves `rounded-sm` for PLATES (buttons, panels, inputs)
         * and keeps the pill for genuine TAGS: a fit score, a size chip, a
         * counter. A match badge is a tag, so the pill form stays.
         *
         * What changed is the PAINT. `gold`, `maroon` and `accent` are all the
         * SAME maroon in the heritage palette, so the old
         * `border-[#541A1A]` on `bg-[#541A1A]` drew a border identical to its own
         * fill (invisible edge), and the `subtle` variant asked for
         * `text-hiraya-on-accent` — vintage-white ink — on a `bg-hiraya-peach/70`
         * PALE fill, which measured ~1.2:1 and rendered the label invisible.
         * The subtle variant now carries the ink that legibility requires.
         */
        gold:    'bg-hiraya-accent text-hiraya-on-accent border-hiraya-accent-deep',
        emerald: 'bg-emerald-700 text-hiraya-on-accent border-emerald-800',
        subtle:  'bg-hiraya-accent-wash text-hiraya-accent border-hiraya-accent/35 backdrop-blur-md',
    }[variant] || 'bg-hiraya-accent text-hiraya-on-accent border-hiraya-accent-deep';

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
                    className={`ml-1 rounded-full px-1.5 py-[1px] text-[8px] tracking-widest ${
                        recommendedSize ? 'bg-hiraya-nav-ink/20' : 'bg-hiraya-nav-ink/12'
                    }`}
                >
                    Size {sizeText}
                </span>
            )}
        </span>
    );
};

export default FitMatchBadge;
