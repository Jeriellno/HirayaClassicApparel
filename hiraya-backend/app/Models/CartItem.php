<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class CartItem extends Model
{
    use HasFactory;

    // Ito yung 'fillable' - pinapayagan natin si Laravel na i-save ang mga fields na ito
    protected $fillable = [
        'user_id', 
        'product_id', 
        'selected_color', 
        'selected_size', 
        'quantity'
    ];

    /**
     * Relationship: Ang isang CartItem ay pagmamay-ari ng isang Product.
     * Ito yung gagamitin natin sa Controller para makuha yung image at price ng product.
     */
    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * Relationship: Ang isang CartItem ay pagmamay-ari ng isang User.
     */
    public function user()
    {
        return $this->belongsTo(User::class);
    }
}   