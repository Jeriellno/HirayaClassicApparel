<?php

/**
 * HIRAYA â€” Garment catalog OCCASION BACKGROUNDS.
 *
 * THE BACKGROUNDS (one per occasion, NOT one shared card)
 *   The catalog image used to be a single obsidian-black canvas with gold
 *   ornamental borders, identical for every product. The AI already tags each
 *   garment with an occasion/vibe, and the resolver below already canonicalised
 *   that tag â€” but the answer was thrown away and every garment got the same
 *   black card, so a linen summer dress and a midnight barong looked like the
 *   same shoot.
 *
 *   The occasion now SELECTS the background. Each preset is drawn in CODE by the
 *   frontend compositor (`garmentCompositor.js` + `framePresets.js`) so it needs
 *   no uploaded image, is pixel-consistent, and costs no network request.
 *   `config/hiraya_backgrounds.php` holds the vocabulary and labels; the actual
 *   colours live in `src/utils/framePresets.js`, mirrored key-for-key.
 *
 *   Only TWO things vary per product: the cut-out garment, and the background its
 *   occasion selects.
 *
 * OCCASIONS / VIBES
 *   Used BOTH as product detail (shown on the customer's shop surfaces) and as
 *   the background selector. The selection is DETERMINISTIC â€” no randomness
 *   anywhere â€” so the same garment with the same occasion always renders the same
 *   card, and a re-save never silently changes a product's look.
 */
return [

    /*
    |--------------------------------------------------------------------------
    | Default occasion
    |--------------------------------------------------------------------------
    | Used when neither the AI's occasion nor the garment category yields
    | anything usable. It also names the default BACKGROUND preset.
    */
    'default' => 'everyday',

    /*
    |--------------------------------------------------------------------------
    | Occasion / vibe vocabulary
    |--------------------------------------------------------------------------
    | `aliases` are lowercase match tokens used to CANONICALISE the AI's
    | `occasions` array, so "Beach Wear" and "beachwear" both normalise to
    | `summer`. The canonical key then selects the catalog BACKGROUND drawn for
     | that garment, and is also stored on the product as styling detail.
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
