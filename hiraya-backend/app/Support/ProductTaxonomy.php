<?php

namespace App\Support;

/**
 * The product categories and the subcategories each one offers.
 *
 * Mirrored by `src/constants/productCategories.js` on the frontend (the
 * Inventory form only offers these); this copy is the one that is enforced by
 * ProductRequest. Keys are the values `products.category` stores; the
 * subcategory names are stored verbatim in `products.subcategory`.
 *
 * Rows saved before subcategories existed keep `subcategory = null` (or an
 * older free-text value from the seeder). Nothing here rewrites stored data.
 */
class ProductTaxonomy
{
    public const SUBCATEGORIES = [
        'TOPS' => ['Polo Shirts', 'Casual Shirts', 'Blouses', 'Filipiniana Tops'],
        'BOTTOMS' => ['Formal Pants', 'Trousers', 'Chinos'],
        'DRESSES' => ['Casual Dresses', 'Cocktail Dresses', 'Maxi Dresses'],
        'OUTERWEAR' => ['Blazers', 'Jackets', 'Coats'],
        'FORMAL_MEN' => ['Barong Tagalog', 'Suits', 'Tuxedos', 'Formal Shirts'],
        'FORMAL_WOMEN' => ['Filipiniana Gowns', 'Terno Dresses', 'Formal Gowns'],
        'FULL_BODY' => ['Jumpsuits', 'Rompers', 'Coordinated Sets'],
    ];

    /** "Full body" / "full-body" / "FULLBODY" -> "FULL_BODY". */
    public static function normaliseCategory(?string $category): string
    {
        $key = (string) preg_replace('/[\s-]+/', '_', strtoupper(trim((string) $category)));

        return $key === 'FULLBODY' ? 'FULL_BODY' : $key;
    }

    /** True when the category has a subcategory list (one of the seven). */
    public static function hasSubcategories(?string $category): bool
    {
        return isset(self::SUBCATEGORIES[self::normaliseCategory($category)]);
    }

    /** @return array<int, string> the subcategories for a category, [] when unknown */
    public static function subcategoriesFor(?string $category): array
    {
        return self::SUBCATEGORIES[self::normaliseCategory($category)] ?? [];
    }

    /** The canonical spelling of `$subcategory` within `$category`, or null when it is not one of them. */
    public static function canonicalSubcategory(?string $category, ?string $subcategory): ?string
    {
        $needle = mb_strtolower(trim((string) $subcategory));

        foreach (self::subcategoriesFor($category) as $name) {
            if (mb_strtolower($name) === $needle) {
                return $name;
            }
        }

        return null;
    }
}
