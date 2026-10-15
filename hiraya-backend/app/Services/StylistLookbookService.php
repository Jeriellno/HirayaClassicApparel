<?php

namespace App\Services;

use App\Models\Product;
use App\Models\User;
use App\Support\ProductVariants;
use App\Support\TryOnGarmentPlan;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * AI STYLIST — the RULES that choose the looks.
 *
 * "AI describes, rules choose, the customer decides." The photo analysis only
 * suggests an undertone; the customer confirms it, picks an occasion and a
 * collection, and this class turns those three answers into up to three
 * complete looks from the real catalog. Every pick carries `reasons[]` that
 * name the rule that chose it, so nothing is a guess and nothing is invented:
 * a piece that is out of stock, not in the customer's size, or for the wrong
 * occasion simply cannot appear.
 *
 * The weights and vocabularies live in config/stylist.php.
 */
class StylistLookbookService
{
    public const PREFERENCES = ['womenswear', 'menswear', 'both'];

    /** @var array<string, ?array<string, float>> memo for size-chart lookups */
    private array $rangeCache = [];

    /** @var array<string, array<string, float>>|null the `size_charts` table, loaded once */
    private ?array $dbCharts = null;

    public function __construct(private StandardSizeChart $charts)
    {
    }

    /**
     * The collection to recommend from: the explicit choice, else the saved
     * one, else derived from the body gender (male -> menswear, female ->
     * womenswear), else both.
     */
    public static function preferenceFor(User $user, ?string $override = null): string
    {
        foreach ([$override, $user->style_preference] as $candidate) {
            $pick = strtolower(trim((string) $candidate));
            if (in_array($pick, self::PREFERENCES, true)) {
                return $pick;
            }
        }

        return match (strtolower((string) $user->gender)) {
            'female' => 'womenswear',
            'male' => 'menswear',
            default => 'both',
        };
    }

    /**
     * Build the lookbook.
     *
     * @return array{occasion: array{key: string, label: string}, preference: string, undertone: ?string, looks: array<int, array<string, mixed>>, notice: ?string}
     */
    public function build(User $user, string $occasion, ?string $preference = null, ?string $undertone = null): array
    {
        $occasions = (array) config('stylist.occasions', []);
        $occasion = array_key_exists($occasion, $occasions) ? $occasion : 'everyday';
        $preference = self::preferenceFor($user, $preference);
        $undertone = in_array($undertone, StylePhotoAnalyzer::UNDERTONES, true) ? $undertone : null;
        $maxLooks = max(1, (int) config('stylist.max_looks', 3));

        $candidates = ['upper' => [], 'lower' => [], 'full' => [], 'feet' => []];
        foreach ($this->catalog() as $product) {
            $piece = $this->evaluate($user, $product, $occasion, $preference, $undertone);
            if ($piece !== null) {
                $candidates[$piece['region']][] = $piece;
            }
        }
        foreach ($candidates as &$list) {
            usort($list, fn ($a, $b) => $b['score'] <=> $a['score']);
        }
        unset($list);

        $looks = $this->pickDiverse($this->composeLooks($candidates), $maxLooks);
        $out = [];
        foreach ($looks as $i => $look) {
            $out[] = $this->finishLook($look, $i, $candidates, $occasion, $undertone);
        }

        $label = (string) ($occasions[$occasion]['label'] ?? Str::headline($occasion));
        $notice = null;
        if ($out === []) {
            $notice = "I don't have a complete " . strtolower($label) . ' look in your size and collection yet. Try another occasion, choose "Both" collections, or check back when new pieces arrive.';
        } elseif (count($out) < $maxLooks) {
            $notice = 'I only have ' . count($out) . ' ' . strtolower($label) . ' look' . (count($out) === 1 ? '' : 's') . ' for you right now. New pieces are added regularly.';
        }

        return [
            'occasion' => ['key' => $occasion, 'label' => $label],
            'preference' => $preference,
            'undertone' => $undertone,
            'looks' => $out,
            'notice' => $notice,
        ];
    }

