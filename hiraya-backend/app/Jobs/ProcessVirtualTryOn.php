<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Models\AiTryOnSession;

class ProcessVirtualTryOn implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected $sessionId;

    public function __construct($sessionId)
    {
        $this->sessionId = $sessionId;
    }

    public function handle()
    {
        $session = AiTryOnSession::find($this->sessionId);

        if (!$session) {
            Log::error("Try-on session {$this->sessionId} not found");
            return;
        }

        try {
            // Call external VTON API (Hugging Face / Replicate)
            $result = $this->callVtonApi($session);

            if ($result['success']) {
                $session->update([
                    'status' => 'completed',
                    'result_image_base64' => $result['result_base64'],
                    'ai_feedback' => $result['feedback'] ?? 'Virtual try-on completed successfully',
                ]);
            } else {
                $session->update([
                    'status' => 'failed',
                    'ai_feedback' => $result['error'] ?? 'VTON processing failed',
                ]);
            }
        } catch (\Exception $e) {
            Log::error("VTON processing failed for session {$this->sessionId}: " . $e->getMessage());
            $session->update([
                'status' => 'failed',
                'ai_feedback' => 'Processing error: ' . $e->getMessage(),
            ]);
        }
    }

    protected function callVtonApi($session)
    {
        // Configuration for external VTON API
        // Supports Hugging Face Inference API or Replicate API
        $provider = config('services.vton.provider', 'huggingface');

        if ($provider === 'huggingface') {
            return $this->callHuggingFaceVton($session);
        } elseif ($provider === 'replicate') {
            return $this->callReplicateVton($session);
        }

        return ['success' => false, 'error' => 'No VTON provider configured'];
    }

    protected function callHuggingFaceVton($session)
    {
        $apiToken = config('services.huggingface.token');
        $modelId = config('services.huggingface.vton_model', 'facebook/try-on-diffusion');

        if (!$apiToken) {
            return ['success' => false, 'error' => 'Hugging Face token not configured'];
        }

        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . $apiToken,
        ])->timeout(300)->post("https://api-inference.huggingface.co/models/{$modelId}", [
            'inputs' => [
                'person_image' => $session->user_photo_base64,
                'garment_images' => $session->garment_photos_base64_json,
            ],
        ]);

        if ($response->successful()) {
            $data = $response->json();
            // Hugging Face returns base64 or URL depending on model
            $resultBase64 = $data['image'] ?? $data['output'] ?? null;

            if ($resultBase64) {
                return ['success' => true, 'result_base64' => $resultBase64];
            }

            return ['success' => false, 'error' => 'No result image returned'];
        }

        return ['success' => false, 'error' => $response->body()];
    }

    protected function callReplicateVton($session)
    {
        $apiToken = config('services.replicate.token');
        $modelVersion = config('services.replicate.vton_version', 'yorickvp/try-on-diffusion:...');

        if (!$apiToken) {
            return ['success' => false, 'error' => 'Replicate token not configured'];
        }

        $response = Http::withHeaders([
            'Authorization' => 'Token ' . $apiToken,
            'Content-Type' => 'application/json',
        ])->timeout(300)->post('https://api.replicate.com/v1/predictions', [
            'version' => $modelVersion,
            'input' => [
                'person_image' => 'data:image/jpeg;base64,' . $session->user_photo_base64,
                'garment_images' => array_map(fn($img) => 'data:image/jpeg;base64,' . $img, $session->garment_photos_base64_json),
            ],
        ]);

        if ($response->successful()) {
            $prediction = $response->json();
            $predictionUrl = $prediction['urls']['get'];

            // Poll for completion (in production, use webhook)
            return $this->pollReplicatePrediction($predictionUrl);
        }

        return ['success' => false, 'error' => $response->body()];
    }

    protected function pollReplicatePrediction($url)
    {
        $apiToken = config('services.replicate.token');

        for ($i = 0; $i < 60; $i++) { // Max 5 minutes (60 * 5s)
            sleep(5);

            $response = Http::withHeaders([
                'Authorization' => 'Token ' . $apiToken,
            ])->get($url);

            if ($response->successful()) {
                $data = $response->json();

                if ($data['status'] === 'succeeded') {
                    $output = $data['output'];
                    $resultUrl = is_array($output) ? $output[0] : $output;

                    // Download and convert to base64
                    $imageResponse = Http::get($resultUrl);
                    if ($imageResponse->successful()) {
                        $base64 = base64_encode($imageResponse->body());
                        return ['success' => true, 'result_base64' => $base64];
                    }
                    return ['success' => false, 'error' => 'Failed to download result image'];
                }

                if ($data['status'] === 'failed') {
                    return ['success' => false, 'error' => $data['error'] ?? 'Prediction failed'];
                }
            }
        }

        return ['success' => false, 'error' => 'Prediction timed out'];
    }
}