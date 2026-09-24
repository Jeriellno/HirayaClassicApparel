<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ProviderHealthEvent;
use App\Support\ProviderHealth;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Super-admin EXTERNAL AI / API CREDENTIAL STATUS.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The platform depends on several third-party keys (PixelAPI for the try-on
 * render, Gemini for catalog vision, Supabase for asset storage). Until now the
 * ONLY way to learn a key was missing, expired, or out of daily quota was to have
 * a customer press "Generate Virtual Fitting" and read the failure off the canvas.
 * This endpoint makes that state observable from the console instead.
 *
 * WHAT THIS DELIBERATELY DOES **NOT** DO
 * --------------------------------------
 * It does NOT read, write, or alter how any of those keys is USED. Every value it
 * reports comes from `config()` — the same source the renderers read — so the
 * console and the renderers can never disagree about which key is in play. There
 * is no new credential store, no DB table, and no change to any renderer: the
 * config remains the single source of truth.
 *
 * WHY THE KEY IS NEVER RETURNED
 * -----------------------------
 * This response describes credentials, so it is treated as sensitive even though
 * the route sits behind `auth:sanctum` + `superadmin`. The raw secret is NEVER
 * sent: only `present` (configured or not) and a MASKED tail, which is enough for
 * an operator to confirm "this is the key I just pasted" without the value being
 * replayable if the response leaks through a log, a screenshot, or a browser
 * extension. The Supabase service-role key bypasses RLS, so it is especially
 * important that it is never echoed.
 *
 * ROTATING A KEY IS STILL AN .env EDIT — ON PURPOSE
 * -------------------------------------------------
 * `instructions` below tells the operator exactly which variable to change and
 * how to make it take effect. Editing a live `.env` from a web form was rejected:
 * it would require a writable filesystem in production (a security hole of its
 * own), and a half-written `.env` takes the WHOLE app down, not just the key
 * being rotated. The screen's job is to tell you precisely what to do; it is not
 * to become a remote shell.
 */
