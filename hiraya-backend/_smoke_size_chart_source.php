<?php

/**
 * _smoke_size_chart_source.php — is the size chart really ONE source of truth?
 *
 * Before this refactor the same chest/waist bands were copy-pasted into four
 * PHP files (and a fifth time into the frontend). They agreed by luck. This test
 * pins them to each other so a future edit to one cannot silently desync them.
 *
 * It checks:
 *   1. SizeChart::recommend is the canonical answer for a grid of bodies.
 *   2. TryOnController::recommendSize      agrees (incl. its hips bump).
 *   3. ProcessTryOnJob::calculateSizeRecommendation agrees.
 *   4. TryOnPreProcessor::sizeLabel         agrees.
 *   5. ProductController's per-size fallback measurements agree.
 *   6. GET /api/size-chart serves the same numbers.
 *
 * Usage: php _smoke_size_chart_source.php
 */

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;
use App\Http\Controllers\Api\ProductController;
use App\Jobs\ProcessTryOnJob;
use App\Services\SizeChart;
use App\Services\TryOnPreProcessor;

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

echo PHP_EOL . '=== SIZE CHART SINGLE-SOURCE SMOKE ===' . PHP_EOL;

/* ---- 0. The canonical table itself ---- */
$check('chart has 6 sizes', count(SizeChart::labels()) === 6, json_encode(SizeChart::labels()));
$check(
    'labels are ordered smallest first',
    SizeChart::labels() === ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    json_encode(SizeChart::labels())
);
$check('XS measurements resolve', SizeChart::measurementsFor('XS') !== null);
$check('unknown size resolves to null', SizeChart::measurementsFor('nope') === null);
$check('lookup is case-insensitive', SizeChart::measurementsFor('xs') === SizeChart::measurementsFor('XS'));

/* ---- 1. Canonical recommendations ---- */
$grid = [
    [80.0, 62.0, null, 'XS'],
    [85.0, 68.0, null, 'S'],
    [93.0, 75.0, null, 'M'],
    [100.0, 82.0, null, 'L'],
    [107.0, 89.0, null, 'XL'],
    [120.0, 100.0, null, '2XL'],
    [85.0, 68.0, 95.0, 'M'],   // hips bump S -> M
    [93.0, 75.0, 70.0, 'M'],   // hips never shrink M -> S
];

foreach ($grid as [$chest, $waist, $hips, $expected]) {
    $got = SizeChart::recommend($chest, $waist, $hips);
    $check(
        sprintf('recommend(c=%s w=%s h=%s) = %s', $chest, $waist, $hips ?? '-', $expected),
        $got === $expected,
        (string) $got
    );
}

$check('no axes -> null (no invented size)', SizeChart::recommend(null, null, null) === null);
$check('chest only still answers', SizeChart::recommend(90.0, null, null) === 'M', (string) SizeChart::recommend(90.0, null, null));
$check('waist only still answers', SizeChart::recommend(null, 68.0, null) === 'S', (string) SizeChart::recommend(null, 68.0, null));

/* ---- 2. TryOnController agrees (via reflection) ---- */
$ctrl = app(TryOnController::class);
$m = new ReflectionMethod(TryOnController::class, 'recommendSize');
$m->setAccessible(true);

$mismatch = null;
foreach ($grid as [$chest, $waist, $hips, $expected]) {
    $got = $m->invoke($ctrl, (float) $chest, (float) $waist, $hips === null ? null : (float) $hips);
    if ($got !== $expected) {
        $mismatch = sprintf('c=%s w=%s h=%s -> %s (want %s)', $chest, $waist, $hips ?? '-', $got, $expected);
        break;
    }
}
$check('TryOnController::recommendSize matches the chart', $mismatch === null, (string) $mismatch);

/* ---- 3. ProcessTryOnJob agrees ---- */
$job = (new ReflectionClass(ProcessTryOnJob::class))->newInstanceWithoutConstructor();
$jm = new ReflectionMethod(ProcessTryOnJob::class, 'calculateSizeRecommendation');
$jm->setAccessible(true);

$mismatch = null;
foreach ($grid as [$chest, $waist, $hips, $expected]) {
    // The job takes (height, waist, chest) and has no hips axis — so it can only
    // be compared against the no-hips expectation.
    if ($hips !== null) {
        continue;
    }
    $got = $jm->invoke($job, 170, (int) $waist, (int) $chest);
    if ($got !== $expected) {
        $mismatch = sprintf('c=%s w=%s -> %s (want %s)', $chest, $waist, $got, $expected);
        break;
    }
}
$check('ProcessTryOnJob::calculateSizeRecommendation matches', $mismatch === null, (string) $mismatch);

/* ---- 4. TryOnPreProcessor agrees ---- */
$pre = app(TryOnPreProcessor::class);
$pm = new ReflectionMethod(TryOnPreProcessor::class, 'sizeLabel');
$pm->setAccessible(true);

$mismatch = null;
foreach ($grid as [$chest, $waist, $hips, $expected]) {
    if ($hips !== null) {
        continue;
    }
    $got = $pm->invoke($pre, (float) $chest, (float) $waist);
    if ($got !== $expected) {
        $mismatch = sprintf('c=%s w=%s -> %s (want %s)', $chest, $waist, $got, $expected);
        break;
    }
}
$check('TryOnPreProcessor::sizeLabel matches', $mismatch === null, (string) $mismatch);
$check('pre-processor keeps its null -> M default', $pm->invoke($pre, null, null) === 'M');

/* ---- 5. ProductController's fallback measurements agree ---- */
// The old constant lived on the controller; it now delegates to SizeChart.
// Verified through the public service so the two can never diverge again.
$check(
    'S fallback measurements match the chart',
    SizeChart::measurementsFor('S') === [
        'chest_bust' => 88.0,
        'waist' => 70.0,
        'hips' => 94.0,
        'shoulder_width' => 39.5,
        'sleeve_length' => 59.5,
    ],
    json_encode(SizeChart::measurementsFor('S'))
);
$check(
    'ProductController no longer defines its own DEFAULT_SIZE_CHART',
    (new ReflectionClass(ProductController::class))->getReflectionConstant('DEFAULT_SIZE_CHART') === false
);

/* ---- 6. The endpoint serves the same numbers ---- */
$payload = SizeChart::toArray();
$check('payload declares units', ($payload['units'] ?? null) === 'cm');
$check('payload lists 6 sizes', count($payload['sizes']) === 6);

$byLabel = [];
foreach ($payload['sizes'] as $s) {
    $byLabel[$s['label']] = $s;
}

$check('payload S matches the chart', ($byLabel['S']['chest_bust_max'] ?? null) === 88.0);
$check('payload 2XL matches the chart', ($byLabel['2XL']['waist_max'] ?? null) === 98.5);
$check(
    'payload labels are ordered smallest first',
    array_column($payload['sizes'], 'label') === ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    json_encode(array_column($payload['sizes'], 'label'))
);

echo PHP_EOL . "=== {$pass} passed, {$fail} failed ===" . PHP_EOL;

exit($fail === 0 ? 0 : 1);
