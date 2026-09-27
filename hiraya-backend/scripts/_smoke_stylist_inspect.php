<?php

/** _smoke_stylist_inspect.php — show the real reply/source for one question. */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\TryOnController;
use Illuminate\Http\Request;

$ask = function (string $message, array $context) {
    $request = Request::create('/api/tryon/chat', 'POST', [
        'message' => $message,
        'context' => $context,
    ]);

    return app(TryOnController::class)->chat($request)->getData(true);
};

$ctx = [
    'measurements' => ['chest_bust' => 90, 'waist' => 72, 'hips' => 95],
    'selected_garments' => ['Emerald Knit Top'],
];

foreach (['What is my size?', 'What should I wear to a party?', 'What colors suit me?'] as $q) {
    $d = $ask($q, $ctx);
    echo PHP_EOL . '--- Q: ' . $q . PHP_EOL;
    echo 'source      : ' . $d['source'] . PHP_EOL;
    echo 'intent      : ' . $d['intent'] . PHP_EOL;
    echo 'reply       : ' . str_replace("\n", ' / ', $d['reply']) . PHP_EOL;
    echo 'suggestions : ' . implode(' | ', $d['suggestions']) . PHP_EOL;
    echo 'products    : ' . count($d['products']) . PHP_EOL;
}