class ApiStatusController extends Controller
{
    /**
     * Every external credential the platform can depend on.
     *
     * Each entry declares WHERE the value lives (`config_path`), HOW to reach the
     * vendor for a liveness probe (`probe`), and WHAT an operator must edit to
     * rotate it (`env` / `instructions`).
     *
     * @return array<string, array<string, mixed>>
     */
    private function registry(): array
    {
        return [
            'pixelapi' => [
                'label' => 'PixelAPI — Virtual Try-On',
                'purpose' => 'Renders the AI fitting (the garment worn on the body).',
                'required' => true,
                'env' => 'VTON_API_TOKEN',
                'config_path' => 'services.vton.token',
                'endpoint_path' => 'services.vton.endpoint',
                /*
                 * A LIVE probe. The try-on endpoint is asked to render a
                 * deliberately invalid payload: the AUTH layer runs BEFORE
                 * validation, so the status code itself tells us what we need —
                 *
                 *   401/403 -> the token is refused
                 *   422     -> auth PASSED (the request reached validation)
                 *   503     -> the provider itself is degraded (e.g. its
                 *              clothing-safety service is down)
                 *   2xx     -> shouldn't happen for an invalid payload, but accepted
                 *
                 * This is the difference between "the key is set" and "the key
                 * WORKS", which is the whole point of the screen.
                 */
                'probe' => [
                    'method' => 'POST',
                    'url_path' => 'services.vton.endpoint',
                    'kind' => 'json',
                    'body' => [
                        'person_image' => 'probe',
                        'garment_image' => 'probe',
                        'category' => '__status_probe__',
                    ],
                ],
                'instructions' => [
                    'Open hiraya-backend/.env',
                    'Set VTON_API_TOKEN to the new PixelAPI key (https://pixelapi.dev dashboard).',
                    'Run: php artisan config:clear',
                    'Restart the try-on worker: php artisan tryon:ensure-worker',
                ],
                'notes' => 'PixelAPI runs ONE render at a time and the key has a '
                    . 'daily cap. When the cap is hit the renderer reports '
                    . 'renderer_payment_required / renderer_busy — rotate the key or '
                    . 'wait for the daily reset.',
            ],

            'gemini' => [
                'label' => 'Gemini — Catalog Vision',
                'purpose' => 'Reads uploaded garment photos to auto-fill catalog details.',
                'required' => false,
                'env' => 'GEMINI_API_KEY',
                'config_path' => 'services.gemini.key',
                'endpoint_path' => 'services.gemini.model',
                /*
                 * Probe the models list. It is cheap, text-only, and the only
                 * call that distinguishes an INVALID key (400/403) from a
                 * rate-limited but VALID one (429) — a distinction that matters
                 * because the free tier caps requests per day.
                 */
                'probe' => [
                    'method' => 'GET',
                    'url' => 'https://generativelanguage.googleapis.com/v1beta/models',
                    'kind' => 'query_key',
                ],
                'instructions' => [
                    'Open hiraya-backend/.env',
                    'Set GEMINI_API_KEY to the new key from https://aistudio.google.com/apikey',
                    'Run: php artisan config:clear',
                ],
                'notes' => 'Free-tier keys are quota-limited per day (HTTP 429) '
                    . 'rather than rejected, so a 429 here means the key is VALID but '
                    . 'has no quota left right now.',
            ],

            'supabase' => [
                'label' => 'Supabase — Asset Storage',
                'purpose' => 'Serves catalog images and occasion backgrounds (service role).',
                'required' => true,
                'env' => 'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
                'config_path' => 'services.supabase.service_role_key',
                'endpoint_path' => 'services.supabase.url',
                /* The service-role key is server-only; it is NEVER echoed. */
                'probe' => [
                    'method' => 'GET',
                    'url_path' => 'services.supabase.url',
                    'suffix' => '/rest/v1/',
                    'kind' => 'supabase',
                ],
                'instructions' => [
                    'Open hiraya-backend/.env',
                    'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the Supabase project settings.',
                    'Run: php artisan config:clear',
                ],
                'notes' => 'This key bypasses row-level security and must stay '
                    . 'server-side. It is shown masked only — never in full.',
            ],
        ];
    }

    /**
     * GET /api/admin/api-status
     *
     * Config-only read: fast, safe, DB-free. This is what the console loads on
     * mount, so it must not make outbound calls (see `probe()` for those).
     */
    public function index(): JsonResponse
    {
        $report = [];
        $missingRequired = [];

        foreach ($this->registry() as $key => $spec) {
            $configured = $this->isConfigured($spec);

            $report[] = [
                'key' => $key,
                'label' => $spec['label'],
                'purpose' => $spec['purpose'],
                'required' => (bool) $spec['required'],
                'configured' => $configured,
                // MASKED tail only — see the class note on why the raw value is
                // never returned.
                'masked' => $configured ? $this->mask($spec) : null,
                'env' => $spec['env'],
                'endpoint' => $this->endpointFor($spec),
                'instructions' => $spec['instructions'],
                'notes' => $spec['notes'] ?? null,
                '//' => 'Live health is on POST /api/admin/api-status/{key}/probe',
            ];

            if ($spec['required'] && ! $configured) {
                $missingRequired[] = $spec['label'];
            }
        }

        return response()->json([
            'status' => empty($missingRequired) ? 'ok' : 'degraded',
            'missing_required' => $missingRequired,
            'checked_at' => now()->toIso8601String(),
            /*
             * A single source of truth for "can the try-on run at all". The
             * console shows this prominently because it is the one condition that
             * makes EVERY fitting fail regardless of what the customer does.
             */
            'tryon_ready' => $this->isConfigured($this->registry()['pixelapi']),
            /*
             * PROVIDER HEALTH — THE PART `tryon_ready` CANNOT SEE.
             *
             * `tryon_ready` answers "is a key present", and is GREEN while
             * PixelAPI's safety checker is down and every fitting is failing. This
             * block answers the question an operator actually has during an
             * incident — "is the PROVIDER degraded RIGHT NOW, for EVERYONE?" — from
             * recorded observations rather than from a guess, which is why it is
             * read from the database and not from config.
             */
            'provider_health' => $this->providerHealth(),
            'services' => $report,
        ]);
    }