    // ------------------------------------------------------------------------
    // Pieces
    // ------------------------------------------------------------------------

    /** @return iterable<Product> */
    private function catalog(): iterable
    {
        try {
            return Product::query()->with('pairedProducts')->latest('id')->limit(200)->get();
        } catch (\Throwable $e) {
            Log::warning('Stylist catalog read failed: ' . $e->getMessage());

            return [];
        }
    }

    /**
     * One product judged for THIS customer and occasion, or null when a hard
     * rule excludes it (wrong collection, wrong occasion, not wearable, not in
     * their size, out of stock).
     */
    public function evaluate(User $user, Product $product, string $occasion, string $preference, ?string $undertone): ?array
    {
        $weights = (array) config('stylist.weights', []);

        // Hard rule 1: the collection the customer asked for.
        $cut = $this->cutOf($product->gender);
        if (! $this->inCollection($cut, $preference)) {
            return null;
        }

        // Hard rule 2: wearable on the body (bags, belts, hats are not rendered).
        if ($this->isAccessory($product->category, $product->name)) {
            return null;
        }
        $region = $this->regionOf($product->category);

        // Hard rule 3: the occasion (exact, or a compatible one).
        $pieceOccasion = strtolower(trim((string) $product->background_occasion)) ?: 'everyday';
        $compatible = (array) config("stylist.occasions.{$occasion}.compatible", []);
        $occasionLabel = (string) config("stylist.occasions.{$occasion}.label", $occasion);
        $reasons = [];
        $score = 0;
        if ($pieceOccasion === $occasion) {
            $score += (int) ($weights['occasion_exact'] ?? 4);
            $reasons[] = 'Made for ' . $this->occasionPhrase($occasion, $occasionLabel);
            $exact = true;
        } elseif (in_array($pieceOccasion, $compatible, true)) {
            $score += (int) ($weights['occasion_compatible'] ?? 2);
            $reasons[] = 'Works for ' . $this->occasionPhrase($occasion, $occasionLabel) . ' too';
            $exact = false;
        } else {
            return null;
        }

        // Hard rule 4: the customer's size (converted across cuts when needed).
        $wanted = $region === 'feet' ? null : $this->wantedSize($user, $region);
        $size = $wanted !== null ? $this->sizeFor($wanted, $product, $region, $this->bodyChartGender($user), $cut) : null;
        $labels = $this->sizeLabels($product->sizes);
        if ($wanted !== null && ($size === null || ($labels !== [] && ! in_array($size, $labels, true)))) {
            return null;
        }

        // Hard rule 5: in stock in that size — choosing the colour that suits
        // the customer's undertone first.
        $option = $this->bestColorOption($product, $size, $undertone);
        if ($option === null) {
            return null;
        }

        $tone = $this->undertoneOfColor($option['color']);
        if ($undertone !== null) {
            if ($tone === $undertone && $tone !== 'neutral') {
                $score += (int) ($weights['undertone_match'] ?? 3);
                $reasons[] = Str::ucfirst($option['color']) . ' suits your ' . $undertone . ' palette';
            } elseif ($tone === 'neutral') {
                $score += (int) ($weights['undertone_neutral'] ?? 1);
                $reasons[] = Str::ucfirst($option['color']) . ' is a neutral that suits everyone';
            }
        }

        if ($size !== null) {
            $reasons[] = $size === $wanted && ($cut === null || $cut === $this->bodyChartGender($user))
                ? 'In your size ' . $size
                : ($this->cutLabel($cut) . ' cut: size ' . $size . ' fits your usual ' . $wanted);
        }

        $fit = $this->fitMatches($product->ai_tags, $user->preferred_fit);
        if ($fit !== null) {
            $score += (int) ($weights['fit_match'] ?? 2);
            $reasons[] = 'Matches your ' . $fit . ' fit';
        }

        $season = $this->season();
        $haystack = Str::lower(implode(' ', array_filter([$product->name, $product->description, (string) $product->category])));
        if (collect($season['words'])->contains(fn ($w) => str_contains($haystack, $w))) {
            $score += (int) ($weights['season'] ?? 1);
            $reasons[] = 'Good for the ' . $season['label'];
        }

        return [
            'id' => $product->id,
            'name' => $product->name,
            'category' => $product->category,
            'region' => $region,
            'price' => (float) $product->price,
            'gender' => $product->gender,
            'occasion' => $pieceOccasion,
            'occasion_exact' => $exact,
            'color' => $option['color'],
            'color_hex' => $option['hex'],
            'color_tone' => $tone,
            'image_url' => $option['display_image_url'] ?: $option['image_url'],
            'display_image_url' => $option['display_image_url'],
            'raw_image_url' => $option['image_url'],
            'ghost_mannequin_url' => $option['ghost_mannequin_url'],
            'size' => $size,
            'wanted_size' => $wanted,
            'stock_in_size' => $option['available'],
            'paired_ids' => $product->relationLoaded('pairedProducts')
                ? $product->pairedProducts->pluck('id')->map(fn ($id) => (int) $id)->all()
                : [],
            'score' => $score,
            'reasons' => $reasons,
            'renderable' => $region !== 'feet',
            'url' => '/product/' . $product->id,
        ];
    }

