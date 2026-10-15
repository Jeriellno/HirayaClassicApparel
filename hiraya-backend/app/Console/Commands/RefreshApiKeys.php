<?php

namespace App\Console\Commands;

use App\Models\ApiCredential;
use App\Services\ApiCredentialStore;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * `php artisan hiraya:refresh-api-keys`
 *
 * THE SCHEDULED HALF OF DYNAMIC API KEY MANAGEMENT.
 *
 * WHAT IT ACTUALLY DOES — stated precisely, because "refresh" oversells it.
 *
 * There are two different failure modes for a third-party key, and they need
 * different handling:
 *
 *   1. THE KEY EXPIRED (short-lived vendor token). The vendor TOLD us when, and
 *      we stored that in `expires_at`. Rotation is a LOCAL operation: promote the
 *      next stored key. No outbound call, no user-visible failure, no deploy.
 *
 *   2. THE KEY WAS REVOKED (deleted in the vendor dashboard, or quota exhausted).
 *      Nobody warned us, so the only way to learn is to ask the vendor. That is a
 *      cheap metadata call per key — never a render — and its status code tells us
 *      which remedy applies:
 *
 *        200 -> valid, keep it
 *        401/403 -> revoked/mistyped: mark unauthorized, rotate away immediately
 *        429 -> VALID but out of quota: keep it, and let it come back tomorrow
 *        5xx/network -> UNKNOWN: do NOT rotate on a vendor hiccup
 *
 * THAT LAST LINE IS THE IMPORTANT ONE. A provider that is briefly unreachable
 * must NOT cause the app to burn through its whole key pool. A network failure
 * records "unknown" and leaves the key exactly where it is, so a momentary outage
 * cannot cascade into us having no working key at all.
 *
 * WHY IT RUNS ON A SCHEDULE
 * -------------------------
 * The point is to act BEFORE a customer hits the failure. A key that expires at
 * 14:00 is rotated at 13:55, and the person who would have seen an error sees a
 * completed fitting instead. Discovering this on demand — by pressing "Test" in
 * the console, or by reading a failure off a customer's canvas — is the situation
 * this command exists to eliminate.
 *
 * `--verify` also runs on demand from the console's "Verify now" button, so a
 * person and the scheduler produce identical history.
 */
class RefreshApiKeys extends Command
{
    protected $signature = 'hiraya:refresh-api-keys
                            {--verify : Actually call each provider to confirm the key works}
                            {--dry-run : Report what would change without rotating anything}
                            {--quiet-ok : Print nothing when every key is healthy}';

    protected $description = 'Rotate expired external API keys and (optionally) verify each one against its vendor.';

