<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\GeminiKeyPool;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * PERSON VERIFICATION — "IS THERE A PERSON IN THIS PHOTO?"
 * =========================================================
 *
 * WHY THIS EXISTS (the reported bug, and why the in-browser tests could not fix it)
 * ---------------------------------------------------------------------------------
 * The customer's rule is absolute:
 *
 *   "BAWAL lahat ng image na walang person. Hindi dapat lumabas sa canvas ang
 *    image na walang tao — kunwari damit lang, dapat ibalik sa user na walang
 *    person."
 *
 * Every in-browser attempt failed, and MEASUREMENT proved it rather than opinion:
 *
 *   - A geometric test (blob size + span + head-to-torso ratio) PASSED a garment
 *     on a mannequin, because a hanging garment IS one big, tall, body-shaped mass.
 *   - An RGB "skin tone" test was defeated by CREAM, WHITE and GOLD fabric. Against
 *     the app's own product photos it LEAKED 3 of 5 garments — `prem barong.jpg`
 *     (skinShare 0.32), `barong male.jpg` (0.35) and `modernshirt.jpg` (0.49) were
 *     all accepted, because gold embroidery and cream cloth satisfy any warm
 *     red>green>blue rule.
 *   - The bundled ISNet neural matte is a SALIENCY segmenter: asked to separate a
 *     subject from its background, it separated the BARONG (coverage 0.27-0.28)
 *     just as happily as a person. It is not a person detector.
 *   - The browser exposes no `FaceDetector` (verified: `typeof FaceDetector`
 *     is `undefined`), so no native face API can be leaned on either.
 *
 * `photoQuality.js` had already documented the conclusion years of tuning leads to:
 * "Distinguishing 'a person' from 'a photo OF a garment' reliably needs a vision
 * model, not arithmetic on a downscaled bitmap."
 *
 * So this endpoint asks an ACTUAL vision model — the same Gemini vision model the
 * catalog auto-fill already uses and which is already configured with a working
 * key — the only question that matters, and returns a machine-readable answer the
 * frontend gate can enforce.
 *
 * A PROVIDER CHAIN, NOT ONE VENDOR
 * --------------------------------
 * Gemini's FREE tier is 20 requests/DAY, shared with catalog auto-fill. Caching
 * (below) stretches that budget but does not remove the wall: once the quota is
 * spent, a legitimate customer gets "could not be verified". So the endpoint now
 * walks an ORDERED list of vision providers (config: services.
 * person_verification.providers) and uses the FIRST that answers. Gemini stays
 * first; a fallback (Cloudflare Workers AI, Groq, OpenAI) is reached ONLY when
 * Gemini is unavailable — a quota 429, an outage, a malformed reply — never when
 * Gemini simply answered "no person". A provider with no configured key is
 * SKIPPED, so an unconfigured deployment behaves exactly as before.
 *
 * FAIL CLOSED
 * -----------
 * Every failure path — no key, a timeout, a quota error, a malformed reply, or
 * EVERY provider failing — returns HTTP 200 with `has_person: false` and
 * `verified: false`. The frontend treats "not verified" as "not a person", so a
 * broken verifier can never admit a garment to the canvas. That is the safe
 * direction for this rule: the cost of a false refusal is a re-upload prompt; the
 * cost of a false acceptance is showing a fitting on a photo of nobody.
 */
class PersonVerificationController extends Controller
{
    /**
     * A generous window: the image is a downscaled JPEG and Gemini answers a
     * one-line JSON question quickly. 20s covers a slow link without hanging the
     * upload UI, which waits on this call.
     */
    private const TIMEOUT_SECONDS = 20;

    /**
     * HOW LONG A VERDICT IS REMEMBERED.
     *
     * The Gemini free tier is 20 requests PER DAY, shared with the catalog
     * auto-fill. Two things make that tight for this endpoint:
     *
     *   1. the frontend gate can ask twice for the same photo (upload, and again
     *      when an already-captured portrait is seeded onto the canvas), and
     *   2. every customer re-uploading the same picture pays again.
     *
     * A verdict for a given image is DETERMINISTIC — identical bytes deserve an
     * identical answer — so it is cached by content hash here, on the server,
     * where the cache is SHARED BY EVERY USER rather than living in one browser.
     * One customer's verification therefore serves the next.
     *
     * A DAY is the natural window: it is long enough to absorb a session's
     * repeats and short enough that a mistaken verdict does not persist forever.
     */
    private const CACHE_TTL_HOURS = 24;

