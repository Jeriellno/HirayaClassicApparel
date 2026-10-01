<?php

namespace App\Services;

use App\Models\Product;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

class OutfitRecommendationService
{
    public function __construct(MeasurementNormalizer $normalizer)
    {
        // Kept for DI compatibility with callers that still resolve this
        // service through the container. The recommendation path below is now
        // a size-LABEL match, so it no longer normalises garment measurement
        // text; SizeChart::measurementsFor() supplies the reference numbers.
    }

/**
 * FIT STYLES — the bridge between what the customer chose and what the
 * catalog says a garment is.
 *
 * The customer picks a fit in lowercase (`users.preferred_fit`:
 * slim / regular / oversized). The AI styling pass tags each product in
 * UPPERCASE (`products.ai_tags->fit_type`: SLIM / REGULAR / LOOSE). The
 * two vocabularies are the same three silhouettes wearing different
 * clothes, so the customer's "oversized" is the catalog's "LOOSE" — this
 * map is where that translation lives, rather than being sprinkled through
 * the comparison below.
 *
 * @var array<string, string>
 */
private const FIT_STYLE = [
    'slim'     => 'SLIM',
    'fitted'   => 'SLIM',
    'regular'  => 'REGULAR',
    'true'     => 'REGULAR',
    'oversized' => 'LOOSE',
    'loose'    => 'LOOSE',
    'relaxed'  => 'LOOSE',
];

/**
 * The three cuts, ordered on the slim -> loose ladder.
 *
 * The ORDER is meaningful: `fitScore()` measures how far apart a garment's
 * cut and the customer's are, so this doubles as the ladder it walks.
 * The SCORES are only the neighbour fallback, kept as a map so the ladder
 * and the values it produces can never drift apart.
 *
 * @var array<string, int>
 */
private const FIT_NEIGHBOUR_SCORE = [
    'SLIM'    => 80,
    'REGULAR' => 70,
    'LOOSE'   => 60,
];

/**
 * Garments whose stock INCLUDES a size the customer actually wears, ranked
 * by FIT STYLE.
 *
 * This used to score each product by comparing five centimetre bands
 * against the customer's five typed measurements. Measurements are gone:
 * the customer now records an upper and a lower SIZE, and there is no
 * per-user cm profile left to compare. The honest equivalent is a label
 * match — does this garment come in their size — so the recommendation
 * engine compares `upper_body_size` / `lower_body_size` against the sizes
 * each product is stocked in, choosing the axis by the garment's category.
 *
 * On top of that GATE, the customer's `preferred_fit` is now compared
 * against the garment's AI `fit_type`: a slim shopper is shown the pieces
 * the stylists tagged SLIM, and the FIT-MATCH badge says why. The size
 * answers "will it fit"; the fit style answers "is this me".
 *
 * `SizeChart::measurementsFor()` still resolves the centimetre numbers for the
 * matched size; those are attached as `fit_reference` so the UI can explain
 * the recommendation, but they are never compared to a customer.
 */
public function getRecommendations(User $user, int $limit = 6): Collection
{
    $upper = SizeChart::normaliseLabel($user->upper_body_size);
    $lower = SizeChart::normaliseLabel($user->lower_body_size);
    $fit = $this->customerFitStyle($user->preferred_fit);
    $gender = $this->customerGender($user->gender ?? null);

        // No sizing profile on file: recommend nothing rather than pretend a
        // match exists. The Home Spotlight shows the "set your sizes" CTA.
        if ($upper === null && $lower === null) {
            return collect([]);
        }

        // Cache per user, invalidated automatically when user model updates
        $productsVersion = Product::max('updated_at') ?? 'none';
        // v5: garment fit tags are now actually read (see garmentFitStyle), so
        // results cached under v4 carry a wrong `garment_fit` / `fit_score`.
        $cacheKey = "user_recommendations_v6_{$user->id}_" . md5($user->updated_at . '|' . $productsVersion . '|' . $limit . '|' . $upper . '|' . $lower . '|' . ($fit ?? 'any') . '|' . ($gender ?? 'any'));

        return Cache::remember($cacheKey, now()->addHours(6), function () use ($limit, $upper, $lower, $fit, $gender) {
            /*
             * `display_image_url` MUST be selected.
             *
             * SpotlightSection renders each product through ProductCard, which
             * resolves its image as `display_image_url || image_url`. This
             * `select()` narrows the row to an explicit column list, so omitting
             * the display column stripped it from the payload entirely and every
             * Spotlight card silently fell back to the admin's ORIGINAL photo —
             * even for products that had a perfectly good AI cut-out stored.
             *
             * `background_occasion` rides along for the "why this was picked"
             * caption, and must stay in sync with any column the card reads.
             *
             * RETURNED, not assigned: the chain used to be stored in a local
             * `$products` that nothing returned, so the closure yielded null and
             * the method's `Collection` return type threw a TypeError (a 500).
             */
            return Product::query()
                ->select([
                    'id', 'name', 'price', 'category', 'gender',
                    'sizes', 'size_measurements', 'ai_tags',
                    'image_url', 'display_image_url', 'background_occasion',
                ])
                ->whereNotNull('sizes')
                // Newest first, so that within a single fit style (where every
                // garment scores identically) the shopper sees the pieces the
                // store added most recently. Without this the order is whatever
                // the database happened to return, which varies between engines.
                ->orderByDesc('id')
                ->get()
                // THE GENDER GATE — menswear for men, womenswear for women;
                // Unisex and untagged pieces are shown to everyone.
                ->filter(fn ($product) => $this->genderMatches($product->gender, $gender))
                ->map(function ($product) use ($upper, $lower, $fit) {
                    // THE GATE — the garment must be stocked in a size the
                    // customer wears. Without this there is no recommendation
                    // to make at all, whatever its cut.
                    $matched = $this->matchedSizeFor(
                        $product->sizes,
                        $this->sizeAxisFor($product->category ?? ''),
                        $upper,
                        $lower,
                    );

                    if ($matched === null) {
                        return null;
                    }

                    // THE RANKING — how this garment's cut answers the fit
                    // style the customer chose.
                    $garmentFit = $this->garmentFitStyle($product->ai_tags);
                    $score = $this->fitScore($garmentFit, $fit);

                    $product->fit_score = $score;
                    $product->recommended_size = $matched;
                    // The customer's fit and the garment's, so the UI can say
                    // "Recommended for slims" instead of a bare 100%.
                    $product->customer_fit = $fit;
                    $product->garment_fit = $garmentFit;
                    // The centimetres behind the matched size, for the UI to
                    // show as the reference the recommendation was drawn from.
                    $product->fit_reference = SizeChart::measurementsFor($matched);

                    return $product;
                })
                ->filter()
                // Best fit style first. Within one fit style every surviving
                // garment is an equal-quality match — they all come in the
                // shopper's own size — so the order falls back to the query's
                // (newest first), which is stable and deterministic.
                ->sortByDesc('fit_score')
                ->take($limit)
                ->values();
        });
    }

