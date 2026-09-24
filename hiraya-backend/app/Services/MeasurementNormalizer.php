<?php

namespace App\Services;

/**
 * MeasurementNormalizer
 *
 * Normalizes a product's size measurement data into a structured format
 * that OutfitRecommendationService::evaluateProductFit() can consume.
 *
 * Resolution order for each size variant:
 *   1. Structured data (from AddProductModal/EditProductModal with min/max keys)
 *   2. Free-form text parsing (from ProductSeeder or legacy entries)
 *   3. Standard size chart fallback (when no measurement data exists)
 *
 * All output values are in centimeters.
 */
class MeasurementNormalizer
{
    public MeasurementParser $parser;
    public StandardSizeChart $chart;

    public function __construct(
        MeasurementParser $parser,
        StandardSizeChart $chart
    ) {
        $this->parser = $parser;
        $this->chart = $chart;
    }

    /**
     * Normalize a product's size_measurements into structured data.
     *
     * @param mixed  $sizeMeasurements  Raw size_measurements from DB (string JSON or array)
     * @param string $category          Product category
     * @param string $gender            Product gender
     * @param array  $sizes             Product sizes (from sizes or size_stocks column)
     * @return array<string, array<string, float>>
     *   e.g. ["M" => ["chest_bust_min" => 91.2, "chest_bust_max" => 96.2, ...]]
     */
    public function normalize(mixed $sizeMeasurements, string $category, string $gender, array $sizes = []): array
    {
        // If sizeMeasurements is empty/null, try parsing sizes alone
        if (empty($sizeMeasurements)) {
            return $this->buildFromSizeLabels($sizes, $category, $gender);
        }

        // Phase 1: Try to parse existing measurement data (structured or text)
        $parsed = $this->parser->parseSizeMeasurements($sizeMeasurements, $category, $gender);

        if (!empty($parsed)) {
            // Merge parsed data with chart fallback for any sizes that weren't parsed
            $sizeLabels = $this->extractSizeLabels($sizes, $sizeMeasurements, $parsed);

            foreach ($sizeLabels as $label) {
                if (!isset($parsed[$label])) {
                    $chartRange = $this->chart->getSizeRange($label, $category, $gender);
                    if ($chartRange) {
                        $parsed[$label] = $chartRange;
                    }
                }
            }

            return $parsed;
        }

        // Phase 2: Fall back to standard size charts based on size labels
        return $this->buildFromSizeLabels($sizes, $category, $gender);
    }

    /**
     * Build measurement data from size labels alone (no measurement text).
     * Uses the standard size chart as fallback.
     */
    private function buildFromSizeLabels(array $sizes, string $category, string $gender): array
    {
        $decoded = $this->decodeJson($sizes);
        $labels = [];

        if (is_array($decoded)) {
            foreach ($decoded as $key => $value) {
                $label = is_string($key) ? $key : $value;
                if (is_string($label) || is_numeric($label)) {
                    $labels[] = (string) $label;
                }
            }
        }

        if (empty($labels)) {
            return [];
        }

        $structured = [];

        foreach ($labels as $label) {
            $chartRange = $this->chart->getSizeRange($label, $category, $gender);
            if ($chartRange) {
                $structured[$label] = $chartRange;
            }
        }

        return $structured;
    }

    /**
     * Extract all size labels from all available sources.
     */
    private function extractSizeLabels(array $sizes, mixed $sizeMeasurements, array $parsed): array
    {
        $labels = array_keys($parsed);

        $decodedSizes = $this->decodeJson($sizes);
        if (is_array($decodedSizes)) {
            foreach ($decodedSizes as $key => $value) {
                $label = is_string($key) ? $key : (is_string($value) ? $value : null);
                if ($label && !in_array($label, $labels, true)) {
                    $labels[] = $label;
                }
            }
        }

        $decodedMeasurements = $this->decodeJson($sizeMeasurements);
        if (is_array($decodedMeasurements)) {
            foreach ($decodedMeasurements as $key => $value) {
                if (!in_array($key, $labels, true)) {
                    $labels[] = $key;
                }
            }
        }

        return $labels;
    }

    /**
     * Decode JSON or return array as-is.
     */
    private function decodeJson(mixed $data): mixed
    {
        if (is_string($data)) {
            return json_decode($data, true) ?? [];
        }
        return $data;
    }
}