    private function occasionPhrase(string $key, string $label): string
    {
        return match ($key) {
            'business' => 'the office',
            'everyday' => 'everyday wear',
            'cultural' => 'Filipiniana occasions',
            default => strtolower($label) . ' occasions',
        };
    }

    // ------------------------------------------------------------------------
    // Looks
    // ------------------------------------------------------------------------

    /**
     * Every valid look: a dress on its own, or a top (upper) + bottom (lower)
     * pair — exactly what the try-on can render. At least one piece must be an
     * exact match for the occasion, so a look is never "compatible" all the way down.
     *
     * @return array<int, array<string, mixed>>
     */
    private function composeLooks(array $c): array
    {
        $weights = (array) config('stylist.weights', []);
        $looks = [];

        foreach (array_slice($c['full'], 0, 8) as $dress) {
            if (! $dress['occasion_exact']) {
                continue;
            }
            $looks[] = ['type' => 'dress', 'slots' => ['full' => $dress], 'score' => $dress['score'], 'extra' => []];
        }

        foreach (array_slice($c['upper'], 0, 8) as $top) {
            foreach (array_slice($c['lower'], 0, 8) as $bottom) {
                if (! $top['occasion_exact'] && ! $bottom['occasion_exact']) {
                    continue;
                }
                $score = $top['score'] + $bottom['score'];
                $extra = [];

                if (in_array($bottom['id'], $top['paired_ids'], true) || in_array($top['id'], $bottom['paired_ids'], true)) {
                    $score += (int) ($weights['stylist_pairing'] ?? 4);
                    $extra[] = 'Paired by Hiraya stylists';
                }

                $tones = [$top['color_tone'], $bottom['color_tone']];
                if (in_array('warm', $tones, true) && in_array('cool', $tones, true)) {
                    $score -= 1;
                } else {
                    $score += 1;
                    $extra[] = 'The colors work together';
                }

                $looks[] = ['type' => 'pair', 'slots' => ['upper' => $top, 'lower' => $bottom], 'score' => $score, 'extra' => $extra];
            }
        }

        // Nothing complete? Offer single statement pieces rather than nothing.
        if ($looks === []) {
            foreach (array_slice($c['upper'], 0, 3) as $top) {
                if ($top['occasion_exact']) {
                    $looks[] = ['type' => 'single', 'slots' => ['upper' => $top], 'score' => $top['score'], 'extra' => []];
                }
            }
        }

        usort($looks, fn ($a, $b) => $b['score'] <=> $a['score']);

        return $looks;
    }

