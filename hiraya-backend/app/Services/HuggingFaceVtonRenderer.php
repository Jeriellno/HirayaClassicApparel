<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Support\LocalAsset;

/**
 * HuggingFaceVtonRenderer — a VTON renderer that drives the yisol/IDM-VTON
 * Hugging Face Space over its Gradio HTTP API.
 *
 * WHY THIS CLASS EXISTS
 * ---------------------
 * PixelAPI (VtonApiRenderer) charges credits per render. The IDM-VTON Space is
 * a FREE path for a purpose-built try-on diffusion model, so it is tried FIRST
 * and PixelAPI is kept as the paid fallback (see ProcessTryOnJob::callVtonApi).
 *
 * This is a REAL Gradio driver, not the retired `api-inference.huggingface.co`
 * route: the Space exposes three plain HTTP endpoints that a server-side client
 * can drive without a browser session:
 *
 *   1. POST {base}{prefix}/upload   (multipart "files")  -> one entry per file
 *   2. POST {base}{prefix}/call/tryon                    -> {"event_id": "..."}
 *   3. GET  {base}{prefix}/call/tryon/{event_id}         -> SSE stream
 *      ending in "event: complete" / "event: error"
 *
 * THE ROUTE PREFIX IS GRADIO-VERSION-DEPENDENT, and the Space this deployment
 * targets (yisol/IDM-VTON) is MEASURED to run Gradio 4.24.0, where the app is
 * mounted at the root (`/upload`, `/call/tryon`). Gradio >= 4.44 moved the
 * routes under `/gradio_api/`, so the prefix is configurable
 * (HUGGINGFACE_VTON_API_PREFIX) rather than hard-coded:
 *
 *   Gradio 4.0 - 4.43 : prefix = ""        -> /upload, /call/tryon
 *   Gradio 4.44+ / 5.x: prefix = /gradio_api -> /gradio_api/upload, /gradio_api/call/tryon
 *
 * THE UPLOAD RESPONSE SHAPE IS ALSO GRADIO-VERSION-DEPENDENT (measured on
 * 4.24.0): 4.x returns a PLAIN ARRAY OF PATH STRINGS
 *     ["/tmp/gradio/<hash>/garment.jpg"]
 * while 5.x returns FileData dicts. Both are handled in parseUploadedPaths().
 *
 * The /tryon fn signature on the Space is
 *     start_tryon(human_img, garm_img, garment_des, is_checked, is_checked_crop,
 *                 denoise_steps, seed)  ->  [result, mask]
 * so the submit payload is exactly SEVEN entries and the FIRST output is the
 * rendered image. Output entries are Gradio FileData dicts ({path, url, ...});
 * the `url` field is a hosted download link.
 *
 * LICENSING CAVEAT (IMPORTANT — DO NOT REMOVE)
 * --------------------------------------------
 * IDM-VTON's weights are distributed under CC BY-NC-SA 4.0: NON-COMMERCIAL.
 * Rendering through this Space is fine for development/demos/academic work, but
 * a commercial storefront CANNOT legally ship renders produced by it. Hugging
 * Face being free of charge does not change the licence. The commercial path
 * remains VtonApiRenderer (PixelAPI) — this class is a free-tier EXPERIMENT tier
 * sitting in front of it, nothing more.
 *
 * PAYLOAD / SIZE CONTRACT
 * -----------------------
 * Same contract as VtonApiRenderer::render(): ONE garment per call (the most
 * significant layer), data URI in / base64 data URI out, so the caller can treat
 * both providers identically and fall through between them on any failure.
 */
class HuggingFaceVtonRenderer
{
    /** SSE stream: the render itself takes 20-60s; leave a generous window. */
    private const TIMEOUT_SECONDS = 240;

    /**
     * Ceiling for ONE garment image (raw base64 length) before upload.
     * Mirrors VtonApiRenderer::MAX_GARMENT_BYTES — see the note there.
     */
    private const MAX_GARMENT_BYTES = 3_000_000;

    private const MAX_PERSON_BYTES = 3_500_000;

