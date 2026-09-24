<?php

/**
 * _smoke_stylist_knowledge.php — verify the Hiraya-grounding fix.
 *
 * Covers the specific defects repaired in this pass:
 *
 *   1. A product whose `sizes` is the LEGACY MAP shape ({"XS":234}) must still
 *      be matchable by its size label — previously it iterated to [234] and
 *      matched nothing.
 *   2. The standard LIST shape must keep working.
 *   3. The rule engine must answer a size question HONESTLY when no catalog
 *      piece carries that label (no "0 pieces" dead end, no invented stock).
 *   4. `sizes` must be treated as PER-GARMENT, not as the whole store's range.
 *   5. The Gemini prompt must actually contain the Hiraya knowledge block.
 *
 * Usage: php _smoke_stylist_knowledge.php
 */

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;

$pass = 0;
$fail = 0;

$check = function (string $label, bool $ok, string $detail = '') use (&$pass, &$fail) {
    if ($ok) {
        $pass++;
        echo "  PASS  {$label}" . PHP_EOL;
    } else {
        $fail++;
        echo "  FAIL  {$label}" . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    }
};

$controller = app(TryOnController::class);

echo PHP_EOL . '=== STYLIST KNOWLEDGE SMOKE ===' . PHP_EOL;

/* ---- 1. normaliseSizeLabels handles BOTH DB shapes ---- */
$norm = new ReflectionMethod(TryOnController::class, 'normaliseSizeLabels');
$norm->setAccessible(true);

$check(
    'legacy MAP yields its KEYS, not quantities',
    $norm->invoke($controller, ['XS' => 234]) === ['XS'],
    json_encode($norm->invoke($controller, ['XS' => 234]))
);
$check(
    'legacy MAP with several keys',
    $norm->invoke($controller, ['XS' => 12, 'S' => 30, 'M' => 5]) === ['XS', 'S', 'M'],
    json_encode($norm->invoke($controller, ['XS' => 12, 'S' => 30, 'M' => 5]))
);
$check(
    'standard LIST still works',
    $norm->invoke($controller, ['S', 'M', 'L', 'XL']) === ['S', 'M', 'L', 'XL'],
    json_encode($norm->invoke($controller, ['S', 'M', 'L', 'XL']))
);
$check(
    'labels are upper-cased and de-duplicated',
    $norm->invoke($controller, ['s', 'S', 'm']) === ['S', 'M'],
    json_encode($norm->invoke($controller, ['s', 'S', 'm']))
);
$check(
    'object rows fall back to size_label',
    $norm->invoke($controller, [['size_label' => 'M', 'stock' => 9]]) === ['M'],
    json_encode($norm->invoke($controller, [['size_label' => 'M', 'stock' => 9]]))
);
$check(
    'empty / null is safe',
    $norm->invoke($controller, null) === [] && $norm->invoke($controller, '') === [],
);
$check(
    'JSON string is decoded',
    $norm->invoke($controller, '{"L":4}') === ['L'],
    json_encode($norm->invoke($controller, '{"L":4}'))
);

/* ---- 2. sizesPresentInCatalog returns real labels only ---- */
$present = new ReflectionMethod(TryOnController::class, 'sizesPresentInCatalog');
$present->setAccessible(true);
$catalogSizes = $present->invoke($controller);

$check('catalog sizes is an array', is_array($catalogSizes));
$check(
    'catalog sizes are non-empty strings',
    $catalogSizes === array_values(array_filter($catalogSizes, fn($s) => is_string($s) && $s !== '')),
    json_encode($catalogSizes)
);
echo '        catalog sizes now: ' . (empty($catalogSizes) ? '(none)' : implode(', ', $catalogSizes)) . PHP_EOL;

/* ---- 3. Honest reply when the recommended size has no stock ---- */
$ask = function (string $message, array $context) {
    $request = Illuminate\Http\Request::create('/api/tryon/chat', 'POST', [
        'message' => $message,
        'context' => $context,
    ]);

    return app(TryOnController::class)->chat($request)->getData(true);
};

// A rule-engine size answer (force `rules` by asking a size question with a
// measurement set; if Gemini is configured the shape checks below still hold).
$sizeAsk = $ask('What is my size?', [
    'measurements' => ['chest_bust' => 90, 'waist' => 72, 'hips' => 95],
    'selected_garments' => [],
]);
$check('size answer returned', ! empty($sizeAsk['reply']));
$check(
    'no fabricated "0 piece(s)" wording',
    ! str_contains((string) $sizeAsk['reply'], '0 piece(s)'),
    substr((string) $sizeAsk['reply'], 0, 140)
);
$check(
    'products payload is always an array',
    is_array($sizeAsk['products'] ?? null)
);

/* ---- 4. The prompt carries the Hiraya knowledge block ---- */
/*
 * The chart table is no longer a literal in the constant — it is appended at
 * runtime by hirayaKnowledge() so the AI always quotes the store's CURRENT
 * chart. Assert against the assembled block, which is what the model receives.
 */
$knowledge = (new ReflectionClass(TryOnController::class))->getConstant('HIRAYA_KNOWLEDGE');

$check('static knowledge constant exists', is_string($knowledge) && $knowledge !== '');

$assembled = new ReflectionMethod(TryOnController::class, 'hirayaKnowledge');
$assembled->setAccessible(true);
$block = $assembled->invoke($controller);

foreach (
    [
        'size chart'      => '/SIZE CHART/i',
        'garment domains' => '/GARMENT DOMAINS/i',
        'virtual fitting' => '/VIRTUAL FITTING FLOW/i',
        'per-garment'     => '/PER-GARMENT/i',
        'XS row'          => '/XS\s+chest_bust\s+81/i',
        '2XL row'         => '/2XL\s+chest_bust\s+116\.5/i',
    ] as $label => $pattern
) {
    $check("knowledge covers {$label}", (bool) preg_match($pattern, $block));
}

/*
 * The point of generating the table: it must equal the chart the rest of the
 * app uses. If someone re-hardcodes the numbers, this fails.
 */
$chart = App\Services\SizeChart::SIZES;
$allPresent = true;
$missing = [];
foreach ($chart as $label => $entry) {
    $needle = sprintf('chest_bust %s', $entry['band']['chest_bust']);
    if (! str_contains($block, $needle)) {
        $allPresent = false;
        $missing[] = $label;
    }
}
$check(
    'prompt chart matches SizeChart exactly (no drift)',
    $allPresent,
    'missing bands: ' . implode(', ', $missing)
);

echo PHP_EOL . "=== {$pass} passed, {$fail} failed ===" . PHP_EOL;

exit($fail === 0 ? 0 : 1);
