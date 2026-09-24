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
$email = 'qa_outfit_' . time() . '@hiraya.test';
$password = 'Passw0rd!23';

[$c, $b] = req('POST', "$base/register", [
    'full_name' => 'QA Outfit',
    'email' => $email,
    'password' => $password,
    'password_confirmation' => $password,
    'chest_bust' => 95,
    'waist' => 72,
    'hips' => 92,
    'shoulder_width' => 41,
    'sleeve_length' => 63,
]);
$token = json_decode($b, true)['token'] ?? null;
echo "register HTTP: $c token: " . ($token ? 'yes' : 'no') . "\n\n";

echo "== GET /outfits/recommended (with token) ==\n";
[$c, $b] = req('GET', "$base/outfits/recommended?limit=8", null, $token);
echo "HTTP: $c\n";
$data = json_decode($b, true);
echo 'has_measurements: ' . var_export($data['has_measurements'] ?? null, true) . "\n";
echo 'recommendation count: ' . count($data['recommendations'] ?? []) . "\n";
if (!empty($data['recommendations'])) {
    $first = $data['recommendations'][0];
    echo 'first: ' . ($first['name'] ?? '?') . ' fit_score=' . ($first['fit_score'] ?? '?')
        . ' size=' . ($first['recommended_size'] ?? '?') . "\n";
}
echo substr($b, 0, 200) . "\n";
