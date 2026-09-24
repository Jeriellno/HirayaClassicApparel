/**
 * The ONE canonical shape for the ['cart'] query cache.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Three different hooks used to register the SAME React Query key (`['cart']`)
 * with THREE different `queryFn` return shapes:
 *
 *   useCart         -> { items, count, total }
 *   useShopData     -> [ ...items ]              (bare array)
 *   useTryOnState   -> [ ...items ]              (bare array)
 *
 * React Query keeps ONE cache entry per key, so whichever query resolved last
 * OVERWROTE the other's shape. Opening the Shop cached a bare array; opening
 * My Bag then read `data.items` from that array — `undefined` — and normalized
 * it to `[]`, so the bag rendered "Your bag is empty" and a piece the customer
 * had just hearted appeared to VANISH. The same flip made the AI Try-On Style
 * Stack come up empty, and made the Shop heart highlight the wrong product.
 *
 * Every consumer now calls `normalizeCartPayload()` so the cache entry always
 * has the same `{ items, count, total }` shape no matter who fetched it.
 *
 * @param {unknown} payload  Raw `GET /cart` body (envelope or bare array).
 * @returns {{ items: Array, count: number, total: number }}
 */
export const normalizeCartPayload = (payload) => {
  // Legacy / degraded response: a bare array of rows.
  if (Array.isArray(payload)) {
    return {
      items: payload,
      count: payload.reduce((acc, item) => acc + Number(item?.quantity || 1), 0),
      total: 0,
    };
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];

  return {
    items,
    count: Number(payload?.count ?? items.reduce((acc, item) => acc + Number(item?.quantity || 1), 0)),
    total: Number(payload?.total ?? 0),
  };
};

export default normalizeCartPayload;
