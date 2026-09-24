<?php

/**
 * _smoke_stylist_chat.php — verify the new intent-aware stylist chat WITHOUT a
 * browser or a live HTTP session.
 *
 * Calls TryOnController::chat() directly through the container with a synthetic
 * Request, across the intents the fallback is supposed to distinguish, and
 * asserts the response SHAPE (reply/source/intent/suggestions/products) plus the
 * specific bugs the rewrite was meant to fix:
 *
 *   1. the 'Hips95cm' spacing bug (label running into the value),
 *   2. the message actually influencing the reply (intent routing),
 *   3. quick-reply chips always present,
 *   4. catalog matches returned for a size that exists.
 *
 * Usage: php _smoke_stylist_chat.php
 */

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;
use Illuminate\Http\Request;

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

$ask = function (string $message, array $context) {
    $request = Request::create('/api/tryon/chat', 'POST', [
        'message' => $message,
        'context' => $context,
    ]);

    return app(TryOnController::class)->chat($request)->getData(true);
};

$context = [
    'measurements' => ['chest_bust' => 90, 'waist' => 72, 'hips' => 95],
    'selected_garments' => ['Emerald Knit Top', 'Beige Trousers'],
    'has_generated_image' => false,
];

echo PHP_EOL . '=== STYLIST CHAT SMOKE ===' . PHP_EOL;

/* ---- 1. Shape + the spacing bug ---- */
$size = $ask('What is my size?', $context);
$check('reply present', ! empty($size['reply']));
$check('source reported', in_array($size['source'], ['gemini', 'rules'], true), $size['source'] ?? 'missing');
$check('intent = size', ($size['intent'] ?? null) === 'size', $size['intent'] ?? 'missing');
$check(
    'hips spacing fixed (no "Hips95cm")',
    ! preg_match('/hips\s*\d/i', (string) $size['reply']) || str_contains((string) $size['reply'], 'hips 95cm'),
    substr((string) $size['reply'], 0, 120)
);
$check('suggestions present', is_array($size['suggestions']) && count($size['suggestions']) > 0);
$check('products is an array', is_array($size['products'] ?? null));

/* ---- 2. Intent routing actually changes the answer ---- */
$occasion = $ask('What should I wear to a party?', $context);
$check('intent = occasion', ($occasion['intent'] ?? null) === 'occasion', $occasion['intent'] ?? 'missing');
$check(
    'occasion reply differs from size reply',
    $occasion['reply'] !== $size['reply']
);

$color = $ask('What colors suit me?', $context);
$check('intent = color', ($color['intent'] ?? null) === 'color', $color['intent'] ?? 'missing');

$greeting = $ask('hello there', $context);
$check('intent = greeting', ($greeting['intent'] ?? null) === 'greeting', $greeting['intent'] ?? 'missing');

/* ---- 3. Missing measurements must NOT invent a size ---- */
$noMeasure = $ask('What is my size?', ['measurements' => [], 'selected_garments' => []]);
$check(
    'no size invented without measurements',
    ! preg_match('/recommended size is/i', (string) $noMeasure['reply']),
    substr((string) $noMeasure['reply'], 0, 120)
);
$check(
    'no products without a size',
    ($noMeasure['products'] ?? null) === []
);

/* ---- 4. Hips can only bump the size UP (never down) ---- */
$ctrl = app(TryOnController::class);
$m = new ReflectionMethod(TryOnController::class, 'recommendSize');
$m->setAccessible(true);

$check('S without hips', $m->invoke($ctrl, 85.0, 68.0, null) === 'S');
$check('hips bump S -> M', $m->invoke($ctrl, 85.0, 68.0, 95.0) === 'M');
$check('hips never shrink M -> S', $m->invoke($ctrl, 93.0, 75.0, 70.0) === 'M');

echo PHP_EOL . "=== {$pass} passed, {$fail} failed ===" . PHP_EOL;

exit($fail === 0 ? 0 : 1);