    /**
     * Up to $max looks that are DIFFERENT from each other: first a different
     * statement piece AND colour story, then just a different statement piece.
     */
    private function pickDiverse(array $looks, int $max): array
    {
        $picked = [];
        $usedStatement = [];
        $usedStory = [];
        $statementOf = fn ($look) => $look['slots']['full'] ?? $look['slots']['upper'] ?? $look['slots']['lower'];

        foreach ([true, false] as $strictColor) {
            foreach ($looks as $look) {
                if (count($picked) >= $max) {
                    break 2;
                }
                $statement = $statementOf($look);
                $story = strtolower((string) $statement['color']);
                if (in_array($statement['id'], $usedStatement, true)) {
                    continue;
                }
                if ($strictColor && in_array($story, $usedStory, true)) {
                    continue;
                }
                $picked[] = $look;
                $usedStatement[] = $statement['id'];
                $usedStory[] = $story;
            }
        }

        return $picked;
    }

    /** Name, reasons, alternatives (‹ ›) and a footwear tip for one look. */
    private function finishLook(array $look, int $index, array $c, string $occasion, ?string $undertone): array
    {
        $altCount = max(0, (int) config('stylist.alternatives_per_slot', 2));
        $slots = [];

        foreach ($look['slots'] as $region => $piece) {
            $partnerIds = collect($look['slots'])->except($region)->pluck('id')->all();
            $alternatives = collect($c[$region])
                ->reject(fn ($p) => $p['id'] === $piece['id'] || in_array($p['id'], $partnerIds, true))
                ->take($altCount)
                ->map(fn ($p) => $this->publicPiece($p))
                ->values()
                ->all();

            $main = $this->publicPiece($piece);
            if ($region !== 'full' && in_array('Paired by Hiraya stylists', $look['extra'], true)) {
                array_unshift($main['reasons'], 'Paired by Hiraya stylists');
            }

            $slots[] = $main + ['slot' => $region, 'alternatives' => $alternatives];
        }

        $statement = $look['slots']['full'] ?? $look['slots']['upper'] ?? $look['slots']['lower'];
        $tone = match ($statement['color_tone']) {
            'warm' => 'Warm',
            'cool' => 'Cool',
            default => 'Classic',
        };
        $label = (string) config("stylist.occasions.{$occasion}.label", Str::headline($occasion));

        $feet = $c['feet'][$index % max(1, count($c['feet']))] ?? null;

        return [
            'id' => 'look-' . chr(65 + $index),
            'letter' => chr(65 + $index),
            'name' => $tone . ' ' . strtolower($label) . ' look',
            // "Barong Tagalog + Brown Formal Trousers" — tells two looks with the
            // same tone and occasion apart at a glance.
            'summary' => implode(' + ', array_map(fn ($p) => $p['name'], $look['slots'])),
            'type' => $look['type'],
            'render_passes' => $look['type'] === 'pair' ? 2 : 1,
            'score' => $look['score'],
            'pieces' => $slots,
            'notes' => array_values(array_filter($look['extra'], fn ($e) => $e !== 'Paired by Hiraya stylists')),
            'styling_tip' => $feet ? $this->publicPiece($feet) + ['slot' => 'feet', 'note' => 'Styling tip only — not part of the try-on render.'] : null,
        ];
    }

    /** The fields the Studio needs for a piece (drops internal scoring keys). */
    private function publicPiece(array $p): array
    {
        return collect($p)->except(['paired_ids', 'score', 'occasion_exact'])->all();
    }

    // ------------------------------------------------------------------------
    // Verdict (after the try-on render)
    // ------------------------------------------------------------------------

