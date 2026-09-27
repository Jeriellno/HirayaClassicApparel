<?php

/**
 * Confirm the Hugging Face VTON config resolves in the SAME environment the
 * worker uses, so a "renderer_unreachable" is not simply a missing token/space.
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

echo 'queue.default = ' . config('queue.default') . PHP_EOL;
echo 'hf.vton_space = ' . var_export(config('services.huggingface.vton_space'), true) . PHP_EOL;
echo 'hf.vton_base  = ' . var_export(config('services.huggingface.vton_base'), true) . PHP_EOL;
echo 'hf.prefix     = ' . var_export(config('services.huggingface.vton_api_prefix'), true) . PHP_EOL;
$tok = (string) config('services.huggingface.token', '');
echo 'hf.token      = ' . ($tok !== '' ? substr($tok, 0, 8) . '...(' . strlen($tok) . ' chars)' : 'EMPTY') . PHP_EOL;
echo 'hf.prompt     = ' . var_export(config('services.huggingface.vton_prompt'), true) . PHP_EOL;
echo 'settings timeout = ' . ini_get('max_execution_time') . PHP_EOL;
