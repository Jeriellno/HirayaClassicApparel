/**
 * Which garments may be PAIRED ("pairs well with") — the frontend mirror of
 * `App\Support\GarmentPairing` in the backend, which is the copy that is
 * enforced. Keep the two in step.
 *
 * A pairing is an outfit suggestion, so both pieces must be worn on DIFFERENT
 * layers of the body:
 *
 *   top       (TOPS)                 pairs with outerwear, bottom, full
 *   bottom    (BOTTOMS)              pairs with top, outerwear
 *   outerwear (OUTERWEAR)            pairs with anything except outerwear
 *   full      (DRESSES, FULL_BODY)   pairs with outerwear and top (a bolero
 *                                    or cropped top worn over the dress)
 *   formal    (FORMAL_MEN/WOMEN)     pairs with anything except formal
 *
 * The try-on wears a dress + top or dress + outerwear pair as the dress first,
 * then the top or outerwear over it (utils/tryOnStackPlan.js), so StyleStack's
 * "Paired looks" can offer "Wear together" for it.
 */

export const MAX_PAIRS = 8;

const LAYER_BY_CATEGORY = {
  TOPS: 'top',
  BOTTOMS: 'bottom',
  OUTERWEAR: 'outerwear',
  DRESSES: 'full',
  FULL_BODY: 'full',
  FORMAL_MEN: 'formal',
  FORMAL_WOMEN: 'formal',
};

export const layerOf = (category) => {
  const key = String(category || '').trim().toUpperCase();
  return LAYER_BY_CATEGORY[key] ?? `other:${key}`;
};

export const canPair = (a, b) => {
  const la = layerOf(a);
  const lb = layerOf(b);
  if (la === lb) return false;
  if (la === 'full' || lb === 'full') {
    const other = la === 'full' ? lb : la;
    return other === 'outerwear' || other === 'top';
  }
  return true;
};

/** A product's paired ids, read from the API's `paired_products` summaries. */
export const pairedIdsOf = (product) =>
  (Array.isArray(product?.paired_products) ? product.paired_products : [])
    .map((p) => Number(p?.id))
    .filter(Boolean);