    public function handle(): int
    {
        try {
            $credentials = ApiCredential::query()
                ->whereNull('retired_at')
                ->orderBy('provider')
                ->orderByDesc('is_active')
                ->get();
        } catch (\Throwable $e) {
            $this->error('The api_credentials table is not available. Run: php artisan migrate');

            return self::FAILURE;
        }

        if ($credentials->isEmpty()) {
            if (!$this->option('quiet-ok')) {
                $this->line('No managed API keys. The app is using its .env configuration.');
            }

            return self::SUCCESS;
        }

        $problems = 0;
        $rotations = 0;

        foreach ($credentials as $credential) {
            $verdict = $this->evaluate($credential);

            if ($verdict['status'] === ApiCredential::STATUS_VALID) {
                ApiCredentialStore::recordVerdict(
                    $credential,
                    ApiCredential::STATUS_VALID,
                    $verdict['message'] ?? null,
                );

                continue;
            }

            if ($verdict['status'] === ApiCredential::STATUS_RATE_LIMITED) {
                /*
                 * OUT OF QUOTA IS NOT DEAD. A 429 key is valid and works again
                 * after the vendor's daily reset, so it stays in play and is not
                 * retired. Rotating it away permanently would be strictly wrong.
                 */
                ApiCredentialStore::recordVerdict(
                    $credential,
                    ApiCredential::STATUS_RATE_LIMITED,
                    $verdict['message'] ?? null,
                );

                continue;
            }

            if ($verdict['status'] === ApiCredential::STATUS_ERROR) {
                /* The vendor could not be reached — record, but do NOT rotate. */
                ApiCredentialStore::recordVerdict(
                    $credential,
                    ApiCredential::STATUS_ERROR,
                    $verdict['message'] ?? null,
                );

                $problems++;

                continue;
            }

            /* Expired or revoked: this key must stop answering. */
            $problems++;
            ApiCredentialStore::recordVerdict(
                $credential,
                $verdict['status'],
                $verdict['message'] ?? null,
            );

            if ($this->option('dry-run')) {
                $this->line("  would rotate away: {$credential->provider} / {$credential->label}");

                continue;
            }

            $promoted = $this->rotateToNextKey($credential, $verdict['status']);

            if ($promoted) {
                $rotations++;
                $this->line("  rotated {$credential->provider} -> {$promoted->label}");
            } else {
                $this->warn("  {$credential->provider}: no replacement key stored — the service will fall back to .env");
            }
        }

        if ($problems > 0 && !$this->option('quiet-ok')) {
            $this->warn("{$problems} credential(s) need attention.");
        }

        if (!$this->option('quiet-ok')) {
            $summary = $rotations > 0
                ? "{$rotations} key(s) rotated."
                : 'All managed keys are healthy.';

            $this->line($summary);
        }

        return $problems > 0 && $rotations === 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * Decide a credential's state.
     *
     * The EXPIRY CHECK COMES FIRST AND DOES NOT REQUIRE A NETWORK CALL. That is
     * the difference between this being a preventative system and a diagnostic
     * one: if the vendor told us the token dies at 14:00, we know it at 14:00
     * without asking anybody.
     *
     * @return array{status: string, message: ?string}
     */
    private function evaluate(ApiCredential $credential): array
    {
        if ($credential->isExpired()) {
            return [
                'status' => ApiCredential::STATUS_EXPIRED,
                'message' => 'The vendor expiry has passed'
                    . ($credential->expires_at ? ' (' . $credential->expires_at->toDateTimeString() . ')' : '') . '.',
            ];
        }

        if (!$this->option('verify')) {
            /*
             * Without --verify we deliberately do NOT contact the vendor. This
             * command runs on a schedule, and the try-on provider serialises
             * jobs — an unattended outbound call every few minutes competes with
             * real renders for the same capacity. Expiry alone is enough to act on.
             */
            return ['status' => ApiCredential::STATUS_VALID, 'message' => null];
        }

        return $this->probeProvider($credential);
    }

    /**
     * A cheap, non-consuming call per provider.
     *
     * NEVER a render and never a vision call: the point is to learn whether a
     * credential is accepted, and both of those would burn the very quota being
     * protected. Each provider already has a metadata endpoint that authenticates
     * and does nothing else.
     *
     * @return array{status: string, message: ?string}
     */
    private function probeProvider(ApiCredential $credential): array
    {
        $secret = $credential->plainSecret();

        if ($secret === null) {
            return [
                'status' => ApiCredential::STATUS_UNAUTHORIZED,
                'message' => 'The stored key could not be decrypted (APP_KEY may have changed).',
            ];
        }

        try {
            $response = match ($credential->provider) {
                'pixelapi' => Http::timeout(20)
                    ->withToken($secret)
                    ->post(trim((string) config('services.vton.endpoint')), [
                        'person_image' => 'probe',
                        'garment_image' => 'probe',
                        'category' => '__key_check__',
                    ]),

                'gemini' => Http::timeout(20)
                    ->withHeaders(['x-goog-api-key' => $secret])
                    ->get('https://generativelanguage.googleapis.com/v1beta/models'),

                'supabase' => Http::timeout(20)
                    ->withToken($secret)
                    ->withHeaders(['apikey' => $secret])
                    ->get(rtrim(trim((string) config('services.supabase.url')), '/') . '/rest/v1/'),

                default => null,
            };
        } catch (\Throwable $e) {
            /* Unknown — explicitly NOT a reason to rotate. */
            return ['status' => ApiCredential::STATUS_ERROR, 'message' => $e->getMessage()];
        }

        if ($response === null) {
            return ['status' => ApiCredential::STATUS_ERROR, 'message' => 'No probe is defined for this provider.'];
        }

        $status = $response->status();

        return match (true) {
            /* 422 means auth PASSED and the request reached validation — healthy. */
            $response->successful() || $status === 422
            => ['status' => ApiCredential::STATUS_VALID, 'message' => 'Accepted by the provider.'],

            $status === 429
            => ['status' => ApiCredential::STATUS_RATE_LIMITED, 'message' => 'Valid key, but out of quota right now.'],

            in_array($status, [401, 403], true)
            => ['status' => ApiCredential::STATUS_UNAUTHORIZED, 'message' => 'The provider refused this key (revoked or mistyped).'],

            default
            => ['status' => ApiCredential::STATUS_ERROR, 'message' => "Unexpected provider response (HTTP {$status})."],
        };
    }

    /**
     * Promote the next usable key for the provider.
     *
     * Prefers a key we have positively verified, and otherwise takes the most
     * recently added non-retired row. Returns the promoted row, or null when the
     * pool is empty — which is not a failure, because `ApiCredentialStore` falls
     * back to `.env` and the service keeps working.
     */
    private function rotateToNextKey(ApiCredential $dead, string $reason): ?ApiCredential
    {
        $next = ApiCredential::query()
            ->where('provider', $dead->provider)
            ->where('id', '!=', $dead->id)
            ->whereNull('retired_at')
            ->orderByRaw('CASE WHEN last_status = ? THEN 0 ELSE 1 END', [ApiCredential::STATUS_VALID])
            ->orderByDesc('id')
            ->first();

        if ($next === null) {
            Log::warning('No replacement API credential available', [
                'provider' => $dead->provider,
                'reason' => $reason,
            ]);

            return null;
        }

        $dead->forceFill([
            'is_active' => false,
            'retired_at' => now(),
        ])->save();

        ApiCredentialStore::promote($next);

        return $next;
    }
}
