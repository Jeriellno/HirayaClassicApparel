<?php

namespace App\Console\Commands;

use App\Models\ProviderHealthEvent;
use App\Support\ProviderHealth;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * `php artisan tryon:check-provider`
 *
 * A SCHEDULED liveness probe of the try-on provider (PixelAPI), so a provider-side
 * outage is VISIBLE to a super admin before a customer has to report it.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * The existing API-status screen has a working probe — but it is MANUAL and
 * ON-DEMAND (`ApiStatusController::probe()`), and its `tryon_ready` flag is
 * CONFIG-ONLY. So the console showed
 *
 *     "Virtual Try-On is configured"   (green)
 *
 * while PixelAPI's clothing-safety checker was down and EVERY fitting was failing
 * with `renderer_safety_unavailable`. The state was only discoverable by pressing
 * "Test", or by reading a failure off a customer's canvas.
 *
 * This command runs on a schedule, records what it finds, and therefore turns
 * "the provider is degraded" from an on-demand question into a monitored fact with
 * a recorded start time and history.
 *
 * WHY IT PROBES WITH AN INVALID PAYLOAD
 * -------------------------------------
 * Exactly as the console's probe does: the provider's AUTH layer runs BEFORE
 * validation, so the status code alone tells us what we need, and the call is
 * cheap and never spends a render credit:
 *
 *   401/403 -> the token is refused          -> down  (renderer_unauthorized)
 *   402     -> the account is out of credits -> down
 *   422     -> auth PASSED, request reached validation -> OK  (this is HEALTHY)
 *   429     -> valid but rate-limited        -> degraded
 *   503     -> the provider is degraded (e.g. safety checker down) -> degraded
 *   520-527 -> the provider's origin is down -> down
 *   2xx     -> unexpected for an invalid payload, but accepted -> OK
 *
 * A SUCCESSFUL PROBE IS RECORDED TOO, AND THAT IS NOT NOISE
 * ---------------------------------------------------------
 * Recording only failures would make "no recent events" ambiguous — it could mean
 * "healthy" OR "the scheduler is not running". A periodic `ok` row makes
 * liveness of the CHECK itself observable, so an operator can tell a healthy
 * provider from a dead cron. To stop the table growing without bound, consecutive
 * healthy probes older than `--keep-ok-hours` are pruned as part of the run.
 */
class TryOnCheckProvider extends Command
{
    protected $signature = 'tryon:check-provider
                            {--slot=vton : Which VTON slot to probe (vton = PixelAPI, fashn = FASHN)}
                            {--quiet-ok : Print nothing when the provider is healthy}
                            {--keep-ok-hours=24 : How many hours of healthy probe rows to keep}';

    protected $description = 'Probe a try-on provider slot (PixelAPI by default, or FASHN with --slot=fashn) and record its health so outages are visible to super admins.';

    /** The provider's own sentinel for "its clothing-safety service is down". */
    private const SAFETY_SENTINEL = 'safety_unavailable';

    /**
     * SLOT -> how the operator sees it.
     *
     * `envPrefix` is used ONLY in the "not configured" text, so the operator is
     * pointed at the variables that actually enable the slot they asked to probe
     * — telling them to set VTON_API_TOKEN while probing FASHN would be a dead end.
     *
     * `provider` is the ProviderHealth id the probe row is filed under, so the
     * console can distinguish a FASHN outage from a PixelAPI one.
     */
    private const SLOTS = [
        'vton' => [
            'label' => 'PixelAPI',
            'envPrefix' => 'VTON_API_URL / VTON_API_TOKEN',
            'provider' => ProviderHealth::PROVIDER_PIXELAPI,
        ],
        'fashn' => [
            'label' => 'FASHN',
            'envPrefix' => 'VTON_FASHN_API_URL / VTON_FASHN_API_TOKEN',
            'provider' => ProviderHealth::PROVIDER_FASHN,
        ],
    ];

