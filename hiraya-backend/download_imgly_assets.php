<?php
/**
 * One-time downloader: mirror the `@imgly/background-removal` assets the engine
 * actually uses into `public/vendor/imgly/`, so they can be served as plain
 * static files instead of being proxied through PHP per request.
 *
 * Only the files needed for the engine's DEFAULTS are fetched:
 *   device: "cpu"    -> onnxruntime-web/ort-wasm-simd-threaded.{wasm,mjs}
 *   model:  "medium" -> models/isnet_fp16
 *
 * Run:  php artisan tinker --execute="require base_path('download_imgly_assets.php');"
 * or:   php download_imgly_assets.php
 */

$base = 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist';
$dest = __DIR__ . '/public/vendor/imgly';

$wanted = [
    '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
    '/models/isnet_fp16',
];

@mkdir($dest, 0775, true);

// Fetch the manifest (authoritative chunk list + sizes).
$manifest = @file_get_contents($base . '/resources.json');
if (!$manifest) {
    fwrite(STDERR, "Could not download resources.json\n");
    exit(1);
}
file_put_contents($dest . '/resources.json', $manifest);
$meta = json_decode($manifest, true);
echo "Manifest saved.\n";

$totalBytes = 0;

/*
 * IMPORTANT: the engine fetches each CHUNK BY NAME, not the assembled file.
 *
 * `loadAsBlob()` in `@imgly/background-removal` reads the manifest, then issues
 * one fetch per entry in `chunks[]` — i.e. `a2a1f2d68cd5...`, `26a663c5a768...`,
 * 22 separate files for `isnet_fp16`. It then verifies each response against
 * `chunk.offsets[1] - chunk.offsets[0]`.
 *
 * Concatenating all chunks into a single `models/isnet_fp16` (what this script
 * used to do) leaves those 22 URLs 404-ing, and the engine fails with:
 *
 *   Failed to fetch /models/isnet_fp16 with size 4194304 but got 6691
 *
 * So every chunk is written as its own file, exactly as the CDN serves it.
 * The offsets are also checked against the assembled size so a truncated
 * download cannot masquerade as a complete one.
 */
foreach ($wanted as $key) {
    if (!isset($meta[$key])) {
        echo "SKIP (not in manifest): $key\n";
        continue;
    }

    $entry = $meta[$key];
    $rel = ltrim($key, '/');
    $dir = $dest . '/' . dirname($rel);
    @mkdir($dir, 0775, true);

    echo "Fetching $rel (" . number_format($entry['size'] / 1048576, 1) . " MB, "
        . count($entry['chunks']) . " chunks)...\n";

    $assembled = 0;

    foreach ($entry['chunks'] as $i => $chunk) {
        $chunkName = $chunk['name'];
        $expectedSize = $chunk['offsets'][1] - $chunk['offsets'][0];
        $chunkFile = $dest . '/' . $chunkName;

        if (is_file($chunkFile) && filesize($chunkFile) === $expectedSize) {
            echo "  chunk " . ($i + 1) . '/' . count($entry['chunks']) . " CACHED ("
                . number_format($expectedSize / 1048576, 2) . " MB)\n";
            $assembled += $expectedSize;
            continue;
        }

        $bin = @file_get_contents($base . '/' . $chunkName);

        if ($bin === false || strlen($bin) !== $expectedSize) {
            fwrite(STDERR, "  chunk " . ($i + 1) . " FAILED: {$chunkName}got "
                . ($bin === false ? 'nothing' : strlen($bin)) . " bytes, expected {$expectedSize})\n");
            continue;
        }

        file_put_contents($chunkFile, $bin);
        echo "  chunk " . ($i + 1) . '/' . count($entry['chunks']) . ' ok ('
            . number_format(strlen($bin) / 1048576, 2) . " MB)\n";
        $assembled += strlen($bin);
    }

    $ok = $assembled === $entry['size'];
    echo ($ok ? 'OK  ' : 'WARN') . "  $rel -> " . number_format($assembled / 1048576, 1)
        . " MB (expected " . number_format($entry['size'] / 1048576, 1) . " MB)\n";

    $totalBytes += $assembled;
}

echo "\nDone. Total fetched: " . number_format($totalBytes / 1048576, 1) . " MB\n";
echo "Destination: {$dest}\n";
