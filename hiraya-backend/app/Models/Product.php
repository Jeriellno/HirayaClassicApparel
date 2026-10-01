<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    use HasFactory;

    protected static function booted(): void
    {
        static::created(function (Product $product): void {
            $product->recordStockMovement(null, (int) $product->stock, null, $product->size_stocks);
        });

        static::updated(function (Product $product): void {
            if (! $product->wasChanged(['stock', 'size_stocks'])) {
                return;
            }

            $product->recordStockMovement(
                (int) $product->getRawOriginal('stock'),
                (int) $product->stock,
                $product->decodeSizeStocks($product->getRawOriginal('size_stocks')),
                $product->size_stocks
            );
        });
    }

    protected $table = 'products';

    /*
     * `pivot` is hidden because the only pivot a product ever carries is its
     * pairing row, and the frontend needs the paired product, not the join.
     */
    protected $hidden = ['pivot'];

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
        // Other colours of this garment, each with its own photos and stock.
        'color_variants',
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
        'color_variants'         => 'array',
        'sizes'                  => 'array',
        'size_measurements'      => 'array',
        'size_stocks'            => 'array',
        'attributes'             => 'array',
        'ai_tags'                => 'array',
        'garment_specifications' => 'array',
    ];

    /**
     * The pieces an admin paired with this one ("pairs well with").
     *
     * Symmetric — see the product_pairings migration — so this one direction
     * is enough to read. Only the summary columns a "Complete the Look" card
     * needs are selected, which keeps the catalog payload small.
     */
    public function pairedProducts(): BelongsToMany
    {
        return $this->belongsToMany(Product::class, 'product_pairings', 'product_id', 'paired_product_id')
            ->select([
                'products.id',
                'products.name',
                'products.price',
                'products.category',
                'products.stock',
                'products.image_url',
                'products.display_image_url',
                'products.ghost_mannequin_url',
            ])
            ->withTimestamps();
    }

    /** Verified-purchase reviews (shown as the rating on shop cards). */
    public function reviews(): HasMany
    {
        return $this->hasMany(ProductReview::class);
    }

    public function stockMovements(): HasMany
    {
        return $this->hasMany(ProductStockMovement::class)->latest();
    }

    private function recordStockMovement(?int $beforeStock, int $afterStock, ?array $beforeSizes, mixed $afterSizes): void
    {
        ProductStockMovement::create([
            'product_id' => $this->id,
            'product_name' => $this->name,
            'changed_by' => auth()->id(),
            'source' => $this->stockMovementSource(),
            'before_stock' => $beforeStock,
            'after_stock' => $afterStock,
            'before_size_stocks' => $beforeSizes,
            'after_size_stocks' => $this->decodeSizeStocks($afterSizes),
        ]);
    }

    private function stockMovementSource(): string
    {
        $path = request()->path();

        return match (true) {
            str_contains($path, 'reject-dp') => 'Rejected payment stock restore',
            str_contains($path, 'checkout') => 'Order checkout',
            str_starts_with($path, 'api/products') => 'Inventory update',
            default => 'Stock adjustment',
        };
    }

    private function decodeSizeStocks(mixed $value): ?array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }

        return is_array($value) ? $value : null;
    }

}