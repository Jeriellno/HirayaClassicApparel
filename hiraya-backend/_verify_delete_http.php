<?php

/**
 * End-to-end HTTP check of DELETE /api/admin/products/{id} — the exact call the
 * Super Admin inventory makes. Logs in, creates a row through the API, deletes it,
 * and confirms both the HTTP status and the row's absence.
 *
 * Run:  php _verify_delete_http.php
 */

$base = 'http://127.0.0.1:8000/api';

function req(string $method, string $url, ?array $payload = null, ?string $token = null): array
{
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CUSTOMREQUEST => $method];
    if ($payload !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($payload);
        $headers[] = 'Content-Type: application/json';
    }
    if ($token) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return [$code, (string) $body];
}

echo '=== DELETE /api/admin/products/{id} over HTTP ===' . PHP_EOL;

[$code, $body] = req('POST', $base . '/login', [
    'email'    => 'admin@hiraya.com',
    'password' => 'HirayaAdmin2026!',
]);
$login = json_decode($body, true);
$token = $login['token'] ?? $login['access_token'] ?? null;
echo "login status = {$code}, token = " . ($token ? 'yes' : 'NO') . PHP_EOL;
if (!$token) {
    echo 'login body   = ' . substr($body, 0, 300) . PHP_EOL;
    exit(1);
}

[$code, $body] = req('POST', $base . '/admin/products', [
    'name'     => '__verify_http_delete__ ' . bin2hex(random_bytes(4)),
    'price'    => 1,
    'category' => 'TOPS',
], $token);
$created = json_decode($body, true);
$id = $created['id'] ?? ($created['data']['id'] ?? ($created['product']['id'] ?? null));
echo "create status = {$code}, id = " . ($id ?? 'NONE') . PHP_EOL;
if (!$id) {
    echo 'create body  = ' . substr($body, 0, 400) . PHP_EOL;
    exit(1);
}

[$code, $body] = req('DELETE', $base . '/admin/products/' . $id, null, $token);
echo "DELETE status = {$code}" . PHP_EOL;
echo 'DELETE body   = ' . substr($body, 0, 200) . PHP_EOL;

[$code2, $body2] = req('GET', $base . '/products/' . $id, null, $token);
echo "GET after     = {$code2} (404 = gone)" . PHP_EOL;

echo (($code >= 200 && $code < 300) && $code2 === 404)
    ? 'RESULT: PASS — HTTP delete removed the product.'
    : 'RESULT: FAIL — see statuses above.';
echo PHP_EOL;
