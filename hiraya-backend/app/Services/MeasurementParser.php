<?php

namespace App\Services;

/**
 * MeasurementParser
 *
 * Parses free-form size measurement strings (e.g., "38-40 in bust",
 * "26.0 cm", "30-34 in elastic bust") into structured min/max
 * measurement data in centimeters.
 *
 * This bridges the gap between legacy un-structured size_measurements
 * (stored as text in the products table) and the structured comparison
 * expected by OutfitRecommendationService::evaluateProductFit().
 */
class MeasurementParser
{
    /**
     * Maps keywords found in free-form strings to standard measurement keys.
     * Order matters — more specific matches come first.
     */
    private const MEASUREMENT_KEYWORDS = [
        'chest'       => 'chest_bust',
        'bust'        => 'chest_bust',
        'waist'       => 'waist',
        'hip'         => 'hips',
        'shoulder'    => 'shoulder_width',
        'sleeve'      => 'sleeve_length',
        'length'      => 'sleeve_length',
    ];

    /**
     * Conversion factor: 1 inch = 2.54 cm
     */
    private const INCH_TO_CM = 2.54;

    /**
     * Parse a free-form measurement string into structured data.
     *
     * @param string $input e.g. "38-40 in bust", "26.0 cm", "15.5 collar"
     * @return array{
     *     min: float|null,
     *     max: float|null,
     *     unit: 'cm'|'in',
     *     measurement_type: string|null,
     *     raw: string
     * }|null Returns null if the string cannot be parsed.
     */
    public function parse(string $input): ?array
    {
        if (empty(trim($input))) {
            return null;
        }

        $lower = strtolower(trim($input));

        // Detect unit
        $unit = 'cm';
        if (str_contains($lower, 'in') || str_contains($lower, 'inch')) {
            $unit = 'in';
        }

        // Extract numbers — supports "38-40", "38 – 40", "38", "26.0"
        $numbers = [];
        preg_match_all('/(\d+(?:\.\d+)?)/', $lower, $matches);
        if (isset($matches[1])) {
            $numbers = array_map('floatval', $matches[1]);
        }

        if (empty($numbers)) {
            return null;
        }

        // Handle range vs single value
        $min = $numbers[0];
        $max = count($numbers) > 1 ? $numbers[count($numbers) - 1] : $min;

        // Convert to cm
        if ($unit === 'in') {
            $min = round($min * self::INCH_TO_CM, 2);
            $max = round($max * self::INCH_TO_CM, 2);
        } else {
            $min = round($min, 2);
            $max = round($max, 2);
        }

        // Infer measurement type from keywords
        $measurementType = $this->inferMeasurementType($lower);

        return [
            'min'             => $min,
            'max'             => $max,
            'unit'            => $unit,
            'measurement_type' => $measurementType,
            'raw'             => $input,
        ];
    }

    /**
     * Parse a product's size_measurements JSON/decoded array into
     * the structured format expected by evaluateProductFit().
     *
     * Input format (from DB):
     *   {"M": "38-40 in bust", "L": "42-44 in chest", "41": "26.0 cm"}
     *
     * Output format:
     *   ["M" => ["chest_bust_min" => 96.52, "chest_bust_max" => 101.6], ...]
     *
     * @param mixed $sizeMeasurements Raw from DB (string JSON or array)
     * @param string $category Product category (TOP, BOTTOMS, etc.)
     * @param string $gender Product gender
     * @return array<string, array<string, float>>
     */
    public function parseSizeMeasurements(mixed $sizeMeasurements, string $category = '', string $gender = ''): array
    {
        $decoded = $this->decodeJson($sizeMeasurements);
        if (empty($decoded) || !is_array($decoded)) {
            return [];
        }

        $structured = [];

        foreach ($decoded as $sizeLabel => $measurementText) {
            if (is_array($measurementText)) {
                // Already structured (from AddProductModal)
                $structured[$sizeLabel] = $this->normalizeStructuredSize($measurementText);
                continue;
            }

            if (!is_string($measurementText)) {
                continue;
            }

            $parsed = $this->parse($measurementText);

            if ($parsed && $parsed['measurement_type']) {
                $structured[$sizeLabel] = [
                    $parsed['measurement_type'] . '_min' => $parsed['min'],
                    $parsed['measurement_type'] . '_max' => $parsed['max'],
                ];
            } else {
                // No explicit keyword — infer from category + size label
                $inferred = $this->inferFromCategory($sizeLabel, $category, $gender);
                if ($inferred) {
                    $structured[$sizeLabel] = $inferred;
                }
            }
        }

        return $structured;
    }

    /**
     * If already structured (e.g., from AddProductModal with
     * chest_bust_min/chest_bust_max keys), normalize values to float.
     */
    private function normalizeStructuredSize(array $data): array
    {
        $result = [];
        foreach ($data as $key => $value) {
            if (is_numeric($value)) {
                $result[$key] = (float) $value;
            }
        }
        return $result;
    }

    /**
     * Infer measurement type from keywords in the measurement string.
     */
    private function inferMeasurementType(string $text): ?string
    {
        foreach (self::MEASUREMENT_KEYWORDS as $keyword => $field) {
            if (str_contains($text, $keyword)) {
                return $field;
            }
        }
        return null;
    }

    /**
     * Infer measurement from category + size label when no keyword
     * is present (e.g., footwear "26.0 cm" or bottoms "30" waist).
     *
     * Returns null for categories where body measurement matching
     * doesn't apply (e.g., raw foot length without context).
     */
    private function inferFromCategory(string $sizeLabel, string $category, string $gender): ?array
    {
        $category = strtoupper($category);

        // Category-based default measurement type
        $defaultMetric = match (true) {
            str_contains($category, 'TOP') || str_contains($category, 'OUTERWEAR') || str_contains($category, 'DRESS')
                => 'chest_bust',
            str_contains($category, 'BOTTOM') || str_contains($category, 'PANTS') || str_contains($category, 'JEANS')
                => 'waist',
            default => null,
        };

        if (!$defaultMetric) {
            return null;
        }

        // For numerical size labels on bottoms, they're typically waist measurements
        if (is_numeric($sizeLabel) && $defaultMetric === 'waist') {
            $waistInches = (float) $sizeLabel;
            $waistCm = round($waistInches * self::INCH_TO_CM, 2);
            // US waist sizes in inches → add ±1.5 inch tolerance in cm
            return [
                'waist_min' => $waistCm - 1.9,
                'waist_max' => $waistCm + 1.9,
            ];
        }

        // For numerical size labels on footwear, they're foot length in cm
        // Not mappable to body measurements — skip
        if (is_numeric($sizeLabel) && str_contains($category, 'FOOTWEAR')) {
            return null;
        }

        return null;
    }

    /**
     * Decode JSON string to array. If already array, return as-is.
     */
    private function decodeJson(mixed $data): mixed
    {
        if (is_string($data)) {
            $decoded = json_decode($data, true);
            return $decoded !== null ? $decoded : $data;
        }
        return $data;
    }
}
