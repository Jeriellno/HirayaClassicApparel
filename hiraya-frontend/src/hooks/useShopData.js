import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { parseVariants } from '../utils/stylistHelper';
import { normalizeCartPayload } from '../utils/cartShape';
import { notify } from '../utils/notify';
import { rowsForProducts, rowMatchesTab, shopRowFor } from '../utils/shopRows';
import { PRODUCT_CATEGORIES, sameSubcategory } from '../constants/productCategories';


/**
 * The first REAL size for a product.
 *
 * `product.sizes` arrives as either an array (`["S","M"]`) or — very commonly —
 * a plain OBJECT keyed by size (`{"L":350,"M":350}`). Indexing the object form
 * with `[0]` yields `undefined`, so the old code silently fell back to a
 * hard-coded 'M' and the heart on a Shop card added a DIFFERENT size than the
 * one chosen on the product page.
 */
const firstSizeOf = (product) => parseVariants(product?.sizes, [])[0] || 'M';

/** Same idea for colour: `product.colors` may be a bare string. */
const firstColorOf = (product) => parseVariants(product?.colors, [])[0] || 'Default';

/**
 * Do two cart/wishlist rows describe the SAME variant?
 *
 * A bag line is uniquely identified by product + size + colour, which is exactly
 * how the backend de-duplicates (`CartController::store` matches all three). The
 * heart used to match on `product_id` ALONE, so a product sitting in the bag as
 * L and M looked like one entry: hearting it deleted an arbitrary row while the
 * other remained, which is why a hearted piece appeared to come and go.
 */
const isSameVariant = (item, { productId, size, color }) => {
  const itemProductId = Number(item?.product_id ?? item?.product?.id);
  if (itemProductId !== Number(productId)) return false;

  // Only compare on the axes the caller actually specified.
  if (size != null && item?.selected_size && item.selected_size !== size) return false;
  if (color != null && item?.selected_color && item.selected_color !== color) return false;

  return true;
};

