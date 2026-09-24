<?php

/**
 * Verify the verdict() fail-closed contract of PersonVerificationController.
 *
 * THE BUG THIS PINS DOWN
 * ----------------------
 * `verdict()` used to compute `verified` as
 *
 *     ! in_array($reason, ['no-api-key', 'unreachable', 'upstream-error', 'unparseable', 'quota'])
 *
 * — a BLOCKLIST. Any reason missing from it was treated as "the model answered".
 * `model-retired` (a 404 on a retired model ID, which this deployment hit for
 * real at 2026-09-24 04:11) is NOT in that list, so the response came back with
 * `verified: true` even though no model ever looked at the image. The frontend
 * then saw `hasPerson:false, verified:true` and told the customer
 * "No person could be found in this photo" — a confident, wrong statement.
 *
 * The fix is an ALLOW-LIST: only `person` / `no-person` mean "a model answered".
 *
 * WHAT THIS TEST ASSERTS
 * ----------------------
 *   1. Every genuine model answer  -> verified:true.
 *   2. Every failure vocabulary word -> verified:false, INCLUDING the ones the
 *      old blocklist forgot (model-retired, unknown-provider) and a nonsense
 *      reason that no version of the code has ever produced.
 *   3. parseVerdict() emits the canonical `reason` token and keeps the model's
 *      free-text wording in `detail`, so the control flow can never be driven by
 *      prose.
 *
 * Usage: php _verify_verdict_contract.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\PersonVerificationController;

$fail = 0;
$ok = function (string $label, bool $pass, string $detail = '') use (&$fail) {
    echo ($pass ? '  PASS  ' : '  FAIL  ') . $label . ($detail !== '' ? "  ({$detail})" : '') . PHP_EOL;
    if (! $pass) {
        $fail++;
    }
};

$controller = app(PersonVerificationController::class);

/* ---- Reach the private methods under test. ---- */
$verdictMethod = new ReflectionMethod(PersonVerificationController::class, 'verdict');
$verdictMethod->setAccessible(true);

$parseMethod = new ReflectionMethod(PersonVerificationController::class, 'parseVerdict');
$parseMethod->setAccessible(true);

/** Decode the JsonResponse verdict() returns. */
$callVerdict = function (string $reason) use ($verdictMethod, $controller): array {
    $response = $verdictMethod->invoke($controller, false, $reason, 0.0);
    return json_decode($response->getContent(), true);
};

echo '=== 1. VERDICT FAIL-CLOSED CONTRACT ===' . PHP_EOL;

/*
 * Reasons where a model genuinely answered. `person` and `no-person` are the
 * ONLY two the controller is allowed to treat as an answer.
 */
$answered = ['person', 'no-person'];
foreach ($answered as $reason) {
    $v = $callVerdict($reason);
    $ok("answered: reason='{$reason}' -> verified true", ($v['verified'] ?? null) === true, 'verified=' . var_export($v['verified'] ?? null, true));
}

/*
 * Every failure path. `model-retired` and `unknown-provider` are the two the OLD
 * blocklist omitted — they are the regression this test exists for.
 */
$failed = [
    'no-api-key' => 'no credential configured',
    'unreachable' => 'network/TLS failure',
    'upstream-error' => 'provider returned an error',
    'unparseable' => 'reply in an unreadable shape',
    'quota' => '429 allowance exhausted',
    'model-retired' => 'RETIRED MODEL ID (the 04:11 bug)',
    'unknown-provider' => 'misconfigured provider name',
    'something-new-unforeseen' => 'a reason no code has produced yet',
];

foreach ($failed as $reason => $why) {
    $v = $callVerdict($reason);
    $ok(
        "failed: reason='{$reason}' -> verified FALSE  [{$why}]",
        ($v['verified'] ?? null) === false,
        'verified=' . var_export($v['verified'] ?? null, true)
    );
}

echo PHP_EOL . '=== 2. parseVerdict() CANONICAL REASON ===' . PHP_EOL;

/*
 * A REAL model answer, copied from a live call: the free-text reason is a whole
 * sentence. If this ever became the control token, the allow-list would reject a
 * perfectly good photo.
 */
$liveModelAnswer = '{"has_person": true, "confidence": 1, "reason": "real human person wearing a t-shirt and jeans"}';
$parsed = $parseMethod->invoke($controller, $liveModelAnswer, 'gemini');

if ($parsed === null) {
    $ok('parseVerdict parsed the live model answer', false, 'returned null');
} else {
    $ok('parseVerdict parsed the live model answer', true);
    $ok(
        "reason is the canonical token 'person', NOT the prose",
        ($parsed['reason'] ?? null) === 'person',
        'reason=' . var_export($parsed['reason'] ?? null, true)
    );
    $ok(
        'the model wording is preserved in detail',
        str_contains((string) ($parsed['detail'] ?? ''), 't-shirt'),
        'detail=' . var_export($parsed['detail'] ?? null, true)
    );
    $ok('has_person is true', ($parsed['has_person'] ?? null) === true);
}

/* A "no person" answer must ALSO be canonical, with has_person false. */
$noPersonAnswer = '{"has_person": false, "confidence": 0.9, "reason": "a garment on a hanger"}';
$parsedNo = $parseMethod->invoke($controller, $noPersonAnswer, 'gemini');

if ($parsedNo === null) {
    $ok('parseVerdict parsed the "no person" answer', false, 'returned null');
} else {
    $ok(
        "no-person answer -> reason 'no-person'",
        ($parsedNo['reason'] ?? null) === 'no-person',
        'reason=' . var_export($parsedNo['reason'] ?? null, true)
    );
    $ok('no-person answer -> has_person false', ($parsedNo['has_person'] ?? null) === false);
}

/* A low-confidence "true" must be refused (MIN_CONFIDENCE = 0.5). */
$lowConf = '{"has_person": true, "confidence": 0.2, "reason": "maybe"}';
$parsedLow = $parseMethod->invoke($controller, $lowConf, 'gemini');
$ok(
    'low-confidence true is refused',
    is_array($parsedLow) && ($parsedLow['has_person'] ?? null) === false,
    is_array($parsedLow) ? 'has_person=' . var_export($parsedLow['has_person'], true) : 'returned null'
);

echo PHP_EOL . '=== 3. AN UNPARSEABLE REPLY MOVES THE CHAIN ON ===' . PHP_EOL;
$garbage = $parseMethod->invoke($controller, 'I am not JSON at all', 'gemini');
$ok('unparseable reply returns null (chain tries the next provider)', $garbage === null, 'got ' . gettype($garbage));

echo PHP_EOL . '================================' . PHP_EOL;
echo $fail === 0 ? '  ALL CHECKS PASSED' . PHP_EOL : "  {$fail} CHECK(S) FAILED" . PHP_EOL;
echo '================================' . PHP_EOL;

exit($fail === 0 ? 0 : 1);
