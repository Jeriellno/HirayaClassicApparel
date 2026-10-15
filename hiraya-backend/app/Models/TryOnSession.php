<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class TryOnSession extends Model
{
    /*
     * SOFT DELETES: a customer's "delete" hides the session from their history;
     * staff can restore it from Customers Management when the customer asks.
     */
    use HasFactory, SoftDeletes;

    protected $table = 'try_on_sessions';

    protected $fillable = [
        'session_id',
        'user_id',
        'user_photo_base64',
        'garment_photos_json',
        // The Style Stack CATEGORY (top/bottom/dress/outerwear/footwear) of each
        // garment in `garment_photos_json`, index-aligned with it. The generated
        // render is only correct if the model is told which body region each
        // image belongs to; without this the region had to be guessed from
        // array position, so an outerwear piece could be described as an inner.
        'garment_categories_json',
        'measurements_json',
        // Derived CV geometry (scaling ratios, pose anchors, lighting brief,
        // layer order) produced by TryOnPreProcessor before the render runs.
        'render_plan_json',
        'status',
        'is_favorite',
        'history_title',
        'garment_metadata_json',
        'result_image_base64',
        // Opaque reference to the ENCRYPTED render in the private renders bucket
        // (App\Support\RenderVault). New renders store only this.
        'result_image_path',
        // Duplicate-render fingerprint (see TryOnController::renderFingerprint).
        'render_fingerprint',
        'ai_feedback',
        'error_message',
    ];

    protected $casts = [
        'session_id' => 'string',
        'is_favorite' => 'boolean',
        'garment_photos_json' => 'array',
        'garment_categories_json' => 'array',
        'garment_metadata_json' => 'array',
        'measurements_json' => 'array',
        'render_plan_json' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => 'queued',
    ];

    /*
     * Never serialise the image columns by accident (e.g. inside a relation
     * dump): renders are only handed out by the owner-checked endpoints.
     */
    protected $hidden = [
        'result_image_base64',
        'result_image_path',
        'user_photo_base64',
    ];

    protected static function booted(): void
    {
        // Permanent deletion removes the stored object too (Recently Deleted
        // purge, retention purge, account deletion).
        static::forceDeleted(function (TryOnSession $session) {
            // After commit, so a rolled-back delete never loses the stored file.
            $path = $session->result_image_path;
            $firstPass = $session->pipeline()['first_pass']['path'] ?? null;
            \Illuminate\Support\Facades\DB::afterCommit(function () use ($path, $firstPass) {
                \App\Support\RenderVault::delete($path);
                \App\Support\RenderVault::delete($firstPass);
            });
        });
    }

    /*
     * RENDER PIPELINE STATE — `render_plan_json['pipeline']`.
     *
     * A top + bottom look, or a top / outerwear over a dress, renders in two
     * provider passes (App\Support\TryOnGarmentPlan). The mode, pass order,
     * `layering` kind and `outer` piece are frozen here when the session is created, and the
     * finished first pass is recorded as an opaque RenderVault reference, so a retry
     * resumes at pass 2 instead of paying for pass 1 again. Kept inside the existing
     * JSON column (no schema change); the renderers never read this key.
     */
    public function pipeline(): array
    {
        return (array) (($this->render_plan_json ?? [])['pipeline'] ?? []);
    }

    public function isPairRender(): bool
    {
        return ($this->pipeline()['mode'] ?? null) === \App\Support\TryOnGarmentPlan::MODE_PAIR;
    }

    public function updatePipeline(array $changes): void
    {
        $plan = $this->render_plan_json ?? [];
        $plan['pipeline'] = array_merge($this->pipeline(), $changes);
        $this->update(['render_plan_json' => $plan]);
    }

    /** The render as a data URI — from the private vault, or a legacy Base64 row. */
    public function resultImage(): ?string
    {
        if ($this->result_image_path) {
            return \App\Support\RenderVault::get($this->result_image_path);
        }

        return $this->result_image_base64 ?: null;
    }

    /** Does this session have a stored render (vaulted or legacy)? */
    public function hasResultImage(): bool
    {
        return ! empty($this->result_image_path) || ! empty($this->result_image_base64);
    }

    /** Only sessions that actually carry a render (either storage form). */
    public function scopeWithRender($query)
    {
        return $query->where(function ($q) {
            $q->whereNotNull('result_image_path')->orWhereNotNull('result_image_base64');
        });
    }

    // Status constants
    public const STATUS_QUEUED = 'queued';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    /**
     * Get the user that owns the session.
     */
    public function user()
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Scope for active sessions.
     */
    public function scopeActive($query)
    {
        return $query->whereIn('status', [self::STATUS_QUEUED, self::STATUS_PROCESSING]);
    }

    /**
     * Check if session is in terminal state.
     */
    public function isTerminal(): bool
    {
        return in_array($this->status, [self::STATUS_COMPLETED, self::STATUS_FAILED]);
    }

    /**
     * Mark session as processing.
     */
    public function markProcessing(): void
    {
        $this->update(['status' => self::STATUS_PROCESSING]);
    }

    /**
     * Mark session as completed with result.
     */
    public function markCompleted(string $resultImageBase64, string $aiFeedback): void
    {
        /*
         * The render goes to the private, encrypted vault and the row keeps only
         * the opaque reference. If the vault cannot store it at all, the render
         * is kept in the legacy column rather than lost (the customer paid for it).
         */
        $path = null;
        try {
            $path = \App\Support\RenderVault::put($resultImageBase64);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('TryOnSession: render could not be vaulted: ' . $e->getMessage());
        }

        $this->update([
            'status' => self::STATUS_COMPLETED,
            'result_image_path' => $path,
            'result_image_base64' => $path ? null : $resultImageBase64,
            'ai_feedback' => $aiFeedback,
        ]);
    }

    /**
     * Mark session as failed with error.
     */
    public function markFailed(string $errorMessage, ?string $aiFeedback = null): void
    {
        $this->update([
            'status' => self::STATUS_FAILED,
            'error_message' => $errorMessage,
            'ai_feedback' => $aiFeedback,
        ]);
    }
}