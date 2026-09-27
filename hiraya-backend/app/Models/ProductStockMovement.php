<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductStockMovement extends Model
{
    protected $fillable = [
        'product_id',
        'product_name',
        'changed_by',
        'source',
        'before_stock',
        'after_stock',
        'before_size_stocks',
        'after_size_stocks',
    ];

    protected $casts = [
        'before_stock' => 'integer',
        'after_stock' => 'integer',
        'before_size_stocks' => 'array',
        'after_size_stocks' => 'array',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by');
    }
}