    /**
     * Resolve the requested slot, falling back to PixelAPI.
     *
     * An unknown `--slot` must NOT make the probe silently do nothing: it warns
     * and probes the default, so a typo surfaces as a visible message rather than
     * as a scheduled job that quietly records the wrong thing — or nothing.
     *
     * @return array{label: string, envPrefix: string, provider: string}
     */
    private function resolveSlot(): array
    {
        $slot = strtolower(trim((string) $this->option('slot')));

        if (isset(self::SLOTS[$slot])) {
            return self::SLOTS[$slot];
        }

        $this->warn("Unknown --slot '{$slot}' — probing PixelAPI instead. Valid: " . implode(', ', array_keys(self::SLOTS)) . '.');

        return self::SLOTS['vton'];
    }

    public function handle(): int
    {
        $slot = strtolower(trim((string) $this->option('slot')));
        $meta = $this->resolveSlot();
        $slotName = isset(self::SLOTS[$slot]) ? $slot : 'vton';

        $endpoint = trim((string) config("services.{$slotName}.endpoint"));
        $token = trim((string) config("services.{$slotName}.token"));

        /*
         * NOT CONFIGURED IS ITS OWN STATE — AND IT IS NOT AN OUTAGE.
         *
         * Recording a probe failure for an empty token would blame the provider
         * for an operator's missing .env value, and would fill the console with an
         * "outage" that has nothing to do with the vendor. `unconfigured` is
         * recorded so the console can distinguish the two, then the command exits
         * successfully — an unconfigured provider is a known configuration, not a
         * command error.
         */
        if ($endpoint === '' || $token === '') {
            $this->record('unconfigured', null, 'not_configured', $meta['envPrefix'] . ' are empty.', $meta['provider']);

            if (! $this->option('quiet-ok')) {
                $this->warn($meta['label'] . ' is not configured (' . $meta['envPrefix'] . ') — nothing to probe.');
            }

            return self::SUCCESS;
        }

        try {
            $response = Http::timeout(25)
                ->acceptJson()
                ->withToken($token)
                ->post($endpoint, $this->probePayload($slotName, $token));
        } catch (\Throwable $e) {
            /*
             * A TRANSPORT FAILURE IS A PROVIDER OUTAGE, not a command error. The
             * provider being unreachable is precisely the condition this command
             * exists to surface, so it is recorded as `down` rather than thrown.
             */
            Log::warning("tryon:check-provider could not reach {$meta['label']}: " . $e->getMessage());

            $this->record('down', null, 'renderer_unreachable', $e->getMessage(), $meta['provider']);

            if (! $this->option('quiet-ok')) {
                $this->error($meta['label'] . ' could not be reached: ' . $e->getMessage());
            }

            return self::SUCCESS;
        }

        $status = $response->status();
        $reason = $this->upstreamReason($response->json());

        [$state, $code] = $this->classify($status, (string) $reason);

        $this->record($state, $status, $code, $reason, $meta['provider']);

        if (! $this->option('quiet-ok') || $state !== 'ok') {
            $label = strtoupper($state);
            $line = sprintf('%s: %s (HTTP %d)%s', $meta['label'], $label, $status, $reason ? ' — ' . $reason : '');
            $state === 'ok' ? $this->info($line) : $this->warn($line);
        }

        $this->pruneHealthyProbes($meta['provider']);

        return self::SUCCESS;
    }

    /**
     * The deliberately-INVALID payload used to probe a slot.
     *
     * WHY INVALID ON PURPOSE — the provider's AUTH layer runs BEFORE validation,
     * so the status code alone tells us what we need (401 = bad token, 422 = auth
     * passed) and the call never spends a render credit.
     *
     * THE SHAPE FOLLOWS THE SLOT, because the two vendors disagree about both the
     * field names and the envelope:
     *
     *   vton  (PixelAPI) FLAT    : { person_image, garment_image, category }
     *   fashn (FASHN)    WRAPPER : { model_name, inputs: { model_image, garment_image, category } }
     *
     * Sending PixelAPI's flat body to FASHN (or the reverse) would be rejected by
     * the vendor's SCHEMA before its auth could be judged, so the probe would
     * report a healthy endpoint as broken. Each branch mirrors what
     * `VtonApiRenderer::buildPayload()` sends for that slot.
     *
     * @return array<string, mixed>
     */
    private function probePayload(string $slot, string $token): array
    {
        $categoryField = trim((string) config("services.{$slot}.category_field", 'category'));
        $categoryField = $categoryField !== '' ? $categoryField : 'category';

        $personField = trim((string) config("services.{$slot}.person_field", 'model_image'));
        $personField = $personField !== '' ? $personField : 'model_image';

        $garmentField = trim((string) config("services.{$slot}.garment_field", 'garment_image'));
        $garmentField = $garmentField !== '' ? $garmentField : 'garment_image';

        $inputs = [
            $personField => 'probe',
            $garmentField => 'probe',
            $categoryField => '__status_probe__',
        ];

        /*
         * `model_name` non-empty is the WRAPPER signal, exactly as the renderer
         * treats it — so the probe's shape cannot drift from the render's.
         */
        $modelName = trim((string) config("services.{$slot}.model_name", ''));

        if ($modelName !== '') {
            return ['model_name' => $modelName, 'inputs' => $inputs];
        }

        return $inputs;
    }

