/**
 * invalidateCatalog — keep every shopper-facing product list in sync after an
 * admin writes to the catalog.
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin and superadmin consoles each held their catalog in LOCAL component
 * state and refreshed only THAT copy after a create/update/delete:
 *
 *     await api.post(`/admin/products/${id}`, payload);
 *     await fetchProducts();   // <- the console's own useState, nothing else
 *
 * The storefront does not read that state. It reads React Query caches, which are
 * separate and were never told anything changed. So an admin could rename a
 * product, see it renamed in their own table, and the shopper would keep seeing
 * the OLD row — measured at up to FIVE MINUTES before it corrected itself, which
 * is exactly the reported "hindi nagre-reload ang products sa users".
 *
 * TWO DIRECTIONAL PROBLEMS, BOTH FIXED BY CALLING THIS
 * ---------------------------------------------------
 *   1. STALE ON WRITE — no cache was invalidated, so `['products']` (5-minute
 *      staleTime) and `['products-featured']` (Home's own key, never invalidated
 *      by anything) kept serving pre-edit data.
 *   2. TWO KEYS FOR ONE RESOURCE — Shop reads `['products']` while Home reads
 *      `['products-featured']`. Even invalidating one would leave the other
 *      stale, so both are handled here rather than leaving that trap for the next
 *      caller.
 *
 * Both keys are invalidated together, which is what makes Shop and Home agree.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export const invalidateCatalog = (queryClient) => {
  if (!queryClient) return;

  /*
   * `invalidateQueries` marks matching queries stale AND refetches the ACTIVE
   * ones immediately, so a mounted Shop/Home repaints without a manual reload.
   * Inactive entries are simply marked stale, which is the correct behaviour:
   * they refetch on their next mount rather than costing a request now.
   */
  queryClient.invalidateQueries({ queryKey: ['products'] });
  queryClient.invalidateQueries({ queryKey: ['products-featured'] });

  /*
   * The Studio's recommendation feed is derived from the catalog, so a product
   * edit can change what it suggests. Invalidated here so a renamed or re-priced
   * piece is not still recommended under its old details.
   */
  queryClient.invalidateQueries({ queryKey: ['outfits-recommended'] });
};

export default invalidateCatalog;
