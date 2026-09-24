<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    use HasFactory;

    protected $table = 'products';

    protected $fillable = [
        'name',
        'description',
        'price',
        'category',
        'subcategory',
        'image_url',
        'display_image_url',
        'background_occasion',
        'images',
        'colors',
        'sizes',
        'size_measurements',
        'size_stocks',
        'attributes',
        'material',
        'gender',
        'featured',
        'stock',
        'canvas_drag_count',
        'try_on_count',
        'ai_tags',
        'ghost_mannequin_url',
        'garment_specifications',
    ];

    protected $casts = [
        'price'                  => 'decimal:2',
        'featured'               => 'boolean',
        'stock'                  => 'integer',
        'canvas_drag_count'      => 'integer',
        'try_on_count'           => 'integer',
        'images'                 => 'array',
        'colors'                 => 'array',
        'sizes'                  => 'array',
        'size_measurements'      => 'array',
        'size_stocks'            => 'array',
        'attributes'             => 'array',
        'ai_tags'                => 'array',
        'garment_specifications' => 'array',
    ];

}