<?php

/**
 * Raw TCP latency to the Supabase pooler, measured OUTSIDE Laravel, so we can
 * tell "our app is slow" apart from "the remote database is slow/unreachable".
 */

$host = 'aws-0-ap-southeast-1.pooler.supabase.com';
$port = 5432;

for ($i = 1; $i <= 3; $i++) {
    $t0 = microtime(true);
    $fp = @fsockopen($host, $port, $errno, $errstr, 15);
    $dt = round((microtime(true) - $t0) * 1000);
    if ($fp) {
        echo "attempt {$i}: TCP connect OK in {$dt}ms" . PHP_EOL;
        fclose($fp);
    } else {
        echo "attempt {$i}: TCP connect FAILED in {$dt}ms — {$errno} {$errstr}" . PHP_EOL;
    }
}
