<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One observation of the try-on provider's health.
 *
 * A row is either a periodic PROBE (the scheduler checked) or a RENDER (a real
 * fitting failed for a provider reason). See the migration for why both exist.
 */
class ProviderHealthEvent extends Model
{
    protected $fillable = [
        'provider',
        'source',
        'state',
        'http_status',
        'code',
        'message',
    ];

    protected $casts = [
        'http_status' => 'integer',
    ];

    /** States that mean "the provider is not serving renders correctly". */
    public const UNHEALTHY_STATES = ['degraded', 'down'];

    /**
     * States that mean "the pipeline cannot render at all".
     *
     * `unconfigured` belongs here even though it is NOT an outage: a missing token
     * is a real total-render failure that an operator must see, and it is the one
     * state that makes the next action different — fix the `.env`, not wait for the
     * vendor. Keeping it out of UNHEALTHY_STATES (which drives "the PROVIDER is
     * degraded") preserves the distinction between "our config is wrong" and "the
     * vendor is broken", while still refusing to paint either one green.
     */
    public const BLOCKING_STATES = ['degraded', 'down', 'unconfigured'];

    /** Is this row evidence of a provider problem? */
    public function isUnhealthy(): bool
    {
        return in_array($this->state, self::UNHEALTHY_STATES, true);
    }
}
