<?php

/** Fetch the Vite HTML shell (the real frontend entry). */

foreach (['http://localhost:5173/', 'http://127.0.0.1:5173/', 'http://localhost:5174/'] as $url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    $head = ($body === false) ? '' : substr($body, 0, 120);
    echo $url . '  => HTTP ' . $code . '  bytes=' . ($body === false ? 'false' : strlen($body)) . PHP_EOL;
    if ($err !== '') {
        echo '   ERR=' . $err . PHP_EOL;
    }
    if ($head !== '') {
        echo '   ' . str_replace(["\r", "\n"], ' ', $head) . PHP_EOL;
    }
    echo PHP_EOL;
}
