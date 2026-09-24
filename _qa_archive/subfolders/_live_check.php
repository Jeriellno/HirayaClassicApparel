<?php

/** Hard-timeout liveness probe for the API + web servers. */

$targets = [
    'API  /api/products' => 'http://127.0.0.1:8000/api/products',
    'API  /' => 'http://127.0.0.1:8000/',
    'WEB  /' => 'http://localhost:5173/',
];

foreach ($targets as $label => $url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    echo $label . '  => HTTP ' . $code
        . '  bytes=' . ($body === false ? 'false' : strlen($body))
        . ($err !== '' ? '  ERR=' . $err : '')
        . PHP_EOL;
}