    /**
     * The stylist's verdict on a RENDERED look, by the same rules that chose it:
     * fit (is this the right size for you?), colour (does it suit your confirmed
     * palette?), occasion (is it right for where you are going?) plus one tip and
     * pieces that complete the look. No model call — instant and repeatable.
     *
     * @param  array<int, array{id: int, color?: ?string, size?: ?string}>  $worn
     * @return array{checks: array<int, array<string, string>>, tip: ?string, complete_the_look: array<int, array<string, mixed>>, occasion: array{key: string, label: string}}
     */
    public function verdict(User $user, array $worn, string $occasion, ?string $undertone): array
    {
        $occasions = (array) config('stylist.occasions', []);
        $occasion = array_key_exists($occasion, $occasions) ? $occasion : 'everyday';
        $label = (string) ($occasions[$occasion]['label'] ?? $occasion);
        $undertone = in_array($undertone, StylePhotoAnalyzer::UNDERTONES, true) ? $undertone : null;

        $ids = array_values(array_unique(array_map(fn ($w) => (int) ($w['id'] ?? 0), $worn)));
        $products = Product::query()->whereIn('id', $ids)->get()->keyBy('id');
        $pieces = [];
        foreach ($worn as $w) {
            $product = $products->get((int) ($w['id'] ?? 0));
            if ($product) {
                $pieces[] = ['product' => $product, 'color' => $w['color'] ?? null, 'size' => $w['size'] ?? null, 'region' => $this->regionOf($product->category)];
            }
        }

        $checks = [];

        // FIT — the size worn vs the size the rules recommend for this body.
        $fitNotes = [];
        $fitOk = true;
        foreach ($pieces as $p) {
            if ($p['region'] === 'feet') {
                continue;
            }
            $wanted = $this->wantedSize($user, $p['region']);
            if ($wanted === null) {
                $fitOk = false;
                $fitNotes[] = 'Add your sizes in Account Settings for a fit check';
                break;
            }
            $best = $this->sizeFor($wanted, $p['product'], $p['region'], $this->bodyChartGender($user), $this->cutOf($p['product']->gender));
            $chosen = $p['size'] ? strtoupper((string) $p['size']) : $best;
            if ($best !== null && $chosen !== $best) {
                $fitOk = false;
                $fitNotes[] = 'Size ' . $best . ' would fit you better than ' . $chosen . ' in ' . $p['product']->name;
            } elseif ($best !== null) {
                $fitNotes[] = 'Size ' . $best . ' is your match';
            }
        }
        $checks[] = ['key' => 'fit', 'label' => 'Fit', 'status' => $fitOk ? 'good' : 'warn', 'text' => $fitNotes[0] ?? 'Size matches your profile', 'anchor' => 'torso'];

        // COLOUR — every piece suits the confirmed palette (or is a neutral).
        if ($undertone === null) {
            $checks[] = ['key' => 'color', 'label' => 'Color', 'status' => 'warn', 'text' => 'Confirm your palette to get a color check', 'anchor' => 'torso'];
        } else {
            $clash = null;
            foreach ($pieces as $p) {
                $color = $p['color'] ?: collect((array) $p['product']->colors)->first();
                $tone = $this->undertoneOfColor($color);
                if ($tone !== 'neutral' && $tone !== $undertone) {
                    $clash = Str::ucfirst((string) $color);
                    break;
                }
            }
            $checks[] = $clash === null
                ? ['key' => 'color', 'label' => 'Color', 'status' => 'good', 'text' => 'The colors suit your ' . $undertone . ' palette', 'anchor' => 'torso']
                : ['key' => 'color', 'label' => 'Color', 'status' => 'warn', 'text' => $clash . ' is outside your ' . $undertone . ' palette; add a ' . $undertone . ' accent near your face', 'anchor' => 'torso'];
        }

        // OCCASION — at least one piece made for it.
        $occasionsWorn = array_map(fn ($p) => strtolower((string) $p['product']->background_occasion) ?: 'everyday', $pieces);
        $compatible = (array) ($occasions[$occasion]['compatible'] ?? []);
        $phrase = $this->occasionPhrase($occasion, $label);
        if (in_array($occasion, $occasionsWorn, true)) {
            $checks[] = ['key' => 'occasion', 'label' => 'Occasion', 'status' => 'good', 'text' => 'Right for ' . $phrase, 'anchor' => 'legs'];
        } elseif (array_intersect($occasionsWorn, $compatible)) {
            $checks[] = ['key' => 'occasion', 'label' => 'Occasion', 'status' => 'warn', 'text' => 'Works for ' . $phrase . ', but it reads more casual', 'anchor' => 'legs'];
        } else {
            $checks[] = ['key' => 'occasion', 'label' => 'Occasion', 'status' => 'warn', 'text' => 'Not really made for ' . $phrase, 'anchor' => 'legs'];
        }

        // TIP + COMPLETE THE LOOK — the layer this occasion still misses.
        $regions = array_column($pieces, 'region');
        $hasOuter = collect($pieces)->contains(fn ($p) => app(VtonApiRenderer::class)->familyOf($p['product']->category) === 'outerwear');
        $tip = match (true) {
            in_array($occasion, ['business', 'formal'], true) && ! $hasOuter && ! in_array('full', $regions, true)
                => 'Tuck in the top and add a light blazer or jacket to make it ' . ($occasion === 'business' ? 'office-ready' : 'more formal') . '.',
            in_array('full', $regions, true) => 'Let the dress be the statement: keep shoes and accessories simple.',
            $occasion === 'summer' => 'Roll the sleeves once and keep the colors light for the heat.',
            default => 'Keep accessories minimal so the silhouette stays the focus.',
        };

        $preference = self::preferenceFor($user);
        $complete = [];
        foreach ($this->catalog() as $product) {
            if (in_array($product->id, $ids, true)) {
                continue;
            }
            $family = app(VtonApiRenderer::class)->familyOf($product->category);
            $wanted = ($family === 'outerwear' && ! $hasOuter) || $family === 'footwear';
            if (! $wanted) {
                continue;
            }
            $piece = $this->evaluate($user, $product, $occasion, $preference, $undertone);
            if ($piece) {
                $complete[] = $this->publicPiece($piece);
            }
            if (count($complete) >= 2) {
                break;
            }
        }

        return [
            'occasion' => ['key' => $occasion, 'label' => $label],
            'checks' => $checks,
            'tip' => $tip,
            'complete_the_look' => $complete,
        ];
    }

