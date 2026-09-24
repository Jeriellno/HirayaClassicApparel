<?php
$env = [];
foreach (file(__DIR__ . '/.env') as $line) {
    if (str_contains($line, '=') && !str_starts_with(trim($line), '#')) {
        [$k, $v] = explode('=', trim($line), 2);
        $env[$k] = trim($v, "\"'");
    }
}

$pdo = new PDO(
    sprintf('pgsql:host=%s;port=%s;dbname=%s', $env['DB_HOST'], $env['DB_PORT'] ?? 5432, $env['DB_DATABASE']),
    $env['DB_USERNAME'],
    $env['DB_PASSWORD'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);

$wanted = ['waist', 'hips', 'chest_bust', 'shoulder_width', 'sleeve_length'];
echo "== measurement column types ==\n";
$stmt = $pdo->query("
    SELECT column_name, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name IN ('waist','hips','chest_bust','shoulder_width','sleeve_length')
    ORDER BY column_name
");
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $flag = $r['data_type'] === 'integer' ? ' <-- WRONG: cannot store decimals' : '';
    echo "  {$r['column_name']}: {$r['data_type']}";
    if ($r['numeric_precision']) {
        echo "({$r['numeric_precision']},{$r['numeric_scale']})";
    }
    echo $flag . "\n";
}
