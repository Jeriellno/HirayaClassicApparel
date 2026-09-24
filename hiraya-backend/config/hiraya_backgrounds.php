<?php

/**
 * HIRAYA — Garment catalog FRAME + Occasion/Vibe vocabulary.
 *
 * THE FRAME (single, shared by EVERY garment)
 *   There is exactly ONE default catalog layout: an obsidian-black canvas with
 *   gold ornamental borders, the HIRAYA logo at the foot, and the cut-out
 *   garment centred. It is drawn in CODE by the frontend compositor
 *   (`garmentCompositor.js`) so it needs no uploaded image and is pixel-perfect
 *   and identical for every product.
 *
 *   Only TWO things change per garment: the cut-out garment itself, and the
 *   product name. Nothing else about the frame is product-specific.
 *
 * OCCASIONS / VIBES
 *   The occasion vocabulary below is NO LONGER used to pick a background. It is
 *   now purely PRODUCT DETAIL: the AI still tags each garment with its
 *   occasion/vibe and those tags are shown on the customer's shop surfaces.
 */
return [

    /*
    |--------------------------------------------------------------------------
    | The single shared catalog frame
    |--------------------------------------------------------------------------
    | Values mirror the frontend compositor defaults. Exposed here so the palette
    | can be audited/adjusted in one place; the compositor has matching constants
    | and does not need to fetch these at runtime.
    */
    'frame' => [
        'background'   => '#000',      // obsidian base canvas
        'vignette'     => '#161616',   // subtle radial lift behind the garment
        'frame_color'  => '#E9C46A',   // official brand gold
        'frame_accent' => '#F2D89B',   // soft gold highlight
    ],

    /*
    |--------------------------------------------------------------------------
    | Default occasion (PRODUCT DETAIL ONLY)
    |--------------------------------------------------------------------------
    | Used when the AI's occasion cannot be matched. Does NOT affect the frame.
    */
    'default' => 'everyday',

    /*
    |--------------------------------------------------------------------------
    | Occasion / vibe vocabulary
    |--------------------------------------------------------------------------
    | `aliases` are lowercase match tokens used to CANONICALISE the AI's
    | `occasions` array, so "Beach Wear" and "beachwear" both normalise to
    | `summer`. These are stored on the product as styling detail and surfaced in
    | the shop — they no longer select a background.
    */
    'occasions' => [

        'summer' => [
            'label' => 'Summer',
            'aliases' => ['summer', 'beach', 'beachwear', 'vacation', 'resort', 'tropical', 'swim', 'pool'],
        ],

        'cultural' => [
            'label' => 'Cultural / Traditional',
            'aliases' => ['cultural', 'traditional', 'filipiniana', 'barong', 'ethnic', 'heritage', 'tribal', 'native'],
        ],

        'formal' => [
            'label' => 'Formal / Evening',
            'aliases' => ['formal', 'evening', 'gala', 'black tie', 'wedding', 'cocktail', 'prom', 'semi formal'],
        ],

        'business' => [
            'label' => 'Business / Office',
            'aliases' => ['business', 'office', 'work', 'corporate', 'professional', 'interview', 'business casual', 'smart casual'],
        ],

        'streetwear' => [
            'label' => 'Streetwear / Urban',
            'aliases' => ['street', 'streetwear', 'urban', 'street style', 'hip hop', 'skate', 'grunge'],
        ],

        'everyday' => [
            'label' => 'Everyday / Casual',
            'aliases' => ['everyday', 'casual', 'daily', 'weekend', 'lounge', 'relaxed', 'basic', 'errand'],
        ],

    ],
];