    /**
     * Most significant layer first — same ranking as VtonApiRenderer::PRIORITY,
     * kept in lockstep so both providers agree on which garment to render.
     */
    private const PRIORITY = ['dress', 'outerwear', 'top', 'bottom', 'inner', 'footwear'];

    /**
     * Garment family hints — a minimal copy of VtonApiRenderer::FAMILIES for the
     * categories the Studio actually sends. Kept deliberately small: this driver
     * does not need the full vocabulary, only the ranking.
     */
    private const FAMILIES = [
        'dress' => ['dress', 'gown'],
        'outerwear' => ['jacket', 'coat', 'blazer', 'outerwear', 'cardigan', 'hoodie', 'parka'],
        'top' => ['shirt', 'blouse', 'top', 'tee', 't-shirt', 'polo', 'tank', 'camisole', 'crop', 'inner', 'undershirt'],
        'bottom' => ['pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack'],
        'footwear' => ['shoe', 'footwear', 'sneaker', 'boot', 'sandal', 'loafer', 'heel', 'slipper'],
    ];

    /**
     * Render a try-on image through the HF Space, mirroring VtonApiRenderer's
     * contract exactly so ProcessTryOnJob can call both interchangeably.
     *
     * @param  string  $userPhoto   Data URI or raw base64 of the customer portrait.
     * @param  array<int, string>  $garments  Data URIs, INDEX-ALIGNED with $categories.
     * @param  array<string, mixed>  $measurements  Unused here (kept for parity).
     * @param  string|null  $recommendedSize  Unused here (kept for parity).
     * @param  array|null  $renderPlan  Unused here (kept for parity).
     * @param  array<int, string|null>  $categories  Style Stack category per garment.
     * @return array{success: bool, image_base64?: string, feedback?: string, error?: string, code?: string, placed?: array<int, string>}
     */
    public function render(
        string $userPhoto,
        array $garments,
        array $measurements = [],
        ?string $recommendedSize = null,
        ?array $renderPlan = null,
        array $categories = []
    ): array {
        $base = $this->baseUrl();

        if ($base === '') {
            return [
                'success' => false,
                'error' => 'No Hugging Face VTON Space is configured. Set HUGGINGFACE_VTON_SPACE (or HUGGINGFACE_VTON_BASE) to enable this tier.',
                'code' => 'not_configured',
            ];
        }

        $personPart = $this->toDataUri($userPhoto);
        if ($personPart === null) {
            return [
                'success' => false,
                'error' => 'The customer portrait is not a usable image.',
                'code' => 'bad_portrait',
            ];
        }

        [$garmentPart, $category] = $this->selectPrimaryGarment($garments, $categories);
        if ($garmentPart === null) {
            return [
                'success' => false,
                'error' => 'No usable garment image was provided.',
                'code' => 'bad_garment',
            ];
        }

        // Byte guards, mirroring the VtonApiRenderer backstops (oversized
        // portraits made the provider reset mid-upload there).
        if (strlen($personPart) > self::MAX_PERSON_BYTES) {
            return [
                'success' => false,
                'error' => 'Your body photo is too large to upload. Please use a smaller photo — a portrait under about 2 MB renders correctly.',
                'code' => 'portrait_too_large',
            ];
        }
        if (strlen($garmentPart) > self::MAX_GARMENT_BYTES) {
            return [
                'success' => false,
                'error' => 'The garment image is too large to upload.',
                'code' => 'garment_too_large',
            ];
        }

        $token = trim((string) config('services.huggingface.token', ''));

        /*
         * STEP 1 — UPLOAD the two images to the Space.
         *
         * The /upload endpoint takes multipart files under the `files` field and
         * returns a JSON array of {path, url, ...} dicts, one per file. The
         * returned `path` is what the /call/tryon payload must carry inside a
         * FileData dict.
         */
        try {
            $uploadRes = $this->request($token)
                ->attach('files', $this->dataUriBytes($personPart), 'person.jpg')
                ->attach('files', $this->dataUriBytes($garmentPart), 'garment.jpg')
                ->post($base . '/upload');
        } catch (\Throwable $e) {
            return $this->unreachable($e, 'upload');
        }

        if ($uploadRes->failed()) {
            return $this->httpFailure('upload', $uploadRes->status(), $uploadRes->body());
        }

        [$personPath, $garmentPath] = $this->parseUploadedPaths($uploadRes->json());

        if ($personPath === null || $garmentPath === null) {
            Log::warning('HF VTON: upload returned an unexpected shape', ['body' => $uploadRes->json()]);

            return [
                'success' => false,
                'error' => 'The try-on service did not accept the uploaded images.',
                'code' => 'renderer_no_image',
            ];
        }

        /*
         * STEP 2 — SUBMIT the try-on job.
         *
         * The payload shape IS the /tryon fn signature, in order — and the FIRST
         * entry is NOT a plain image: on the live Space (app.py on
         * yisol/IDM-VTON) the fn is
         *
         *     start_tryon(dict, garm_img, garment_des, is_checked,
         *                 is_checked_crop, denoise_steps, seed)
         *
         * where `dict` comes from a gr.ImageEditor component and is read as
         * `dict["background"]` (the person photo) and, when auto-masking is OFF,
         * `dict["layers"][0]` (a hand-drawn mask). Its API value is therefore the
         * ImageEditorValue dict below — NOT a bare FileData.
         *
         * MEASURED: submitting a bare FileData for entry 0 makes the fn crash on
         * `dict["background"]` and the SSE stream answers `event: error` with
         * `data: null` — an opaque null that cost several debug rounds to trace
         * back to the payload shape. The shape below is the one that RENDERS
         * (measured end-to-end against the live Space).
         *
         * With auto-mask ON (our default, is_checked=true) the layers array can
         * stay empty — the Space computes the mask itself from OpenPose+parsing.
         */
        $payload = [
            'data' => [
                [
                    'background' => ['path' => $personPath, 'meta' => ['_type' => 'gradio.FileData']],
                    'layers' => [],
                    'composite' => null,
                ],
                ['path' => $garmentPath, 'meta' => ['_type' => 'gradio.FileData']],
                (string) config('services.huggingface.vton_prompt', 'a photo of a person wearing the garment'),
                (bool) config('services.huggingface.vton_auto_mask', true),
                (bool) config('services.huggingface.vton_auto_crop', false),
                $this->optionalPositiveInt(config('services.huggingface.vton_denoise_steps'), 30),
                $this->optionalInt(config('services.huggingface.vton_seed'), -1),
            ],
        ];

        try {
            $submitRes = $this->request($token)
                ->withHeaders(['Content-Type' => 'application/json'])
                ->post($this->apiUrl($base, '/call/tryon'), $payload);
        } catch (\Throwable $e) {
            return $this->unreachable($e, 'submit');
        }

        if ($submitRes->failed()) {
            return $this->httpFailure('submit', $submitRes->status(), $submitRes->body());
        }

        $eventId = data_get($submitRes->json(), 'event_id');
        if (!is_string($eventId) || $eventId === '') {
            Log::warning('HF VTON: submit returned no event id', ['body' => $submitRes->json()]);

            return [
                'success' => false,
                'error' => 'The try-on service did not start the render.',
                'code' => 'renderer_no_image',
            ];
        }

        /*
         * STEP 3 — STREAM the SSE result for that event id.
         *
         * The connection stays open until the Space pushes `event: complete`
         * (payload = the fn's return value: an array of FileData dicts) or
         * `event: error`. One blocking GET is enough — we parse the WHOLE body
         * afterwards, so no incremental SSE reader is needed.
         */
        try {
            $streamRes = $this->request($token)
                ->timeout(self::TIMEOUT_SECONDS)
                ->get($this->apiUrl($base, '/call/tryon/' . rawurlencode($eventId)));
        } catch (\Throwable $e) {
            return $this->unreachable($e, 'stream');
        }

        if ($streamRes->failed()) {
            return $this->httpFailure('stream', $streamRes->status(), $streamRes->body());
        }

        return $this->parseSseResult($streamRes->body(), $category, count($garments));
    }

