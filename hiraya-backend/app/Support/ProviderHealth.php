<?php

namespace App\Support;

use App\Models\ProviderHealthEvent;
use Illuminate\Support\Facades\Log;

/**
 * ProviderHealth — the single place that decides "who is to blame" for a failed
 * try-on, and remembers the answer.
 *
 * THE DISTINCTION THIS CLASS EXISTS TO MAKE
 * -----------------------------------------
 * Before this, every try-on failure produced ONE kind of record: a log line. That
 * made a PROVIDER OUTAGE (PixelAPI's safety checker down, its gateway returning
 * 522, its single-job queue refusing a second submit) indistinguishable — to a
 * super admin, and to the console — from a CUSTOMER'S fixable mistake (a photo
 * that is too large, a measurement out of range, a garment with no cut-out).
 *
 * Those two must never be mixed, because they lead to opposite actions:
 *
 *   - a provider fault   -> "nothing the customer did wrong; the vendor is broken;
 *                           nothing was charged; expect it to clear by itself"
 *   - a customer fault   -> "this WILL happen again identically until the input is
 *                           fixed, and the customer can fix it right now"
 *
 * Counting the second kind as an outage would make the console cry wolf on every
 * oversized photo; counting the first kind as a customer error is exactly the bug
 * that had customers re-uploading good photos during a vendor outage.
 *
 * So the classification is explicit and closed: a code is a provider fault ONLY
 * if it appears in PROVIDER_FAULT_CODES. Anything unknown is treated as NOT a
 * provider fault, which fails safe — the console under-reports rather than
 * alarming on something it does not understand.
 */
class ProviderHealth
{
    /** The only provider wired into the render chain today. */
    public const PROVIDER_PIXELAPI = 'pixelapi';

    /*
     * CODES THAT MEAN "THE PROVIDER IS AT FAULT".
     *
     * Every one of these is either raised by the provider itself (a 5xx, a
     * gateway code, its explicit `vton_safety_unavailable`) or is the provider
     * refusing a second concurrent submit because it renders one job at a time.
     * NONE of them is influenced by the request, the photos, or the payload.
     *
     * DELIBERATELY ABSENT — and why each is a CUSTOMER/PACKAGE fault, not ours:
     *
     *   not_configured        operator error, and visible on the status screen
     *   bad_portrait          the customer's photo is unusable
     *   bad_garment           the product has no usable try-on asset
     *   portrait_too_large    fixable by the customer right now
     *   garment_too_large     same
     *   renderer_rejected     a 422 — a VALIDATION problem with the payload
     *   renderer_unauthorized the API token is wrong
     *   renderer_payment_required  the account is out of credits
     *   validation_error      a measurement outside the accepted range
     */
    public const PROVIDER_FAULT_CODES = [
        // The provider's clothing-safety service is briefly down. MEASURED as the
        // dominant real-world failure: 503 `vton_safety_unavailable`.
        'renderer_safety_unavailable',
        // Cloudflare 520-527 / any other 5xx: the provider's origin is down.
        'renderer_gateway_error',
        // The provider could not be reached at all (connection reset, DNS).
        'renderer_unreachable',
        // The provider renders ONE job at a time and refused/coalesced this one.
        'renderer_busy',
        // Accepted the request but produced no image — a provider hiccup.
        'renderer_no_image',
    ];

    /** Is this render-failure code a PROVIDER fault rather than a customer one? */
    public static function isProviderFault(?string $code): bool
    {
        return $code !== null && in_array($code, self::PROVIDER_FAULT_CODES, true);
    }

    /**
     * Map a render-failure code onto a health STATE.
     *
     * `renderer_busy` is deliberately `degraded`, not `down`: the provider is
     * WORKING, just serialised, so calling it `down` in the console would send an
     * operator chasing a fault that is really normal load. Everything else in the
     * provider-fault list is a genuine fault.
     */
    public static function stateForCode(string $code): string
    {
        return $code === 'renderer_busy' ? 'degraded' : 'down';
    }

    /**
     * Record a PROVIDER-RESULT observation from the render path.
     *
     * A no-op for any code that is not a provider fault, so callers can pass the
     * result of every render without having to classify it themselves — the one
     * place that knows the vocabulary is right here.
     *
     * @param  array<string, mixed>  $result  the array returned by VtonApiRenderer::render()
     */
    public static function recordRenderFailure(array $result): void
    {
        $code = $result['code'] ?? null;

        if (! self::isProviderFault($code)) {
            return;
        }

        /*
         * A NON-FATAL WRITE. Health bookkeeping must NEVER be the reason a render
         * fails: if the table is missing (a deploy that has not migrated yet) or
         * the DB is momentarily unavailable, the render's own result — which the
         * customer needs — must still be returned unchanged.
         */
        try {
            ProviderHealthEvent::create([
                'provider' => self::PROVIDER_PIXELAPI,
                'source' => 'render',
                'state' => self::stateForCode($code),
                'http_status' => null,
                'code' => $code,
                'message' => self::truncate($result['error'] ?? null),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Could not record provider health event: ' . $e->getMessage());
        }
    }

    /**
     * The provider's own text can be long and is not ours; keep the row bounded.
     */
    private static function truncate(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $value = trim($value);

        return mb_strlen($value) > 1000 ? mb_substr($value, 0, 997) . '...' : $value;
    }
}
