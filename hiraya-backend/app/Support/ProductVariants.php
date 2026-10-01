<?php

namespace App\Support;

use App\Models\Product;

/**
 * Stock bookkeeping for a product's COLOR VARIANTS.
 *
 * A cart / order line names its colour in `selected_color`. When that colour is
 * one of the product's `color_variants`, the stock lives on the variant (its own
 * `size_stocks` + `stock`); otherwise it is the primary colour and the stock
 * lives on the product row exactly as before. Checkout, the rejected-payment
 * restock and the cart all go through here so the rule exists in one place.
 */
class ProductVariants
{
    /**
     * Index of the variant whose colour matches, or null for the primary colour.
     */
    public static function indexFor(Product $product, ?string $color): ?int
    {
        $needle = strtolower(trim((string) $color));
        if ($needle === '' || $needle === 'standard') {
            return null;
        }

        foreach (self::all($product) as $i => $variant) {
            if (strtolower(trim((string) ($variant['color'] ?? ''))) === $needle) {
                return $i;
            }
        }

        return null;
    }

    /**
     * Units sellable for this colour + size.
     */
    public static function available(Product $product, ?string $size, ?string $color): int
    {
        $index = self::indexFor($product, $color);

        if ($index === null) {
            $sizeStocks = self::decode($product->size_stocks);
            if ($size && array_key_exists($size, $sizeStocks)) {
                return max(0, (int) $sizeStocks[$size]);
            }

            return max(0, (int) $product->stock);
        }

        $variant = self::all($product)[$index];
        $sizeStocks = self::decode($variant['size_stocks'] ?? []);
        if ($size && array_key_exists($size, $sizeStocks)) {
            return max(0, (int) $sizeStocks[$size]);
        }

        return max(0, (int) ($variant['stock'] ?? 0));
    }

    /**
     * Add `$delta` units (negative to reserve, positive to restock) and save.
     * The caller is expected to hold a row lock on the product.
     */
    public static function adjust(Product $product, ?string $size, ?string $color, int $delta): void
    {
        $index = self::indexFor($product, $color);

        if ($index === null) {
            $sizeStocks = self::decode($product->size_stocks);
            if ($size && array_key_exists($size, $sizeStocks)) {
                $sizeStocks[$size] = max(0, (int) $sizeStocks[$size] + $delta);
                $product->size_stocks = $sizeStocks;
            }
            $product->stock = max(0, (int) $product->stock + $delta);
            $product->save();

            return;
        }

        $variants = self::all($product);
        $variant = $variants[$index];
        $sizeStocks = self::decode($variant['size_stocks'] ?? []);
        if ($size && array_key_exists($size, $sizeStocks)) {
            $sizeStocks[$size] = max(0, (int) $sizeStocks[$size] + $delta);
            $variant['size_stocks'] = $sizeStocks;
        }
        $variant['stock'] = max(0, (int) ($variant['stock'] ?? 0) + $delta);
        $variants[$index] = $variant;

        $product->color_variants = $variants;
        $product->save();
    }

    /** @return array<int, array<string, mixed>> */
    public static function all(Product $product): array
    {
        $variants = self::decode($product->color_variants);

        return array_values(array_filter($variants, 'is_array'));
    }

    /** @return array<mixed> */
    private static function decode(mixed $value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }

        return is_array($value) ? $value : [];
    }
}