    /**
     * Resolve the Space's base URL from config.
     *
     * An explicit HUGGINGFACE_VTON_BASE wins (pinned for private Spaces or
     * mirrors); otherwise it is derived from the Space id the standard way:
     * yisol/IDM-VTON -> https://yisol-idm-vton.hf.space
     */
    private function baseUrl(): string
    {
        $explicit = trim((string) config('services.huggingface.vton_base', ''));
        if ($explicit !== '') {
            return rtrim($explicit, '/');
        }

        $space = trim((string) config('services.huggingface.vton_space', ''));
        if ($space === '') {
            return '';
        }

        $slug = strtolower(str_replace(['.', '/'], ['-', '-'], $space));

        return 'https://' . $slug . '.hf.space';
    }

    /**
     * Build one of the version-dependent API urls.
     *
     * The prefix is empty for the Gradio 4.x mount this Space uses and
     * `/gradio_api` for Gradio 4.44+ / 5.x (see the class note).
     */
    private function apiUrl(string $base, string $path): string
    {
        $prefix = trim((string) config('services.huggingface.vton_api_prefix', ''));

        /*
         * An EMPTY prefix must contribute NOTHING — concatenating '/' + '' +
         * '/call/tryon' produced '//call/tryon', which the Space answered with
         * a misleading 404 (MEASURED). Join the non-empty segments explicitly.
         */
        $segments = array_filter([rtrim($base, '/'), trim($prefix, '/')], fn ($s) => $s !== '');

        return implode('/', $segments) . $path;
    }

