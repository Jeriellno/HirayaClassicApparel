<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Order extends Model
{
    protected $fillable = [
        'user_id',
        'total_amount',
        'dp_amount',
        'balance_amount',
        'payment_status',
        'rejection_reason',
        'order_status',
        'courier',
        'customer_name',
        'contact_number',
        'delivery_address',
        'tracking_booking_details',
        'dp_proof_image_path',
        'full_payment_proof_image_path',
        'dp_reference_number',
        'balance_reference_number',
        'dp_submitted_at',
        'balance_proof_submitted_at',
    ];

    protected $casts = [
        'total_amount'   => 'decimal:2',
        'dp_amount'      => 'decimal:2',
        'balance_amount' => 'decimal:2',
        'dp_submitted_at' => 'datetime',
        'balance_proof_submitted_at' => 'datetime',
        'is_demo' => 'boolean',
    ];

    /**
     * Expose public URLs of the payment proofs without a separate endpoint.
     */
    protected $appends = ['dp_proof_url', 'full_payment_proof_url', 'processing_date', 'placed_after_cutoff'];

    /** Order Guidelines §1: placed at or after the cut-off (store time)? */
    public function getPlacedAfterCutoffAttribute(): bool
    {
        if (! $this->created_at) {
            return false;
        }

        $placed = $this->created_at->copy()->setTimezone(config('payments.timezone', 'Asia/Manila'));
        [$hour, $minute] = array_map('intval', explode(':', (string) config('payments.cutoff', '15:00')) + [0, 0]);

        return $placed->gte($placed->copy()->setTime($hour, $minute));
    }

    /** The store-local date this order is processed on (Y-m-d). */
    public function getProcessingDateAttribute(): ?string
    {
        if (! $this->created_at) {
            return null;
        }

        $placed = $this->created_at->copy()->setTimezone(config('payments.timezone', 'Asia/Manila'));

        return ($this->placed_after_cutoff ? $placed->addDay() : $placed)->toDateString();
    }

    public function getDpProofUrlAttribute(): ?string
    {
        return $this->dp_proof_image_path
            ? asset('storage/' . $this->dp_proof_image_path)
            : null;
    }

    public function getFullPaymentProofUrlAttribute(): ?string
    {
        return $this->full_payment_proof_image_path
            ? asset('storage/' . $this->full_payment_proof_image_path)
            : null;
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The line items that make up this order (what was actually bought).
     * Empty for legacy orders created before order_items existed — callers
     * must degrade gracefully rather than assume it is populated.
     */
    public function orderItems(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }
}
