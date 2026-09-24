<?php
/**
 * Repair the mirrored imgly assets IN PLACE.
 *
 * The previous version of `download_imgly_assets.php` concatenated each
 * resource's chunks into ONE file (`models/isnet_fp16`). The engine instead
 * fetches every chunk BY NAME and checks its size, so all 22 model chunk URLs
 * 404 and background removal fails.
 *
 * The concatenated file already contains exactly the right bytes, in order, so
 * we only need to slice it back into the chunk files named by the manifest
 * rather than re-downloading ~100 MB.
 */

$dest = __DIR__ . '/public/vendor/imgly';
$manifest = json_decode(file_get_contents($dest . '/resources.json'), true);

if (!$manifest) {
    fwrite(STDERR, "Could not read resources.json in $dest\n");
    exit(1);
}

// Only the resources this app requests: cpu + isnet_fp16.
$targets = [
    '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
    '/models/isnet_fp16',
];

$totalWritten = 0;

foreach ($targets as $key) {
    if (!isset($manifest[$key])) {
        echo "SKIP (not in manifest): $key\n";
        continue;
    }

    $entry = $manifest[$key];
    $assembledPath = $dest . '/' . ltrim($key, '/');

    if (!is_file($assembledPath)) {
        echo "MISSING assembled file for $key — re-run download_imgly_assets.php\n";
        continue;
    }

    $expectedTotal = $entry['size'];
    $actualTotal = filesize($assembledPath);

    echo "$key\n";
    echo "  assembled: " . number_format($actualTotal / 1048576, 2) . " MB (expected "
        . number_format($expectedTotal / 1048576, 2) . " MB)\n";

    if ($actualTotal !== $expectedTotal) {
        echo "  WARN: size mismatch; skipping to avoid writing corrupt chunks\n";
        continue;
    }

    // Work out whether the chunks already exist and are correct.
    $allChunksPresent = true;
    foreach ($entry['chunks'] as $chunk) {
        $chunkFile = $dest . '/' . $chunk['name'];
        $chunkSize = $chunk['offsets'][1] - $chunk['offsets'][0];
        if (!is_file($chunkFile) || filesize($chunkFile) !== $chunkSize) {
            $allChunksPresent = false;
            break;
        }
    }

    if ($allChunksPresent) {
        echo "  chunks already present and correct — nothing to do\n";
        continue;
    }

    $in = fopen($assembledPath, 'rb');
    if (!$in) {
        echo "  cannot open assembled file\n";
        continue;
    }

    foreach ($entry['chunks'] as $i => $chunk) {
        $start = $chunk['offsets'][0];
        $end = $chunk['offsets'][1];
        $length = $end - $start;
        $chunkFile = $dest . '/' . $chunk['name'];

        fseek($in, $start);
        $bytes = fread($in, $length);

        if ($bytes === false || strlen($bytes) !== $length) {
            echo "  chunk " . ($i + 1) . " READ FAILED\n";
            continue;
        }

        file_put_contents($chunkFile, $bytes);
        $totalWritten += strlen($bytes);
    }

    fclose($in);
    echo "  wrote " . count($entry['chunks']) . " chunks\n";
}

echo "\nDone. Wrote " . number_format($totalWritten / 1048576, 1) . " MB of chunk files.\n";
echo "Chunk files live directly under: $dest\n";