    /**
     * Read the two upload paths out of the /upload response, tolerating BOTH
     * gradio generations:
     *
     *   4.x  : ["/tmp/gradio/<hash>/person.jpg", ...]          (plain strings)
     *   5.x  : [{"path": "/tmp/gradio/...", "url": ...}, ...]  (FileData dicts)
     *
     * @return array{0: ?string, 1: ?string} [personPath, garmentPath]
     */
    private function parseUploadedPaths(mixed $uploads): array
    {
        if (!is_array($uploads) || count($uploads) < 2) {
            return [null, null];
        }

        $read = function ($entry): ?string {
            if (is_string($entry) && $entry !== '') {
                return $entry;
            }

            if (is_array($entry)) {
                $path = data_get($entry, 'path');

                return is_string($path) && $path !== '' ? $path : null;
            }

            return null;
        };

        return [$read($uploads[0]), $read($uploads[1])];
    }

    /**
     * A pre-configured HTTP client (auth + sane timeouts + JSON accept).
     */
    private function request(?string $token): \Illuminate\Http\Client\PendingRequest
    {
        $client = Http::acceptJson()->connectTimeout(30);

        if ($token !== '') {
            $client = $client->withToken($token);
        }

        return $client;
    }

    /**
     * Extract raw image bytes out of a data URI (or bare base64).
     */
    private function dataUriBytes(string $dataUri): string
    {
        return base64_decode(preg_replace('#^data:image/\w+;base64,#', '', $dataUri)) ?: '';
    }

