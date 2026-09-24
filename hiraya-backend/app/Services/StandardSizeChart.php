<?php

namespace App\Services;

use App\Models\SizeChart;

/**
 * StandardSizeChart
 *
 * Provides standardized measurement ranges (in cm) for common size
 * labels across categories and genders. Used as a fallback when a
 * product has no explicit size measurement data.
 *
 * Resolution order for each size:
 *   1. Database size_charts table (runtime-managed by admins)
 *   2. Hardcoded standard chart (fallback of last resort)
 *
 * Ranges are based on standard US/international sizing guidelines,
 * converted to centimeters. Each entry provides min/max for the
 * 5 core measurements: chest_bust, waist, hips, shoulder_width,
 * sleeve_length.
 */
class StandardSizeChart
{
    /**
     * The 5 core measurement keys.
     */
    public const MEASUREMENTS = [
        'chest_bust',
        'waist',
        'hips',
        'shoulder_width',
        'sleeve_length',
    ];

    /**
     * Standard size charts organized by [category][gender][size] => [measurement => [min, max]]
     *
     * All values are in centimeters.
     */
    private array $charts = [
        // =========================================================
        // TOPS
        // =========================================================
        'TOPS' => [
            'Men' => [
                'XS'  => ['chest_bust' => [81, 86], 'waist' => [66, 71], 'hips' => [81, 86], 'shoulder_width' => [36, 38], 'sleeve_length' => [58, 60]],
                'S'   => ['chest_bust' => [86, 91], 'waist' => [71, 76], 'hips' => [86, 91], 'shoulder_width' => [38, 40], 'sleeve_length' => [60, 62]],
                'M'   => ['chest_bust' => [91, 97], 'waist' => [76, 81], 'hips' => [91, 96], 'shoulder_width' => [40, 42], 'sleeve_length' => [62, 65]],
                'L'   => ['chest_bust' => [97, 104], 'waist' => [81, 89], 'hips' => [96, 102], 'shoulder_width' => [42, 44], 'sleeve_length' => [65, 67]],
                'XL'  => ['chest_bust' => [104, 111], 'waist' => [89, 97], 'hips' => [102, 110], 'shoulder_width' => [44, 46], 'sleeve_length' => [67, 69]],
                '2XL' => ['chest_bust' => [111, 119], 'waist' => [97, 104], 'hips' => [110, 117], 'shoulder_width' => [46, 48], 'sleeve_length' => [69, 71]],
            ],
            'Women' => [
                'XS'  => ['chest_bust' => [79, 84], 'waist' => [59, 63], 'hips' => [83, 88], 'shoulder_width' => [33, 35], 'sleeve_length' => [56, 58]],
                'S'   => ['chest_bust' => [84, 89], 'waist' => [63, 67], 'hips' => [88, 93], 'shoulder_width' => [35, 37], 'sleeve_length' => [58, 60]],
                'M'   => ['chest_bust' => [89, 94], 'waist' => [67, 72], 'hips' => [93, 98], 'shoulder_width' => [37, 39], 'sleeve_length' => [60, 62]],
                'L'   => ['chest_bust' => [94, 99], 'waist' => [72, 77], 'hips' => [98, 103], 'shoulder_width' => [39, 41], 'sleeve_length' => [62, 64]],
                'XL'  => ['chest_bust' => [99, 104], 'waist' => [77, 82], 'hips' => [103, 108], 'shoulder_width' => [41, 43], 'sleeve_length' => [64, 66]],
            ],
            'Unisex' => [
                'XS'  => ['chest_bust' => [81, 86], 'waist' => [63, 68], 'hips' => [81, 86], 'shoulder_width' => [36, 38], 'sleeve_length' => [58, 60]],
                'S'   => ['chest_bust' => [86, 91], 'waist' => [68, 73], 'hips' => [86, 91], 'shoulder_width' => [38, 40], 'sleeve_length' => [60, 62]],
                'M'   => ['chest_bust' => [91, 97], 'waist' => [73, 78], 'hips' => [91, 96], 'shoulder_width' => [40, 42], 'sleeve_length' => [62, 65]],
                'L'   => ['chest_bust' => [97, 104], 'waist' => [78, 84], 'hips' => [96, 102], 'shoulder_width' => [42, 44], 'sleeve_length' => [65, 67]],
                'XL'  => ['chest_bust' => [104, 111], 'waist' => [84, 91], 'hips' => [102, 108], 'shoulder_width' => [44, 46], 'sleeve_length' => [67, 69]],
            ],
        ],

        // =========================================================
        // BOTTOMS
        // =========================================================
        'BOTTOMS' => [
            'Men' => [
                'XS'  => ['waist' => [66, 71], 'hips' => [81, 86]],
                'S'   => ['waist' => [71, 76], 'hips' => [86, 91]],
                'M'   => ['waist' => [76, 81], 'hips' => [91, 96]],
                'L'   => ['waist' => [81, 89], 'hips' => [96, 102]],
                'XL'  => ['waist' => [89, 97], 'hips' => [102, 108]],
                '2XL' => ['waist' => [97, 104], 'hips' => [108, 114]],
            ],
            'Women' => [
                'XS'  => ['waist' => [59, 63], 'hips' => [83, 88]],
                'S'   => ['waist' => [63, 67], 'hips' => [88, 93]],
                'M'   => ['waist' => [67, 72], 'hips' => [93, 98]],
                'L'   => ['waist' => [72, 77], 'hips' => [98, 103]],
                'XL'  => ['waist' => [77, 82], 'hips' => [103, 108]],
            ],
            'Unisex' => [
                'XS'  => ['waist' => [63, 68], 'hips' => [81, 86]],
                'S'   => ['waist' => [68, 73], 'hips' => [86, 91]],
                'M'   => ['waist' => [73, 78], 'hips' => [91, 96]],
                'L'   => ['waist' => [78, 84], 'hips' => [96, 102]],
                'XL'  => ['waist' => [84, 91], 'hips' => [102, 108]],
            ],
        ],

        // =========================================================
        // DRESSES
        // =========================================================
        'DRESSES' => [
            'Women' => [
                'XS'  => ['chest_bust' => [79, 84], 'waist' => [59, 63], 'hips' => [83, 88], 'shoulder_width' => [33, 35], 'sleeve_length' => [56, 58]],
                'S'   => ['chest_bust' => [84, 89], 'waist' => [63, 67], 'hips' => [88, 93], 'shoulder_width' => [35, 37], 'sleeve_length' => [58, 60]],
                'M'   => ['chest_bust' => [89, 94], 'waist' => [67, 72], 'hips' => [93, 98], 'shoulder_width' => [37, 39], 'sleeve_length' => [60, 62]],
                'L'   => ['chest_bust' => [94, 99], 'waist' => [72, 77], 'hips' => [98, 103], 'shoulder_width' => [39, 41], 'sleeve_length' => [62, 64]],
                'XL'  => ['chest_bust' => [99, 104], 'waist' => [77, 82], 'hips' => [103, 108], 'shoulder_width' => [41, 43], 'sleeve_length' => [64, 66]],
            ],
        ],

        // =========================================================
        // OUTERWEAR
        // =========================================================
        'OUTERWEAR' => [
            'Men' => [
                'XS'  => ['chest_bust' => [89, 94], 'waist' => [71, 76], 'hips' => [86, 91], 'shoulder_width' => [40, 42], 'sleeve_length' => [62, 65]],
                'S'   => ['chest_bust' => [94, 99], 'waist' => [76, 81], 'hips' => [91, 96], 'shoulder_width' => [42, 44], 'sleeve_length' => [64, 66]],
                'M'   => ['chest_bust' => [99, 104], 'waist' => [81, 89], 'hips' => [96, 102], 'shoulder_width' => [44, 46], 'sleeve_length' => [66, 68]],
                'L'   => ['chest_bust' => [104, 111], 'waist' => [89, 97], 'hips' => [102, 108], 'shoulder_width' => [46, 48], 'sleeve_length' => [68, 70]],
                'XL'  => ['chest_bust' => [111, 119], 'waist' => [97, 104], 'hips' => [108, 114], 'shoulder_width' => [48, 50], 'sleeve_length' => [70, 72]],
            ],
            'Women' => [
                'XS'  => ['chest_bust' => [84, 89], 'waist' => [59, 63], 'hips' => [83, 88], 'shoulder_width' => [35, 37], 'sleeve_length' => [58, 60]],
                'S'   => ['chest_bust' => [89, 94], 'waist' => [63, 67], 'hips' => [88, 93], 'shoulder_width' => [37, 39], 'sleeve_length' => [60, 62]],
                'M'   => ['chest_bust' => [94, 99], 'waist' => [67, 72], 'hips' => [93, 98], 'shoulder_width' => [39, 41], 'sleeve_length' => [62, 64]],
                'L'   => ['chest_bust' => [99, 104], 'waist' => [72, 77], 'hips' => [98, 103], 'shoulder_width' => [41, 43], 'sleeve_length' => [64, 66]],
                'XL'  => ['chest_bust' => [104, 109], 'waist' => [77, 82], 'hips' => [103, 108], 'shoulder_width' => [43, 45], 'sleeve_length' => [66, 68]],
            ],
            'Unisex' => [
                'S'   => ['chest_bust' => [94, 99], 'waist' => [71, 77], 'hips' => [88, 93], 'shoulder_width' => [42, 44], 'sleeve_length' => [64, 66]],
                'M'   => ['chest_bust' => [99, 104], 'waist' => [77, 84], 'hips' => [93, 98], 'shoulder_width' => [44, 46], 'sleeve_length' => [66, 68]],
                'L'   => ['chest_bust' => [104, 111], 'waist' => [84, 91], 'hips' => [98, 103], 'shoulder_width' => [46, 48], 'sleeve_length' => [68, 70]],
                'XL'  => ['chest_bust' => [111, 119], 'waist' => [91, 97], 'hips' => [102, 108], 'shoulder_width' => [48, 50], 'sleeve_length' => [70, 72]],
            ],
        ],

        // =========================================================
        // FORMAL_MEN / FORMAL_WOMEN (specialized categories)
        // =========================================================
        'FORMAL_MEN' => [
            'Men' => [
                'S'   => ['chest_bust' => [91, 97], 'waist' => [76, 81], 'hips' => [91, 96], 'shoulder_width' => [40, 42], 'sleeve_length' => [62, 65]],
                'M'   => ['chest_bust' => [97, 104], 'waist' => [81, 89], 'hips' => [96, 102], 'shoulder_width' => [42, 44], 'sleeve_length' => [65, 67]],
                'L'   => ['chest_bust' => [104, 111], 'waist' => [89, 97], 'hips' => [102, 108], 'shoulder_width' => [44, 46], 'sleeve_length' => [67, 69]],
                'XL'  => ['chest_bust' => [111, 119], 'waist' => [97, 104], 'hips' => [108, 114], 'shoulder_width' => [46, 48], 'sleeve_length' => [69, 71]],
            ],
        ],
        'FORMAL_WOMEN' => [
            'Women' => [
                'XS'  => ['chest_bust' => [79, 84], 'waist' => [59, 63], 'hips' => [83, 88], 'shoulder_width' => [33, 35], 'sleeve_length' => [56, 58]],
                'S'   => ['chest_bust' => [84, 89], 'waist' => [63, 67], 'hips' => [88, 93], 'shoulder_width' => [35, 37], 'sleeve_length' => [58, 60]],
                'M'   => ['chest_bust' => [89, 94], 'waist' => [67, 72], 'hips' => [93, 98], 'shoulder_width' => [37, 39], 'sleeve_length' => [60, 62]],
                'L'   => ['chest_bust' => [94, 99], 'waist' => [72, 77], 'hips' => [98, 103], 'shoulder_width' => [39, 41], 'sleeve_length' => [62, 64]],
                'XL'  => ['chest_bust' => [99, 104], 'waist' => [77, 82], 'hips' => [103, 108], 'shoulder_width' => [41, 43], 'sleeve_length' => [64, 66]],
            ],
        ],
    ];

