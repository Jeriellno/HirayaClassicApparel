/**
 * Maps a product's free-text category onto one of the stack rows.
 * Moved to a standalone module to maintain Vite Fast Refresh compatibility.
 *
 * THIS IS A UI BUCKET, NOT A BODY REGION.
 * ---------------------------------------
 * It decides which row of the Style Stack carries a piece (Tops / Bottoms /
 * Dresses …). It is NEVER sent to the renderer: the render payload carries the
 * product's own catalogue label (`productCategory` in useTryOnState.js), which
 * `TryOnPreProcessor::normaliseLayer` resolves on the backend. See the note on
 * `requestBackendRender` for why that separation matters.
 *
 * IT MUST AGREE WITH `resolveCategory` IN useTryOnState.js. The two mappers are
 * applied to the same product by different surfaces — this one files the item
 * into a visible row, that one files it into the render feed — and when they
 * disagreed (this list was missing skirt/gown/cardigan/loafer/heel and the
 * purse/scarf/sunglass/wallet) the SAME garment appeared under row X
 * but was bucketed as Y for the render, so what the customer saw and what the
 * model was told could differ. The families below are therefore kept in lockstep
 * with the hook's version, including the accessory families that must never fall
 * through to `top`.
 *
 * `accessor`/`hat`/`cap` are intentionally part of the accessory test: a hat is
 * worn on a head, which is not a body region any VTON layer can dress, so it is
 * excluded from the render the same way a bag is.
 */
export const resolveStackCategory = (rawCategory) => {
  const c = String(rawCategory || '').toLowerCase();
  if (c.includes('bottom') || c.includes('pant') || c.includes('jean') || c.includes('trouser') || c.includes('short') || c.includes('skirt')) return 'bottom';
  if (c.includes('shoe') || c.includes('footwear') || c.includes('sneaker') || c.includes('boot') || c.includes('sandal') || c.includes('loafer') || c.includes('heel')) return 'footwear';
  if (c.includes('jacket') || c.includes('coat') || c.includes('outerwear') || c.includes('blazer') || c.includes('cardigan') || c.includes('hoodie')) return 'outerwear';
  /*
   * ACCESSORIES ARE TESTED AFTER EVERY GARMENT FAMILY.
   *
   * The bag/purse/jewel families have no body region, so they must be routed to
   * their own bucket rather than falling through to `top` — a bag filed as a top
   * is what made the renderer draw sleeves nobody selected.
   */
  if (
    c.includes('accessor') || c.includes('bag') || c.includes('purse') ||
    c.includes('jewel') || c.includes('watch') || c.includes('belt') ||
    c.includes('scarf') || c.includes('sunglass') || c.includes('wallet') ||
    c.includes('hat') || c.includes('cap')
  ) return 'accessories';
  if (c.includes('dress') || c.includes('gown')) return 'dress';
  return 'top';
};