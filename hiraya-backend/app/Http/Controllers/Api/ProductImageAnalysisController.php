<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\OccasionBackgroundResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ProductImageAnalysisController extends Controller
{
    /*
     * CANONICAL AI-STYLING VOCABULARY.
     *
     * These MUST stay identical to `ProductRequest` and
     * `src/constants/productOptions.js`. They are duplicated here on purpose so
     * the analysis response is already canonical and never relies on the client
     * having mapped the value correctly.
     */
    private const OCCASIONS = [
        'CASUAL', 'FORMAL', 'BUSINESS', 'PARTY', 'STREETWEAR', 'MINIMALIST', 'TRADITIONAL',
    ];

    private const BODY_SHAPES = [
        'HOURGLASS', 'PEAR', 'APPLE', 'RECTANGLE', 'INVERTED_TRIANGLE',
    ];

    public function __construct(private readonly OccasionBackgroundResolver $backgrounds)
    {
    }

    public function analyze(Request $request)
    {
        $validated = $request->validate([
            'image' => ['required', 'string', 'regex:/^data:image\/(png|jpeg|jpg|webp);base64,/'],
        ]);

        $apiKey = config('services.gemini.key');
        if (!$apiKey) {
            return response()->json([
                'message' => 'Automatic garment analysis is not configured. Add GEMINI_API_KEY to the backend environment.',
            ], 503);
        }

        try {
            /*
             * RETRY ONCE on a transient failure.
             *
             * The first request after the dev server boots (or after the machine
             * wakes from sleep) frequently loses the connection and dies with
             * `cURL error 28`, which surfaced as a bogus "took too long" 504 for
             * a call that had barely started. One silent retry absorbs that.
             *
             * A TLS trust failure (`cURL error 60`) is NOT retried: it can never
             * succeed on a second attempt, so retrying only delays the accurate
             * error the admin needs to see.
             */
            $response = Http::timeout(30)
                ->connectTimeout(10)
                /*
                 * RETRY TRANSIENT FAILURES — BOTH SOCKET AND HTTP.
                 *
                 * The predicate below retries when EITHER:
                 *   (a) the request threw a connection/timeout exception, or
                 *   (b) Gemini answered with a TRANSIENT status.
                 *
                 * (b) is the fix for the reported 502. Google returns 503
                 * ("The model is overloaded") and 429 under load, and a bare
                 * 503 RESPONSE is not an exception — so the previous predicate,
                 * which only ever saw throwables, let it pass straight through
                 * to the `failed()` branch and out as a generic error. The user
                 * hit a momentary Google hiccup and was told the analysis had
                 * "failed", with no hint that trying again would work.
                 *
                 * `throw: false` keeps a final failure as a RESPONSE so the
                 * status-specific messaging below still runs after the retries.
                 */
                ->retry(
                    3,
                    800,
                    function ($exception) {
                        // $exception is the Throwable, or a Response on an HTTP-level retry.
                        if ($exception instanceof \Illuminate\Http\Client\ConnectionException) {
                            return ! $this->looksLikeTlsFailure($exception->getMessage());
                        }

                        if ($exception instanceof \Illuminate\Http\Client\Response) {
                            return in_array($exception->status(), [429, 500, 502, 503, 504], true);
                        }

                        return false;
                    },
                    throw: false,
                )
                ->acceptJson()
                ->post($this->endpoint($apiKey), [
                    'contents' => [[
                        'parts' => [
                            ['text' => <<<'PROMPT'
Analyze this garment catalog image and return ONLY valid JSON with these keys: name, description, category, material, gender, colors, undertone, fit_type, body_shapes, occasions.
category must be TOPS, BOTTOMS, DRESSES, OUTERWEAR, FORMAL_MEN, FORMAL_WOMEN, or FULL_BODY. gender must be Men, Women, or Unisex. colors, body_shapes, and occasions must be arrays. undertone must be WARM, COOL, or NEUTRAL. fit_type must be SLIM, REGULAR, or LOOSE. Never invent exact body measurements; those are entered separately.
PROMPT],
                            ['inline_data' => [
                                'mime_type' => $this->mimeType($validated['image']),
                                'data' => $this->base64Data($validated['image']),
                            ]],
                        ],
                    ]],
                    'generationConfig' => [
                        'temperature' => 0.2,
                        'responseMimeType' => 'application/json',
                    ],
                ]);
        } catch (\Illuminate\Http\Client\ConnectionException $exception) {
            /*
             * A timeout, DNS/socket failure OR TLS failure to Gemini throws here.
             * Without this catch it would bubble up as a 500 HTML error page,
             * which the frontend cannot parse into a useful message.
             *
             * The message must reflect WHAT actually failed. Reporting every
             * connection error as "took too long" (504) sent us chasing a
             * timeout when the real cause was `cURL error 60: unable to get
             * local issuer certificate` — a TLS trust problem on the host PHP
             * cURL, which no amount of retrying will fix and which the admin
             * can actually act on.
             */
            $error = $exception->getMessage();
            $isTls = $this->looksLikeTlsFailure($error);

            Log::warning('Gemini garment analysis connection failed', [
                'model' => config('services.gemini.model'),
                'tls' => $isTls,
                'error' => $error,
            ]);

            if ($isTls) {
                return response()->json([
                    'message' => 'The Hiraya server could not establish a secure connection to the image ' .
                        'analysis service (TLS certificate verification failed). Fix the PHP cURL CA bundle ' .
                        'on the server (php.ini `curl.cainfo` / `openssl.cafile`), then try again.',
                ], 502);
            }

            return response()->json([
                'message' => 'The image analysis service took too long to respond. Please try again.',
            ], 504);
        }

        if ($response->failed()) {
            $upstreamMessage = (string) data_get($response->json(), 'error.message', 'Unknown Gemini error');
            Log::warning('Gemini garment analysis failed', [
                'status' => $response->status(),
                'model' => config('services.gemini.model'),
            ]);

            $lower = strtolower($upstreamMessage);

            if ($response->status() === 404 || str_contains($lower, 'no longer available') || str_contains($lower, 'not found')) {
                /*
                 * Google RETIRES models and answers them with 404. This is
                 * exactly how the "Add New Garment" auto-fill broke silently
                 * once `gemini-2.0-flash` was withdrawn — name the model so the
                 * fix is a one-line .env change.
                 */
                $message = 'The configured Gemini vision model "' . config('services.gemini.model') . '" is not '
                    . 'available. Set GEMINI_VISION_MODEL to a current model (e.g. gemini-2.5-flash) in the backend .env.';
            } elseif (str_contains($lower, 'suspended') || str_contains($lower, 'permission denied')) {
                $message = 'The Gemini API key is invalid or suspended. Replace GEMINI_API_KEY in the backend .env file.';
            } elseif (str_contains($lower, 'quota') || str_contains($lower, 'rate limit') || $response->status() === 429) {
                $message = 'The Gemini analysis quota was reached. Wait a moment, then try again.';
            } elseif ($response->status() === 503 || str_contains($lower, 'overloaded') || str_contains($lower, 'unavailable')) {
                /*
                 * GOOGLE-SIDE OVERLOAD — NOT A CONFIG FAULT.
                 *
                 * This was the reported 502: the log recorded
                 * `Gemini garment analysis failed {"status":503}` while the key
                 * and model were perfectly valid. 503 means "the model is
                 * overloaded, try again" — a momentary Google condition that
                 * clears on its own.
                 *
                 * The retries above now absorb most of these. If one STILL
                 * surfaces it is because the overload outlasted all three
                 * attempts, so the message must say the fault is upstream and
                 * temporary rather than implying something is misconfigured.
                 */
                $message = 'The Gemini image analysis service is temporarily overloaded. This is a brief '
                    . 'condition on Google\'s side, not a configuration problem — please try again in '
                    . 'a few moments.';
            } else {
                $message = 'Garment image analysis failed. Check the Gemini API configuration.';
            }

            return response()->json(['message' => $message], 502);
        }

        /*
         * gemini-2.5-flash returns THINKING parts alongside the answer. The
         * first part is frequently a thought (no `text`), so blindly reading
         * parts.0.text yields null and the response parses as invalid. Walk the
         * parts and take the first one that actually carries text.
         */
        $parts = data_get($response->json(), 'candidates.0.content.parts', []);
        $text = '';
        foreach ((array) $parts as $part) {
            if (! empty($part['text'])) {
                $text = (string) $part['text'];
                break;
            }
        }

        $analysis = json_decode(trim((string) preg_replace('/^```(?:json)?|```$/m', '', $text)), true);

        if (! is_array($analysis)) {
            return response()->json(['message' => 'Garment image analysis returned invalid data.'], 502);
        }

        /*
         * OCCASION / VIBE = PURE PRODUCT DETAIL.
         *
         * The AI's occasion is canonicalised against the shared vocabulary
         * (e.g. "Beach Wear" -> "summer") and merged back into the payload so
         * it is stored on the product and shown on the customer's shop
         * surfaces. It does NOT select a background — every garment shares the
         * one default HIRAYA frame, which the frontend draws in code.
         */
        /*
         * CANONICALISE the AI's free-form vocabulary BEFORE it leaves this
         * endpoint.
         *
         * Gemini answers the vision prompt in its own words — "Hourglass",
         * "Inverted Triangle", "smart casual" — while `ProductRequest` validates
         * `body_shapes.*` / `occasions.*` STRICTLY against the canonical set
         * (`Rule::in`). The console posts exactly what the AI returned, so a
         * response like `body_shapes: ["Hourglass"]` failed validation with
         * "The selected body_shapes.0 is invalid" and the whole save answered
         * `422 (Unprocessable Content)` — the reported bug.
         *
         * Normalising here (uppercase + separator-insensitive match) means the
         * values ALREADY match what both consoles and the validator expect, so
         * the multipart save passes. Unknown values are dropped rather than
         * stored, since `Rule::in` would reject them anyway.
         */
        $analysis['body_shapes'] = $this->canonicalize(
            is_array($analysis['body_shapes'] ?? null) ? $analysis['body_shapes'] : [],
            self::BODY_SHAPES,
        );
        $analysis['occasions'] = $this->canonicalize(
            is_array($analysis['occasions'] ?? null) ? $analysis['occasions'] : [],
            self::OCCASIONS,
        );

        $occasions = $analysis['occasions'];
        $occasionKey = $this->backgrounds->resolveFromOccasions($occasions);

        // Keep the AI's own wording but ensure the canonical key is first, so
        // downstream surfaces have a stable, matchable value to display.
        $analysis['occasion'] = $occasionKey;
        $analysis['occasion_label'] = data_get(
            config('hiraya_backgrounds.occasions'),
            "{$occasionKey}.label",
            $occasionKey,
        );

        return response()->json(['data' => $analysis]);
    }

    /**
     * Map the AI's free-form values onto the canonical vocabulary.
     *
     * Matching is case- and separator-insensitive, so "Hourglass", "hourglass"
     * and "INVERTED TRIANGLE" all resolve to their canonical constant. A value
     * with no canonical equivalent is DROPPED — the validator would reject it, so
     * keeping it would only re-introduce the 422.
     *
     * @param  array<int, mixed>  $values
     * @param  array<int, string> $canonical
     * @return array<int, string>
     */
    private function canonicalize(array $values, array $canonical): array
    {
        $out = [];

        foreach ($values as $value) {
            if (! is_string($value)) {
                continue;
            }

            // Collapse to the canonical shape: uppercase, single underscore
            // separators ("Inverted Triangle" -> "INVERTED_TRIANGLE").
            $needle = strtoupper(trim((string) preg_replace('/[^A-Za-z0-9]+/', '_', $value)));

            if (! in_array($needle, $canonical, true)) {
                continue;
            }

            if (! in_array($needle, $out, true)) {
                $out[] = $needle;
            }
        }

        return $out;
    }

    /**
     * True when a cURL/Guzzle error is a TLS trust failure (missing or bad CA
     * bundle) rather than a transient timeout. These can never succeed on a
     * retry and need a DIFFERENT, actionable message.
     */
    private function looksLikeTlsFailure(string $error): bool
    {
        return str_contains($error, 'error 60')
            || str_contains($error, 'SSL certificate')
            || str_contains($error, 'certificate verify');
    }

    /**
     * Full Gemini generateContent URL for the configured vision model.
     *
     * Extracted so the endpoint is defined in one place and the API key is
     * always URL-encoded into the query string.
     */
    private function endpoint(string $apiKey): string
    {
        return 'https://generativelanguage.googleapis.com/v1beta/models/'
            . config('services.gemini.model')
            . ':generateContent?key=' . urlencode($apiKey);
    }

    private function base64Data(string $dataUri): string
    {
        return preg_replace('/^data:image\/(png|jpeg|jpg|webp);base64,/', '', $dataUri) ?? '';
    }

    private function mimeType(string $dataUri): string
    {
        preg_match('/^data:(image\/(?:png|jpeg|jpg|webp));base64,/', $dataUri, $matches);
        return $matches[1] ?? 'image/jpeg';
    }
}