export const useShopData = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { user } = useAuth(); // 👈 Kunin ang authenticated user state

  const [activeSubCat, setActiveSubCatState] = useState('all');
  // The subcategory chip under the tabs ('' = all of the tab). A chip belongs
  // to its tab, so choosing another tab (or "Explore More") clears it.
  const [activeSubcategory, setActiveSubcategory] = useState('');
  const setActiveSubCat = useCallback((value) => {
    setActiveSubCatState(value);
    setActiveSubcategory('');
  }, []);
  const [selectedProductModal, setSelectedProductModal] = useState(null);
  const [addedSuccess, setAddedSuccess] = useState(false);

  const searchKeyword = searchParams.get('search') || '';

  // 1. Fetch Products (Public Endpoint)
  //
  // `normalizedProducts` is guaranteed to be an array even when the API returns
  // null/garbage, so every downstream `.map`/`.filter` is null-safe.
  const { data: apiProducts = [], isLoading, isError, refetch } = useQuery({
    /*
     * SHARED WITH Home.jsx — ONE KEY FOR ONE RESOURCE.
     *
     * Shop used ['products'] while Home used ['products-featured'], so the two
     * caches for the SAME endpoint could disagree, and invalidating one left the
     * other stale. Home now uses this key too, so a catalog write updates both
     * via `invalidateCatalog`.
     */
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get('/products');
      return Array.isArray(res.data) ? res.data : (res.data?.data || []);
    },
    /*
     * STALE WINDOW TRIMMED FROM 5 MINUTES TO 30 SECONDS.
     *
     * Five minutes meant a shopper who had already visited the shop kept seeing a
     * pre-edit catalog for that long even after navigating away and back, which is
     * what made an admin's change look like it "never reloaded".
     *
     * 30s keeps the endpoint cheap (admin writes ALSO invalidate this query
     * explicitly, so the common case does not wait for the window at all — the
     * timer is only the backstop for a change made by someone else's session).
     */
    staleTime: 1000 * 30,
  });

  const normalizedProducts = useMemo(
    () => (Array.isArray(apiProducts) ? apiProducts : []),
    [apiProducts]
  );

  // 2. Fetch the BAG (Protected Endpoint - May Guard Check)
  //
  // The wishlist was eradicated as a standalone store, so the shop's heart
  // toggle now reflects BAG membership. Same ['cart'] query key as useCart, so
  // the card hearts stay in sync with the My Bag badge automatically.
  const { data: cartData } = useQuery({
    queryKey: ['cart'],
    queryFn: async () => {
      const res = await api.get('/cart');
      return normalizeCartPayload(res.data);
    },
    enabled: !!user, // 👈 PIPIGILAN ang GET request kapag WALANG naka-log in (Maiiwasan ang 401 Error)
    /*
     * NO STALE WINDOW — the heart depends on this being current.
     *
     * The toggle decides add-vs-remove by looking for the row in this data. With
     * a 2-minute `staleTime`, clicks in quick succession matched against a
     * PRE-CLICK snapshot, so the toggle kept choosing "add": the backend
     * incremented quantity every time and the item never left the bag. That is
     * the piece that "was added and then vanished" — it was never removed, its
     * quantity just climbed (a single row reached qty 11 in testing).
     */
    staleTime: 0,
  });

  /*
   * Normalize defensively on read: the same `['cart']` key is written by
   * useCart and useTryOnState, so a bare-array entry (or a legacy payload) must
   * never be treated as `{ items }`. See utils/cartShape.js.
   */
  const normalizedCart = normalizeCartPayload(cartData);

  // Product IDs currently sitting in the bag — drives the filled heart state.
  //
  // NOTE the fallback order: `product_id` is the real product id, then the
  // nested product object. `item.id` is deliberately NOT used — that is the
  // cart ROW id, so matching on it lit the heart on an unrelated product.
  const bagIds = useMemo(
    () =>
      normalizedCart.items
        .map((item) => Number(item?.product_id ?? item?.product?.id))
        .filter((id) => Number.isFinite(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cartData]
  );

  // Full bag rows, kept so the heart toggle can resolve a product back to the
  // exact cart_items.id it needs to DELETE.
  const bagItems = useMemo(
    () => normalizedCart.items,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cartData]
  );

  // 3. Search Filter
  const searchedProducts = useMemo(() => {
    const source = normalizedProducts;
    if (!searchKeyword.trim()) return source;

    // NAME-ONLY MATCH. It used to also test `description` and `category`, which
    // made the field behave like a full-text filter: a shopper looking for "linen"
    // was shown pieces whose DESCRIPTION merely mentioned linen, and words like
    // "cotton" matched a paragraph rather than a garment. The search bar says
    // "Search the collection", so it matches what a shopper can actually read as
    // the product's name — anything else is filter-bar territory, not search.
    const query = searchKeyword.trim().toLowerCase();
    return source.filter((p) => (p?.name || '').toLowerCase().includes(query));
  }, [normalizedProducts, searchKeyword]);

  /*
   * 3b. Subcategory chips for the active tab (none on "All Garments").
   *
   * The list's subcategories of every category in the tab's row(s), in list
   * order, then any older stored value — each ONLY when a product in view
   * carries it, so a chip never leads to an empty collection.
   */
  const subcategoryOptions = useMemo(() => {
    const tab = String(activeSubCat || '').trim().toLowerCase();
    if (!tab || tab === 'all' || tab === 'all garments') return [];

    const inTab = searchedProducts.filter((p) => rowMatchesTab(shopRowFor(p?.category), activeSubCat));
    const known = PRODUCT_CATEGORIES
      .filter((c) => rowMatchesTab(shopRowFor(c.value), activeSubCat))
      .flatMap((c) => c.subcategories);
    const stored = inTab.map((p) => String(p?.subcategory || '').trim()).filter(Boolean);
    const ordered = [...known, ...stored];

    return ordered.filter((name, i) =>
      ordered.findIndex((other) => sameSubcategory(other, name)) === i
      && inTab.some((p) => sameSubcategory(p?.subcategory, name))
    );
  }, [searchedProducts, activeSubCat]);

  // A chip whose pieces a new search hid stops filtering, instead of leaving
  // an empty page with no chip to clear.
  const effectiveSubcategory = subcategoryOptions.find((name) => sameSubcategory(name, activeSubcategory)) || '';

  const filteredProducts = useMemo(
    () => (effectiveSubcategory
      ? searchedProducts.filter((p) => sameSubcategory(p?.subcategory, effectiveSubcategory))
      : searchedProducts),
    [searchedProducts, effectiveSubcategory]
  );

  // 4. Category Filter
  const availableCategories = useMemo(() => {
    if (!filteredProducts.length) return [];

    // Every product maps to exactly one row (see utils/shopRows.js), so a
    // product in a category outside the five original rows is still listed.
    return rowsForProducts(filteredProducts).filter((cat) => rowMatchesTab(cat, activeSubCat));
  }, [filteredProducts, activeSubCat]);

  // 5. Bag Mutation — the heart/save toggle on shop cards.
  const bagMutation = useMutation({
    mutationFn: async ({ product, customSize, customColor }) => {
      if (!product) return;

      // NOTE the field names: the cart endpoint expects selected_size /
      // selected_color, NOT the wishlist's size / color. Getting this wrong
      // silently saves every item as the server default 'M' / 'Standard'.
      const payload = {
        product_id: product.id,
        quantity: 1,
        selected_size: customSize || product.sizes?.[0] || 'M',
        selected_color: customColor || product.colors?.[0] || 'Default',
      };

      const response = await api.post('/cart', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      setAddedSuccess(true);
      setTimeout(() => setAddedSuccess(false), 2000);
    },
    onError: (err) => {
      console.error('Add to Bag Failed:', err?.response?.data || err.message);
      notify(err?.response?.data?.message || 'Could not add this piece to your bag. Please try again.', 'error');
    },
  });

  const handleAddToBag = (product, customSize = null, customColor = null) => {
    if (!user) {
      notify('Please log in to add items to your bag.');
      return Promise.reject("User not authenticated");
    }
    return bagMutation.mutateAsync({ product, customSize, customColor });
  };

  /**
   * Heart toggle — the shop-card"Save" action.
   *
   * There is a single pre-purchase container now (My Bag / cart_items), so the
   * heart is a real TOGGLE over bag membership rather than an append-only save:
   *   - not in bag  -> POST /cart            (add)
   *   - already in  -> DELETE /cart/{rowId}  (remove)
   * Either way the ['cart'] query is invalidated so My Bag and the AI Try-On
   * picker both resync instantly.
   */
  const bagToggleMutation = useMutation({
    mutationFn: async ({ product, customSize, customColor }) => {
      const productId = Number(product?.id);

      /*
       * Resolve the variant ONCE — from the caller's explicit choice when it was
       * given (product page), otherwise from the product's first REAL size.
       * `product.sizes?.[0]` returned undefined for the object shape
       * `{"L":350,"M":350}`, so every hearted piece was silently added as 'M'.
       */
      const size = customSize || firstSizeOf(product);
      const color = customColor || firstColorOf(product);

      /*
       * READ THE BAG FRESH before deciding add-vs-remove.
       *
       * The old code matched against `bagItems`, a value captured from the LAST
       * completed `['cart']` fetch. Two heart clicks in quick succession both saw
       * the pre-click snapshot, so the second click also chose "add" instead of
       * "remove": the backend incremented quantity (one row climbed to qty 11)
       * and the piece looked like it had been added and then never went away —
       * which reads as "my item vanished / the heart is broken".
       *
       * `staleTime: 0` only makes React Query re-fetch on the NEXT render; it
       * does not guarantee this mutation reads post-click data. So we pull an
       * authoritative snapshot here, and fall back to the cached rows only if
       * that request fails.
       */
      let freshItems = bagItems;
      try {
        const snapshot = await api.get('/cart');
        freshItems = normalizeCartPayload(snapshot.data).items;
      } catch {
        // Network hiccup: the cached rows are the best information we have.
        freshItems = bagItems;
      }

      // Match product + size + colour, mirroring how the backend dedupes.
      const existing = (Array.isArray(freshItems) ? freshItems : []).find((item) =>
        isSameVariant(item, { productId, size, color })
      );

      if (existing?.id) {
        /*
         * The row may have been incremented by earlier heart clicks, so a plain
         * DELETE discards the accumulated quantity — that is the intended
         * toggle: heart off means the piece leaves the bag entirely.
         */
        const res = await api.delete(`/cart/${existing.id}`);
        return { action: 'removed', data: res.data };
      }

      const payload = {
        product_id: product.id,
        quantity: 1,
        selected_size: size,
        selected_color: color,
      };
      const res = await api.post('/cart', payload);
      return { action: 'added', data: res.data };
    },
    onSuccess: (result) => {
      /*
       * The heart reflects BAG membership, so ['cart'] is the only list that can
       * go stale from this write. (The old wishlist cache was invalidated here
       * too; the wishlist is gone, so there is no second list to sync.)
       */
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      // The Studio's stack warms itself from the recommendation feed too, so a
      // bag change can alter its precedence — keep the two in lockstep.
      queryClient.invalidateQueries({ queryKey: ['outfits-recommended'] });
      setAddedSuccess(result?.action === 'added');
      setTimeout(() => setAddedSuccess(false), 2000);
    },
    onError: (err) => {
      console.error('Bag Toggle Failed:', err?.response?.data || err.message);
      notify(err?.response?.data?.message || 'Could not update your bag. Please try again.', 'error');
    },
  });

  const handleToggleBag = (product, customSize = null, customColor = null) => {
    if (!user) {
      notify('Please log in to save pieces to your bag.');
      return Promise.reject('User not authenticated');
    }
    return bagToggleMutation.mutateAsync({ product, customSize, customColor });
  };

  const handleTryOn = useCallback(
    async (product, customSize = null, customColor = null) => {
      if (!user) {
        notify('Please log in to try on items.');
        return;
      }
      try {
        await bagMutation.mutateAsync({ product, customSize, customColor });
        // NOTE: the registered Studio route is /try-on — '/aitryon' never existed
        // and silently dumped the user on the Home fallback.
        navigate('/try-on');
      } catch (error) {
        console.error("Try On Navigation Aborted due to error:", error);
      }
    },
    [user, bagMutation, navigate]
  );

  return {
    searchKeyword,
    activeSubCat,
    setActiveSubCat,
    activeSubcategory: effectiveSubcategory,
    setActiveSubcategory,
    subcategoryOptions,
    selectedProductModal,
    setSelectedProductModal,
    addedSuccess,
    bagIds,
    filteredProducts,
    availableCategories,
    isLoading,
    isError,
    refetch,
    // The wishlist no longer exists as a standalone store; this flag now just
    // reflects an in-flight bag write so cards can disable their heart while it
    // settles. Name kept for consumer compatibility.
    isWishlistPending: bagMutation.isPending || bagToggleMutation.isPending,
    handleAddToBag,
    handleToggleBag,
    handleTryOn,
  };
};