    /**
     * The exact image bytes being classified in the CURRENT request, held so the
     * per-provider methods do not each need it threaded through as a parameter.
     * A controller instance answers one request, so this is not shared state.
     */
    private string $currentImage = '';

    /**
     * provider-name => fail reason for the CURRENT request, so that when EVERY
     * provider fails the caller can report a meaningful reason instead of a
     * generic error.
     *
     * @var array<string, string>
     */
    private array $lastFailure = [];

    /**
     * The prompt is deliberately strict about the failure cases this is meant to
     * catch, because a general model will otherwise answer "yes, clothing is
     * present" for a garment shot. It names the exact things the customer listed:
     * garments alone, flat-lays, hangers, mannequins, product shots. Every
     * provider in the chain is asked this ONE prompt.
     */
    private const PROMPT = <<<'PROMPT'
You are the gate for a virtual try-on fitting room. A customer may ONLY use this
app if their uploaded photo shows an actual human being — a real person, of any
body type, any skin tone, any age, any pose (standing, seated, full-body, or a
close head-and-shoulders crop), any clothing, indoors or outdoors.

Answer strictly: does this photo contain a real human person?

Answer has_person = true ONLY when a human being is visibly present.

Answer has_person = false when the image shows:
- a garment or clothing item ALONE: on a hanger, on a mannequin or dress form,
  laid flat, folded, or photographed as a product
- any object, furniture, food, animal, landscape, room, or empty scene
- text, a logo, a sign, a screenshot, or an illustration
- anything where a PERSON (a face, a head, a body) is not actually visible

A garment that is body-shaped, or that has skin-toned, cream, white, gold, beige
or nude fabric, is STILL a garment and is NOT a person. A mannequin is NOT a
person. A photo of clothes with no wearer is NOT a person.

If you are unsure whether a real person is present, answer false.

Return ONLY valid JSON, no other text:
{"has_person": true|false, "confidence": 0.0-1.0, "reason": "<short phrase>"}
PROMPT;

    /**
     * A low-confidence "true" is still refused: the model is told to answer
     * false when unsure, and this is the belt to that suspenders.
     */
    private const MIN_CONFIDENCE = 0.5;

