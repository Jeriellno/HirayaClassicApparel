<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GarmentSize extends Model
{
    protected $fillable = [
        'garment_id',
        'size_label',
        'stock',
        'chest_bust_min',
        'chest_bust_max',
        'waist_min',
        'waist_max',
        'hips_min',
        'hips_max',
        'shoulder_width_min',
        'shoulder_width_max',
        'sleeve_length_min',
        'sleeve_length_max',
    ];

    protected $casts = [
        'stock' => 'integer',
        'chest_bust_min' => 'float',
        'chest_bust_max' => 'float',
        'waist_min' => 'float',
        'waist_max' => 'float',
        'hips_min' => 'float',
        'hips_max' => 'float',
        'shoulder_width_min' => 'float',
        'shoulder_width_max' => 'float',
        'sleeve_length_min' => 'float',
        'sleeve_length_max' => 'float',
    ];

    public function garment(): BelongsTo
    {
        return $this->belongsTo(Garment::class);
    }
}