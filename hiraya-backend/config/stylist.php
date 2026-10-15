<?php

/*
|--------------------------------------------------------------------------
| AI Stylist rules
|--------------------------------------------------------------------------
|
| "AI describes, rules choose, the customer decides."
|
| The photo analysis (Gemini) only DESCRIBES the photo. Every recommendation
| is chosen by the rules below, so each pick can be explained ("Bagay sa warm
| palette mo", "In your size M") and the same inputs always give the same looks.
| Edit this file to tune the stylist; no code change is needed.
|
*/

return [

    /*
    | COLOR NAME -> UNDERTONE.
    | Products store plain color names (`products.colors`, e.g. "Cream",
    | "Navy"). A color matching the customer's confirmed undertone scores
    | higher; `neutral` colors suit everyone. Unknown names count as neutral.
    */
    'color_undertones' => [
        'warm' => [
            'cream', 'ivory', 'beige', 'camel', 'tan', 'khaki', 'brown', 'chocolate', 'coffee',
            'olive', 'mustard', 'yellow', 'gold', 'orange', 'rust', 'terracotta', 'coral',
            'peach', 'red', 'maroon', 'copper', 'bronze', 'sand', 'mocha', 'caramel',
        ],
        'cool' => [
            'blue', 'royal blue', 'sky blue', 'light blue', 'teal', 'emerald', 'mint', 'purple',
            'lavender', 'lilac', 'plum', 'pink', 'rose', 'fuchsia', 'magenta', 'silver',
            'burgundy', 'wine', 'ice', 'periwinkle',
        ],
        'neutral' => [
            'white', 'off-white', 'black', 'gray', 'grey', 'charcoal', 'navy', 'denim',
            'green', 'taupe', 'nude', 'standard',
        ],
    ],

    /*
    | OCCASION COMPATIBILITY.
    | Keys are the store's occasion vocabulary (config/hiraya_backgrounds.php ->
    | occasions, stored on products as `background_occasion`). A piece tagged
    | with the chosen occasion is an exact match; a piece tagged with one of the
    | listed compatible occasions may still complete the look.
    */
    'occasions' => [
        'everyday'   => ['label' => 'Everyday',     'compatible' => ['summer', 'streetwear', 'business']],
        // A barong is everyday office wear in the Philippines, hence `cultural`.
        'business'   => ['label' => 'Office',       'compatible' => ['formal', 'cultural', 'everyday']],
        'formal'     => ['label' => 'Formal',       'compatible' => ['cultural', 'business']],
        // Barong / Filipiniana is worn with formal or office trousers and skirts.
        'cultural'   => ['label' => 'Filipiniana',  'compatible' => ['formal', 'business']],
        'summer'     => ['label' => 'Summer',       'compatible' => ['everyday']],
        'streetwear' => ['label' => 'Streetwear',   'compatible' => ['everyday']],
    ],

    /*
    | SCORING WEIGHTS (higher = more important).
    */
    'weights' => [
        'occasion_exact'      => 4,
        'occasion_compatible' => 2,
        'undertone_match'     => 3,
        'undertone_neutral'   => 1,
        'stylist_pairing'     => 4,
        'fit_match'           => 2,
        'season'              => 1,
    ],

    // How many looks to build, and alternatives offered per slot (‹ ›).
    'max_looks' => 3,
    'alternatives_per_slot' => 2,

    // Photo analysis: how long a finished/failed analysis stays cached (minutes).
    'analysis_ttl_minutes' => 120,
];
