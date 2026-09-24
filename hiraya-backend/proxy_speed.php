<?php
// Measure proxy throughput for a real 4 MB model chunk.
$url = 'http://127.0.0.1:8000/api/admin/assets/background-removal/3dae4038fc722ce4ce041fbc9c63fd5c2d9864bc732a01994518f96e9ec2f357';
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 180,
    CURLOPT_CONNECTTIMEOUT => 15,
]);
$start = microtime(true);
$body = curl_exec($ch);
$elapsed = round(microtime(true) - $start, 2);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
echo "HTTP: $code\n";
echo "BYTES: " . strlen((string) $body) . "\n";
echo "ELAPSED: {$elapsed}s\n";
echo 'SPEED: ' . round((strlen((string) $body) / 1024 / 1024) / max(0.01, $elapsed), 2) . " MB/s\n";
