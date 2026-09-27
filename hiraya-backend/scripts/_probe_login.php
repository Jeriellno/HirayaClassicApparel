<?php

/**
 * Probe the login API exactly as the browser does, so a "Cannot reach the
 * Hiraya server" message can be told apart from a slow render/DB round trip.
 */

$ch = curl_init('http://127.0.0.1:8000/api/login');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode(['email' => 'ken@hiraya.com', 'password' => 'Hiraya2026!']),
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 60,
]);

$started = microtime(true);
$body = curl_exec($ch);
$err = curl_error($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$secs = round(microtime(true) - $started, 1);

echo 'HTTP ' . $status . ' in ' . $secs . 's' . PHP_EOL;
if ($err !== '') {
    echo 'cURL error: ' . $err . PHP_EOL;
}
echo 'body: ' . substr((string) $body, 0, 600) . PHP_EOL;
