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

        // A colour's stock lives inside `color_variants`, so a sale, restock or
        // edit of a colour never touched `stock`/`size_stocks` and was missing
        // from Stock History. Record one movement per colour that changed.
        static::updated(function (Product $product): void {
            if ($product->wasChanged('color_variants')) {
                $product->recordVariantMovements();
            }
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

    private function recordVariantMovements(): void
    {
        $key = fn (array $v) => (string) ($v['id'] ?? mb_strtolower((string) ($v['color'] ?? '')));
        $index = function (mixed $raw) use ($key): array {
            $out = [];
            foreach ($this->decodeSizeStocks($raw) ?? [] as $variant) {
                if (is_array($variant)) {
                    $out[$key($variant)] = $variant;
                }
            }

            return $out;
        };

        $before = $index($this->getRawOriginal('color_variants'));
        $after = $index($this->color_variants);

        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $id) {
            $old = $before[$id] ?? null;
            $new = $after[$id] ?? null;
            $oldSizes = $this->decodeSizeStocks($old['size_stocks'] ?? null);
            $newSizes = $this->decodeSizeStocks($new['size_stocks'] ?? null);
            $oldStock = $old === null ? null : (int) ($old['stock'] ?? array_sum($oldSizes ?? []));
            $newStock = $new === null ? 0 : (int) ($new['stock'] ?? array_sum($newSizes ?? []));

            if ($old !== null && $new !== null && $oldStock === $newStock && $oldSizes == $newSizes) {
                continue;
            }

            $color = (string) (($new ?? $old)['color'] ?? 'Colour');
            ProductStockMovement::create([
                'product_id' => $this->id,
                'product_name' => mb_substr($this->name . ' — ' . $color, 0, 255),
                'changed_by' => auth()->id(),
                'source' => $this->stockMovementSource(),
                'before_stock' => $oldStock,
                'after_stock' => $newStock,
                'before_size_stocks' => $oldSizes,
                'after_size_stocks' => $newSizes,
            ]);
        }
    }

    private function stockMovementSource(): string
    {
        $path = request()->path();

        if (str_contains($path, 'stock-adjust')) {
            $reason = trim((string) request()->input('reason', ''));

            return mb_substr('Manual adjustment' . ($reason !== '' ? ': ' . $reason : ''), 0, 80);
        }

        return match (true) {
            str_contains($path, 'reject-dp') => 'Rejected payment stock restore',
            str_contains($path, 'reupload-dp') => 'Down payment re-upload',
            str_contains($path, '/status') && str_contains($path, 'orders') => 'Cancelled order stock restore',
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