    /**
     * A rolled-up verdict on the try-on provider, from recorded observations.
     *
     * WHY THIS READS THE DATABASE RATHER THAN PROBING
     * ------------------------------------------------
     * This is the config-only `index` route, which the console loads on mount and
     * which must NEVER make an outbound call (the dev server is single-threaded
     * and an unattended console polling a vendor would compete with real renders).
     * So it reports what is already KNOWN — recorded by the scheduled
     * `tryon:check-provider` probe and by real renders — instead of asking the
     * provider again on every page load.
     *
     * The consequence, and it is stated in the payload itself: this describes the
     * provider as of the last observation. `minutes_since_check` (and
     * `stale_after_minutes`) let the console say "we do not know, the checker may
     * not be running" rather than silently showing a stale green.
     *
     * @return array<string, mixed>
     */
    private function providerHealth(): array
    {
        $provider = ProviderHealth::PROVIDER_PIXELAPI;
        $windowHours = 24;

        try {
            $last = ProviderHealthEvent::query()
                ->where('provider', $provider)
                ->latest('id')
                ->first();

            $lastProbe = ProviderHealthEvent::query()
                ->where('provider', $provider)
                ->where('source', 'probe')
                ->latest('id')
                ->first();

            /*
             * COUNT OUTAGES, NOT FAILED ATTEMPTS, and count them by the thing an
             * operator cares about: DISTINCT EPISODES. Two consecutive unhealthy
             * probes five minutes apart are ONE outage, not two, so a new episode
             * is counted when an unhealthy observation is followed by ANY other
             * observation changing state — approximated here by counting the
             * transitions, which is what the timeline below shows directly.
             */
            $recent = ProviderHealthEvent::query()
                ->where('provider', $provider)
                ->where('created_at', '>=', now()->subHours($windowHours))
                ->orderBy('id')
                ->get(['state', 'source', 'code', 'http_status', 'message', 'created_at']);

            $outages = 0;
            $previousUnhealthy = false;

            foreach ($recent as $event) {
                $unhealthy = in_array($event->state, ProviderHealthEvent::UNHEALTHY_STATES, true);

                if ($unhealthy && ! $previousUnhealthy) {
                    $outages++;
                }

                $previousUnhealthy = $unhealthy;
            }

            $currentlyUnhealthy = $last !== null
                && in_array($last->state, ProviderHealthEvent::UNHEALTHY_STATES, true);

            /*
             * "BLOCKING" IS BROADER THAN "DEGRADED", AND THE DIFFERENCE IS THE
             * WHOLE POINT OF SHOWING BOTH.
             *
             *   degraded  -> the VENDOR is at fault   -> wait for it to clear
             *   unconfigured -> OUR config is at fault -> fix the .env now
             *
             * Both stop every render, so neither may render green, but they lead to
             * opposite actions. `degraded` is therefore reserved for a genuine
             * provider fault (and drives the "provider outage" wording and the outage
             * count), while `blocking` covers both and stops the card claiming the
             * provider is healthy when it is our token that is missing.
             */
            $currentlyBlocking = $last !== null
                && in_array($last->state, ProviderHealthEvent::BLOCKING_STATES, true);

            return [
                'provider' => $provider,
                'known' => $last !== null,
                'state' => $last->state ?? 'unknown',
                'degraded' => $currentlyUnhealthy,
                'blocking' => $currentlyBlocking,
                'since' => $currentlyBlocking ? $last->created_at?->toIso8601String() : null,
                'last_checked_at' => $last->created_at?->toIso8601String(),
                'last_probe_at' => $lastProbe?->created_at?->toIso8601String(),
                'minutes_since_check' => $last?->created_at?->diffInMinutes(now()),
                /*
                 * The scheduled probe runs every five minutes, so anything older
                 * than three missed cycles means the CHECKER itself is not running —
                 * a different fault from the provider being down, and one the
                 * console must not present as "healthy".
                 */
                'stale_after_minutes' => 15,
                'last_source' => $last->source ?? null,
                'last_code' => $last->code ?? null,
                'last_http_status' => $last->http_status,
                'last_message' => $last->message,
                'window_hours' => $windowHours,
                'outages_in_window' => $outages,
                'recent_events' => $recent->take(-20)->values()->map(fn ($e) => [
                    'state' => $e->state,
                    'source' => $e->source,
                    'code' => $e->code,
                    'http_status' => $e->http_status,
                    'message' => $e->message,
                    'at' => $e->created_at?->toIso8601String(),
                ])->all(),
            ];
        } catch (\Throwable $e) {
            /*
             * Health bookkeeping must never break the status screen: if the table
             * is missing (a deploy that has not migrated yet) the console still
             * loads and says it does not know, rather than returning a 500.
             */
            Log::warning('Could not read provider health: ' . $e->getMessage());

            return [
                'provider' => $provider,
                'known' => false,
                'state' => 'unknown',
                'degraded' => false,
                'blocking' => false,
                'last_checked_at' => null,
                'minutes_since_check' => null,
                'stale_after_minutes' => 15,
                'window_hours' => $windowHours,
                'outages_in_window' => 0,
                'recent_events' => [],
                'note' => 'Provider health history is unavailable: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * POST /api/admin/api-status/{key}/probe
     *
     * A LIVE liveness check for ONE service. Deliberately a separate, on-demand
     * route: it makes an outbound call, so it must never run on page load (the dev
     * server is single-threaded, and an unattended console polling every vendor
     * would compete with real renders).
     */
    public function probe(string $key): JsonResponse
    {
        $registry = $this->registry();

        if (! isset($registry[$key])) {
            return response()->json(['message' => 'Unknown service key.'], 404);
        }

        $spec = $registry[$key];

        if (! $this->isConfigured($spec)) {
            return response()->json([
                'key' => $key,
                'reachable' => false,
                'ok' => false,
                'summary' => 'Not configured — ' . $spec['env'] . ' is empty.',
                'detail' => 'Nothing to test until the variable is set.',
            ]);
        }

        try {
            return response()->json($this->runProbe($key, $spec));
        } catch (\Throwable $e) {
            /*
             * A probe is a DIAGNOSTIC, so it must never surface as a 500: "the
             * probe itself broke" is less useful than the network detail, and a
             * 500 would read like the app is down rather than the vendor being
             * unreachable.
             */
            Log::warning("API status probe failed for {$key}: " . $e->getMessage());

            return response()->json([
                'key' => $key,
                'reachable' => false,
                'ok' => false,
                'summary' => 'Probe could not complete.',
                'detail' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Perform the outbound liveness call described by `$spec['probe']`.
     *
     * @param  array<string, mixed>  $spec
     * @return array<string, mixed>
     */
    private function runProbe(string $key, array $spec): array
    {
        $probe = $spec['probe'];
        $timeout = 25;

        $client = Http::timeout($timeout)->acceptJson();

        if ($key === 'pixelapi') {
            $url = trim((string) config($probe['url_path']));
            $token = trim((string) config($spec['config_path']));

            $res = $client->withToken($token)->post($url, $probe['body']);

            return [
                'key' => $key,
                'reachable' => true,
                'http_status' => $res->status(),
                'ok' => in_array($res->status(), [200, 201, 202, 422], true),
                'summary' => match (true) {
                    $res->status() === 422 => 'Key is VALID — the request reached validation.',
                    in_array($res->status(), [401, 403], true) => 'Key is INVALID or lacks permission.',
                    $res->status() === 402 => 'Valid key, but the account is out of credits.',
                    $res->status() === 429 => 'Valid key, but rate-limited right now.',
                    $res->status() === 503 => 'Key is valid, but the provider is degraded (e.g. safety service down).',
                    $res->successful() => 'Provider accepted the request.',
                    default => 'Unexpected response from the provider.',
                },
                'detail' => $this->upstreamReason($res->json()),
            ];
        }

        if ($key === 'gemini') {
            $token = trim((string) config($spec['config_path']));
            $url = $probe['url'] . '?key=' . urlencode($token);

            $res = Http::timeout($timeout)->acceptJson()->get($url);

            return [
                'key' => $key,
                'reachable' => true,
                'http_status' => $res->status(),
                'ok' => $res->successful(),
                'summary' => match (true) {
                    $res->successful() => 'Key is VALID and reachable.',
                    $res->status() === 429 => 'Key is VALID but out of quota for now.',
                    in_array($res->status(), [400, 401, 403], true) => 'Key is INVALID or not permitted for this API.',
                    default => 'Unexpected response from Gemini.',
                },
                'detail' => $this->upstreamReason($res->json()),
            ];
        }

        // Supabase: the service-role key is sent as a bearer token.
        $base = rtrim(trim((string) config($probe['url_path'])), '/');
        $token = trim((string) config($spec['config_path']));
        $url = $base . ($probe['suffix'] ?? '');

        $res = Http::timeout($timeout)
            ->acceptJson()
            ->withToken($token)
            ->withHeaders(['apikey' => $token])
            ->get($url);

        return [
            'key' => $key,
            'reachable' => true,
            'http_status' => $res->status(),
            'ok' => $res->status() < 500 && $res->status() !== 401 && $res->status() !== 403,
            'summary' => $res->status() < 500 && ! in_array($res->status(), [401, 403], true)
                ? 'Project is reachable and the key is accepted.'
                : 'Project reachable, but the key was refused.',
            'detail' => null,
        ];
    }

    /**
     * Is the declared credential actually present?
     *
     * Reads the CONFIG value (the same source the renderers use), not the env
     * directly, so a cached config and the running app always agree. A blank
     * string, `null`, and the literal placeholder values that ship in
     * `.env.example` all count as missing — a key set to `<your-key-here>` must
     * not read as configured.
     *
     * @param  array<string, mixed>  $spec
     */
    private function isConfigured(array $spec): bool
    {
        $value = config($spec['config_path']);

        if (! is_string($value)) {
            return false;
        }

        $value = trim($value);

        if ($value === '') {
            return false;
        }

        // Obvious placeholders are not a credential.
        return ! preg_match('/^(<.*>|your[-_]?key|changeme|null|none)$/i', $value);
    }

    /**
     * A masked, non-replayable hint of the key: length plus the last 4 characters.
     *
     * The tail is enough for an operator to confirm "this is the key I just
     * pasted", and useless to anyone who obtains the response.
     *
     * @param  array<string, mixed>  $spec
     */
    private function mask(array $spec): string
    {
        $value = (string) config($spec['config_path']);
        $tail = substr($value, -4);

        return str_repeat('•', 12) . $tail . ' (' . strlen($value) . ' chars)';
    }

    /** The configured endpoint/model for display, when the spec declares one. */
    private function endpointFor(array $spec): ?string
    {
        if (! isset($spec['endpoint_path'])) {
            return null;
        }

        $value = trim((string) config($spec['endpoint_path']));

        return $value !== '' ? $value : null;
    }

    /**
     * Pull a human-readable reason out of a vendor error body.
     *
     * Mirrors the shapes VtonApiRenderer already documents (FastAPI `detail`,
     * `error.message`, `message`) so the console shows the SAME text the renderer
     * would log, rather than a second, divergent interpretation.
     *
     * @param  mixed  $body
     */
    private function upstreamReason($body): ?string
    {
        if (! is_array($body)) {
            return null;
        }

        $detail = $body['detail'] ?? null;

        if (is_string($detail) && trim($detail) !== '') {
            return trim($detail);
        }

        if (is_array($detail) && $detail !== []) {
            $first = $detail[0] ?? null;

            if (is_array($first)) {
                $msg = trim((string) ($first['msg'] ?? ''));

                if ($msg !== '') {
                    return $msg;
                }
            }
        }

        $nested = $body['error']['message'] ?? ($body['message'] ?? null);

        return is_string($nested) && trim($nested) !== '' ? trim($nested) : null;
    }
}