    /**
     * The customer's gender in the CATALOG's vocabulary (Men / Women), or null
     * when the account has none on file — the feed is then not gender-filtered.
     */
    private function customerGender(mixed $gender): ?string
    {
        if (! is_string($gender)) {
            return null;
        }

        return match (strtolower(trim($gender))) {
            'male', 'man', 'men' => 'Men',
            'female', 'woman', 'women' => 'Women',
            default => null,
        };
    }

    /**
     * Whether a product's gender tag suits the customer. Unisex and untagged
     * products always pass.
     */
    private function genderMatches(mixed $productGender, ?string $customerGender): bool
    {
        if ($customerGender === null || ! is_string($productGender) || trim($productGender) === '') {
            return true;
        }

        $tag = $this->customerGender($productGender);

        return $tag === null || $tag === $customerGender;
    }

    /**
     * The customer's chosen fit, in the CATALOG's vocabulary.
     *
     * Returns null when the shopper never picked a fit (or picked one this
     * class does not recognise) — the recommendation then falls back to the
     * size gate alone rather than guessing a silhouette for them.
     */
    private function customerFitStyle(mixed $preferred): ?string
    {
        if (! is_string($preferred)) {
            return null;
        }

        return self::FIT_STYLE[strtolower(trim($preferred))] ?? null;
    }

    /**
     * The garment's AI-tagged cut, in the CATALOG's vocabulary.
     *
     * @param  mixed  $aiTags  the `ai_tags` JSON column; may be null/array/string
     */
    private function garmentFitStyle(mixed $aiTags): ?string
    {
        if (is_string($aiTags)) {
            $aiTags = json_decode($aiTags, true);
        }

        if (! is_array($aiTags)) {
            return null;
        }

        $fit = $aiTags['fit_type'] ?? null;

        if (! is_string($fit) || trim($fit) === '') {
            return null;
        }

        $candidate = strtoupper(trim($fit));

        // The cuts are the KEYS of the ladder (its values are scores), so a
        // value lookup here treated every tagged garment as untagged.
        return array_key_exists($candidate, self::FIT_NEIGHBOUR_SCORE) ? $candidate : null;
    }

