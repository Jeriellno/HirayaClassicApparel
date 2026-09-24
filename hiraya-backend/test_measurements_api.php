<?php
function req($method, $url, $payload = null, $token = null)
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
    return [curl_getinfo($ch, CURLINFO_HTTP_CODE), (string) $body];
}

$base = 'http://127.0.0.1:8000/api';

echo "== 1. Unauthenticated GET /user/measurements (expect 401) ==\n";
[$c, $b] = req('GET', "$base/user/measurements");
echo "HTTP: $c " . substr($b, 0, 150) . "\n\n";

$email = 'qa_measure_' . time() . '@hiraya.test';
$password = 'Passw0rd!23';

echo "== 2. Register a fresh test user ($email) ==\n";
[$c, $b] = req('POST', "$base/register", [
    'full_name' => 'QA Measure',
    'email' => $email,
    'password' => $password,
    'password_confirmation' => $password,
    'chest_bust' => 95, 'waist' => 72, 'hips' => 92, 'shoulder_width' => 41, 'sleeve_length' => 63,
]);
echo "HTTP: $c\n";
$login = json_decode($b, true);
$token = $login['token'] ?? null;
echo 'token: ' . ($token ? substr($token, 0, 24) . '...' : 'NONE') . "\n";
if (isset($login['user'])) {
    echo 'register stored chest_bust: ' . var_export($login['user']['chest_bust'] ?? null, true) . "\n";
}
echo "\n";

if (!$token) {
    echo "Cannot continue without a token. Response:\n" . substr($b, 0, 500) . "\n";
    exit(1);
}

echo "== 3. GET /user/measurements with token ==\n";
[$c, $b] = req('GET', "$base/user/measurements", null, $token);
echo "HTTP: $c\n$b\n";

echo "== 4. PUT /user/measurements with token (write test values) ==\n";
[$c, $b] = req('PUT', "$base/user/measurements", [
    'chest_bust' => 93.5, 'waist' => 71.5, 'hips' => 91.5, 'shoulder_width' => 40, 'sleeve_length' => 65,
], $token);
echo "HTTP: $c\n" . substr($b, 0, 400) . "\n\n";

echo "== 5. Re-GET to confirm persistence ==\n";
[$c, $b] = req('GET', "$base/user/measurements", null, $token);
echo "HTTP: $c\n$b\n";
