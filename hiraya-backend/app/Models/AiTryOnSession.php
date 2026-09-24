<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiTryOnSession extends Model
{
    // 1. Payagan si Laravel na i-save ang mga columns na ito (Base64 architecture)
    protected $fillable = [
        'user_id',
        'user_photo_base64',
        'garment_photos_base64_json',
        'result_image_base64',
        'status',
        'ai_feedback'
    ];

    // 2. I-convert ang Array (ng mga damit) into JSON pag save sa DB,
    // at i-convert pabalik sa Array pag kinuha ni React.
    protected $casts = [
        'garment_photos_base64_json' => 'array',
    ];

    // Relationship para malaman kung kaninong session ito
    public function user()
    {
        return $this->belongsTo(User::class);
    }
}