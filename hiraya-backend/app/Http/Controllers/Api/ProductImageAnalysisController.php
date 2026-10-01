<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\OccasionBackgroundResolver;
use App\Services\GeminiKeyPool;
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

        /*
         * POOL, NOT A SINGLE KEY — the key that answers comes from
         * App\Services\GeminiKeyPool, which rotates to the next key when the
         * current one's daily quota is drained (429). With no GEMINI_API_KEYS
         * configured this behaves exactly as a single GEMINI_API_KEY.
         */
        $apiKey = GeminiKeyPool::current();
        if (!$apiKey) {
            return response()->json([
                'message' => 'Automatic garment analysis is not configured. Add GEMINI_API_KEY (or GEMINI_API_KEYS) to the backend environment.',
            ], 503);
        }

        /*
         * REMOVE THE PHP TIME LIMIT FOR THIS REQUEST.
         *
         * The model chain below can legitimately spend up to ~184s in HTTP
         * (2 models x 3 attempts x 30s, plus backoff) before it gives up and
         * reports a real reason. A stock `max_execution_time` of 30-60s would
         * kill that mid-flight and surface as an unexplained 500 — the very
         * "it just times out" symptom this chain was added to fix.
         *
         * Safe to unbind for the same reason `TryOnController` does it: the
         * request carries its OWN finite ceiling. Every model has a 30s HTTP
         * timeout, the chain is finite, and the whole walk is bounded well under
         * the 300s the browser is willing to wait. Unbounded PHP time can only
         * stop the interpreter from aborting a call that is about to answer.
         */
        @set_time_limit(0);

        try {
            /*
             * WALK THE MODEL CHAIN, RETRYING EACH ONE.
             *
             * This used to post to a single hardcoded model, which meant a 404
             * (retired ID), a 429 (that model's 20/day free bucket drained) or a
             * 30s stall on `gemini-3.5-flash-lite` ended the whole request — even
             * though `config('services.gemini.models')` already listed a working
             * sibling (`gemini-3.5-flash`) and `PersonVerificationController` had
             * been walking that chain all along. The catalog auto-fill was the one
             * Gemini surface NOT using the fallback list.
             *
             * The explicit `model` is always tried first so a deliberate override
             * in .env still wins; the chain's only job is to survive a bad one.
             *
             * `asked` accumulates the attempts so the final failure can say WHAT
             * went wrong per model, instead of the useless "took too long".
             */
            $asked = [];
            $response = null;
            $connectionError = null;

            foreach ($this->geminiModels() as $model) {
                $asked[] = $model;

                try {
                    $response = $this->askGemini($apiKey, $model, $this->prompt(), [
                        /*
                         * `inlineData` / `mimeType` — THE API'S OWN JSON NAMES.
                         *
                         * This payload used to say `inline_data` / `mime_type`,
                         * which look like PHP-serialised protobuf field names.
                         * Google's v1beta endpoint is strict protobuf-JSON and
                         * rejects unknown names, so every garment image was
                         * refused before it was ever read:
                         *   400 Invalid JSON payload received.
                         *       Unknown name "inline_data" at
                         *       'contents[0].parts[1].inline_data': Cannot find field.
                         *
                         * The model chain cannot rescue this: a malformed request
                         * fails identically on every model, so the walk stopped on
                         * the first entry and the admin was told to "check the
                         * Gemini API configuration" — with a perfectly valid key
                         * and a live model.
                         */
                        'inlineData' => [
                            'mimeType' => $this->mimeType($validated['image']),
                            'data' => $this->base64Data($validated['image']),
                        ],
                    ], 3, 800);

                    /*
                     * A chain that already produced a usable answer stops here.
                     * A 4xx that is not quota/model-shaped (a malformed request,
                     * a bad key) will fail identically on every sibling, so
                     * walking the rest of the list would only burn ~30s more
                     * before reporting the same thing.
                     */
                    if ($response->successful() || ! $this->isTransient($response->status())) {
                        break;
                    }
                } catch (\Illuminate\Http\Client\ConnectionException $exception) {
                    /*
                     * ONE MODEL'S CONNECTION FAILED — KEEP WALKING.
                     *
                     * This used to abort the whole request and report "took too
                     * long" regardless of what actually happened. Now a socket
                     * error on one model just moves us to the next one, and only
                     * if EVERY model failed on the socket do we report it — with
                     * the real reason, so a TLS problem is never mis-sold as a
                     * slow service.
                     */
                    $connectionError = $exception;
                    continue;
                }
            }

            if ($response === null) {
                /*
                 * EVERY MODEL FAILED ON THE CONNECTION. Report what the last
                 * failure actually WAS: a TLS trust problem can never succeed on
                 * a retry and needs the CA bundle fixed, while a genuine stall
                 * is worth another press of the button.
                 */
                $error = $connectionError?->getMessage() ?? 'unknown connection failure';
                $isTls = $this->looksLikeTlsFailure($error);

                Log::warning('Gemini garment analysis could not reach the API', [
                    'models' => $asked,
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
                    'message' => 'The image analysis service could not be reached' .
                        ($asked ? ' (tried: ' . implode(', ', $asked) . ')' : '') .
                        '. Please try again.',
                ], 504);
            }
        } catch (\Throwable $exception) {
            /*
             * ANYTHING ELSE — a malformed response, a bug in this controller, a
             * cURL error that is not a ConnectionException. Without this the
             * admin gets a 500 HTML page, which the frontend cannot turn into a
             * message. The log carries the detail; the user gets a retry prompt.
             */
            Log::warning('Gemini garment analysis crashed', [
                'models' => $asked,
                'error' => $exception->getMessage(),
            ]);

            return response()->json([
                'message' => 'The image analysis service could not be reached. Please try again.',
            ], 502);
        }

        if ($response->failed()) {
            $upstreamMessage = (string) data_get($response->json(), 'error.message', 'Unknown Gemini error');
            Log::warning('Gemini garment analysis failed', [
                'status' => $response->status(),
                'models_tried' => $asked,
                // The upstream text is what actually names the fault (a retired
                // model, a bad key, a malformed part). Without it in the log the
                // only evidence available is a bare status, which is why this
                // failure read as an unexplained 400 for days.
                'upstream' => $upstreamMessage,
            ]);

            $lower = strtolower($upstreamMessage);
            $lastModel = $asked[count($asked) - 1] ?? config('services.gemini.model');

            if ($response->status() === 404 || str_contains($lower, 'not found') || str_contains($lower, 'not supported') || str_contains($lower, 'no longer available')) {
                /*
                 * Google RETIRES models and answers them with 404. This is
                 * exactly how the "Add New Garment" auto-fill broke silently
                 * once `gemini-2.0-flash` was withdrawn.
                 *
                 * This is now the WORST-CASE report: the chain above already
                 * walked every configured model, so all of them are unusable.
                 */
                $message = 'None of the configured Gemini vision models (' . implode(', ', $asked) . ') are '
                    . 'available. Set GEMINI_VISION_MODELS in the backend .env to a current model list '
                    . '(e.g. gemini-3.5-flash-lite).';
            } elseif (str_contains($lower, 'suspended') || str_contains($lower, 'permission denied') || str_contains($lower, 'api key not valid')) {
                /* A dead key must never answer again today — report it so the
                 * pool rotates past it on the next request. */
                GeminiKeyPool::markInvalid($apiKey);
                $message = 'The Gemini API key is invalid or suspended. Replace the drained key in the backend .env file.';
            } elseif (str_contains($lower, 'quota') || str_contains($lower, 'rate limit') || $response->status() === 429) {
                /* The DAILY bucket for this key is gone — put it on cooldown so
                 * the pool serves the next request from the next key. */
                GeminiKeyPool::markRateLimited($apiKey);
                $message = 'The Gemini analysis quota was reached. Wait a moment, then try again.';
            } elseif ($response->status() === 503 || str_contains($lower, 'overloaded') || str_contains($lower, 'unavailable')) {
                /*
                 * GOOGLE-SIDE OVERLOAD — NOT A CONFIG FAULT.
                 *
                 * 503 means "the model is overloaded, try again" — a momentary
                 * Google condition that clears on its own. The chain retries
                 * above have already absorbed most of these; one that still
                 * surfaces outlasted every configured model, so the message says
                 * the fault is upstream and temporary.
                 */
                $message = 'The Gemini image analysis service is temporarily overloaded. This is a brief '
                    . 'condition on Google\'s side, not a configuration problem — please try again in '
                    . 'a few moments.';
            } else {
                $message = 'Garment image analysis failed on ' . $lastModel . '. Check the Gemini API configuration.';
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

        /*
         * THE AI'S OWN BACKGROUND PICK WINS. The prompt asks Gemini for a
         * `background_vibe` from the six scene keys, so a barong lands on the
         * Cultural backdrop because the model recognised a barong — not because
         * "TRADITIONAL" happened to be listed after "FORMAL". The occasions
         * resolver is only the fallback for an answer outside the vocabulary.
         */
        $vibe = strtolower(trim((string) ($analysis['background_vibe'] ?? '')));
        $occasionKey = array_key_exists($vibe, config('hiraya_backgrounds.occasions', []))
            ? $vibe
            : $this->backgrounds->resolveFromOccasions($occasions);
        $analysis['background_vibe'] = $occasionKey;

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
     * The ordered, de-duplicated Gemini model list: the explicitly chosen
     * `model` FIRST, then the configured fallbacks. Read straight from config so
     * a .env edit (plus `config:cache`) is all it takes to change the order.
     *
     * Identical in shape to `PersonVerificationController::geminiModels()` — the
     * two surfaces must not drift, or a model retired for one keeps breaking the
     * other.
     *
     * @return array<int, string>
     */
    private function geminiModels(): array
    {
        $list = array_merge(
            [(string) config('services.gemini.model')],
            (array) config('services.gemini.models', [])
        );

        return array_values(array_unique(array_filter(array_map('trim', $list))));
    }

    /**
     * A status worth trying ANOTHER model for.
     *
     * 429 (this model's daily free bucket drained), 5xx (overloaded / transient)
     * and 404 (the ID was retired) are all conditions of the MODEL, not of the
     * request: a sibling with a fresh bucket answers the identical payload. A
     * 400/401/403 is a fault of the request or the key and would fail the same
     * way on every entry, so we stop and report it.
     */
    private function isTransient(int $status): bool
    {
        return in_array($status, [404, 429, 500, 502, 503, 504], true);
    }

    /**
     * ONE attempt against ONE model, with the transient-failure retries applied
     * to that model alone.
     *
     * The per-attempt HTTP timeout is set HERE, inside the retry closure's
     * reach, rather than on the outer chain. Previously `Http::timeout(30)` sat
     * outside `->retry(3, ...)`, so the three attempts shared a single 30s
     * ceiling: the first slow model consumed the whole budget and the remaining
     * two never got to run at all.
     *
     * A TLS trust failure is never retried — it cannot succeed on a second
     * attempt, and retrying only delays the accurate error the admin needs.
     *
     * @throws \Illuminate\Http\Client\ConnectionException
     */
    private function askGemini(string $apiKey, string $model, array $parts, array $inlineImage, int $attempts, int $backoffMs)
    {
        return Http::acceptJson()
            ->retry(
                $attempts,
                $backoffMs,
                function ($exception) {
                    // $exception is the Throwable, or a Response on an HTTP-level retry.
                    if ($exception instanceof \Illuminate\Http\Client\ConnectionException) {
                        return ! $this->looksLikeTlsFailure($exception->getMessage());
                    }

                    if ($exception instanceof \Illuminate\Http\Client\Response) {
                        return $this->isTransient($exception->status());
                    }

                    return false;
                },
                // Keep a final failure as a RESPONSE so the caller can inspect the
                // status and decide whether the next MODEL is worth trying.
                throw: false,
            )
            ->timeout(30)
            ->connectTimeout(10)
            ->post($this->endpoint($apiKey, $model), [
                'contents' => [[
                    'parts' => [
                        ['text' => $parts['prompt']],
                        /*
                         * The part VALUE is `$inlineImage` — the call site already
                         * hands over `{ mimeType, data }`. Wrapping it a second
                         * time nests the whole blob one level too deep and Google
                         * answers "Unknown name \"mimeType\" at
                         * 'contents[0].parts[1].inlineData'".
                         */
                        $inlineImage,
                    ],
                ]],
                'generationConfig' => [
                    'temperature' => 0.2,
                    'responseMimeType' => 'application/json',
                ],
            ]);
    }

    /**
     * The catalog-analysis prompt, kept as its own method so `askGemini` stays a
     * pure transport and the text is not rebuilt inside the model loop.
     *
     * @return array{prompt: string}
     */
    private function prompt(): array
    {
        return ['prompt' => <<<'PROMPT'
Analyze this garment catalog image and return ONLY valid JSON with these keys: name, description, category, material, gender, colors, undertone, fit_type, body_shapes, occasions, background_vibe.
category must be TOPS, BOTTOMS, DRESSES, OUTERWEAR, FORMAL_MEN, FORMAL_WOMEN, or FULL_BODY. gender must be Men, Women, or Unisex. colors, body_shapes, and occasions must be arrays. undertone must be WARM, COOL, or NEUTRAL. fit_type must be SLIM, REGULAR, or LOOSE. Never invent exact body measurements; those are entered separately.
Judge fit_type from the CUT of the garment as it actually hangs on the body, not from the model wearing it: a shirt that tapers at the waist with little ease through the chest is SLIM, one that falls straight from the shoulder with ordinary room is REGULAR, and one visibly wider than the wearer with dropped shoulders or extra drape is LOOSE. This value drives the storefront's "recommended for you" feed, so an inaccurate answer sends a shopper the wrong silhouette. When you genuinely cannot tell, return REGULAR.
description must be one short shopper-facing sentence about fabric, cut and feel — no measurements, no size chart, no marketing superlatives.
background_vibe picks the catalog backdrop scene for this garment and must be exactly ONE of: summer, cultural, formal, business, streetwear, everyday. Choose by what the garment is worn for: Filipino or other traditional/heritage wear (barong tagalog, filipiniana, terno, baro't saya, malong) is cultural; gowns, cocktail and evening wear is formal; suits, tuxedos, blazers, slacks, dress shirts and office wear is business; beach, resort, linen, floral, shorts and swimwear is summer; hoodies, cargo, graphic tees, bombers and sneakers-culture pieces is streetwear; plain tees, jeans and basics is everyday.
PROMPT];
    }

    /**
     * Full Gemini generateContent URL for a SPECIFIC model, with the API key
     * always URL-encoded into the query string.
     *
     * Takes the model as a parameter because the caller walks a chain: a single
     * hardcoded endpoint is what made one retired model take the whole feature
     * down with it.
     */
    private function endpoint(string $apiKey, ?string $model = null): string
    {
        return 'https://generativelanguage.googleapis.com/v1beta/models/'
            . ($model ?: config('services.gemini.model'))
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