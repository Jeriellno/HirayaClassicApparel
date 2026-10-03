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
        'dp_verified_at',
        'fully_paid_at',
        'ready_for_shipping_at',
        'shipped_at',
        'delivered_at',
        // Receipt fraud protection (advisory) + trusted-record verification.
        'receipt_sha256',
        'receipt_phash',
        'receipt_risk_level',
        'receipt_analysis',
        'payment_verification_method',
        'payment_verified_by',
    ];

    /*
     * Staff-only fields. Receipt fingerprints, the AI/OCR analysis and the
     * internal transaction reference are never sent to the customer (or to a
     * public URL); the admin order endpoints call withStaffFields().
     */
    protected $hidden = [
        'receipt_sha256',
        'receipt_phash',
        'receipt_risk_level',
        'receipt_analysis',
        'payment_verification_method',
        'payment_verified_by',
        'dp_reference_number',
        'balance_reference_number',
        'dp_proof_image_path',
        'full_payment_proof_image_path',
    ];

    public const STAFF_FIELDS = [
        'receipt_risk_level',
        'receipt_analysis',
        'payment_verification_method',
        'payment_verified_by',
        'dp_reference_number',
        'balance_reference_number',
        'dp_proof_image_path',
        'full_payment_proof_image_path',
    ];

    /** Reveal the staff-only fields (admin console responses only). */
    public function withStaffFields(): static
    {
        return $this->makeVisible(self::STAFF_FIELDS);
    }

    /**
     * Customer-facing payment status label. Every new order is paid in FULL;
     * '50_paid' only exists on historical 50/50 orders and stays readable.
     */
    public const PAYMENT_STATUS_LABELS = [
        'pending' => 'Pending Verification',
        'needs_review' => 'Needs Review',
        'rejected' => 'Verification Failed',
        'fully_paid' => 'Verified / Paid',
        '50_paid' => '50% Paid (legacy order)',
    ];

    protected $casts = [
        'total_amount'   => 'decimal:2',
        'dp_amount'      => 'decimal:2',
        'balance_amount' => 'decimal:2',
        'dp_submitted_at' => 'datetime',
        'balance_proof_submitted_at' => 'datetime',
        'is_demo' => 'boolean',
        'dp_verified_at' => 'datetime',
        'fully_paid_at' => 'datetime',
        'ready_for_shipping_at' => 'datetime',
        'shipped_at' => 'datetime',
        'delivered_at' => 'datetime',
        'receipt_analysis' => 'array',
    ];

    /**
     * Has this payment reference already been used on another order? Stops one
     * receipt from being submitted for two orders (dp or balance, any order).
     */
    public static function referenceInUse(string $reference, ?int $exceptOrderId = null): ?int
    {
        $normalized = strtolower(preg_replace('/\s+/', '', $reference));
        if ($normalized === '') {
            return null;
        }

        return static::query()
            ->when($exceptOrderId, fn ($q) => $q->whereKeyNot($exceptOrderId))
            ->where(function ($q) use ($normalized) {
                $q->whereRaw("lower(replace(dp_reference_number, ' ', '')) = ?", [$normalized])
                  ->orWhereRaw("lower(replace(balance_reference_number, ' ', '')) = ?", [$normalized]);
            })
            ->value('id');
    }

    /**
     * Expose public URLs of the payment proofs without a separate endpoint.
     */
    protected $appends = ['dp_proof_url', 'full_payment_proof_url', 'processing_date', 'placed_after_cutoff', 'has_payment_proof', 'is_legacy_split_payment'];

    /** The customer uploaded a receipt (without exposing where it is stored). */
    public function getHasPaymentProofAttribute(): bool
    {
        return ! empty($this->dp_proof_image_path);
    }

    /** A historical order from the removed 50% down-payment flow. */
    public function getIsLegacySplitPaymentAttribute(): bool
    {
        return (float) $this->balance_amount > 0;
    }

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

    /*
     * Receipts are PRIVATE (ReceiptStorage) and are streamed only through the
     * staff-gated proof endpoint. These attributes used to build a public
     * `/storage/...` URL out of the storage key; they now always return null so
     * no storage key or guessable path leaves the server. Kept (as null) so
     * older clients reading the key do not break.
     */
    public function getDpProofUrlAttribute(): ?string
    {
        return null;
    }

    public function getFullPaymentProofUrlAttribute(): ?string
    {
        return null;
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
