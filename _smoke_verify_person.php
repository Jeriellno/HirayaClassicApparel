<?php

/**
 * LIVE person-verification probe.
 *
 * Answers ONE question with evidence: does the /tryon/verify-person chain actually
 * work RIGHT NOW, with the currently configured model(s) and key?
 *
 * It calls PersonVerificationController's provider list directly (through the
 * container) so the result is the real verdict the frontend gate would receive —
 * not a re-implementation of it.
 *
 * Usage: php _probe_verify_person.php [path-to-image]
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\PersonVerificationController;

echo '== CONFIGURED NOW ==' . PHP_EOL;
echo '  gemini.key        : ' . (config('services.gemini.key') ? '<set>' : 'MISSING') . PHP_EOL;
echo '  vision model (1st): ' . config('services.gemini.model') . PHP_EOL;
echo '  vision chain      : ' . implode(', ', (array) config('services.gemini.models')) . PHP_EOL;
echo '  verify providers  : ' . implode(', ', (array) config('services.person_verification.providers')) . PHP_EOL;

$hasFallback = false;
foreach ((array) config('services.person_verification.providers') as $p) {
    $key = match ($p) {
        'gemini' => config('services.gemini.key'),
        'groq' => config('services.person_verification.groq.token'),
        'openai' => config('services.person_verification.openai.token'),
        'cloudflare' => config('services.person_verification.cloudflare.token'),
        default => null,
    };
    if ($p !== 'gemini' && $key) {
        $hasFallback = true;
    }
}
echo '  fallback provider : ' . ($hasFallback ? 'YES' : 'NONE  <-- the 20/day wall is still a single point of failure') . PHP_EOL;

/* ---- Use a real photo if given, else the QA portrait at the repo root. ---- */
$photo = $argv[1] ?? (__DIR__ . '/qa_person.jpg');
if (!is_file($photo)) {
    fwrite(STDERR, "no image to test with: {$photo}\n");
    exit(1);
}

$dataUri = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($photo));
echo PHP_EOL . '== LIVE CALL ==' . PHP_EOL;
echo '  image: ' . basename($photo) . ' (' . round(filesize($photo) / 1024) . " KB)\n";

$controller = app(PersonVerificationController::class);
$request = Illuminate\Http\Request::create('/tryon/verify-person', 'POST', ['image' => $dataUri]);

try {
    $response = $controller->verify($request);
    $json = json_decode($response->getContent(), true);

    echo '  http    : ' . $response->getStatusCode() . PHP_EOL;
    echo '  verified: ' . var_export($json['verified'] ?? null, true) . PHP_EOL;
    echo '  has_person: ' . var_export($json['has_person'] ?? null, true) . PHP_EOL;
    echo '  confidence: ' . var_export($json['confidence'] ?? null, true) . PHP_EOL;
    echo '  reason  : ' . var_export($json['reason'] ?? null, true) . PHP_EOL;

    echo PHP_EOL . '== VERDICT ==' . PHP_EOL;
    if (($json['verified'] ?? false) && ($json['has_person'] ?? false)) {
        echo '  WORKING — the chain answered AND found a person.' . PHP_EOL;
    } elseif (($json['verified'] ?? false) && !($json['has_person'] ?? false)) {
        echo '  WORKING — the chain answered "no person". The gate is functioning; this' . PHP_EOL;
        echo '  particular image has no person in it.' . PHP_EOL;
    } else {
        echo '  NOT WORKING — reason "' . ($json['reason'] ?? '?') . '". The model could not be reached' . PHP_EOL;
        echo '  or had no quota. This is the state that produces the customer-facing' . PHP_EOL;
        echo '  "could not be verified right now" message.' . PHP_EOL;
        exit(1);
    }
} catch (\Throwable $e) {
    echo '  EXCEPTION: ' . $e->getMessage() . PHP_EOL;
    exit(1);
}
