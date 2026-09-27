<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class TryOnSession extends Model
{
    use HasFactory;

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
        $this->update([
            'status' => self::STATUS_COMPLETED,
            'result_image_base64' => $resultImageBase64,
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