    /**
     * Get the standard measurement range for a given size.
     *
     * @param string $sizeLabel e.g. "M", "L", "32"
     * @param string $category e.g. "TOPS", "BOTTOMS"
     * @param string $gender e.g. "Men", "Women", "Unisex"
     * @return array<string, array{min: float, max: float}>|null
     */
    public function getSizeRange(string $sizeLabel, string $category, string $gender): ?array
    {
        $category = strtoupper($category);
        $sizeLabel = strtoupper($sizeLabel);

        // Phase 1: Try database (runtime-managed size charts)
        $dbEntry = SizeChart::byCategory($category)
            ->byGender($gender)
            ->bySizeLabel($sizeLabel)
            ->first();

        if ($dbEntry) {
            return $dbEntry->toMeasurementRange();
        }

        // Try database with Unisex fallback
        if (strtolower($gender) !== 'unisex') {
            $dbEntry = SizeChart::byCategory($category)
                ->byGender('Unisex')
                ->bySizeLabel($sizeLabel)
                ->first();

            if ($dbEntry) {
                return $dbEntry->toMeasurementRange();
            }
        }

        // Phase 2: Fall back to hardcoded standard charts
        $categories = $this->resolveCategories($category);

        foreach ($categories as $cat) {
            if (!isset($this->charts[$cat])) {
                continue;
            }

            $genders = $this->resolveGenders($gender, $cat);

            foreach ($genders as $g) {
                if (!isset($this->charts[$cat][$g][$sizeLabel])) {
                    continue;
                }

                return $this->formatRange($this->charts[$cat][$g][$sizeLabel]);
            }
        }

        return null;
    }

