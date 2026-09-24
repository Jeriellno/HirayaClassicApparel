<?php

/**
 * Verify the VtonApiRenderer payload changes:
 *   1. With n_steps/n_samples UNSET, the payload is EXACTLY as before (3 fields).
 *   2. With them SET, they are added.
 *   3. `optionalInt` treats '', 0, null as "omit".
 *   4. The category mapping still emits the vendor's live-accepted vocabulary.
 */

/*
 * Resolve the backend from the PROJECT ROOT, not from __DIR__. This file lives
 * under _qa_archive/subfolders/, so the original `__DIR__ . '/hiraya-backend'`
 * pointed at a directory that does not exist and the script died on require()
 * instead of running its checks — a silently dead test. Walk up to the dir that
 * actually contains hiraya-backend.
 */
$backend = __DIR__;
for ($i = 0; $i < 5 && !is_dir($backend . '/hiraya-backend'); $i++) {
    $backend = dirname($backend);
}
$backend .= '/hiraya-backend';
if (!is_dir($backend)) {
    fwrite(STDERR, "could not locate hiraya-backend from " . __DIR__ . "\n");
    exit(1);
}
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Services\VtonApiRenderer;

$fail = 0;
$ok = function (string $label, bool $pass, string $detail = '') use (&$fail) {
    echo ($pass ? '  PASS  ' : '  FAIL  ') . $label . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    if (!$pass) {
        $fail++;
    }
};

echo PHP_EOL . '=== VTON PAYLOAD TEST ===' . PHP_EOL . PHP_EOL;

$renderer = app(VtonApiRenderer::class);

$build = new ReflectionMethod(VtonApiRenderer::class, 'buildPayload');
$build->setAccessible(true);
$optInt = new ReflectionMethod(VtonApiRenderer::class, 'optionalInt');
$optInt->setAccessible(true);
$mapCat = new ReflectionMethod(VtonApiRenderer::class, 'mapCategory');
$mapCat->setAccessible(true);

/* --- 1. Unset => exactly the original 3-field shape --- */
$configUnset = [
    'endpoint' => 'x',
    'token' => 'x',
    'model_name' => '',
    'person_field' => 'person_image',
    'garment_field' => 'garment_image',
    'category_field' => 'category',
    'n_steps' => null,
    'n_samples' => null,
];

$payload = $build->invoke($renderer, $configUnset, 'P', 'G', 'dress');
$ok('unset: payload has exactly 3 keys', count($payload) === 3, 'keys=' . implode(',', array_keys($payload)));
$ok('unset: no n_steps key', !array_key_exists('n_steps', $payload));
$ok('unset: no n_samples key', !array_key_exists('n_samples', $payload));

/* --- 2. Set => fields present --- */
$configSet = $configUnset;
$configSet['n_steps'] = 30;
$configSet['n_samples'] = 2;
$payload2 = $build->invoke($renderer, $configSet, 'P', 'G', 'dress');
$ok('set: n_steps present and correct', ($payload2['n_steps'] ?? null) === 30);
$ok('set: n_samples present and correct', ($payload2['n_samples'] ?? null) === 2);
$ok('set: base fields still intact', ($payload2['person_image'] ?? null) === 'P' && ($payload2['garment_image'] ?? null) === 'G');

/* --- 3. optionalInt semantics --- */
$cases = [null => null, '' => null, 0 => null, '0' => null, false => null, 30 => 30, '30' => 30, 'x' => null];
foreach ($cases as $in => $want) {
    $got = $optInt->invoke($renderer, $in);
    $ok('optionalInt(' . var_export($in, true) . ') === ' . var_export($want, true), $got === $want, 'got ' . var_export($got, true));
}

/* --- 4. Live category vocabulary (probed from the API's own 422) --- */
/*
 * An UNRESOLVED label maps to `upperbody`, NOT `auto`. PixelAPI (the active
 * vendor) has no `auto` in its enum — measured: sending it 422s — so the fallback
 * must be a real region. The old `'auto'` expectation here was FASHN-era and never
 * matched the live contract.
 */
$mapCases = [
    'dress' => 'dress',
    'top' => 'upperbody',
    'inner' => 'upperbody',
    'bottom' => 'lowerbody',
    'outerwear' => 'upperbody',
    '' => 'upperbody',
];
foreach ($mapCases as $in => $want) {
    $got = $mapCat->invoke($renderer, $in);
    $ok("mapCategory('{$in}') === '{$want}'", $got === $want, "got '{$got}'");
}

echo PHP_EOL . '================================' . PHP_EOL;
echo $fail === 0 ? '  ALL CHECKS PASSED' . PHP_EOL : "  {$fail} CHECK(S) FAILED" . PHP_EOL;
echo '================================' . PHP_EOL . PHP_EOL;

exit($fail === 0 ? 0 : 1);