    // ------------------------------------------------------------------------
    // Rules helpers (public where the verdict reuses them)
    // ------------------------------------------------------------------------

    /** Catalog gender tag -> 'Men' | 'Women' | 'Unisex' | null. */
    public function cutOf(mixed $gender): ?string
    {
        return match (strtolower(trim((string) $gender))) {
            'men', 'male', 'man' => 'Men',
            'women', 'female', 'woman' => 'Women',
            'unisex' => 'Unisex',
            default => null,
        };
    }

    private function inCollection(?string $cut, string $preference): bool
    {
        return match ($preference) {
            'womenswear' => $cut !== 'Men',
            'menswear' => $cut !== 'Women',
            default => true,
        };
    }

    private function cutLabel(?string $cut): string
    {
        return match ($cut) {
            'Men' => "Men's",
            'Women' => "Women's",
            default => 'Unisex',
        };
    }

    /** The size chart that matches the customer's BODY (from `users.gender`). */
    public function bodyChartGender(User $user): ?string
    {
        return match (strtolower((string) $user->gender)) {
            'male' => 'Men',
            'female' => 'Women',
            default => null,
        };
    }

    public function wantedSize(User $user, string $region): ?string
    {
        $upper = $user->upper_body_size ? strtoupper($user->upper_body_size) : null;
        $lower = $user->lower_body_size ? strtoupper($user->lower_body_size) : null;

        return $region === 'lower' ? ($lower ?? $upper) : ($upper ?? $lower);
    }