    /**
     * Turn an HTTP status + the provider's own reason into (state, code).
     *
     * PRECEDENCE MATTERS: a 503 carrying `vton_safety_unavailable` is a DIFFERENT
     * fault from a bare 503 (which is the provider's single-job queue refusing a
     * concurrent submit). The sentinel is matched rather than the prose, because
     * the wording may change while the code does not — this mirrors
     * `VtonApiRenderer::isSafetyUnavailable()` exactly so one interpretation of
     * the provider's vocabulary exists in the codebase, not two.
     *
     * @return array{0: string, 1: string}
     */
    private function classify(int $status, string $reason): array
    {
        $lower = strtolower($reason);

        return match (true) {
            in_array($status, [401, 403], true) => ['down', 'renderer_unauthorized'],
            $status === 402 => ['down', 'renderer_payment_required'],
            /*
             * A 422 IS HEALTHY. The provider runs auth BEFORE validation, so a
             * validation rejection PROVES the request travelled end to end and was
             * understood. Treating this as an outage would report a fault every
             * time the probe ran.
             */
            $status === 422 => ['ok', 'probe_reached_validation'],
            $status === 429 => ['degraded', 'renderer_no_image'],
            // The safety checker being down is a DEGRADED provider, not a dead
            // one: its gateway is up and it is answering. See the class note on
            // why this has its own code in the renderer.
            $status === 503 && str_contains($lower, self::SAFETY_SENTINEL)
            => ['degraded', 'renderer_safety_unavailable'],
            // A bare 503 is the provider's one-job-at-a-time queue — working, busy.
            $status === 503 => ['degraded', 'renderer_busy'],
            // Cloudflare 520-527: the provider's origin is unreachable.
            $status >= 520 && $status <= 527 => ['down', 'renderer_gateway_error'],
            $status >= 500 => ['down', 'renderer_gateway_error'],
            $status >= 200 && $status < 300 => ['ok', 'probe_accepted'],
            default => ['degraded', 'renderer_http_' . $status],
        };
    }

    /** Persist one observation. Never throws — see ProviderHealth::recordRenderFailure. */
    private function record(string $state, ?int $httpStatus, string $code, ?string $message, string $provider = ProviderHealth::PROVIDER_PIXELAPI): void
    {
        try {
            ProviderHealthEvent::create([
                'provider' => $provider,
                'source' => 'probe',
                'state' => $state,
                'http_status' => $httpStatus,
                'code' => $code,
                'message' => $message,
            ]);
        } catch (\Throwable $e) {
            Log::warning('tryon:check-provider could not record its result: ' . $e->getMessage());
        }
    }

    /**
     * Keep the healthy-probe history bounded.
     *
     * `ok` rows accumulate at one per scheduled run forever, while the UNHEALTHY
     * rows are rare AND are the ones worth keeping. So only `ok` rows are pruned,
     * and only past the retention window.
     */
    private function pruneHealthyProbes(string $provider = ProviderHealth::PROVIDER_PIXELAPI): void
    {
        try {
            ProviderHealthEvent::query()
                ->where('provider', $provider)
                ->where('source', 'probe')
                ->where('state', 'ok')
                ->where('created_at', '<', now()->subHours((int) $this->option('keep-ok-hours')))
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('tryon:check-provider could not prune healthy probes: ' . $e->getMessage());
        }
    }

    /**
     * The provider's own wording, from any of the shapes it uses.
     *
     * Mirrors `ApiStatusController::upstreamReason()` so the console, the probe and
     * the renderer all quote the vendor identically instead of each inventing its
     * own reading of the same body.
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
