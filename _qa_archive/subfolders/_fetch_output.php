<?php

/** Fetch a PixelAPI output_url and report the true bytes/dims. */

$url = $argv[1] ?? '';
if ($url === '') {
    exit("usage: php _fetch_output.php <url>\n");
}

$ctx = stream_context_create(['http' => ['timeout' => 60]]);
$bytes = @file_get_contents($url, false, $ctx);
if ($bytes === false) {
    exit("FETCH FAILED\n");
}

$out = __DIR__ . '/_pixelapi_output.png';
file_put_contents($out, $bytes);

$info = @getimagesizefromstring($bytes);
echo 'url   : ' . $url . PHP_EOL;
echo 'bytes : ' . strlen($bytes) . ' (' . round(strlen($bytes) / 1024) . ' KB)' . PHP_EOL;
echo 'dims  : ' . ($info ? $info[0] . 'x' . $info[1] . '  ' . $info['mime'] : 'UNREADABLE') . PHP_EOL;
echo 'saved : ' . $out . PHP_EOL;
