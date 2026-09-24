<?php

namespace Database\Seeders;

use App\Models\SizeChart;
use Illuminate\Database\Seeder;

class SizeChartSeeder extends Seeder
{
    /**
     * Standard size charts organized by [category][gender][size] => [measurement => [min, max]]
     *
     * All values are in centimeters. Mirrors StandardSizeChart::charts so the
     * database is the source of truth and admins can edit from a known baseline.
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
        // FORMAL_MEN
        // =========================================================
        'FORMAL_MEN' => [
            'Men' => [
                'S'   => ['chest_bust' => [91, 97], 'waist' => [76, 81], 'hips' => [91, 96], 'shoulder_width' => [40, 42], 'sleeve_length' => [62, 65]],
                'M'   => ['chest_bust' => [97, 104], 'waist' => [81, 89], 'hips' => [96, 102], 'shoulder_width' => [42, 44], 'sleeve_length' => [65, 67]],
                'L'   => ['chest_bust' => [104, 111], 'waist' => [89, 97], 'hips' => [102, 108], 'shoulder_width' => [44, 46], 'sleeve_length' => [67, 69]],
                'XL'  => ['chest_bust' => [111, 119], 'waist' => [97, 104], 'hips' => [108, 114], 'shoulder_width' => [46, 48], 'sleeve_length' => [69, 71]],
            ],
        ],

        // =========================================================
        // FORMAL_WOMEN
        // =========================================================
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

    public function run(): void
    {
        SizeChart::truncate();

        $records = [];

        foreach ($this->charts as $category => $genders) {
            foreach ($genders as $gender => $sizes) {
                foreach ($sizes as $sizeLabel => $measurements) {
                    $records[] = [
                        'category'   => $category,
                        'gender'     => $gender,
                        'size_label' => $sizeLabel,
                        'chest_bust_min'       => $measurements['chest_bust'][0] ?? null,
                        'chest_bust_max'       => $measurements['chest_bust'][1] ?? null,
                        'waist_min'            => $measurements['waist'][0] ?? null,
                        'waist_max'            => $measurements['waist'][1] ?? null,
                        'hips_min'             => $measurements['hips'][0] ?? null,
                        'hips_max'             => $measurements['hips'][1] ?? null,
                        'shoulder_width_min'   => $measurements['shoulder_width'][0] ?? null,
                        'shoulder_width_max'   => $measurements['shoulder_width'][1] ?? null,
                        'sleeve_length_min'    => $measurements['sleeve_length'][0] ?? null,
                        'sleeve_length_max'    => $measurements['sleeve_length'][1] ?? null,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }
            }
        }

        SizeChart::insert($records);
    }
}
