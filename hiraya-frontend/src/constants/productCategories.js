/*
 * PRODUCT CATEGORIES AND THEIR SUBCATEGORIES — the ONE frontend list.
 *
 * `value` is what `products.category` stores (the Inventory form has always
 * saved these upper-case keys); `subcategories` are stored verbatim in
 * `products.subcategory`. The backend validates against the same list in
 * App\Support\ProductTaxonomy, so the two must change together.
 *
 * Products saved before subcategories existed have `subcategory = null`, and a
 * few seeded rows carry older free-text values ("T-Shirts"). Both stay valid:
 * nothing here rewrites stored data, the helpers below only describe it.
 */
export const PRODUCT_CATEGORIES = [
  { value: 'TOPS', label: 'Tops', subcategories: ['Polo Shirts', 'Casual Shirts', 'Blouses', 'Filipiniana Tops'] },
  { value: 'BOTTOMS', label: 'Bottoms', subcategories: ['Formal Pants', 'Trousers', 'Chinos'] },
  { value: 'DRESSES', label: 'Dresses', subcategories: ['Casual Dresses', 'Cocktail Dresses', 'Maxi Dresses'] },
  { value: 'OUTERWEAR', label: 'Outerwear', subcategories: ['Blazers', 'Jackets', 'Coats'] },
  { value: 'FORMAL_MEN', label: 'Formal — Men', subcategories: ['Barong Tagalog', 'Suits', 'Tuxedos', 'Formal Shirts'] },
  { value: 'FORMAL_WOMEN', label: 'Formal — Women', subcategories: ['Filipiniana Gowns', 'Terno Dresses', 'Formal Gowns'] },
  { value: 'FULL_BODY', label: 'Full body', subcategories: ['Jumpsuits', 'Rompers', 'Coordinated Sets'] },
];

/** A stored category in the list's key form ("Full body" / "full-body" -> "FULL_BODY"). */
export const normaliseCategory = (raw) => {
  const key = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return key === 'FULLBODY' ? 'FULL_BODY' : key;
};

/** The subcategories offered for a category ([] for an unknown or empty one). */
export const subcategoriesFor = (category) =>
  PRODUCT_CATEGORIES.find((c) => c.value === normaliseCategory(category))?.subcategories ?? [];

/** The display label for a stored category value ("FORMAL_MEN" -> "Formal — Men"). */
export const categoryLabel = (category) =>
  PRODUCT_CATEGORIES.find((c) => c.value === normaliseCategory(category))?.label
  ?? String(category || '').replace(/_/g, ' ');

/**
 * What a shop card / quick view calls a piece: its subcategory ("Barong
 * Tagalog"), else its category as before ("FORMAL MEN"), else `fallback`.
 */
export const productTypeLabel = (product, fallback = 'GARMENT') =>
  product?.subcategory || product?.category?.replace('_', ' ') || fallback;

/** Case/space-insensitive equality for stored subcategory text. */
export const sameSubcategory = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
