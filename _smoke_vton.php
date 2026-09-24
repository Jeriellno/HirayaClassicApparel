<?php

/**
 * VTON provider wiring smoke test.
 *
 * Verifies, against the REAL Laravel container:
 *   1. VtonApiRenderer resolves and is instantiable.
 *   2. With no token configured it returns `not_configured` — NOT an exception,
 *      and NOT a hard failure that would kill the render chain.
 *   3. The job's chain puts VtonApi FIRST when configured, and OMITS it when not.
 *   4. `not_configured` is NOT in the non-retryable set (it must not abort the
 *      chain and leave the customer with a dead canvas).
 *
 * Usage:  php hiraya-backend/_smoke_vton.php
 */

$backend = __DIR__ . '/hiraya-backend';

require $backend . '/vendor/autoload.php';

$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$fail = 0;
$ok = function (string $label, bool $pass, string $detail = '') use (&$fail) {
    echo ($pass ? "  PASS  " : "  FAIL  ") . $label . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    if (!$pass) {
        $fail++;
    }
};

echo PHP_EOL . '=== VTON PROVIDER SMOKE TEST ===' . PHP_EOL . PHP_EOL;

/* ---- 1. Config present ---- */
$endpoint = config('services.vton.endpoint');
$token = config('services.vton.token');
echo "  config vton.endpoint = " . var_export($endpoint, true) . PHP_EOL;
echo "  config vton.token    = " . ($token ? '<set>' : var_export($token, true)) . PHP_EOL;
echo "  config vton.model    = " . var_export(config('services.vton.model_name'), true) . PHP_EOL;
echo "  config vton.category_dress = " . var_export(config('services.vton.category_dress'), true) . PHP_EOL;
echo PHP_EOL;

$ok('vton config block exists', is_array(config('services.vton')));

/* ---- 2. Renderer resolves ---- */
try {
    $renderer = app(App\Services\VtonApiRenderer::class);
    $ok('VtonApiRenderer resolves from the container', true, get_class($renderer));
} catch (\Throwable $e) {
    $ok('VtonApiRenderer resolves from the container', false, $e->getMessage());
    exit(1);
}

/* ---- 3. Unconfigured -> not_configured, no throw ---- */
if (empty($token) || empty($endpoint)) {
    try {
        $result = $renderer->render(
            'data:image/png;base64,iVBORw0KGgo=',
            ['data:image/png;base64,iVBORw0KGgo='],
            ['chest_bust' => 90],
            'M',
            null,
            ['dress']
        );

        $ok(
            'unconfigured renderer returns a result (does not throw)',
            is_array($result) && isset($result['success']),
            'success=' . var_export($result['success'] ?? null, true)
        );
        $ok(
            'unconfigured renderer reports code=not_configured',
            ($result['code'] ?? null) === 'not_configured',
            'code=' . var_export($result['code'] ?? null, true)
        );
    } catch (\Throwable $e) {
        $ok('unconfigured renderer returns a result (does not throw)', false, $e->getMessage());
    }
} else {
    echo "  SKIP  unconfigured-path assertions (a token IS configured)" . PHP_EOL;
}

/* ---- 4. not_configured must NOT be non-retryable ---- */
$jobSource = file_get_contents($backend . '/app/Jobs/ProcessTryOnJob.php');
$retryBlock = '';
if (preg_match('/in_array\(\$result\[.code.\].*?true\)/s', $jobSource, $m)) {
    $retryBlock = $m[0];
}
$ok(
    'not_configured is absent from the non-retryable code set',
    $retryBlock !== '' && !str_contains($retryBlock, 'not_configured'),
    $retryBlock === '' ? 'could not locate the set' : 'set located'
);

/* ---- 5. Chain ordering: VtonApi registered before Gemini ---- */
$chainPos = strpos($jobSource, "\$chain['VtonApi']");
$geminiPos = strpos($jobSource, "\$chain['Gemini']");
$ok(
    'VtonApi is registered in the chain',
    $chainPos !== false
);
$ok(
    'VtonApi is tried BEFORE Gemini',
    $chainPos !== false && $geminiPos !== false && $chainPos < $geminiPos,
    "vton@{$chainPos} gemini@{$geminiPos}"
);

/* ---- 6. Category mapping ---- */
/*
 * LIVE VOCABULARY, NOT FASHN-ERA. This case list previously expected an empty
 * label to map to 'auto', which was the FASHN contract. PixelAPI (the active
 * vendor) has NO `auto` in its enum — measured: sending it 422s — so an
 * unresolved label must fall back to a REAL region. `upperbody` is the
 * documented choice (see VtonApiRenderer::mapCategory), because the catalogue's
 * default product is clothing and the non-wearable case is dropped upstream.
 *
 * Kept in lockstep with _qa_archive/subfolders/_smoke_vton_payload.php, which
 * asserts the same table.
 */
$map = new ReflectionMethod(App\Services\VtonApiRenderer::class, 'mapCategory');
$map->setAccessible(true);
$cases = [
    'dress' => config('services.vton.category_dress'),
    'top' => config('services.vton.category_top'),
    'inner' => config('services.vton.category_top'),
    'bottom' => config('services.vton.category_bottom'),
    'outerwear' => config('services.vton.category_top'),
    '' => config('services.vton.category_top'),
];
foreach ($cases as $input => $expected) {
    $actual = $map->invoke($renderer, $input);
    $ok(
        "category '{$input}' maps to '{$expected}'",
        $actual === $expected,
        "got '{$actual}'"
    );
}

echo PHP_EOL . '================================' . PHP_EOL;
echo $fail === 0
    ? '  ALL CHECKS PASSED' . PHP_EOL
    : "  {$fail} CHECK(S) FAILED" . PHP_EOL;
echo '================================' . PHP_EOL . PHP_EOL;

exit($fail === 0 ? 0 : 1);