    /**
     * Ask the vision model(s) whether the photo contains a person.
     *
     * PROVIDER CHAIN
     * --------------
     * The endpoints are tried IN THE CONFIGURED ORDER (services.
     * person_verification.providers) and the first USABLE answer wins. Gemini
     * sits first; a fallback is reached ONLY when Gemini is unavailable — a
     * quota 429, an outage, a malformed reply — never when Gemini simply said
     * "no person". That keeps the verdict stable while removing the single
     * 20-requests-per-day wall: when one provider is exhausted the next answers.
     *
     * If EVERY provider fails the endpoint still fails CLOSED (verified:false,
     * has_person:false) and NOTHING is cached, so the next request really retries.
     */
    public function verify(Request $request)
    {
        $validated = $request->validate([
            'image' => ['required', 'string'],
        ]);

        $this->currentImage = $validated['image'];
        $this->lastFailure = [];

        /*
         * CACHE LOOKUP — BEFORE ANY PROVIDER CALL, so a cached verdict costs no
         * quota at all. The key is the SHA-256 of the exact bytes being
         * classified, so two different photos never share an entry.
         */
        $cacheKey = 'person-verify:' . hash('sha256', $validated['image']);
        $cached = Cache::get($cacheKey);
        if (is_array($cached) && array_key_exists('has_person', $cached)) {
            return response()->json($cached);
        }

        $providers = $this->configuredProviders();
        if ($providers === []) {
            // Nothing usable at all. Report the FIRST reason the builder recorded
            // (e.g. gemini's missing key) rather than a bare default, so the log
            // names the variable that actually needs setting.
            $firstReason = reset($this->lastFailure) ?: 'no-api-key';

            return $this->verdict(false, (string) $firstReason, 0.0);
        }

        /*
         * TRACK THE MOST INFORMATIVE FAILURE, NOT THE LAST ONE.
         *
         * `$lastReason = ...` on every iteration meant a chain of
         * gemini(quota) -> cloudflare(no key) reported `no-api-key`, HIDING the
         * fact that the real ceiling was a drained quota. Those two need opposite
         * fixes: a quota problem is solved by waiting or adding a provider, a
         * missing key by pasting one in. Ranking keeps the actionable reason.
         *
         * Most -> least useful to the person reading it:
         *   quota          the model answered, we are out of allowance
         *   upstream-error the provider is reachable but erroring
         *   unreachable    the network/TLS failed
         *   unparseable    the provider replied in a shape we could not read
         *   model-retired  a permanent, fixable-by-config condition
         *   no-api-key     never even attempted
         */
        $rank = ['quota' => 6, 'upstream-error' => 5, 'unreachable' => 4, 'unparseable' => 3, 'model-retired' => 2, 'no-api-key' => 1];
        $lastReason = 'unreachable';
        $bestRank = 0;
        $verdict = null;

        foreach ($providers as $name => $call) {
            $answer = $call();

            if ($answer !== null) {
                // A real, parsed verdict — this provider answered. Stop here.
                $verdict = $answer;
                break;
            }

            // $answer === null means "this provider could not answer" — keep the
            // MOST meaningful reason so far, then try the next provider.
            $reason = $this->lastFailure[$name] ?? 'unreachable';
            if (($rank[$reason] ?? 0) > $bestRank) {
                $bestRank = $rank[$reason] ?? 0;
                $lastReason = $reason;
            }

            Log::info("Person verification: provider '{$name}' unavailable, trying the next.", [
                'reason' => $reason,
            ]);
        }

        if ($verdict === null) {
            // Every provider failed — fail CLOSED and do NOT cache.
            return $this->verdict(false, $lastReason, 0.0);
        }

        /*
         * Remember ONLY a real verdict from a working model. Every failure path
         * above returns WITHOUT caching, so a transient outage (429, a 503) is
         * never frozen into a permanent refusal — the next request really retries
         * (and may reach a different provider).
         */
        Cache::put($cacheKey, $verdict, now()->addHours(self::CACHE_TTL_HOURS));

        return response()->json($verdict);
    }

    /**
     * Build the ordered map of provider-name => callable. A provider with no
     * credential is SKIPPED, so listing one in the order costs nothing until its
     * key is set. The callable returns a normalized verdict array, or null when
     * the provider could not answer (its reason lands in $this->lastFailure).
     *
     * @return array<string, callable>
     */
    private function configuredProviders(): array
    {
        $chain = [];
        $names = (array) config('services.person_verification.providers', ['gemini']);

        foreach ($names as $name) {
            $name = strtolower(trim((string) $name));

            /*
             * A provider with NO credential is SKIPPED — but it is RECORDED
             * first. Skipping silently was a real diagnostic hole: when every
             * provider failed, `lastFailure` held nothing for the unconfigured
             * ones, so an operator reading the log could not tell "we never even
             * tried Groq because its key is blank" apart from "Groq was tried
             * and timed out". Those need completely different fixes.
             */
            $configured = match ($name) {
                'gemini' => (bool) GeminiKeyPool::current(),
                'cloudflare' => (bool) (config('services.person_verification.cloudflare.account_id')
                    && config('services.person_verification.cloudflare.token')),
                'groq' => (bool) config('services.person_verification.groq.token'),
                'openai' => (bool) config('services.person_verification.openai.token'),
                default => false,
            };

            if (! $configured) {
                // Unknown NAME and missing KEY are both "not usable", but they are
                // different mistakes, so they get different reasons.
                $this->lastFailure[$name] = match ($name) {
                    'gemini', 'cloudflare', 'groq', 'openai' => 'no-api-key',
                    default => 'unknown-provider',
                };

                continue;
            }

            $chain[$name] = match ($name) {
                'gemini' => fn () => $this->askGemini((string) GeminiKeyPool::current()),
                'cloudflare' => fn () => $this->askCloudflare(),
                'groq' => fn () => $this->askOpenAiCompatible('groq'),
                'openai' => fn () => $this->askOpenAiCompatible('openai'),
            };
        }

        return $chain;
    }