    /**
     * How well a garment's cut answers the fit the customer asked for.
     *
     * The ladder is SLIM -> REGULAR -> LOOSE:
     *
     *   - same style        -> 100 ("this is what you asked for")
     *   - one step away     -> 80 / 70, still shown, just below the exact hits
     *   - the far end       -> 60, kept only so the shopper still sees options
     *   - untagged garment  -> 70, deliberately mid-pack: a product with no AI
     *                           fit tag must not outrank one the stylists
     *                           explicitly tagged for this shopper
     *
     * With no fit on file for the customer the score is a flat 70, so the feed
     * keeps its previous "all real size matches, no false ranking" behaviour.
     */
    private function fitScore(?string $garmentFit, ?string $customerFit): int
    {
        if ($customerFit === null) {
            return 70;
        }

        if ($garmentFit === null) {
            return 70;
        }

        if ($garmentFit === $customerFit) {
            return 100;
        }

        $ladder = array_keys(self::FIT_NEIGHBOUR_SCORE);
        $from = array_search($garmentFit, $ladder, true);
        $to = array_search($customerFit, $ladder, true);

        // Both are members of FIT_NEIGHBOUR_SCORE by the time we get here, so
        // this cannot fail; the guard keeps the method total anyway.
        if ($from === false || $to === false) {
            return 70;
        }

        // The full ladder is three rungs, so the furthest possible distance is 2.
        return match (abs($from - $to)) {
            1 => self::FIT_NEIGHBOUR_SCORE[$ladder[min($from, $to)]],
            default => min(self::FIT_NEIGHBOUR_SCORE),
        };
    }

    /**
     * Which sizing axis governs this garment category.
     *
     * Bottoms are cut from the lower body; everything wearable on the torso
     * (tops, dresses, outerwear) is cut from the upper body. An unknown or
     * accessory category falls back to the upper body, which is what a shopper
     * means by "my size" for anything that is not a pair of trousers.
     */
    private function sizeAxisFor(string $category): string
    {
        $category = strtolower(trim($category));

        foreach (['pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack'] as $lowerWord) {
            if (str_contains($category, $lowerWord)) {
                return 'lower';
            }
        }

        return 'upper';
    }

    /**
     * The customer's size, if the product is stocked in it.
     *
     * Normalises the stored `sizes` (which may be a JSON string or an array)
     * and returns the matched label, or null. Normalisation goes through
     * SizeChart so "m", "M " and "Medium-ish casing" all resolve the same way.
     */
    private function matchedSizeFor(mixed $sizes, string $axis, ?string $upper, ?string $lower): ?string
    {
        $wanted = $axis === 'lower' ? ($lower ?? $upper) : ($upper ?? $lower);

        if ($wanted === null) {
            return null;
        }

        $available = $this->normalisedSizeLabels($sizes);

        if ($available === []) {
            return null;
        }

        foreach ($available as $label) {
            if (strcasecmp($label, $wanted) === 0) {
                return $label;
            }
        }

        return null;
    }

    /**
     * Pull a flat list of size labels out of a product's `sizes` column.
     *
     * That column has been stored as a JSON array, a JSON string and a plain
     * string at different points in this project's life, so all three shapes
     * are handled rather than assuming one.
     *
     * @return array<int, string>
     */
    private function normalisedSizeLabels(mixed $sizes): array
    {
        if (is_string($sizes)) {
            $decoded = json_decode($sizes, true);
            $sizes = is_array($decoded) ? $decoded : array_filter(array_map('trim', explode(',', $sizes)));
        }

        if (! is_array($sizes)) {
            return [];
        }

        $labels = [];
        foreach ($sizes as $key => $entry) {
            $label = is_array($entry) ? ($entry['label'] ?? $entry['size_label'] ?? $entry['size'] ?? null) : $entry;
            // A keyed map ({ "M": { stock: 4 } }) names the size in the key.
            $label = $label ?? (is_string($key) ? $key : null);

            if (is_string($label) && trim($label) !== '') {
                $labels[] = trim($label);
            }
        }

        return $labels;
    }
}