    /**
     * Parse the SSE body: the FIRST output entry of the `complete` event is the
     * render. Every other terminal (`error`, malformed stream) is a failure.
     *
     * @return array{success: bool, image_base64?: string, feedback?: string, error?: string, code?: string, placed?: array<int, string>}
     */
    private function parseSseResult(string $body, string $category, int $garmentCount): array
    {
        $events = $this->splitSse($body);

        foreach ($events as $event) {
            $name = $event['name'];
            $data = $event['data'];

            if ($name === 'complete') {
                $decoded = json_decode($data, true);
                $output = data_get($decoded, '0');

                // Older gradio clients emit a bare array instead of FileData.
                $url = is_array($output)
                    ? (data_get($output, 'url') ?: data_get($output, 'path'))
                    : (is_string($output) ? $output : null);

                if (is_string($url) && $url !== '') {
                    $image = $this->downloadResult($url);
                    if ($image !== null) {
                        return [
                            'success' => true,
                            'image_base64' => $image,
                            'feedback' => 'Rendered via Hugging Face IDM-VTON (free tier) — ' . $garmentCount . ' garment(s) requested, rendered the ' . ($category ?: 'primary') . ' layer.',
                            'placed' => [$category],
                        ];
                    }
                }

                return [
                    'success' => false,
                    'error' => 'The try-on service completed the render but returned no image.',
                    'code' => 'renderer_no_image',
                ];
            }

            if ($name === 'error') {
                /*
                 * QUOTE THE SPACE'S OWN ERROR WHEN IT SENDS ONE, AND CLASSIFY A
                 * NULL ONE HONESTLY WHEN IT DOES NOT.
                 *
                 * Gradio's error event carries the exception message when the fn
                 * CRASHES inside the Space. IDM-VTON is a heavy SDXL inpaint
                 * pipeline on ZeroGPU, which enforces a DAILY GPU-second quota
                 * (measured: ~2 min anonymous, ~5 min for a free account — see
                 * https://huggingface.co/docs/hub/spaces-zerogpu).
                 *
                 * MEASURED ON THIS DEPLOYMENT: the IDENTICAL payload that
                 * completed successfully (event: complete, two output FileData
                 * entries) also fails with `event: error / data: null` in runs a
                 * second later. A crash repeats identically at the same speed for
                 * every call; the observed pattern — success, then fast null
                 * errors, then success again later — is quota exhaustion, not a
                 * payload fault.
                 *
                 * A null error is therefore reported as a RETRYABLE
                 * `renderer_busy` (the quota resets), which also lets
                 * ProcessTryOnJob fall through to PixelAPI for THIS render instead
                 * of failing the session. A NAMED error (a real exception message)
                 * stays non-retryable `renderer_no_image` — retrying a crash that
                 * names its cause costs minutes and returns the same answer.
                 */
                $detail = trim($data);
                $isOpaque = $detail === '' || strtolower($detail) === 'null';

                Log::warning('HF VTON render error event', [
                    'detail' => $detail === '' ? '(empty)' : $detail,
                    'opaque' => $isOpaque,
                ]);

                if ($isOpaque) {
                    return [
                        'success' => false,
                        'error' => 'The Hugging Face try-on service refused the render without a reason (its free ZeroGPU quota is likely spent — it resets daily).',
                        'code' => 'renderer_busy',
                    ];
                }

                return [
                    'success' => false,
                    'error' => 'The try-on service reported an error during the render: ' . $detail,
                    'code' => 'renderer_no_image',
                ];
            }
        }

        return [
            'success' => false,
            'error' => 'The try-on service closed the stream before completing the render.',
            'code' => 'renderer_unreachable',
        ];
    }

    /**
     * Split an SSE body into {name, data} events.
     *
     * Gradio emits `event: <name>\ndata: <json>` blocks; the render result is
     * one long data line, so we split on the event markers rather than line
     * counting.
     *
     * @return array<int, array{name: string, data: string}>
     */
    private function splitSse(string $body): array
    {
        $events = [];
        $current = ['name' => 'message', 'data' => ''];

        foreach (preg_split('/\r?\n/', $body) as $line) {
            if (str_starts_with($line, 'event:')) {
                if ($current['name'] !== 'message' || $current['data'] !== '') {
                    $events[] = $current;
                }
                $current = ['name' => trim(substr($line, 6)), 'data' => ''];

                continue;
            }

            if (str_starts_with($line, 'data:')) {
                $current['data'] .= trim(substr($line, 5));

                continue;
            }

            if (trim($line) === '' && $current['data'] !== '') {
                $events[] = $current;
                $current = ['name' => 'message', 'data' => ''];
            }
        }

        if ($current['data'] !== '') {
            $events[] = $current;
        }

        return $events;
    }

    /**
     * Download the rendered image from the Space and return it as a data URI.
     * The `url` field is hosted on the Space's own domain; the `path` variant
     * must go through /gradio_api/file={path}.
     */
    private function downloadResult(string $reference): ?string
    {
        $url = $reference;

        if (!str_contains($url, '://')) {
            // A bare path needs the version-dependent file route: /gradio_api/file=
            // on 4.44+/5.x, /file= on 4.x.
            $url = rtrim($this->baseUrl(), '/') . trim((string) config('services.huggingface.vton_api_prefix', '')) . '/file=' . $url;
        }

        try {
            $res = Http::timeout(60)->get($url);
            if ($res->successful() && strlen($res->body()) > 0) {
                $mime = $res->header('Content-Type') ?: 'image/png';
                $mime = str_contains($mime, 'jpeg') || str_contains($mime, 'jpg') ? 'image/jpeg' : 'image/png';

                return 'data:' . $mime . ';base64,' . base64_encode($res->body());
            }
        } catch (\Throwable $e) {
            Log::warning('HF VTON result download failed: ' . $e->getMessage());
        }

        return null;
    }

