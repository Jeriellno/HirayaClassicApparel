<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Garment extends Model
{
    protected $fillable = [
        'name',
        'category',
        'image_base64',
        'layer_order',
        'price',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'layer_order' => 'integer',
    ];

    /**
     * Get the size variants and core measurement thresholds for the garment.
     */
    public function sizes(): HasMany
    {
        return $this->hasMany(GarmentSize::class);
    }
}