<?php

/**
 * _smoke_size_chart_http.php — does GET /api/size-chart actually serve JSON?
 *
 * Drives the real route through the HTTP kernel (no server process needed), so
 * this proves routing + controller + caching header, not just the service class.
 *
 * Usage: php _smoke_size_chart_http.php
 */

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$request = Illuminate\Http\Request::create('/api/size-chart', 'GET', [], [
    'HTTP_ACCEPT' => 'application/json',
]);

$response = $kernel->handle($request);

echo PHP_EOL . '=== GET /api/size-chart ===' . PHP_EOL;
echo 'status      : ' . $response->getStatusCode() . PHP_EOL;
echo 'cache-control: ' . ($response->headers->get('Cache-Control') ?? '(none)') . PHP_EOL;
echo 'body        : ' . substr((string) $response->getContent(), 0, 400) . PHP_EOL;

$ok = $response->getStatusCode() === 200;
$data = json_decode((string) $response->getContent(), true);

$ok = $ok
    && is_array($data)
    && ($data['units'] ?? null) === 'cm'
    && count($data['sizes'] ?? []) === 6
    && str_contains((string) $response->headers->get('Cache-Control'), 'max-age');

echo PHP_EOL . ($ok ? 'RESULT: OK' : 'RESULT: FAILED') . PHP_EOL;

$kernel->terminate($request, $response);

exit($ok ? 0 : 1);
