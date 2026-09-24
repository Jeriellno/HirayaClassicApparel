<?php

namespace App\Services;

use App\Models\Product;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

class OutfitRecommendationService
{
    /** Maximum distance from a garment measurement that still counts as a close match. */
    private const TOLERANCE_CM = 8.0;

    protected MeasurementNormalizer $normalizer;

    public function __construct(MeasurementNormalizer $normalizer)
    {
        $this->normalizer = $normalizer;
    }

    public function getRecommendations(User $user, int $limit = 6): Collection
    {
        // Cache per user, invalidated automatically when user model updates
        $productsVersion = Product::max('updated_at') ?? 'none';
        $cacheKey = "user_recommendations_v2_{$user->id}_" . md5($user->updated_at . '|' . $productsVersion . '|' . $limit);

        return Cache::remember($cacheKey, now()->addHours(6), function () use ($user, $limit) {
            $userMetrics = array_filter([
                'chest_bust'     => $user->chest_bust,
                'waist'          => $user->waist,
                'hips'           => $user->hips,
                'shoulder_width' => $user->shoulder_width,
                'sleeve_length'  => $user->sleeve_length,
            ]);

            if (empty($userMetrics)) {
                return collect([]);
            }

            // Products are active by presence in the catalog; the current products
            // schema does not contain an is_active column.
            // Personalized Spotlight must only use garments with real saved
            // measurements. Generic size-chart fallbacks are for other flows,
            // not for claiming a garment matches this user's body.
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
             */
            $products = Product::query()
                ->select([
                    'id', 'name', 'price', 'category', 'gender',
                    'sizes', 'size_measurements',
                    'image_url', 'display_image_url', 'background_occasion',
                ])
                ->whereNotNull('size_measurements')
                ->get()
                ->filter(fn ($product) => $this->hasSavedMeasurements($product->size_measurements));

            return $products->map(function ($product) use ($userMetrics) {
                // Normalize size measurements: parse free-form text, fall back to standard charts
                $normalizedSizeChart = $this->normalizer->normalize(
                    $product->size_measurements,
                    $product->category ?? '',
                    $product->gender ?? 'Unisex',
                    $product->sizes ?? []
                );

                $fitData = $this->evaluateProductFit($userMetrics, $normalizedSizeChart);
                $product->fit_score = $fitData['score'];
                $product->recommended_size = $fitData['size'];
                return $product;
            })
            ->filter(fn ($product) => $product->fit_score >= 60) // Include exact and close matches
            ->sortByDesc('fit_score')
            ->take($limit)
            ->values();
        });
    }

    private function evaluateProductFit(array $userMetrics, ?array $sizeChart): array
    {
        if (empty($sizeChart)) {
            return ['score' => 0, 'size' => null];
        }

        $maxScore = 0;
        $matchedSize = null;

        foreach ($sizeChart as $sizeLabel => $garmentSpecs) {
            if (!is_array($garmentSpecs)) {
                continue;
            }

            $matches = 0;
            $evaluatedCount = 0;

            foreach ($userMetrics as $metric => $userVal) {
                // Support both min/max format (from normalizer) and single-value format
                $minKey = "{$metric}_min";
                $maxKey = "{$metric}_max";

                if (isset($garmentSpecs[$minKey]) && isset($garmentSpecs[$maxKey])) {
                    $evaluatedCount++;
                    $minVal = (float) $garmentSpecs[$minKey];
                    $maxVal = (float) $garmentSpecs[$maxKey];

                    $userMetricVal = (float) $userVal;
                    $distance = $userMetricVal < $minVal
                        ? $minVal - $userMetricVal
                        : ($userMetricVal > $maxVal ? $userMetricVal - $maxVal : 0);
                    $matches += max(0, 1 - ($distance / self::TOLERANCE_CM));
                } elseif (isset($garmentSpecs[$metric])) {
                    // Legacy single-value format
                    $evaluatedCount++;
                    $garmentVal = (float) $garmentSpecs[$metric];

                    $distance = abs($garmentVal - (float) $userVal);
                    $matches += max(0, 1 - ($distance / self::TOLERANCE_CM));
                }
            }

            if ($evaluatedCount > 0) {
                $score = round(($matches / $evaluatedCount) * 100);
                if ($score > $maxScore) {
                    $maxScore = $score;
                    $matchedSize = $sizeLabel;
                }
            }
        }

        return [
            'score' => $maxScore,
            'size' => $matchedSize,
        ];
    }

    private function hasSavedMeasurements(mixed $measurements): bool
    {
        if (is_string($measurements)) {
            $measurements = json_decode($measurements, true) ?? [];
        }

        if (!is_array($measurements)) {
            return false;
        }

        foreach ($measurements as $sizeMeasurements) {
            if (!is_array($sizeMeasurements)) {
                continue;
            }

            foreach ($sizeMeasurements as $value) {
                if (is_numeric($value)) {
                    return true;
                }
            }
        }

        return false;
    }
}