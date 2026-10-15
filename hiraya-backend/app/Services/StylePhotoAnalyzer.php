<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * AI STYLIST — what the stylist SEES in the customer's photo.
 *
 * "AI describes, rules choose." This class only DESCRIBES the photo; it never
 * picks a product. The description feeds the style-profile modal (the customer
 * confirms or corrects the undertone) and tells the lookbook overlay where to
 * draw its dots. Products are then chosen by StylistLookbookService's rules.
 *
 * What it deliberately does NOT infer: body shape, weight, size, age, ethnicity
 * or attractiveness. Size comes from the customer's own sizing profile.
 *
 * Returns null on any failure (no key, quota, timeout, unreadable answer); the
 * caller then falls back to "Not sure — pick one" and fixed dot positions.
 */
class StylePhotoAnalyzer
{
    private const TIMEOUT_SECONDS = 25;

    public const UNDERTONES = ['warm', 'cool', 'neutral'];

    private const PROMPT = <<<'PROMPT'
You are helping a fashion stylist. DESCRIBE this photo of a customer as JSON.

Rules:
- Describe only what is visible. Do NOT infer or mention body shape, weight, clothing size, age, ethnicity or attractiveness.
- "undertone": the person's apparent skin undertone for choosing clothing colors: "warm", "cool" or "neutral". If the lighting makes it unclear, answer "neutral" with a low confidence.
- "confidence": 0.0 to 1.0, how sure you are about the undertone.
- "wearing_colors": up to 3 plain color names of the clothes the person wears now (for example "navy", "white").
- "vibe": the style of what they wear now, exactly one of: "everyday", "business", "formal", "cultural", "summer", "streetwear".
- "anchors": positions on the image as FRACTIONS between 0.0 and 1.0 (both x and y), measured from the TOP-LEFT corner: "torso" = middle of the chest, "legs" = middle of the thighs, "feet" = the feet. Use null for a point that is not visible.

Return ONLY this JSON:
{"undertone":"warm","confidence":0.8,"wearing_colors":["navy"],"vibe":"everyday","anchors":{"torso":{"x":0.5,"y":0.3},"legs":{"x":0.5,"y":0.62},"feet":{"x":0.5,"y":0.93}}}
PROMPT;

    /**
     * @return array{undertone: string, confidence: float, wearing_colors: array<int, string>, vibe: ?string, anchors: array<string, ?array{x: float, y: float}>, engine: string}|null
     */
    public function analyse(string $dataUri): ?array
    {
        if (! preg_match('/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/s', $dataUri, $m)) {
            return null;
        }

        $mime = $m[1] === 'image/jpg' ? 'image/jpeg' : $m[1];
        $data = $m[2];

        foreach ($this->models() as $model) {
            $apiKey = GeminiKeyPool::current();
            if (! $apiKey) {
                Log::info('Style photo analysis skipped: no Gemini key available.');

                return null;
            }

            try {
                // Key in a header, never the URL (URLs leak into logged exceptions).
                $response = Http::timeout(self::TIMEOUT_SECONDS)
                    ->connectTimeout(10)
                    ->acceptJson()
                    ->withHeaders(['x-goog-api-key' => $apiKey])
                    ->post('https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent', [
                        'contents' => [[
                            'parts' => [
                                ['text' => self::PROMPT],
                                ['inlineData' => ['mimeType' => $mime, 'data' => $data]],
                            ],
                        ]],
                        'generationConfig' => [
                            // 0 = the same photo gets the same description (no "mood").
                            'temperature' => 0,
                            'responseMimeType' => 'application/json',
                        ],
                    ]);
            } catch (\Throwable $e) {
                Log::info('Style photo analysis request failed (' . $model . '): ' . $e->getMessage());

                continue;
            }

            if (! $response->successful()) {
                if ($response->status() === 429) {
                    GeminiKeyPool::markRateLimited($apiKey);
                } elseif (in_array($response->status(), [401, 403], true)) {
                    GeminiKeyPool::markInvalid($apiKey);
                }
                Log::info('Style photo analysis non-2xx (' . $model . '): ' . $response->status());

                continue;
            }

            $text = (string) data_get($response->json(), 'candidates.0.content.parts.0.text', '');
            $parsed = $this->parse($text);

            if ($parsed !== null) {
                return $parsed + ['engine' => 'gemini:' . $model];
            }
        }

        return null;
    }

    /** @return array<int, string> */
    private function models(): array
    {
        $list = array_merge(
            [(string) config('services.gemini.model')],
            (array) config('services.gemini.models', [])
        );

        return array_values(array_unique(array_filter(array_map('trim', $list))));
    }

    /**
     * Turn the model's JSON into a strictly-typed description. Anything out of
     * range is dropped rather than trusted.
     */
    public function parse(string $text): ?array
    {
        $text = trim(preg_replace('/^```(?:json)?|```$/m', '', $text) ?? $text);
        $json = json_decode($text, true);

        if (! is_array($json)) {
            return null;
        }

        $undertone = strtolower(trim((string) ($json['undertone'] ?? '')));
        if (! in_array($undertone, self::UNDERTONES, true)) {
            $undertone = 'neutral';
        }

        $confidence = (float) ($json['confidence'] ?? 0);
        $confidence = max(0.0, min(1.0, $confidence));

        $colors = array_values(array_slice(array_filter(array_map(
            fn ($c) => is_string($c) ? strtolower(trim($c)) : null,
            (array) ($json['wearing_colors'] ?? [])
        )), 0, 3));

        $vibe = strtolower(trim((string) ($json['vibe'] ?? '')));
        if (! array_key_exists($vibe, (array) config('stylist.occasions', []))) {
            $vibe = null;
        }

        $anchors = [];
        foreach (['torso', 'legs', 'feet'] as $point) {
            $p = $json['anchors'][$point] ?? null;
            $x = is_array($p) ? $this->fraction($p['x'] ?? null) : null;
            $y = is_array($p) ? $this->fraction($p['y'] ?? null) : null;
            $anchors[$point] = ($x !== null && $y !== null) ? ['x' => round($x, 3), 'y' => round($y, 3)] : null;
        }

        return [
            'undertone' => $undertone,
            'confidence' => round($confidence, 2),
            'wearing_colors' => $colors,
            'vibe' => $vibe,
            'anchors' => $anchors,
        ];
    }

    /**
     * A coordinate as a 0-1 fraction. MEASURED: the model mixes scales inside
     * one answer (`{"x": 0.49, "y": 42}`), and vision models often use 0-1000
     * for points, so 0-1, 0-100 and 0-1000 are all accepted and normalised.
     */
    private function fraction(mixed $value): ?float
    {
        if (! is_numeric($value)) {
            return null;
        }

        $v = (float) $value;

        return match (true) {
            $v < 0 => null,
            $v <= 1 => $v,
            $v <= 100 => $v / 100,
            $v <= 1000 => $v / 1000,
            default => null,
        };
    }
}