    /**
     * The size to recommend in THIS product's cut.
     *
     * Same cut (or unknown body/cut) -> the customer's own label. Different cut
     * -> convert through centimetres: take the middle of the customer's chest
     * (tops) or waist (bottoms) range in their own chart, then find the product
     * size whose range in the product's chart contains it (else the nearest).
     */
    public function sizeFor(string $wanted, Product $product, string $region, ?string $bodyGender, ?string $cut): ?string
    {
        $labels = $this->sizeLabels($product->sizes);

        if ($bodyGender === null || $cut === null || $cut === $bodyGender) {
            return $labels === [] || in_array($wanted, $labels, true) ? $wanted : null;
        }

        $category = strtoupper((string) $product->category);
        $category = $category === 'FULL_BODY' ? 'DRESSES' : $category;
        $metric = $region === 'lower' ? 'waist' : 'chest_bust';

        $mine = $this->range($wanted, $category, $bodyGender);
        if (! isset($mine["{$metric}_min"], $mine["{$metric}_max"])) {
            return in_array($wanted, $labels, true) ? $wanted : null;
        }
        $middle = ($mine["{$metric}_min"] + $mine["{$metric}_max"]) / 2;

        $best = null;
        $bestDistance = INF;
        foreach ($labels as $label) {
            $theirs = $this->range($label, $category, $cut);
            if (! isset($theirs["{$metric}_min"], $theirs["{$metric}_max"])) {
                continue;
            }
            if ($middle >= $theirs["{$metric}_min"] && $middle <= $theirs["{$metric}_max"]) {
                return $label;
            }
            $distance = min(abs($middle - $theirs["{$metric}_min"]), abs($middle - $theirs["{$metric}_max"]));
            if ($distance < $bestDistance) {
                $bestDistance = $distance;
                $best = $label;
            }
        }

        return $best ?? (in_array($wanted, $labels, true) ? $wanted : null);
    }

    /**
     * A size's measurement range: the admin-managed `size_charts` table first
     * (exact gender, then Unisex), else the standard chart.
     *
     * The table is loaded ONCE per request. Going through
     * StandardSizeChart::getSizeRange() cost two remote queries per lookup —
     * MEASURED 22 queries / 8.3 s for one lookbook on the remote database, which
     * made the browser give up on the request.
     */
    private function range(string $label, string $category, string $gender): ?array
    {
        $label = strtoupper($label);
        $key = $label . '|' . $category . '|' . $gender;
        if (array_key_exists($key, $this->rangeCache)) {
            return $this->rangeCache[$key];
        }

        if ($this->dbCharts === null) {
            $this->dbCharts = [];
            try {
                foreach (\App\Models\SizeChart::query()->get() as $row) {
                    $this->dbCharts[strtoupper((string) $row->category) . '|' . $row->gender . '|' . strtoupper((string) $row->size_label)] = $row->toMeasurementRange();
                }
            } catch (\Throwable $e) {
                Log::info('Stylist size-chart preload failed: ' . $e->getMessage());
            }
        }

        return $this->rangeCache[$key] = $this->dbCharts[$category . '|' . $gender . '|' . $label]
            ?? ($gender !== 'Unisex' ? ($this->dbCharts[$category . '|Unisex|' . $label] ?? null) : null)
            ?? $this->charts->standardRange($label, $category, $gender);
    }