    /**
     * Pick the single most significant garment to render — same priority order
     * as VtonApiRenderer::selectPrimaryGarment, condensed for this driver.
     *
     * @param  array<int, string>  $garments
     * @param  array<int, string|null>  $categories
     * @return array{0: string|null, 1: string}
     */
    private function selectPrimaryGarment(array $garments, array $categories): array
    {
        $best = null;
        $bestRank = PHP_INT_MAX;

        foreach ($garments as $index => $garment) {
            if (!is_string($garment) || trim($garment) === '') {
                continue;
            }

            $dataUri = $this->toDataUri($garment);
            if ($dataUri === null) {
                continue;
            }

            if (strlen($dataUri) > self::MAX_GARMENT_BYTES) {
                Log::warning('HF VTON garment too large to upload; skipping it', [
                    'index' => $index,
                    'bytes' => strlen($dataUri),
                ]);

                continue;
            }

            $layer = $this->resolveFamily(strtolower((string) ($categories[$index] ?? ''))) ?? '';
            $rank = array_search($layer, self::PRIORITY, true);
            $rank = $rank === false ? count(self::PRIORITY) : $rank;

            if ($rank < $bestRank) {
                $bestRank = $rank;
                $best = ['image' => $dataUri, 'category' => strtolower((string) ($categories[$index] ?? ''))];
            }
        }

        if ($best === null) {
            return [null, ''];
        }

        return [$best['image'], $best['category']];
    }

    /**
     * Resolve a garment category to its layer family (a condensed copy of
     * VtonApiRenderer::resolveFamily).
     */
    private function resolveFamily(string $needle): ?string
    {
        foreach (self::PRIORITY as $layer) {
            foreach (self::FAMILIES[$layer] ?? [] as $hint) {
                if (str_contains($needle, $hint)) {
                    return $layer;
                }
            }
        }

        return null;
    }

    /**
     * Normalise any image reference to a data URI (delegates to LocalAsset for
     * the disk/remote/base64 resolution rules).
     */
    private function toDataUri(string $image): ?string
    {
        return LocalAsset::toDataUri($image);
    }

    private function optionalPositiveInt(mixed $value, int $default): int
    {
        if ($value === null || $value === '' || $value === false) {
            return $default;
        }

        $int = (int) $value;

        return $int > 0 ? $int : $default;
    }

    private function optionalInt(mixed $value, int $default): int
    {
        if ($value === null || $value === '' || $value === false) {
            return $default;
        }

        return (int) $value;
    }

    /**
     * A transport failure — RETRYABLE per the job's vocabulary.
     */
    private function unreachable(\Throwable $e, string $stage): array
    {
        Log::warning('HF VTON unreachable at ' . $stage . ': ' . $e->getMessage());

        return [
            'success' => false,
            'error' => 'Could not reach the Hugging Face try-on service.',
            'code' => 'renderer_unreachable',
        ];
    }

    /**
     * An HTTP failure on one of the three Space endpoints.
     */
    private function httpFailure(string $stage, int $status, string $body): array
    {
        Log::warning('HF VTON ' . $stage . ' failed', ['status' => $status, 'body' => substr($body, 0, 500)]);

        $code = match (true) {
            $status === 401 || $status === 403 => 'renderer_unauthorized',
            $status === 429 => 'renderer_busy',          // ZeroGPU quota — clears with time
            $status === 503 => 'renderer_busy',          // Space waking up / cold start
            $status >= 500 => 'renderer_busy',
            default => 'renderer_no_image',
        };

        return [
            'success' => false,
            'error' => 'The Hugging Face try-on service returned HTTP ' . $status . ' during ' . $stage . '.',
            'code' => $code,
        ];
    }
}
