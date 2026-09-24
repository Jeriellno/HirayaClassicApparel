<?php

/**
 * VERIFY THE APP PATH: queue -> worker -> VtonApiRenderer -> session row.
 *
 * This is the path the Studio actually uses (TryOnController::generate does
 * exactly this), NOT the direct renderer call that `_e2e_pixelapi.php` does.
 * It exists to prove the fix for the "job stays queued forever / falls back to
 * the local composite" defect.
 *
 * Usage: php _verify_app_path.php
 */

$backend = __DIR__ . '/hiraya-backend';
require $backend . '/vendor/autoload.php';
$app = require_once $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Jobs\ProcessTryOnJob;
use App\Models\TryOnSession;
use Illuminate\Support\Str;

$personPath = $backend . '/storage/app/public/tryon/7acsG4dloz.jpeg';
$garmentPath = __DIR__ . '/raw_emerald.jpg';

$person = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($personPath));
$garment = 'data:image/jpeg;base64,' . base64_encode(file_get_contents($garmentPath));

$sessionId = 'verify_' . Str::uuid();

$session = TryOnSession::create([
    'session_id' => $sessionId,
    'user_id' => 1, // any id; the job does not gate on it
    'user_photo_base64' => $person,
    'garment_photos_json' => [$garment],
    'garment_categories_json' => ['dress'],
    'measurements_json' => ['chest_bust' => 110, 'waist' => 102, 'hips' => 107, 'shoulder_width' => 55, 'sleeve_length' => 71],
    'status' => TryOnSession::STATUS_QUEUED,
]);

echo 'created session #' . $session->id . ' (' . $sessionId . ')' . PHP_EOL;
echo 'dispatching ProcessTryOnJob onto the tryon queue...' . PHP_EOL;

ProcessTryOnJob::dispatch($session->id);

echo PHP_EOL . 'polling the SESSION ROW (what the frontend polls) ...' . PHP_EOL;

$deadline = time() + 200;
$last = null;
while (time() < $deadline) {
    sleep(3);
    $fresh = TryOnSession::find($session->id);
    $status = $fresh->status ?? '?';
    if ($status !== $last) {
        echo '  t+' . (time() - ($deadline - 200)) . 's  status=' . $status . PHP_EOL;
        $last = $status;
    }

    if (in_array($status, [TryOnSession::STATUS_COMPLETED, TryOnSession::STATUS_FAILED], true)) {
        echo PHP_EOL . '=== TERMINAL STATE ===' . PHP_EOL;
        echo 'status   : ' . $status . PHP_EOL;
        echo 'error    : ' . substr((string) $fresh->error_message, 0, 300) . PHP_EOL;
        echo 'feedback : ' . substr((string) $fresh->ai_feedback, 0, 300) . PHP_EOL;

        $img = (string) $fresh->result_image_base64;
        echo 'result   : ' . strlen($img) . ' chars' . PHP_EOL;

        if ($status === TryOnSession::STATUS_COMPLETED && strlen($img) > 1000) {
            $b64 = preg_replace('#^data:image/\w+;base64,#', '', $img);
            $bytes = base64_decode($b64, true);
            $info = $bytes !== false ? @getimagesizefromstring($bytes) : null;
            $mime = $info ? $info['mime'] : 'unknown';
            if ($bytes !== false) {
                file_put_contents(__DIR__ . '/_verify_app_path_render.png', $bytes);
                echo 'saved    : _verify_app_path_render.png' . PHP_EOL;
            }
            echo PHP_EOL . 'APP PATH OK â€” the queue produced a real render.' . PHP_EOL;
        } else {
            echo PHP_EOL . 'APP PATH FAILED â€” see status/error above.' . PHP_EOL;
        }
        break;
    }
}
