<?php
// Inspect the users table's measurement columns without the app bootstrapping.
$env = [];
foreach (file(__DIR__ . '/.env') as $line) {
    if (str_contains($line, '=') && !str_starts_with(trim($line), '#')) {
        [$k, $v] = explode('=', trim($line), 2);
        $env[$k] = trim($v, "\"'");
    }
}

$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s',
    $env['DB_HOST'] ?? '',
    $env['DB_PORT'] ?? '5432',
    $env['DB_DATABASE'] ?? 'postgres',
);

try {
    $pdo = new PDO($dsn, $env['DB_USERNAME'] ?? '', $env['DB_PASSWORD'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
} catch (Throwable $e) {
    fwrite(STDERR, 'DB connect failed: ' . $e->getMessage() . "\n");
    exit(1);
}

echo "Connected.\n\n";

// 1. Does the users table even HAVE the measurement columns?
$cols = $pdo->query("
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'users'
    ORDER BY ordinal_position
")->fetchAll(PDO::FETCH_ASSOC);

echo "== users columns ==\n";
foreach ($cols as $c) {
    echo "  {$c['column_name']} ({$c['data_type']})\n";
}

$wanted = ['chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length'];
$names = array_column($cols, 'column_name');
$missing = array_diff($wanted, $names);
echo "\nMissing measurement columns: " . (empty($missing) ? 'NONE' : implode(', ', $missing)) . "\n\n";

// 2. What is actually stored?
$rows = $pdo->query("
    SELECT id, email, role, chest_bust, waist, hips, shoulder_width, sleeve_length
    FROM users
    ORDER BY id
    LIMIT 10
")->fetchAll(PDO::FETCH_ASSOC);

echo "== user rows (" . count($rows) . " shown) ==\n";
foreach ($rows as $r) {
    $vals = [];
    foreach ($wanted as $w) {
        $vals[] = "{$w}=" . ($r[$w] === null ? 'NULL' : $r[$w]);
    }
    echo "  #{$r['id']} {$r['email']} [{$r['role']}] " . implode(' ', $vals) . "\n";
}

// 3. How many users have ANY measurement?
$withData = $pdo->query("
    SELECT COUNT(*) FROM users
    WHERE chest_bust IS NOT NULL OR waist IS NOT NULL OR hips IS NOT NULL
")->fetchColumn();

echo "\nUsers with at least one measurement: {$withData}\n";