    /** @return array<int, string> upper-cased size labels the product is offered in */
    public function sizeLabels(mixed $sizes): array
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
            $label = $label ?? (is_string($key) ? $key : null);
            if (is_string($label) && trim($label) !== '') {
                $labels[] = strtoupper(trim($label));
            }
        }

        return array_values(array_unique($labels));
    }

    /**
     * The colour to show: one that suits the undertone first, then a neutral,
     * then any — and only a colour that is actually in stock in this size.
     *
     * @return array{color: string, hex: ?string, image_url: ?string, display_image_url: ?string, ghost_mannequin_url: ?string, available: int}|null
     */
    private function bestColorOption(Product $product, ?string $size, ?string $undertone): ?array
    {
        $variants = ProductVariants::all($product);
        $variantColors = array_map(fn ($v) => strtolower(trim((string) ($v['color'] ?? ''))), $variants);
        $primary = collect((array) $product->colors)
            ->first(fn ($c) => is_string($c) && ! in_array(strtolower(trim($c)), $variantColors, true))
            ?? 'Standard';

        $options = [[
            'color' => (string) $primary,
            'hex' => data_get($product->ai_tags, 'primary_hex'),
            'image_url' => $product->image_url,
            'display_image_url' => $product->display_image_url,
            'ghost_mannequin_url' => $product->ghost_mannequin_url,
        ]];
        foreach ($variants as $v) {
            if (! empty($v['color'])) {
                $options[] = [
                    'color' => (string) $v['color'],
                    'hex' => $v['hex'] ?? null,
                    'image_url' => $v['image_url'] ?? $product->image_url,
                    'display_image_url' => $v['display_image_url'] ?? null,
                    'ghost_mannequin_url' => $v['ghost_mannequin_url'] ?? null,
                ];
            }
        }

        $rank = function (array $o) use ($undertone): int {
            $tone = $this->undertoneOfColor($o['color']);

            return match (true) {
                $undertone !== null && $tone === $undertone => 0,
                $tone === 'neutral' => 1,
                default => 2,
            };
        };
        usort($options, fn ($a, $b) => $rank($a) <=> $rank($b));

        foreach ($options as $o) {
            $available = ProductVariants::available($product, $size, $o['color'] === 'Standard' ? null : $o['color']);
            if ($available > 0) {
                return $o + ['available' => $available];
            }
        }

        return null;
    }

    /** 'warm' | 'cool' | 'neutral' for a colour NAME (longest matching word wins). */
    public function undertoneOfColor(?string $color): string
    {
        $name = strtolower(trim((string) $color));
        $best = 'neutral';
        $bestLength = 0;

        foreach ((array) config('stylist.color_undertones', []) as $tone => $words) {
            foreach ((array) $words as $word) {
                if ($name === $word || preg_match('/\b' . preg_quote($word, '/') . '\b/', $name)) {
                    if (strlen($word) > $bestLength) {
                        $best = $tone;
                        $bestLength = strlen($word);
                    }
                }
            }
        }

        return $best;
    }

    /**
     * Body region of a catalog category: 'upper' | 'lower' | 'full' | 'feet'.
     *
     * The try-on planner's free-text matcher (TryOnGarmentPlan::regionOf) has no
     * hint for FULL_BODY or FORMAL_WOMEN and files them as tops; for building a
     * look they are one-piece outfits (the size chart already maps FORMAL_WOMEN
     * to DRESSES), so they are classified here first.
     */
    public function regionOf(?string $category): string
    {
        return match (strtoupper(trim((string) $category))) {
            'DRESSES', 'FULL_BODY', 'FORMAL_WOMEN' => 'full',
            'FORMAL_MEN' => 'upper',
            default => TryOnGarmentPlan::regionOf($category),
        };
    }

    private function isAccessory(?string $category, ?string $name): bool
    {
        $text = strtolower(($category ?? '') . ' ' . ($name ?? ''));

        return (bool) preg_match('/\b(bag|belt|hat|cap|accessor\w*|jewel\w*|watch|necklace|earring|bracelet|wallet)\b/', $text);
    }

    /** The customer's fit when this garment's AI-tagged cut matches it, else null. */
    private function fitMatches(mixed $aiTags, ?string $preferred): ?string
    {
        $tags = is_string($aiTags) ? json_decode($aiTags, true) : $aiTags;
        $garment = strtoupper((string) data_get($tags, 'fit_type', ''));
        $wanted = strtolower((string) $preferred);

        $map = ['slim' => 'SLIM', 'regular' => 'REGULAR', 'oversized' => 'LOOSE'];

        return isset($map[$wanted]) && $map[$wanted] === $garment ? $wanted : null;
    }

    /** The Philippine season right now (store time). */
    private function season(): array
    {
        $month = (int) now(config('payments.timezone', 'Asia/Manila'))->month;

        return match (true) {
            $month >= 6 && $month <= 11 => ['label' => 'rainy season', 'words' => ['jacket', 'outerwear', 'coat', 'long sleeve', 'trench', 'boots', 'layer']],
            $month >= 3 && $month <= 5 => ['label' => 'summer heat', 'words' => ['linen', 'summer', 'shorts', 'short sleeve', 'cotton', 'sandals', 'resort']],
            default => ['label' => 'cool holiday season', 'words' => ['knit', 'blazer', 'coat', 'formal', 'cardigan', 'long sleeve', 'holiday']],
        };
    }
}
