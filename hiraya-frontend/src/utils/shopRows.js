/*
 * SHOP CARD ROWS — which row of the Shop's product-card listing a product goes in.
 *
 * The Shop used to render rows only for five fixed names and matched products to
 * them by the first three letters of the category. Inventory can also save
 * FORMAL_MEN, FORMAL_WOMEN and FULL_BODY (the AI auto-fill picks them too), and
 * none of those prefixes match a fixed row — so such a product appeared on Home
 * and in the Shop swipe stage (which use the unfiltered list) but NEVER in the
 * regular card listing.
 *
 * Every product now maps to exactly ONE row:
 *   - the five original rows keep their original matching rule unchanged;
 *   - formal / full-body categories get their own rows;
 *   - anything else falls into "More Pieces" instead of disappearing.
 */

const prefixMatch = (rowName) => (category) => {
  const prod = category.toLowerCase();
  const target = rowName.toLowerCase();
  return prod === target || prod.startsWith(target.slice(0, 3)) || target.startsWith(prod.slice(0, 3));
};

export const OTHER_ROW = 'More Pieces';

export const SHOP_ROWS = [
  { name: 'Tops', matches: prefixMatch('Tops') },
  { name: 'Bottoms', matches: prefixMatch('Bottoms') },
  { name: 'Footwear', matches: prefixMatch('Footwear') },
  { name: 'Outerwear', matches: prefixMatch('Outerwear') },
  { name: 'Dresses', matches: prefixMatch('Dresses') },
  { name: 'Formal Wear', matches: (category) => /formal/i.test(category) },
  { name: 'Full Outfits', matches: (category) => /full[\s_-]*body|outfit/i.test(category) },
];

/** The row a product's category belongs to ('' for a product with no category). */
export const shopRowFor = (rawCategory) => {
  const category = String(rawCategory || '').trim();
  if (!category) return '';
  return SHOP_ROWS.find((row) => row.matches(category))?.name || OTHER_ROW;
};

/** Rows that have at least one product, in display order ("More Pieces" last). */
export const rowsForProducts = (products) => {
  const present = new Set((Array.isArray(products) ? products : []).map((p) => shopRowFor(p?.category)).filter(Boolean));
  return [...SHOP_ROWS.map((row) => row.name), OTHER_ROW].filter((name) => present.has(name));
};