    /**
     * Reusable HTTP client: same timeout/retry policy for every provider, so a
     * fallback behaves like Gemini on a flaky link. `throw: false` lets the
     * caller inspect a non-2xx instead of being interrupted by an exception.
     */
    private function http()
    {
        return Http::timeout(self::TIMEOUT_SECONDS)
            ->connectTimeout(10)
            ->retry(
                2,
                600,
                function ($exception) {
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
            ->acceptJson();
    }

    /**
     * GEMINI — the first provider. Image-in, text-out, same shape the catalog
     * auto-fill uses.
     *
     * @return array<string, mixed>|null
     */
    private function askGemini(string $apiKey): ?array
    {
        $image = $this->currentImage;

        /*
         * WALK THE MODEL CHAIN. Each model has its OWN 20/day free bucket, so a
         * 429 on the first does not have to refuse the customer — the next model
         * may still answer. A 404 (retired ID) also just moves on. The FIRST
         * model that returns a PARSEABLE verdict wins; every failure reason is
         * recorded so, if all models fail, the chain can report why.
         */
        $models = $this->geminiModels();

        foreach ($models as $model) {
            try {
                $response = $this->http()->post($this->endpoint($apiKey, $model), [
                    'contents' => [[
                        'parts' => [
                            ['text' => self::PROMPT],
                            /*
                             * `inlineData` / `mimeType` — the API's own JSON
                             * names. `inline_data` / `mime_type` are protobuf
                             * FIELD names, which strict v1beta rejects with
                             *   400 Invalid JSON payload received.
                             *       Unknown name "inline_data" ...
                             * i.e. the photo was never even read.
                             */
                            ['inlineData' => [
                                'mimeType' => $this->mimeType($image),
                                'data' => $this->base64Data($image),
                            ]],
                        ],
                    ]],
                    'generationConfig' => [
                        'temperature' => 0.0,
                        'responseMimeType' => 'application/json',
                    ],
                ]);
            } catch (\Illuminate\Http\Client\ConnectionException $exception) {
                $this->providerFailed('gemini', 'unreachable', [
                    'model' => $model,
                    'tls' => $this->looksLikeTlsFailure($exception->getMessage()),
                    'error' => $exception->getMessage(),
                ]);

                // A connection error is likely network-wide, but a later model
                // may still answer; keep walking rather than giving up here.
                continue;
            }

            if ($response->failed()) {
                /*
                 * 429 IS THE QUOTA WALL, NOT A BAD IMAGE. Report it distinctly so
                 * the chain (and the log) says "quota reached" rather than a
                 * generic upstream error — then TRY THE NEXT MODEL.
                 *
                 * THE OUTCOME IS ALSO REPORTED TO THE KEY POOL: a 429 puts THIS
                 * key on daily cooldown and the pool serves the NEXT call from
                 * the next key; a 401/403 sits the key out the same way (it is
                 * invalid, not merely drained). 404 stays out of this — it is a
                 * MODEL fault, not a KEY fault.
                 */
                $reason = match (true) {
                    $response->status() === 429 => 'quota',
                    $response->status() === 404 => 'model-retired',
                    default => 'upstream-error',
                };

                if ($response->status() === 429) {
                    GeminiKeyPool::markRateLimited($apiKey);
                } elseif (in_array($response->status(), [401, 403], true)) {
                    GeminiKeyPool::markInvalid($apiKey);
                }

                $this->providerFailed('gemini', $reason, [
                    'model' => $model,
                    'status' => $response->status(),
                    'body' => substr($response->body(), 0, 300),
                ]);

                continue;
            }

            /*
             * Collect the text parts of the first candidate — the same shape the
             * catalog analysis reads, and the model may split its answer across
             * parts.
             */
            $parts = data_get($response->json(), 'candidates.0.content.parts', []);
            $text = '';
            foreach ((array) $parts as $part) {
                if (isset($part['text'])) {
                    $text .= $part['text'];
                }
            }

            $verdict = $this->parseVerdict($text, 'gemini');
            if ($verdict !== null) {
                return $verdict;
            }

            // Unparseable from THIS model — try the next one.
        }

        // Every Gemini model failed; the caller may fall through to another provider.
        return null;
    }

    /**
     * The ordered, de-duplicated Gemini model list: the explicitly chosen
     * `model` FIRST, then the configured fallbacks. Read straight from config so
     * a .env edit (plus `config:cache`) is all it takes to change the order.
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
     * CLOUDFLARE WORKERS AI — the free fallback. A vision instruct model that
     * accepts an image ARRAY of raw bytes and returns `{result: {response}}`.
     *
     * @return array<string, mixed>|null
     */
    private function askCloudflare(): ?array
    {
        $accountId = (string) config('services.person_verification.cloudflare.account_id');
        $token = (string) config('services.person_verification.cloudflare.token');
        $model = (string) config('services.person_verification.cloudflare.model');
        $image = $this->currentImage;

        // Workers AI wants the raw bytes as an int array, not a base64 string.
        $bytes = base64_decode($this->base64Data($image), true);
        if ($bytes === false) {
            return $this->providerFailed('cloudflare', 'unparseable', ['error' => 'image base64 could not be decoded']);
        }

        $url = "https://api.cloudflare.com/client/v4/accounts/{$accountId}/ai/run/{$model}";

        try {
            $response = $this->http()
                ->withToken($token)
                ->post($url, [
                    // Cloudflare's vision payload: the prompt text and the image
                    // bytes, both in `messages[0].content`.
                    'messages' => [[
                        'role' => 'user',
                        'content' => [
                            ['type' => 'text', 'text' => self::PROMPT],
                            ['type' => 'image', 'image' => array_values(unpack('C*', $bytes))],
                        ],
                    ]],
                    'temperature' => 0.0,
                    'max_tokens' => 200,
                ]);
        } catch (\Illuminate\Http\Client\ConnectionException $exception) {
            return $this->providerFailed('cloudflare', 'unreachable', [
                'model' => $model,
                'error' => $exception->getMessage(),
            ]);
        }

        if ($response->failed()) {
            return $this->providerFailed('cloudflare', $response->status() === 429 ? 'quota' : 'upstream-error', [
                'status' => $response->status(),
                'body' => substr($response->body(), 0, 400),
            ]);
        }

        // `{result: {response: "..."}}`; a couple of CF models nest under
        // `result.response` and others under `result.answer`.
        $text = (string) data_get($response->json(), 'result.response', '');
        if ($text === '') {
            $text = (string) data_get($response->json(), 'result.answer', '');
        }

        return $this->parseVerdict($text, 'cloudflare');
    }

    /**
     * GROQ / OPENAI — an OpenAI-compatible chat completion with the image as a
     * data URI. One method serves both because the request/response shape is
     * identical and only the endpoint, key and model differ by config.
     *
     * @return array<string, mixed>|null
     */
    private function askOpenAiCompatible(string $provider): ?array
    {
        $conf = (array) config("services.person_verification.{$provider}", []);
        $token = (string) ($conf['token'] ?? '');
        $model = (string) ($conf['model'] ?? '');
        $image = $this->currentImage;

        $url = $provider === 'groq'
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';

        try {
            $response = $this->http()
                ->withToken($token)
                ->post($url, [
                    'model' => $model,
                    'temperature' => 0.0,
                    'max_tokens' => 200,
                    'response_format' => ['type' => 'json_object'],
                    'messages' => [[
                        'role' => 'user',
                        'content' => [
                            ['type' => 'text', 'text' => self::PROMPT],
                            ['type' => 'image_url', 'image_url' => ['url' => $image]],
                        ],
                    ]],
                ]);
        } catch (\Illuminate\Http\Client\ConnectionException $exception) {
            return $this->providerFailed($provider, 'unreachable', [
                'model' => $model,
                'error' => $exception->getMessage(),
            ]);
        }

        if ($response->failed()) {
            return $this->providerFailed($provider, $response->status() === 429 ? 'quota' : 'upstream-error', [
                'status' => $response->status(),
                'body' => substr($response->body(), 0, 400),
            ]);
        }

        $text = (string) data_get($response->json(), 'choices.0.message.content', '');

        return $this->parseVerdict($text, $provider);
    }

    /**
     * Turn a provider's text answer into the normalized verdict, or null when it
     * cannot be parsed (which makes the chain try the next provider).
     *
     * @return array<string, mixed>|null
     */
    private function parseVerdict(string $text, string $provider): ?array
    {
        $decoded = json_decode(
            trim((string) preg_replace('/^```(?:json)?|```$/m', '', $text)),
            true
        );

        if (! is_array($decoded) || ! array_key_exists('has_person', $decoded)) {
            return $this->providerFailed($provider, 'unparseable', [
                'text' => substr($text, 0, 300),
            ]);
        }

        $hasPerson = filter_var($decoded['has_person'], FILTER_VALIDATE_BOOLEAN);
        $confidence = is_numeric($decoded['confidence'] ?? null)
            ? (float) $decoded['confidence']
            : 0.0;

        $accepted = $hasPerson && $confidence >= self::MIN_CONFIDENCE;

        return [
            'verified' => true,
            'has_person' => $accepted,
            'confidence' => $confidence,
            /*
             * TWO DIFFERENT FIELDS, DELIBERATELY.
             *
             * `reason` is a CANONICAL control-flow token — always `person` or
             * `no-person` — because `verdict()` decides `verified` from it. The
             * model's own free-text explanation ("real human person wearing a
             * t-shirt and jeans") CANNOT be the control token: it would fail an
             * allow-list check and turn a successful answer into `verified:false`,
             * i.e. a correct photo refused as "could not be verified".
             *
             * That wording is still worth keeping for the log and for the
             * frontend's diagnostics, so it travels separately in `detail`.
             */
            'reason' => $accepted ? 'person' : 'no-person',
            'detail' => is_string($decoded['reason'] ?? null)
                ? $decoded['reason']
                : ($accepted ? 'person' : 'no-person'),
        ];
    }

    /**
     * Record WHY a provider could not answer and return null so the chain moves
     * on. `$reason` is one of the fail-closed reasons (quota, unreachable,
     * upstream-error, unparseable) so that, if EVERY provider fails, the caller
     * can still report a meaningful reason.
     */
    private function providerFailed(string $provider, string $reason, array $context = []): ?array
    {
        $this->lastFailure[$provider] = $reason;

        Log::warning("Person verification provider '{$provider}' failed ({$reason})", $context);

        return null;
    }

    /**
     * The single response shape. `verified` says the CALL succeeded (as opposed to
     * the answer being "no person"), so the frontend can tell "the model says no
     * person" apart from "we could not ask" if it ever wants to phrase them
     * differently — while both are refused.
     *
     * `quota` is in the failure list too: a 429 from EVERY provider means the
     * question was never actually answered, so `verified` must be false — the
     * frontend then treats it as "could not verify", NOT as "no person", and
     * (crucially) refuses to cache it.
     *
     * WRITTEN AS AN ALLOW-LIST, NOT A DENY-LIST.
     * ------------------------------------------
     * This used to be `! in_array($reason, [five reasons], true)` — a BLOCKLIST.
     * Anything missing from that list was silently treated as "the model
     * answered", so `model-retired` (a 404 on a retired model ID, which this
     * deployment hit for real) returned `verified: true`. The frontend then saw
     * `hasPerson:false, verified:true` and told the customer "No person could be
     * found in this photo" — a confusing lie, because no model ever looked.
     *
     * The ONLY reason that means "a provider actually answered" is `person` or
     * `no-person`. Every failure vocabulary word is therefore listed explicitly,
     * and anything unrecognised falls through to `verified: false` — the safe
     * direction. A new provider added later is fail-closed by default instead of
     * fail-open by omission.
     */
    private const ANSWERED_REASONS = [
        'person',
        'no-person',
    ];

    private function verdict(bool $hasPerson, string $reason, float $confidence)
    {
        return response()->json([
            // Fail-CLOSED: only a genuine verdict from a model counts as verified.
            'verified' => in_array($reason, self::ANSWERED_REASONS, true),
            'has_person' => $hasPerson,
            'confidence' => $confidence,
            'reason' => $reason,
        ]);
    }

    private function looksLikeTlsFailure(string $error): bool
    {
        return str_contains($error, 'error 60')
            || str_contains($error, 'SSL certificate')
            || str_contains($error, 'certificate verify');
    }

    private function endpoint(string $apiKey, string $model): string
    {
        return 'https://generativelanguage.googleapis.com/v1beta/models/'
            . $model
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
