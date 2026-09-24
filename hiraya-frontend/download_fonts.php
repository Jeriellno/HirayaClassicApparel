<?php
/**
 * Self-host the Cinzel + Plus Jakarta Sans webfonts.
 *
 * WHY: `index.css` imports these from fonts.googleapis.com, which is BLOCKED on
 * this network (same restriction that broke staticimgly.com). When the webfont
 * never arrives the browser substitutes a system font, and that substitute
 * renders the peso sign "₱" (U+20B1) as "?".
 *
 * This downloads the Google Fonts CSS + every woff2 it references, rewrites the
 * urls to local paths, and writes a single `fonts.css` next to the font files.
 *
 * Run: php download_fonts.php
 */

$cssUrl = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap';

// Google only serves woff2 to a modern UA; a bare PHP request gets ttf.
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

$destDir = __DIR__ . '/public/fonts';
@mkdir($destDir, 0775, true);

$ctx = stream_context_create([
    'http' => ['header' => "User-Agent: {$ua}\r\n", 'timeout' => 60],
]);

$css = @file_get_contents($cssUrl, false, $ctx);
if (!$css) {
    fwrite(STDERR, "Could not download the Google Fonts CSS.\n");
    exit(1);
}

echo 'Downloaded CSS: ' . strlen($css) . " bytes\n";

// Collect every url(...) pointing at a woff2 file.
if (!preg_match_all('#url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)#', $css, $m)) {
    fwrite(STDERR, "No woff2 URLs found in the CSS.\n");
    exit(1);
}

$urls = array_values(array_unique($m[1]));
echo 'Found ' . count($urls) . " font files to mirror.\n";

$map = [];
$total = 0;

foreach ($urls as $url) {
    $bin = @file_get_contents($url, false, $ctx);
    if ($bin === false) {
        fwrite(STDERR, "  FAILED: {$url}\n");
        continue;
    }

    // Deterministic local name so repeated runs reuse the same file.
    $name = basename(parse_url($url, PHP_URL_PATH));
    file_put_contents($destDir . '/' . $name, $bin);
    $map[$url] = $name;
    $total += strlen($bin);
    echo '  ' . str_pad($name, 24) . ' . ' . number_format(strlen($bin) / 1024, 1) . " KB\n";
}

// Rewrite the CSS to point at the local copies.
$local = str_replace(
    array_keys($map),
    array_map(fn ($n) => './' . $n, array_values($map)),
    $css,
);

file_put_contents($destDir . '/fonts.css', $local);
echo "\nWrote fonts.css\n";
echo 'Total mirrored: ' . number_format($total / 1024, 1) . " KB\n";