    /**
     * Check if a standard chart exists for the given category/gender.
     */
    public function hasChart(string $category, string $gender): bool
    {
        $category = strtoupper($category);
        $categories = $this->resolveCategories($category);

        foreach ($categories as $cat) {
            if (!isset($this->charts[$cat])) {
                continue;
            }

            $genders = $this->resolveGenders($gender, $cat);
            foreach ($genders as $g) {
                if (isset($this->charts[$cat][$g])) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Resolve a category to its hierarchy of chart keys.
     * e.g. "FORMAL_MEN" → ["FORMAL_MEN", "TOPS"]
     */
    private function resolveCategories(string $category): array
    {
        $map = [
            'FORMAL_MEN'   => ['FORMAL_MEN', 'TOPS'],
            'FORMAL_WOMEN' => ['FORMAL_WOMEN', 'DRESSES'],
        ];

        if (isset($map[$category])) {
            return $map[$category];
        }

        return [$category];
    }

    /**
     * Resolve gender priority — try exact match, then Unisex.
     */
    private function resolveGenders(string $gender, string $category): array
    {
        $genders = [$gender];

        // If gender is not in the chart for this category, add Unisex as fallback
        if (isset($this->charts[$category]['Unisex'])) {
            $genders[] = 'Unisex';
        }

        return $genders;
    }

    /**
     * Format [measurement => [min, max]] into [measurement_min => min, measurement_max => max].
     */
    private function formatRange(array $range): array
    {
        $result = [];
        foreach ($range as $measurement => $values) {
            $result["{$measurement}_min"] = (float) $values[0];
            $result["{$measurement}_max"] = (float) $values[1];
        }
        return $result;
    }
}
