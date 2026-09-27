<?php
/*
 * HIRAYA — password reset verification suite.
 *
 * Runs every check for the reset flow in one command, so "is this still working"
 * is a single question with a single answer. Two of these suites were written
 * while FIXING the flow and each one caught a real defect, so they are kept as
 * regression guards rather than being thrown away after the fix:
 *
 *   TOKEN     the signing scheme: expiry, binding, single use
 *   TEMPLATES the mail bodies: comment lexing, escaping, both parts render
 *   FLOW      the endpoints: routing, validation, enumeration safety, revocation
 *
 * Usage:
 *   C:\php-8.3\php.exe verify-reset.php              # everything
 *   C:\php-8.3\php.exe verify-reset.php token        # one suite
 *
 * Exit code is 0 only when every suite passes, so this can gate a deploy.
 */

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$suites = [
    'token' => 'verify/token-lifecycle.php',
    'templates' => 'verify/email-templates.php',
    'flow' => 'verify/end-to-end.php',
    'mail' => 'verify/mail-delivery.php',
];

$requested = $argv[1] ?? 'all';

if ($requested !== 'all' && ! isset($suites[$requested])) {
    echo "Unknown suite '{$requested}'. Available: " . implode(', ', array_keys($suites)) . "\n";
    exit(2);
}

$selected = $requested === 'all' ? $suites : [$requested => $suites[$requested]];

$failed = [];

foreach ($selected as $name => $script) {
    $path = __DIR__ . '/' . $script;

    if (! file_exists($path)) {
        echo "\n### {$name}: MISSING ({$script})\n";
        $failed[] = $name;
        continue;
    }

    echo "\n" . str_repeat('#', 60) . "\n";
    echo "# SUITE: " . strtoupper($name) . "\n";
    echo str_repeat('#', 60) . "\n";

    $output = [];
    $exitCode = 0;
    exec('"' . PHP_BINARY . '" ' . escapeshellarg($path) . ' 2>&1', $output, $exitCode);

    echo implode("\n", $output) . "\n";

    if ($exitCode !== 0) {
        $failed[] = $name;
    }
}

echo "\n" . str_repeat('=', 60) . "\n";

if ($failed === []) {
    echo "ALL SUITES PASSED\n\n";
    exit(0);
}

echo "FAILED: " . implode(', ', $failed) . "\n\n";
exit(1);