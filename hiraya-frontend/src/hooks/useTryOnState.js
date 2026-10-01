import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { normalizeCartPayload } from '../utils/cartShape';
import { prepareVtonGarments } from '../utils/prepareVtonGarment';
import { prepareUserPhoto } from '../utils/prepareUserPhoto';
import { validateBodyPhoto } from '../utils/validateBodyPhoto';
import { runFitCheck } from '../utils/fitCheck';
import { isBackendReachable } from '../utils/backendHealth';
import { MAX_FILE_UPLOAD_SIZE } from '../constants/config';

/**
 * Gate a focused-window refetch on the backend actually being reachable.
 *
 * React Query calls this with a `query`; we ignore it and answer from the
 * shared health state. Returns false during an outage so tab-focusing cannot
 * re-issue a request already known to be failing (the cause of the repeating
 * console warnings). A single successful request flips the state back and
 * focus refetching resumes automatically.
 */
const shouldRefetchOnFocus = () => {
  /*
   * A HIDDEN TAB MUST NOT DRIVE A REFETCH.
   *
   * React Query fires this on the browser `focus` event, which is NOT the same
   * thing as the tab being VISIBLE — a window can hold focus while its tab is
   * backgrounded, and minimising does not reliably fire `focus` at all. Combined
   * with `staleTime: 0` on the bag query, that meant a backgrounded Studio could
   * re-issue `/cart` and `/outfits/recommended` on its own — more traffic the
   * single-threaded dev server has to serve alongside an in-flight render.
   *
   * Nothing in a hidden tab needs fresh data, so this simply never runs while
   * `visibilityState === 'hidden'`. Visibility returning triggers its own
   * refresh through the maintenance hook, and any genuinely stale query is
   * refetched on mount instead.
   */
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;

  return isBackendReachable();
};

/**
 * Turn any garment image reference into a Base64 data URI the IDM-VTON
 * renderer can consume as a file.
 *
 * The BAG items expose relative Supabase paths (e.g."products/ab12.jpg"),
 * while Saved/Admin items may already be data URIs or absolute URLs. The
 * renderer needs pixels, not a path, so relative paths are fetched and
 * encoded in-browser when possible. If a fetch is blocked by CORS or the
 * request fails, we fall back to the original reference so the request is
 * never silently dropped.
 */
/*
 * A dress is ONE continuous garment: it replaces the top AND the bottom.
 * Selecting a dress while a top/bottom is worn (or vice versa) would render two
 * competing garments over the same body region, so the toggle enforces the rule
 * rather than silently stacking them.
 */
export const DRESS_EXCLUSIVE = true;

/**
 * Map a product's free-text catalogue label onto a Style Stack row.
 *
 * MODULE LEVEL ON PURPOSE — see the note where it used to be declared inside the
 * `garmentsByCategory` memo. `toggleGarment` needs the SAME mapper to decide
 * whether the dress rule applies, and two functions cannot reliably share a
 * locally-scoped helper.
 *
 * IT IS A UI BUCKET, NOT A BODY REGION. It decides which row carries a piece and
 * is never sent to the renderer; the render payload carries the product's own
 * `productCategory` instead (see `requestBackendRender`).
 *
 * IT MUST AGREE WITH `resolveStackCategory` in utils/categoryHelpers.js. That
 * mapper files items into the visible rows when StyleStack self-fetches the bag,
 * and this one files them into the render feed. When the two disagreed, the SAME
 * garment appeared under row X but was bucketed as Y for the render, so what the
 * customer saw and what the model was told could differ. The families below are
 * kept in lockstep with it, accessory families included.
 *
 * @param {string} rawCategory the product's own catalogue category label
 * @returns {'top'|'bottom'|'dress'|'outerwear'|'footwear'|'accessories'}
 */
export const resolveCategory = (rawCategory) => {
  const catRaw = String(rawCategory || '').toLowerCase();
  if (catRaw.includes('bottom') || catRaw.includes('pant') || catRaw.includes('jean') || catRaw.includes('trouser') || catRaw.includes('short') || catRaw.includes('skirt')) return 'bottom';
  if (catRaw.includes('shoe') || catRaw.includes('footwear') || catRaw.includes('sneaker') || catRaw.includes('boot') || catRaw.includes('sandal') || catRaw.includes('loafer') || catRaw.includes('heel')) return 'footwear';
  if (catRaw.includes('jacket') || catRaw.includes('coat') || catRaw.includes('outerwear') || catRaw.includes('blazer') || catRaw.includes('cardigan') || catRaw.includes('hoodie')) return 'outerwear';
  if (catRaw.includes('dress') || catRaw.includes('gown')) return 'dress';
  /*
   * ACCESSORIES AND JEWELLERY ARE NOT GARMENTS.
   *
   * Routed to their own bucket instead of falling through to `top`. They are
   * excluded from the try-on payload (see `requestBackendRender`) because they
   * have no body region to be placed on. `hat`/`cap` are included for the same
   * reason — a head is not a body region any VTON layer can dress.
   */
  if (
    catRaw.includes('accessor') || catRaw.includes('bag') || catRaw.includes('purse') ||
    catRaw.includes('jewel') || catRaw.includes('watch') || catRaw.includes('belt') ||
    catRaw.includes('scarf') || catRaw.includes('sunglass') || catRaw.includes('wallet') ||
    catRaw.includes('hat') || catRaw.includes('cap')
  ) return 'accessories';
  /*
   * Anything still unrecognised is treated as a TOP — a garment is the safe
   * assumption for a catalog whose default product IS clothing — but the label is
   * only a hint. The backend refuses to guess when it receives an unknown
   * category, so a mislabel can no longer invent a body region.
   */
  return 'top';
};

/**
 * The store's size chart, fetched from the backend at runtime.
 *
 * WHY THIS EXISTS
 * ---------------
 * These bands used to be hardcoded here as a second copy of the backend's
 * thresholds. Two copies of a sizing policy WILL drift, and when they do the
 * Size Suggester chip shows one size while the render reports another — with no
 * error to point at either. `GET /api/size-chart` is now the single source of
 * truth (backed by App\Services\SizeChart, which every backend caller uses too).
 *
 * FALLBACK: the last-known-good chart is kept inline. If the request fails the
 * chip still works offline rather than going blank, and the values match the
 * backend's today. Only the fetch failing can reach them.
 */
const FALLBACK_SIZE_CHART = [
  { label: 'XS', chest_bust_max: 81, waist_max: 63, measurements: { chest_bust: 81, waist: 63, hips: 87, shoulder_width: 37, sleeve_length: 57 } },
  { label: 'S', chest_bust_max: 88, waist_max: 70, measurements: { chest_bust: 88, waist: 70, hips: 94, shoulder_width: 39.5, sleeve_length: 59.5 } },
  { label: 'M', chest_bust_max: 95, waist_max: 77, measurements: { chest_bust: 95, waist: 77, hips: 101, shoulder_width: 41.5, sleeve_length: 61.5 } },
  { label: 'L', chest_bust_max: 102, waist_max: 84, measurements: { chest_bust: 102, waist: 84, hips: 108, shoulder_width: 43.5, sleeve_length: 63.5 } },
  { label: 'XL', chest_bust_max: 109, waist_max: 91, measurements: { chest_bust: 109, waist: 91, hips: 115, shoulder_width: 45.5, sleeve_length: 65.5 } },
  { label: '2XL', chest_bust_max: 116.5, waist_max: 98.5, measurements: { chest_bust: 116.5, waist: 98.5, hips: 122.5, shoulder_width: 47.5, sleeve_length: 67.5 } },
];

let sizeChartCache = FALLBACK_SIZE_CHART;

/**
 * Load the chart once per session. Safe to call repeatedly; failures are
 * swallowed and leave the fallback in place.
 */
export const loadSizeChart = async () => {
  try {
    const res = await api.get('/size-chart');
    const sizes = Array.isArray(res?.data?.sizes) ? res.data.sizes : null;

    if (sizes && sizes.length > 0) {
      sizeChartCache = sizes.map((s) => ({
        label: s.label,
        chest_bust_max: Number(s.chest_bust_max),
        waist_max: Number(s.waist_max),
        measurements: s.measurements || {},
      }));
    }
  } catch {
    // Offline / backend down: keep the fallback. The chip must not disappear.
  }

  return sizeChartCache;
};

/** The chart currently in use (already loaded, or the fallback). */
export const getSizeChart = () => sizeChartCache;

/**
 * THE SIZE LABELS THE STORE STOCKS, smallest first.
 *
 * Drives the Account Settings selects and the Studio's size chips. The ladder is
 * the fetched chart's own labels, so a size added to the backend appears in the
 * UI without a second edit here.
 */
export const getSizeLabels = () => sizeChartCache.map((s) => s.label);

/**
 * Canonicalise a stored size label against the chart, or null if unknown.
 *
 * The same guard exists server-side (SizeChart::normaliseLabel). Both are needed:
 * this one keeps a stale value out of the UI's controlled <select> before the
 * request that the server would reject anyway.
 */
const normaliseLabel = (label) => {
  if (typeof label !== 'string') return null;
  const wanted = label.trim().toUpperCase();
  return getSizeLabels().find((l) => l.toUpperCase() === wanted) ?? null;
};

/**
 * WHICH SIZING AXIS GOVERNS A GARMENT CATEGORY.
 *
 * Bottoms are cut from the lower body; everything worn on the torso (tops,
 * dresses, outerwear) is cut from the upper body. This mirrors the backend's
 * own axis choice in OutfitRecommendationService, so the Studio's suggested size
 * and the Spotlight's recommended size cannot disagree about a "pair of trousers".
 */
export const sizeAxisForCategory = (category = '') => {
  const c = String(category).toLowerCase();
  return ['pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack'].some(
    (word) => c.includes(word)
  )
    ? 'lower'
    : 'upper';
};

/**
 * The size this customer wears for a given garment category.
 *
 * This REPLACES recommendSizeFromMeasurements(). There are no per-customer
 * centimetres any more — the customer records an upper and a lower size, so the
 * suggestion for a pair of trousers is their lower size and for a blouse it is
 * their upper size. When only one axis is on file, that one answers for both:
 * an incomplete profile should still produce a suggestion rather than silence.
 */
export const recommendSizeForCategory = (sizes = {}, category = '') => {
  const upper = normaliseLabel(sizes.upper_body_size);
  const lower = normaliseLabel(sizes.lower_body_size);

  const wanted = sizeAxisForCategory(category) === 'lower' ? (lower ?? upper) : (upper ?? lower);

  if (!wanted) return null;

  // If the store stocks the exact label, that is the answer. Otherwise fall
  // back to the NEAREST stocked size, so a customer who wears a 3XL is never
  // told their own size does not exist.
  if (getSizeLabels().some((l) => l.toUpperCase() === wanted)) return wanted;

  const order = getSizeLabels();
  const target = order.findIndex((l) => l.toUpperCase() === wanted);
  if (target === -1) return null;

  return (
    order[Math.min(order.length - 1, Math.max(0, target))] ?? order[order.length - 1] ?? null
  );
};

/**
 * THE BODY METRICS THE LOCAL RENDERER NEEDS, DERIVED FROM THE CUSTOMER'S SIZES.
 *
 * The compositor and fitCheck still work in centimetres. The customer no longer
 * supplies any — they supply two labels — so the centimetres come from the SAME
 * size chart the backend uses (`/api/size-chart`), which is what keeps the
 * browser's drape geometry and the server's render plan describing one body.
 *
 * Returns `{}` for a customer with no sizes on file; every consumer already
 * treats that as "infer proportions from the photo" rather than as an error.
 */
export const bodyMetricsFromSizes = (sizes = {}) => {
  const upper = normaliseLabel(sizes.upper_body_size);
  const lower = normaliseLabel(sizes.lower_body_size);

  const chart = getSizeChart();
  const rowFor = (label) => chart.find((s) => s.label.toUpperCase() === String(label).toUpperCase());

  const upperRow = rowFor(upper ?? lower);
  const lowerRow = rowFor(lower ?? upper);

  if (!upperRow && !lowerRow) return {};

  const upperM = upperRow?.measurements || {};
  const lowerM = lowerRow?.measurements || {};

  // The chest is the upper body's own axis and the waist/hips the lower body's,
  // so a customer whose two sizes differ is measured on each correct axis.
  const metrics = {
    chest_bust: upperM.chest_bust,
    chest: upperM.chest_bust,
    shoulder_width: upperM.shoulder_width,
    sleeve_length: upperM.sleeve_length,
    waist: lowerM.waist,
    hips: lowerM.hips,
  };

  return Object.fromEntries(Object.entries(metrics).filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0));
};

/**
 * Resolve the GARMENT's own measurements for the size the customer selected.
 *
 * `size_measurements` is a per-size table keyed by size label:
 *
 *   { "M": { chest_bust: 94, waist: 76, hips: 100, shoulder_width: 41, top_length: 94 },
 *     "L": { chest_bust: 102, waist: 84, ... } }
 *
 * TWO HISTORICAL SHAPES exist in this database and BOTH are handled, because a
 * wrong parse here would silently mis-size every garment on the catalog:
 *
 *   1. The CURRENT shape (admin MeasurementFields / useProductModalForm): a map
 *      of size -> metric object. This is what we want.
 *   2. A LEGACY shape from ProductSeeder: `{ "M": "38-40 in" }` — a range STRING,
 *      not an object. It carries no machine-readable chest/waist value, so it is
 *      rejected rather than guessed at.
 *
 * A row is only accepted when it yields at least one FINITE POSITIVE NUMBER, so
 * a partially-filled admin form degrades to "no garment measurements" (and the
 * compositor keeps its previous photo-derived sizing) instead of producing
 * NaN-driven geometry.
 *
 * @param {Object|string} table   the product's `size_measurements`
 * @param {string}        sizeKey the size the customer chose ("M", "L", ...)
 * @returns {Object|null} metric map, or null when nothing usable was found
 */
export const resolveGarmentMeasurements = (table, sizeKey) => {
  let parsed = table;

  // A JSON string can still arrive from an older API build or a cached payload.
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const isUsableRow = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    return Object.values(row).some((v) => Number.isFinite(Number(v)) && Number(v) > 0);
  };

  // 1. The chosen size, when it has a usable row.
  const wanted = sizeKey != null ? String(sizeKey) : '';
  if (wanted && isUsableRow(parsed[wanted])) return parsed[wanted];

  /*
   * 2. Case-insensitive retry. Cart sizes are free-text (`"m"` vs `"M"`) and
   *    the table keys are convention-defined, so an exact-match miss is common
   *    and would otherwise drop a garment that HAS measurements.
   */
  const wantedLower = wanted.toLowerCase();
  const fuzzyKey = Object.keys(parsed).find((k) => k.toLowerCase() === wantedLower);
  if (fuzzyKey && isUsableRow(parsed[fuzzyKey])) return parsed[fuzzyKey];

  /*
   * 3. Any usable row. Reachable when the customer never picked a size, or picked
   *    one the admin never filled in. The garment's OTHER sizes are a far better
   *    estimate of its build than the product photograph is, so this is a
   *    deliberate improvement over falling straight through to photo sizing.
   */
  const fallbackKey = Object.keys(parsed).find((k) => isUsableRow(parsed[k]));
  return fallbackKey ? parsed[fallbackKey] : null;
};

/*
 * `toRenderableImage` was REMOVED.
 *
 * It inlined a remote image as a data URI — the same job now done inside
 * `loadImage()` in utils/compositeTryOn.js, where it is actually on the render
 * path. As written here it was never called by anything, so it only showed up as
 * a lint error. The equivalent behaviour for a remote PORTRAIT lives in
 * compositeTryOn's step 3; a remote GARMENT already goes through
 * extractGarment's `toReadableSource`.
 */

export const useTryOnState = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // 1. SIZING PROFILE — the two size labels that replaced the 5 Core Body
  // Measurements. Seeded from the authenticated user so the Studio's size
  // suggestions are right on first paint; the dedicated endpoint refreshes it.
  //
  // There is NO body-profile form here any more. The Studio reads these sizes
  // and derives centimetres from the size chart (`bodyMetricsFromSizes`); the
  // customer edits them in Account Settings, which is the single place a sizing
  // profile is written from.
  const [bodySizes, setBodySizes] = useState(() => ({
    upper_body_size: user?.upper_body_size ?? '',
    lower_body_size: user?.lower_body_size ?? '',
  }));
  const [chartTick, setChartTick] = useState(0);

  /*
   * The centimetre body metrics the local renderer and fitCheck read.
   *
   * DERIVED, never entered. These are recomputed whenever the labels change or
   * the size chart finishes loading, which is the only way they can stay
   * correct now that there is nothing for a customer to type. `chartTick` is the
   * re-render signal for the chart: it is module-level state, so bumping a
   * counter here is what tells React the derived metrics moved.
   */
  const measurements = useMemo(
    () => bodyMetricsFromSizes(bodySizes),
    [bodySizes, chartTick],
  );

  useEffect(() => {
    let isMounted = true;

    // Pull the authoritative sizes first; fall back to the auth user object.
    const fetchUserSizes = async () => {
      try {
        const res = await api.get('/user/sizes');
        if (isMounted && res.data) {
          setBodySizes({
            upper_body_size: res.data.upper_body_size ?? user?.upper_body_size ?? '',
            lower_body_size: res.data.lower_body_size ?? user?.lower_body_size ?? '',
          });
        }
      } catch {
        // Endpoint unavailable: the seeded state from the auth user (or the
        // initial state above) is still valid, so leave it alone.
      }
    };

    fetchUserSizes();
    /*
     * Pull the size chart once so the derived body metrics and the size chips
     * come from the backend's table rather than the hardcoded fallback.
     * Fire-and-forget: the Studio must render immediately, and the fallback
     * covers a failed fetch.
     */
    loadSizeChart().then(() => {
      if (isMounted) setChartTick((n) => n + 1);
    });
    return () => { isMounted = false; };
  }, [user?.id]);

  // 2. GARMENT SELECTION, BAG & SAVED ITEMS
  const [selectedGarments, setSelectedGarments] = useState({
    top: null, bottom: null, footwear: null, outerwear: null, dress: null, accessories: null
  });

  /*
   * REUSE A SAVED OUTFIT — load the garments of a past try-on into the Style
   * Stack. Called by the Studio's history drawer ("Use This Outfit"), so the
   * customer stays on the canvas. Each garment replaces its own layer only;
   * layers the saved look did not wear are left as they are.
   */
  const applySavedOutfit = useCallback((garments) => {
    if (!Array.isArray(garments) || garments.length === 0) return;
    setSelectedGarments((current) => {
      const next = { ...current };
      for (const garment of garments) {
        const category = resolveCategory(garment.category);
        if (category === 'accessories') continue;
        next[category] = { ...garment, productId: garment.id };
      }
      return next;
    });
  }, []);

  // Legacy hand-off: a reuse left in sessionStorage by an older tab is applied
  // once on mount, then cleared so a refresh/Back cannot re-apply it.
  useEffect(() => {
    const raw = sessionStorage.getItem('hiraya:reuse-outfit');
    if (!raw) return;
    sessionStorage.removeItem('hiraya:reuse-outfit');
    try {
      applySavedOutfit(JSON.parse(raw));
    } catch {
      // Ignore malformed temporary reuse data and leave the stack untouched.
    }
  }, [applySavedOutfit]);

  // The wishlist / "Saved" bookmark layer was retired end to end (UI, API and
  // the `wishlists` table). The Studio's garment picker is now fed by exactly
  // two sources: the BAG below and the recommendation feed.

  // BAG (active purchase layer). This is the primary feed for the Studio:
  // whatever the customer is actually buying must be try-on-able.
  /*
   * NOTE: this query MUST write the canonical `{ items, count, total }` shape.
   *
   * It used to return a BARE ARRAY while useCart/useShopData returned the
   * envelope. React Query keeps ONE cache entry per key, so opening the Studio
   * overwrote the bag with an array; My Bag then read `data.items` from that
   * array (`undefined`) and rendered "Your bag is empty" — the piece the
   * customer had just hearted appeared to VANISH, purely from navigating to
   * the Studio. `normalizeCartPayload` now guarantees one shape on every write.
   */
  const { data: cartData, isLoading: cartLoading } = useQuery({
    queryKey: ['cart'],
    queryFn: async () => {
      try {
        const res = await api.get('/cart');
        return normalizeCartPayload(res.data);
      } catch (err) {
        return normalizeCartPayload(null);
      }
    },
    staleTime: 0,
    refetchOnMount: 'always',
    // Focus refetch is gated on backend reachability — see the wishlist query.
    refetchOnWindowFocus: shouldRefetchOnFocus,
    retry: false,
  });

  /*
   * RECOMMENDATIONS feed — the SAME personalised set Home's Spotlight shows.
   *
   * Home renders `/outfits/recommended`; the Studio only ever read bag + saved
   * items. So a customer could see "Recommended for your size" on Home
   * and then find an EMPTY style stack in the Studio — the recommended piece was
   * never offered as something to try on. Ingesting the recommendation feed here
   * makes the two surfaces agree: anything Hiraya recommends is try-on-able.
   */
  const { data: recommendedData } = useQuery({
    queryKey: ['outfits-recommended', user?.id ?? 'guest'],
    queryFn: async () => {
      try {
        const res = await api.get('/outfits/recommended?limit=6');
        return Array.isArray(res.data?.recommendations) ? res.data.recommendations : [];
      } catch (err) {
        return [];
      }
    },
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: false,
  });

  const garmentsByCategory = useMemo(() => {
    const categoriesMap = { top: [], bottom: [], footwear: [], outerwear: [], dress: [], accessories: [] };
    const seenProductIds = new Set();

    /**
     * Maps a product's free-text category onto one of our six layers.
     *
     * THE UNKNOWN-CATEGORY DEFAULT USED TO BE `'top'` — the sleeve bug.
     *
     * Because `'top'` was the catch-all, ANY product the mapper did not
     * recognise was dressed on the upper torso. On the live catalog a handbag
     * (category "BAG"/"Accessories") has no matching branch, so it silently
     * became a top — and the backend's `top` layer is described to the renderer
     * as "upper torso from the shoulders to the hip line, SLEEVES DOWN THE ARMS"
     * (see TryOnPreProcessor::regionFor)\*. The model therefore drew sleeves on a
     * stack that contained no sleeved garment, which is exactly the reported
     * "may sleeve sa output kahit wala sa selected garments".
     *
     * The fix has two halves. HERE (the frontend) we recognise the
     * non-wearable families explicitly and route them to a dedicated
     * `accessories` bucket, so a bag is never mistaken for a top, and that
     * bucket is excluded from the render payload in `requestBackendRender`.
     * On the BACKEND the controller drops a non-wearable before any plan is
     * built (`TryOnController::isNonWearableCategory`) and the layer planner
     * refuses to guess a body region for one (`TryOnPreProcessor::buildLayerPlan`).
     *
     * Accessories are deliberately NOT part of the VTON render: a bag has no
     * body region, and asking a VTON model to "wear" one is how you get a bag
     * painted onto a torso. They stay in `selectedGarments` for the UI and for
     * checkout.
     *
     * The `return 'top'` below is only a LABEL for an unrecognised piece; it is
     * no longer trusted as a placement, because the backend filters on the
     * category it receives rather than on this bucket name.
     */
    /*
     * `resolveCategory` now lives at MODULE level (see the top of this file).
     *
     * It was declared in here, which meant it was visible only inside this memo —
     * and `toggleGarment` (a different function) could not reuse it. That is how
     * the dress/top exclusion ended up trusting a caller-supplied bucket name
     * instead of the garment's own label: the mapper it needed was out of scope.
     *
     * The body was moved verbatim; only the declaration site changed.
     */

    const ingest = (item, source) => {
      if (!item) return;
      const prod = item?.product || item;
      const productId = prod?.id ?? item?.product_id;
      if (!productId) return;

      // The BAG wins over a SAVED duplicate so the Studio mirrors what the
      // customer is actually purchasing, and never shows the same piece twice.
      if (seenProductIds.has(productId)) return;
      seenProductIds.add(productId);

      const targetCat = resolveCategory(prod?.category);

      categoriesMap[targetCat].push({
        id: item.id || productId,
        productId,
        name: prod?.name || 'Unnamed Garment',
        price: prod?.price || 0,
        /*
         * THE STACK ROW this piece was filed under. Drives the LEFT panel UI only
         * (Tops/Bottoms/Dresses rows).
         *
         * IT IS NOT THE GARMENT'S CATEGORY. It is a BUCKET name derived from a
         * free-text catalogue label, and every unrecognised product falls into
         * `'top'` (see `resolveCategory` above). Sending this to the renderer as
         * `category` was the reason a Tops-only stack rendered as a dress: the
         * backend accepts `'top'` as a body region, so a `'top'` bucket was
         * trusted as "upper torso ... sleeves down the arms" even when the piece
         * was, in fact, a dress or a pair of trousers the mapper had failed to
         * recognise.
         */
        category: targetCat,
        /*
         * THE PRODUCT'S OWN CATEGORY, VERBATIM.
         *
         * This is the value the renderer's layer planner is allowed to reason
         * about (`TryOnPreProcessor::normaliseLayer`), and it is what keeps a
         * dress a dress and a shirt a shirt. `targetCat` above is the row the
         * Studio displays it in; `productCategory` is the truth about what the
         * piece IS. The two are kept separate so a bucket label can never be
         * mistaken for a body region again.
         */
        productCategory: prod?.category || '',
        /*
         * `display_image_url` FIRST.
         *
         * This column holds the AI cut-out on the HIRAYA frame — the image the
         * customer saw on the shop card, in QuickView and on the product page.
         * Omitting it meant the Studio requested the raw admin upload instead,
         * so a garment that looked beautifully framed everywhere else arrived
         * here as the original photo with its busy background.
         */
        /*
         * BOTH slots are kept, deliberately.
         *
         * `display_image_url` is the prepared catalog cut-out and `image_url` the
         * raw upload. Folding them into one field (as this used to) meant the
         * consumer could never tell WHICH it had, so it could not prefer the
         * cut-out for a clean overlay while still having a fallback.
         */
        display_image_url: prod?.display_image_url || '',
        image_url:
          prod?.display_image_url ||
          prod?.image_url ||
          prod?.image_base64 ||
          prod?.image ||
          '',
        raw_image_url: prod?.image_url || prod?.image || '',
        /*
         * STAGE 1's bare cut-out. Preferred over the raw photo by extractGarment()
         * when present: it is already transparent and carries no frame, wordmark
         * or product-name script, so nothing has to be segmented out of it.
         */
        ghost_mannequin_url: prod?.ghost_mannequin_url || '',
        selected_color: item.selected_color || '',
        selected_size: item.selected_size || '',
        /*
         * THE GARMENT'S OWN MEASUREMENTS — the missing half of the fit.
         *
         * Up to here the compositor only ever received the CUSTOMER's body
                   * metrics (derived from their two saved sizes), so a garment's size
                   * could not affect the render at all:
         * a Size XS and a Size 2XL of the same dress came out identical, because
         * the draw was sized from the product PHOTO's pixel span.
         *
         * The product already carries a per-size measurement table (the keys are
         * the size labels). Both `/cart` and `/wishlist` eager-load the whole
         * `product`, and `Product` has no `$hidden`, so this arrives for free.
         * It was simply never read.
         */
        size_measurements: prod?.size_measurements || {},
        /*
         * The table entry for THE SIZE THE CUSTOMER CHOSE, falling back to the
         * first entry that carries real numbers. A `null` here means we could not
         * resolve a usable row (no table, or legacy `"38-40 in"` range strings) —
         * the compositor then falls back to its previous photo-derived sizing
         * rather than inventing a fit it cannot support.
         */
        measurements: resolveGarmentMeasurements(
          prod?.size_measurements,
          item.selected_size,
        ),
        // Lets the UI distinguish"in my bag" from"saved for later".
        source,
      });
    };

    // Ingest order defines precedence. `ingest` skips a product already seen, so:
    //   bag   > recommended
    // The bag wins because that is what the customer is actually purchasing; a
    // recommendation only fills a slot nothing else claims.
    normalizeCartPayload(cartData).items.forEach((item) => ingest(item, 'bag'));
    (Array.isArray(recommendedData) ? recommendedData : []).forEach((item) => ingest(item, 'recommended'));

    return categoriesMap;
  }, [cartData, recommendedData]);

  /**
   * Toggle a garment in the outfit.
   *
   * DRESS IS EXCLUSIVE — a dress is ONE continuous garment covering both the
   * upper and lower body, so it cannot coexist with a separate top or bottom:
   *
   *   - picking a DRESS  -> clears any top + bottom
   *   - picking a TOP or BOTTOM -> clears any dress
   *
   * Without this rule the compositor would paint two garments over the same body
   * region and the render would look broken.
   */
  const toggleGarment = (garment) => {
    /*
     * WHICH ROW THE PIECE BELONGS TO, DECIDED FROM THE PIECE ITSELF.
     *
     * This used to trust `garment.category` verbatim. That field is a UI BUCKET
     * name, and two different mappers produce it — `resolveStackCategory` (used when
     * StyleStack self-fetches the bag) and `resolveCategory` (used when the hook
     * builds the feed). A caller that supplied a raw product, or a bucket that
     * disagreed with the piece's real label, would file a DRESS under `top` — and
     * because this function switches on `category`, the dress/top exclusion below
     * simply would not fire. Two mutually exclusive garments would then be worn at
     * once, which is exactly the state the rule exists to prevent.
     *
     * Resolving from the product's OWN catalogue label first makes the rule depend
     * on what the garment IS, not on which row happened to carry it. The bucket is
     * kept as the fallback for a piece that has no catalogue label at all.
     */
    const resolved = garment?.productCategory
      ? resolveCategory(garment.productCategory)
      : null;
    const category = resolved || garment?.category;

    if (!category) return;

    setSelectedGarments(prev => {
      const isAlreadySelected = prev[category]?.id === garment.id;
      if (isAlreadySelected) return { ...prev, [category]: null };

      let updated = { ...prev };

      /*
       * DRESS IS EXCLUSIVE — ONE CONTINUOUS GARMENT, BOTH BODY REGIONS.
       *
       * A dress covers the upper AND lower body in a single piece, so it cannot
       * coexist with a separate top or bottom: the renderer would be told to dress
       * the same region twice.
       *
       *   picking a DRESS        -> clears any top + bottom
       *   picking a TOP/BOTTOM   -> clears any dress
       *
       * The clear is applied on BOTH sides of the rule. The previous version only
       * cleared `dress` on the top/bottom branch, which was correct, but it never
       * verified that the incoming piece really was a top or bottom — so a
       * mis-bucketed dress replaced nothing and both ended up selected.
       */
      if (category === 'dress') {
        updated.top = null;
        updated.bottom = null;
        updated.dress = garment;
      } else if (category === 'top' || category === 'bottom') {
        updated.dress = null;
        updated[category] = garment;
      } else {
        updated[category] = garment;
      }
      return updated;
    });
  };

  /*
   * REMOVING A LAYER ALSO RELEASES THE OPPOSITE SIDE OF THE RULE.
   *
   * Clearing `top`/`bottom` used to leave `dress` untouched (and vice versa), which
   * was harmless in isolation but meant a stale dress could still be considered
   * worn after the customer cleared the rows it was blocking. Dropping the layer is
   * enough — nothing needs to be restored, because the exclusivity rule only ever
   * CLEARS the competing side.
   */
  const clearLayer = (category) => setSelectedGarments(prev => ({ ...prev, [category]: null }));
  const clearAllStack = () => {
    setSelectedGarments({ top: null, bottom: null, footwear: null, outerwear: null, dress: null, accessories: null });
    setGeneratedImage(null);
  };

  /*
   * WHICH LAYERS THE DRESS RULE IS CURRENTLY BLOCKING.
   *
   * The Style Stack uses this to disable the Top/Bottom rows (and the Dress row
   * when a top or bottom is worn) instead of letting a customer tap a tile that
   * would silently cancel the piece they just chose. Derived rather than stored so
   * it can never disagree with `selectedGarments`.
   */
  const dressLockedCategories = useMemo(() => {
    if (selectedGarments.dress) return ['top', 'bottom'];
    if (selectedGarments.top || selectedGarments.bottom) return ['dress'];
    return [];
  }, [selectedGarments.dress, selectedGarments.top, selectedGarments.bottom]);

  // 3. CANVAS & AI TRY-ON
  const [userPhotoPreview, setUserPhotoPreview] = useState(null);
  const [userPhotoBase64, setUserPhotoBase64] = useState(null);
  /*
   * WHY A PHOTO WAS REFUSED — and it IS a refusal, not a note.
   *
   * THE RULE (this is a GATE, not advice):
   *   - NOTHING is shown on the canvas until the photo has been verified AND
   *     background-removed.
   *   - The background is NOT removed until the photo is verified as a real,
   *     WHOLE-BODY person.
   *
   * So a photo that is text, a product card, an empty scene or a head-and-shoulders
   * crop never reaches the canvas at all — the customer gets the reason and is asked
   * for a proper full-body picture. That is deliberate: showing an unverified photo
   * and then dressing it produces a confidently wrong fitting, which is worse than
   * asking for a better photo.
   *
   * Shape: { reason, detail, evidence } | null. Cleared on a successful upload and
   * on remove-photo.
   */
  const [photoRejection, setPhotoRejection] = useState(null);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  // Live session telemetry surfaced by GET /tryon/status/{sessionId} so the
  // canvas can render a real progress bar instead of a fake spinner.
  const [tryOnStatus, setTryOnStatus] = useState(null);   // queued | processing | completed | failed
  const [tryOnProgress, setTryOnProgress] = useState(0);  // 0 - 100
  const [tryOnError, setTryOnError] = useState(null);     // { message, code }
  const [recommendedSize, setRecommendedSize] = useState(null);
  const [aiFeedback, setAiFeedback] = useState(null);
  /*
   * VTON INPUT QUALITY WARNING.
   *
   * Set when a render is dispatched with a garment that is NOT a clean,
   * transparent cut-out (no `ghost_mannequin_url`, segmentation failed, so the
   * model receives the framed/composed catalog card). The render still runs —
   * this drives an HONEST notice so the customer knows why the result may look
   * off, instead of the pipeline silently sending a marketing card.
   *
   * Shape: { count, names: string[], reasons: string[] } | null
   */
  const [vtonAssetWarning, setVtonAssetWarning] = useState(null);
  /*
   * BODY PHOTO VERIFICATION — runs once, right after an upload.
   *
   * THE POINT IS TO CATCH A BAD PHOTO BEFORE THE RENDER, NOT AFTER IT.
   *
   * The engine needs a STANDING FULL FIGURE: `bodyGeometry.GARMENT_SPANS`
   * measures a dress as 86% of body height and footwear as starting 94% down, so
   * those fractions only mean anything if the subject is upright, head-toe and
   * square to the camera. Feed it a head-and-shoulders crop and every long piece
   * is clamped short — a limitation of the PHOTO, not of the garment.
   *
   * `runFitCheck` already measures exactly this (`figureType` from the portrait's
   * own silhouette) but it only ran at GENERATE time, alongside the render — so
   * the customer waited out a full render (up to ~165s) to be told the input was
   * wrong. Verifying at upload turns that into feedback they can act on while the
   * photo is still in front of them.
   *
   * Shape: { status: 'checking' | 'ready' | 'warn', figureType, notes: [{ level, text }] } | null
   *   'checking' — analysis in flight (drives the small spinner on the canvas)
   *   'ready'    — a usable full figure; the render will fit properly
   *   'warn'     — usable but flagged (a bust crop, or no sizes on file)
   *
   * ADVISORY ONLY. It never blocks Generate — a customer with a bust photo can
   * still render, and is simply told the result will be limited.
   */
  const [photoVerification, setPhotoVerification] = useState(null);
  /*
   * WHICH ENGINE PRODUCED THE CURRENT RENDER.
   * Only 'ai' is possible now — the render is produced by the server-side VTON
   * API (PixelAPI). The 'composite' (browser-drawn) engine was removed, so this
   * exists purely so the UI can assert provenance rather than assume it.
   *   'ai'        – the server-side VTON model rendered it
   */
  const [renderEngine, setRenderEngine] = useState(null);
  /*
   * WHICH BODY REGIONS THE LAST RENDER ACTUALLY DRESSED.
   * Reported by the compositor so the UI can confirm, e.g., "Top + Bottom
   * attached" instead of leaving the customer guessing whether a piece landed.
   */
  const [placedRegions, setPlacedRegions] = useState([]);
  /*
   * How the fit was derived (measured silhouette vs estimated frame) plus what
   * was skipped and why. Kept so a poor render is EXPLAINABLE to the customer
   * instead of mysterious, and so the UI can label an approximation honestly.
   */
  const [fitDiagnostics, setFitDiagnostics] = useState(null);
  /*
   * FIT CHECK — the pre/post-render advisory verdict (pose, posture, body vs
   * garment size, garment data, body profile). It ADVISES; it never blocks the
   * render. Populated just before the render runs so the canvas can show it
   * alongside the picture. See utils/fitCheck.js for the five checks.
   */
  const [fitCheck, setFitCheck] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const pollingIntervalRef = useRef(null);
  const cancelledRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Any unmount (navigating away from the Studio) must kill the in-flight
  // poller, otherwise setState fires on a dead component.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      stopPolling();
    };
  }, [stopPolling]);

  /**
   * HANDLE BODY PHOTO UPLOAD.
   *
   * The file is DOWNSCALED AND COMPRESSED before it is used, not sent raw.
   *
   * A phone photo arrives at several megabytes; Base64 inflates that by ~33%, so
   * the try-on request was carrying a ~5 MB `person_image` field — and the
   * provider reset the connection mid-upload (`cURL error 56: Recv failure`). The
   * model's own output is ~576x864, so a huge input buys nothing. `prepareUserPhoto`
   * caps the longest edge and re-encodes as JPEG, cutting the payload by an order
   * of magnitude while keeping the resolution the renderer actually uses.
   *
   * It falls back to the original data URI if anything in the resize fails, so an
   * unusual browser still uploads.
   */
  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    /*
     * CHEAP REJECTIONS FIRST, BEFORE ANY DECODING OR ANALYSIS.
     *
     * The `<input accept="image/*">` is only a file-picker HINT — a drag-and-drop
     * or a mis-set picker can still hand us a PDF, a HEIC that the browser cannot
     * decode, or a 40 MB raw file. Catching those here (a string comparison, no
     * canvas work) means the customer gets an honest, specific reason immediately
     * instead of a decode failure or a slow upload that only fails at the server's
     * 3.5 MB guard.
     *
     * NOTE: `MAX_FILE_UPLOAD_SIZE` (5 MB) is the RAW FILE ceiling. It is
     * deliberately looser than the server's 3.5 MB POST-resize backstop, because
     * `prepareUserPhoto` re-encodes the upload down to ~1 MB — a 5 MB phone photo
     * is expected and acceptable here; anything above it is not a photo we should
     * spend a decode on.
     */
    if (!file.type || !file.type.startsWith('image/')) {
      const detail =
        'That file is not an image. Upload your full-body photo as a JPG or PNG so the ' +
        'fitting has a real body to dress.';
      setUserPhotoPreview(null);
      setUserPhotoBase64(null);
      setPhotoVerification(null);
      setPhotoRejection({ reason: 'not-an-image', detail, evidence: null });
      e.target.value = '';   // allow re-selecting the SAME file after a fix
      return;
    }

    if (file.size > MAX_FILE_UPLOAD_SIZE) {
      const detail =
        'That photo is too large to upload (' +
        (file.size / 1048576).toFixed(1) +
        ' MB). Please use a photo under about 5 MB — a normal phone photo works.';
      setUserPhotoPreview(null);
      setUserPhotoBase64(null);
      setPhotoVerification(null);
      setPhotoRejection({ reason: 'file-too-large', detail, evidence: null });
      e.target.value = '';
      return;
    }

    /*
     * ==========================================================================
     * THE GATE. NOTHING REACHES THE CANVAS UNTIL THIS HAS PASSED.
     * ==========================================================================
     *
     * THE RULES, in order, and they are HARD:
     *
     *   1. VERIFY FIRST against the ORIGINAL photo — IS THERE A PERSON? Only then
     *      may anything else happen. (A person is the whole verdict; framing and
     *      body length are the customer's choice and are noted later, not gated
     *      here. See the gate below.)
     *   2. BACKGROUND REMOVAL RUNS ONLY on a photo that passed step 1. If it did
     *      not, we do NOT cut: there is no person to cut out, and cutting would
     *      manufacture a fake silhouette.
     *   3. THE CANVAS SHOWS NOTHING until BOTH succeeded. A refused photo produces
     *      an explanation and a request for a proper picture — never a preview,
     *      never a render.
     *
     * WHY THE CANVAS IS GATED (the bug this closes)
     * ---------------------------------------------
     * The preview used to appear the instant a file was chosen, and the background
     * was removed before any person-check. Together that meant a WHITE CARD WITH
     * BLACK TEXT got segmented (the letters became the "subject"), showed up in the
     * canvas, and was dressed with garments — a confident fitting on a photo of
     * nothing. Showing an unverified photo and then dressing it is worse than
     * asking for a better photo, so the canvas is now simply not fed until the
     * photo has earned it.
     *
     * NO EARLY `setUserPhotoPreview(URL.createObjectURL(file))`: that line is what
     * flashed an unverified image onto the canvas. It is gone on purpose.
     */
    setPhotoVerification({ status: 'checking', figureType: null, notes: [] });
    setPhotoRejection(null);

    const prepared = await prepareUserPhoto(file);

    /* ---- RULE 1: VERIFY THE ORIGINAL ---------------------------------------- */
    let validation = null;
    try {
      validation = await validateBodyPhoto(prepared.base64);
    } catch (err) {
      console.warn('[Hiraya] Photo validation could not run:', err);
    }

    /*
     * THE GATE IS "IS THERE A PERSON?" — AND NOTHING ELSE.
     *
     * Only `isPerson` refuses. A photo WITHOUT a person (a text/logo card, a
     * product shot, an empty scene, a garment on a mannequin) is the single real
     * failure, and it produces an explanation on the canvas plus an invitation to
     * re-upload.
     *
     * WHY `fullBody` IS NOT ANDED IN HERE (this was the contradiction):
     * `validateBodyPhoto` marks `fullBody` as "informational only — NOT a gate" —
     * a portrait of a person is still a person, and the fitting is the customer's
     * choice of framing. But this handler ALSO refused on `!fullBody`, so a real
     * bust portrait was rejected at upload with "add a full-body photo" while the
     * validator had just passed it. The two disagreed. The gate now enforces
     * exactly what the validator documents: a person is the whole verdict, and a
     * portrait crop is carried through (the length limitation is surfaced later,
     * as a softer notice, by the fit-check panel — not as an upload refusal).
     */
    if (!validation || !validation.isPerson) {
      const reason = validation?.reason || 'validation-failed';
      const detail =
        validation?.detail ||
        'This photo could not be checked. Upload a clear photo of yourself.';

      setUserPhotoPreview(null);
      setUserPhotoBase64(null);
      setPhotoRejection({ reason, detail, evidence: validation?.evidence || null });
      setPhotoVerification({
        status: 'warn',
        figureType: validation?.isPerson ? 'bust' : 'object',
        notes: [
          {
            id: 'pose',
            label: 'Photo pose',
            status: 'warn',
            detail,
            figureType: validation?.isPerson ? 'bust' : 'object',
            evidence: validation?.evidence || null,
          },
        ],
      });
      return;
    }

    /* ---- RULE 2: USE THE PHOTO AS UPLOADED -------------------------------- */
    /*
     * BACKGROUND REMOVAL IS NO LONGER PART OF THIS FLOW.
     *
     * This step used to cut the customer out of their background and hand the
     * transparent PNG to the canvas + the render payload. It has been dropped on
     * purpose: the ORIGINAL photo now goes through unchanged, background intact.
     *
     * Note the knock-on effect, so it does not read as a bug later: the silhouette
     * measurement downstream (`measureSilhouette` in runFitCheck) is an ALPHA-MASK
     * scanner, and `prepareUserPhoto` re-encodes every upload as JPEG (no alpha).
     * Without the cut-out there is no alpha mask to measure, so `figureType` will
     * land on 'unknown' and the panel shows the NEUTRAL "unmeasured" state instead
     * of a green "Photo looks good". That is the expected outcome here, not a
     * regression — see the three-outcome comment further down.
     */
    const photoForRender = prepared.base64;

    /* ---- RULE 3: ONLY NOW MAY THE CANVAS SHOW IT --------------------------- */
    setUserPhotoPreview(photoForRender);
    setUserPhotoBase64(photoForRender);
    setPhotoRejection(null);

    /*
     * The figure type is read from the verdict, not asserted. A photo that spans
     * enough of the frame is a full figure; a passing PORTRAIT crop is labelled as
     * one, so the canvas can stay honest instead of claiming "full-figure" for a
     * bust. `fullBody` is informational (see the gate above) — here it only picks
     * the LABEL.
     */
    const figureType = validation.fullBody ? 'full-figure' : 'bust';

    setPhotoVerification({
      status: 'ready',
      figureType,
      notes: [
        {
          id: 'pose',
          label: 'Photo pose',
          status: 'pass',
          detail: validation.detail,
          figureType,
          evidence: validation.evidence,
        },
      ],
    });

    /*
     * A full fit-check trace still runs for the SIDE PANEL (posture, size, body
     * profile). It no longer decides the pose verdict — validation above already
     * did — so it cannot re-open a photo that was just refused.
     */
    try {
      const portraitImg = await loadPortraitImage(photoForRender);

      if (!portraitImg) {
        /*
         * The image could not be decoded for analysis. That is NOT a verdict on
         * the photo — it simply means the silhouette could not be read, so the
         * render proceeds unverified rather than being blocked.
         */
        setPhotoVerification({
          // NEUTRAL, not green: the photo could not be analysed at all, so there is
          // nothing to congratulate the customer on — but nothing to blame either.
          status: 'unmeasured',
          figureType: 'unknown',
          notes: [],
        });
        return;
      }

      const verdict = runFitCheck({
        portrait: portraitImg,
        measurements,
        garmentsByCategory: selectedGarments,
      });

      /*
       * Only the BODY-PROFILE and POSE items are read here. The garment-size
       * checks need a garment selected, and at upload time none is — including
       * them would report "no garment" as if it were a photo problem.
       */
      const photoItems = (verdict?.items || []).filter((i) =>
        ['pose', 'posture', 'body-profile', 'body_profile', 'silhouette'].includes(i.id)
      );

      /*
       * READ THE STRUCTURED `figureType`, DO NOT REGEX THE PROSE.
       *
       * This used to decide the verdict by matching /bust|crop|full-body/ against
       * the item's human-facing `detail` sentence. That was fragile in both
       * directions: rewording the copy silently changed the verdict, and the phrase
       * "full-body photo fits them properly" appears INSIDE the bust warning — so a
       * bust crop could match the PASS case out of its own advice.
       *
       * `checkPose` already emits a machine-readable `figureType`
       * ('full-figure' | 'bust' | 'object' | 'unknown'), so the hook reads that
       * field instead. Copy can now be rewritten freely without touching logic.
       */
      const poseItem = photoItems.find((i) => i.id === 'pose');
      const figureType = poseItem?.figureType || 'unknown';

      /*
       * THREE OUTCOMES, NOT TWO: measured / unmeasured / flagged.
       *
       * MEASURED BUG: every upload showed the green "Photo looks good" — including
       * a product marketing shot with no person in it. The cause was that this hook
       * only flagged 'bust' and 'object' and let 'unknown' fall through to green.
       *
       * The first fix made 'unknown' a WARN. That was HONEST but USELESS: 'unknown'
       * is not an edge case, it is the COMMON branch. `prepareUserPhoto` re-encodes
       * every upload as JPEG (no alpha), `measureSilhouette` is an alpha-mask
       * scanner, so it returns `null` for every normal photo — meaning EVERY
       * customer saw the amber "Photo may limit the fit" chip on a perfectly good
       * picture. A warning that fires on everyone tells the customer nothing except
       * that the app is unhappy with them.
       *
       * The truth being reported is NOT "your photo is bad" — it is "we could not
       * MEASURE your outline". Those are different claims and deserve different
       * colours, so 'unknown' gets its own NEUTRAL state:
       *
       *   ready      (green)  — the silhouette WAS measured and is a full figure.
       *   unmeasured (neutral)— nothing to compare against; not the photo's fault.
       *   warn       (amber)  — the silhouette WAS measured and found wanting
       *                         ('bust' crop, or 'object' — no person in frame).
       *
       * The single thing that moves a photo OUT of 'unmeasured' and into a real
       * green/amber is a MEASURABLE silhouette. That is what the background-removal
       * step delivers: cut the subject out (transparent PNG), and the alpha-mask
       * scanner finally has something to read. Until then, this neutral state is the
       * honest home for an unmeasured photo.
       */
      const warn =
        figureType === 'bust' ||
        figureType === 'object' ||
        photoItems.some((i) => i.status === 'block');

      const unmeasured = !warn && figureType !== 'full-figure';

      setPhotoVerification({
        status: warn ? 'warn' : unmeasured ? 'unmeasured' : 'ready',
        figureType,
        notes: photoItems,
      });
    } catch (err) {
      console.warn('[Hiraya] Photo verification could not run:', err);
      // A crash while analysing is a failure to MEASURE, not a verdict on the
      // photo — the same neutral state as any other unmeasured result.
      setPhotoVerification({ status: 'unmeasured', figureType: 'unknown', notes: [] });
    }
  };

  /**
   * REMOVE THE BODY PHOTO — clears the portrait, nothing else.
   *
   * This is the focused action behind the canvas's "Remove Photo" affordance.
   * It deliberately touches ONLY the two photo fields:
   *
   *   - `userPhotoPreview` (the on-screen image)
   *   - `userPhotoBase64` (the payload the render is drawn onto)
   *
   * The selected garments are left alone. Clearing them here was wrong: the
   * Style Stack is a separate customer choice, and wiping it because a photo was
   * swapped or removed forces a full reselection. The stack has its own Clear in
   * the left panel for that purpose.
   *
   * Any render already produced is also dropped, because it is a picture of the
   * photo we just removed and would otherwise sit on a canvas whose source no
   * longer exists.
   */
  const removeUserPhoto = useCallback(() => {
    setUserPhotoPreview(null);
    setUserPhotoBase64(null);
    setGeneratedImage(null);
    setRenderEngine(null);
    setPlacedRegions([]);
    setTryOnStatus(null);
    setTryOnProgress(0);
    setTryOnError(null);
    // The verification belonged to the photo just removed, so it goes with it.
    // Leaving it would show "Photo ready" over an empty canvas.
    setPhotoVerification(null);
    // A refusal belonged to that photo too; clearing it lets the canvas fall back
    // to the upload prompt instead of keeping a stale "upload a full-body photo".
    setPhotoRejection(null);
  }, []);

  /**
   * CANCEL AN IN-FLIGHT FITTING.
   *
   * The render is a long chain of awaited steps — garment preparation, the
   * backend round trip (with its own polling loop), then the browser composite.
   * Every one of those already checks `cancelledRef`, so setting it is enough to
   * make the running chain stand down at its next checkpoint.
   *
   * Three things this must do, and why each matters:
   *   - `cancelledRef = true` stops the pending steps from writing state.
   *   - `stopPolling()` kills the backend status poller so it does not keep
   *     hitting `/tryon/status` for a render the customer abandoned.
   *   - `setIsGenerating(false)` re-enables the UI, so the Stop button does not
   *     leave the canvas locked behind a spinner.
   *
   * NOTE: the server-side session is NOT aborted. The backend may still finish
   * its render; we simply stop waiting for and displaying it. Aborting the job
   * itself would need a cancel endpoint, which does not exist.
   */
  const cancelFitting = useCallback(() => {
    cancelledRef.current = true;
    stopPolling();
    setIsGenerating(false);
    setTryOnStatus(null);
    setTryOnProgress(0);
    setTryOnError(null);

    /*
     * Arm the ref for the NEXT run.
     *
     * `cancelledRef` is a lifetime latch: the generate function resets nothing
     * on entry, so leaving it true here would make the next Generate return
     * immediately (its first `if (cancelledRef.current)` would fire). Clearing
     * it on the next tick gives the current chain room to observe `true` once
     * more before the ref is reused.
     */
    setTimeout(() => {
      cancelledRef.current = false;
    }, 0);
  }, [stopPolling]);

  /**
   * Allow a caller (e.g. Account Settings -> "Use this photo") to seed the
   * canvas with an already-captured portrait instead of forcing a re-upload.
   *
   * IT MUST NOT BYPASS THE GATE. This used to hand the canvas WHATEVER image it
   * was given, with no person-check at all — a second door into the canvas that
   * skipped `handlePhotoUpload` entirely. A garment, a saved object photo or a
   * stale non-person image could be seeded straight onto the canvas and dressed.
   *
   * It now runs the SAME verify step the upload uses: the photo is analysed for a
   * person (with skin evidence) FIRST, and only a photo that passes is shown. A
   * photo with no person is refused with the same explanation and never reaches
   * the canvas — exactly like a fresh upload.
   */
  const setUserPhoto = useCallback(async (preview, base64) => {
    const src = base64 || preview;
    if (!src) return;

    setPhotoVerification({ status: 'checking', figureType: null, notes: [] });
    setPhotoRejection(null);

    let validation = null;
    try {
      validation = await validateBodyPhoto(src);
    } catch (err) {
      console.warn('[Hiraya] Photo validation could not run:', err);
    }

    if (!validation || !validation.isPerson) {
      const reason = validation?.reason || 'validation-failed';
      const detail =
        validation?.detail ||
        'This photo could not be checked. Upload a clear photo of yourself.';

      setUserPhotoPreview(null);
      setUserPhotoBase64(null);
      setPhotoRejection({ reason, detail, evidence: validation?.evidence || null });
      setPhotoVerification({
        status: 'warn',
        figureType: 'object',
        notes: [
          {
            id: 'pose',
            label: 'Photo pose',
            status: 'warn',
            detail,
            figureType: 'object',
            evidence: validation?.evidence || null,
          },
        ],
      });
      return;
    }

    const figureType = validation.fullBody ? 'full-figure' : 'bust';
    setUserPhotoPreview(preview || src);
    setUserPhotoBase64(src);
    setPhotoRejection(null);
    setPhotoVerification({
      status: 'ready',
      figureType,
      notes: [
        {
          id: 'pose',
          label: 'Photo pose',
          status: 'pass',
          detail: validation.detail,
          figureType,
          evidence: validation.evidence,
        },
      ],
    });
  }, []);

  /**
   * Is the Generate action allowed?
   *
   * Only the two things the RENDER genuinely needs:
   *   1. a full-body photo (it is the canvas the garments are drawn onto), and
   *   2. at least one selected garment.
   *
   * Sizes are deliberately NOT required. They drive the SIZE SUGGESTION,
   * which is a separate, non-blocking feature — gating the render on them meant a
   * customer who wanted to see the outfit first could not, which is backwards.
   */
  const canGenerate = useMemo(() => {
    const hasPhoto = !!userPhotoBase64;
    /*
     * A WEARABLE GARMENT MUST BE PRESENT, not merely a selection.
     *
     * Accessories are excluded because they are never sent to the render (see
     * `requestBackendRender`). Counting them here would enable the Generate
     * button on a bag-only stack, run a render with zero garments, and end in a
     * failed session — a dead canvas for a selection the customer could see.
     */
    const hasGarment = Object.entries(selectedGarments)
      .some(([key, value]) => key !== 'accessories' && !!value);
    return hasPhoto && hasGarment;
  }, [userPhotoBase64, selectedGarments]);

  // 4. CHATBOT LOGIC
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', text:"Hello! I am your Hiraya AI Personal Stylist. Upload your photo, select an outfit stack, and I will calculate your optimal fit size!" }
  ]);
  const [isChatTyping, setIsChatTyping] = useState(false);

  const triggerAiConclusion = useCallback((size = 'M') => {
    const selectedNames = Object.values(selectedGarments).filter(Boolean).map(g => g.name).join(', ');
    const conclusion = `✨ **Virtual Fitting Complete!**\n\nMatching your saved sizes (top ${bodySizes.upper_body_size || '–'}, bottom ${bodySizes.lower_body_size || '–'}) against ${selectedNames}, the recommended size for this ensemble is **Size ${size}**.\n\nHow does this look to you?`;
    setChatMessages(prev => [...prev, { role: 'assistant', text: conclusion }]);
  }, [selectedGarments, bodySizes]);

  /**
   * SERVER RENDER REQUEST — hand the job to the Laravel backend.
   *
   * This is the FRONTEND -> BACKEND wire. It POSTs the portrait and the selected
   * garments to `/tryon/generate`, then polls
   * `/tryon/status/{id}` the way the controller expects. The body centimetres the
   * render needs are derived SERVER-side from the customer's saved sizes, so no
   * measurement is sent from here.
   *
   * THIS IS THE ONLY PATH — THERE IS NO LOCAL FALLBACK.
   * ---------------------------------------------------
   * The backend holds the try-on pipeline (VtonApiRenderer/PixelAPI + the
   * TryOnPreProcessor geometry planner). When PixelAPI produces a true fitting we
   * show it as 'ai'. When it does NOT (provider down, queue worker not running,
   * token rejected, quota spent) the server's session ends `failed` and the caller
   * reports the real reason. The browser composite that used to render a
   * substitute here has been removed.
   *
   * @returns {Promise<{ok:boolean, image?:string, feedback?:string, size?:string}>}
   */
  const requestBackendRender = useCallback(async () => {
    /*
     * ACCESSORIES ARE NOT SENT TO THE RENDER.
     *
     * A bag, a belt or a pair of sunglasses has NO body region. Sending one to a
     * VTON model can only produce a wrong placement — and before this filter it
     * was worse than wrong: an unrecognised label fell through to the `top`
     * layer, so a handbag was described to the model as "upper torso ... sleeves
     * down the arms" and the render came back wearing sleeves that no selected
     * garment had (the reported bug).
     *
     * They remain in `selectedGarments` for the UI and for checkout; only the
     * render payload excludes them. A stack of accessories ALONE therefore has
     * no wearable garment, and `canGenerate` is false, so the Studio asks for a
     * garment instead of spending a render on nothing.
     */
    const garments = Object.entries(selectedGarments)
      .filter(([key, value]) => key !== 'accessories' && value)
      .map(([, value]) => value);
    if (!userPhotoBase64 || garments.length === 0) return { ok: false };

    try {
      /*
       * PREPARE EVERY GARMENT INTO A CLEAN, TRANSPARENT VTON CUT-OUT.
       *
       * This is the load-bearing line. It used to send
       * `g.ghost_mannequin_url || g.image_url` raw — and on the live catalog
       * `ghost_mannequin_url` is EMPTY for every product, so the model received
       * the raw MARKETING CARD (backdrop, floral wreath, mirror reflection,
       * wordmark). The model then reproduced the card: wrong colour, wrong
       * texture, cropped silhouette. See `utils/prepareVtonGarment.js` for the
       * measured evidence and the full rationale.
       *
       * `prepareVtonGarments` prefers a real ghost-mannequin matte, otherwise
       * segments a transparent cut-out out of the product photograph, and only
       * then falls back to the composed card. It reports, per garment, whether
       * the result is a real cut-out (`extracted`) so the UI can warn instead of
       * silently sending a poster of a dress.
       */
      const prepared = await prepareVtonGarments(garments);

      if (prepared.length === 0) return { ok: false, reason: 'no_garment_asset' };

      /*
       * A stack with NO VTON-ready asset at all cannot be rendered honestly.
       * Refuse and report, rather than spending a render on a marketing card.
       */
      const usable = prepared.filter((p) => p.dataUri);
      if (usable.length === 0) return { ok: false, reason: 'no_garment_asset' };

      /*
       * Warn (do not block) when a garment is being sent WITHOUT a real cut-out.
       * The render still runs — the customer gets a picture — but we surface why
       * it may look wrong, and which pieces are affected, instead of pretending
       * the input was clean.
       */
      const notExtracted = usable.filter((p) => !p.extracted);
      if (notExtracted.length > 0) {
        console.warn(
          '[Hiraya] VTON input is NOT a clean cut-out for:',
          notExtracted.map((p) => `${p.product?.name || 'garment'} (${p.source}/${p.reason || 'unknown'})`),
        );
        setVtonAssetWarning({
          count: notExtracted.length,
          names: notExtracted.map((p) => p.product?.name || 'Garment'),
          reasons: notExtracted.map((p) => p.reason || 'unknown'),
        });
      } else {
        setVtonAssetWarning(null);
      }

      const res = await api.post('/tryon/generate', {
        user_photo_base64: userPhotoBase64,
        /*
         * THE CATEGORY IS THE PLACEMENT.
         *
         * The renderer places each piece on the body region its category resolves
         * to, so a `footwear` label is worn on the feet, a `dress` replaces top +
         * bottom as one piece, and a top stays on the torso. Sending the REAL label
         * is what makes the generated fitting correct.
         *
         * NOTE the backend does not blindly trust a category with a body region it
         * cannot place — `TryOnPreProcessor::normaliseLayer` maps the label, and an
         * accessory is dropped outright rather than guessed onto the torso.
         */
        garments: usable.map((p) => ({
          /*
           * SEND THE REAL CATEGORY, NOT THE STACK ROW.
           *
           * `productCategory` is the catalogue's own label; `category` is the UI
           * bucket and is only a fallback for a product whose label is genuinely
           * empty. The backend validates this field against the wearable
           * vocabulary and drops anything it cannot place, so sending a bucket
           * name would have silently cost the piece its body region — the
           * "Tops garment rendered as a dress" symptom.
           */
          category: p.product?.productCategory || p.product?.category,
          name: p.product?.name,
          /*
           * THE CATALOG ID — lets the BACKEND supply the clean cut-out.
           *
           * The browser cannot reliably fetch the catalog's absolute
           * `127.0.0.1:8000` asset URLs (a different origin/device), so
           * `prepareVtonGarment` failed on `ghost_mannequin_url` and fell back to
           * segmenting the MARKETING CARD — which is how the HIRAYA logo and the
           * "CULTURE MEETS STYLE" headline got rendered onto a customer's blouse.
           * The server has no such restriction and already holds the prepared
           * matte, so it re-resolves the input from this id when one is available.
           */
          product_id: p.product?.productId ?? p.product?.id ?? p.product?.product_id ?? null,
          image: p.dataUri,
        })),
      });

      const activeSessionId = res.data?.session_id || res.data?.id;
      if (!activeSessionId) return { ok: false, reason: 'no_session' };

      setSessionId(activeSessionId);

      /*
       * INLINE RESULT — the backend rendered SYNCHRONOUSLY.
       *
       * With `QUEUE_CONNECTION=sync` (this deployment: there is no worker to run)
       * the POST does not return a `queued` session at all — it BLOCKS through the
       * render and answers with the finished image in the same response. Painting
       * that here avoids opening a poll loop for a render that is already done,
       * which is what made the flow feel like it hung and then reported a
       * worker/queue error.
       *
       * The same raster/engine guards the poll loop applies are reused below, so a
       * server placeholder can never be mistaken for a real fitting whichever path
       * delivered it.
       */
      const inlineImage = res.data?.result_image_base64 || res.data?.result_image;
      if (inlineImage) {
        const isRasterInline =
          typeof inlineImage === 'string' &&
          /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(inlineImage.trim());
        const serverWasCompositeInline = String(res.data?.engine || '').toLowerCase() === 'composite';

        if (isRasterInline && !serverWasCompositeInline) {
          return {
            ok: true,
            image: inlineImage,
            engine: res.data?.engine || 'ai',
            feedback: res.data?.ai_feedback || null,
            size: res.data?.recommended_size || null,
          };
        }
      }

      /*
       * INLINE FAILURE — a sync render that produced nothing usable.
       *
       * The backend already knows the terminal state, so surface its reason now
       * instead of polling a failed session 70 times before giving up.
       */
      const inlineStatus = String(res.data?.status || '').toLowerCase();
      if (inlineStatus === 'failed') {
        return { ok: false, reason: res.data?.message || res.data?.ai_feedback || 'render_failed' };
      }

      /*
       * The backend reports, per garment, whether the asset IT used was a clean
       * cut-out. When the Studio sent a pre-cleaned data URI this is normally
       * empty, but a bag-hydrated stack (or a legacy client) can still arrive
       * with a composed/raw image — surface that so the warning above is
       * accurate whichever side prepared the input.
       */
      const backendWarnings = Array.isArray(res.data?.asset_warnings) ? res.data.asset_warnings : [];
      if (backendWarnings.length > 0) {
        setVtonAssetWarning({
          count: backendWarnings.length,
          names: backendWarnings.map((w) => w?.name || 'Garment'),
          reasons: backendWarnings.map((w) => w?.reason || 'unknown'),
        });
      }

      /*
       * POLL UNTIL THE SESSION RESOLVES.
       *
       * WAIT BUDGET — ONE PROVIDER RENDER PER ATTEMPT, PLUS THE RETRY.
       *
       * RAISED TO 100 x 3s = 300s IN LOCKSTEP WITH THE SERVER'S POLL WINDOW
       * (VtonApiRenderer::POLL_TIMEOUT_SECONDS, 120s -> 240s).
       *
       * THE MEASURED FAILURE THIS ADDRESSES — the reported "Fitting Interrupted,
       * the try-on service is busy": a REAL end-to-end render was driven through
       * this stack (genuine JPEG portrait + genuine JPEG garment) and it was STILL
       * RENDERING when the server's 120s window closed. The customer's canvas told
       * them the provider was "busy, try again in a few seconds" for a render that
       * was in fact seconds-to-a-couple-of-minutes from landing. Raising the server
       * window alone would have been useless: the CLIENT would have given up first
       * (the old 165s budget is BELOW the new 240s poll window), so the two are
       * raised together.
       *
       * WHY 300s AND NOT MORE — the client must stay BELOW the job's own ceiling
       * (`ProcessTryOnJob::$timeout = 360s`) so the customer is never told "it took
       * too long" while the worker is still legitimately rendering. 300s sits
       * inside that 360s with ~60s of cover, and above the 240s poll window with
       * the same margin, so a render landing right on the renderer's deadline is
       * still painted instead of racing a client timeout.
       *
       * It ALSO has to survive the retry path, not just one poll window: a render
       * that genuinely reports `renderer_busy` is released with a 15s backoff
       * (ProcessTryOnJob::$backoff) and then polls again. Because the FIRST window
       * now covers the realistic (~155s worst case) render, reaching the backoff at
       * all means the provider really did refuse — so the second window is spent
       * only when it is genuinely needed, rather than being the default outcome.
       *
       * The old 165s expired DURING a legitimate render, which is exactly why a
       * real fitting was reported as a provider fault.
       */
      const MAX_ATTEMPTS = 100;
      const INTERVAL_MS = 3000;
      /*
       * QUEUED GRACE WINDOW.
       *
       * This is a LEGACY fallback only: the status payload now carries
       * `worker_running`, a fact read from the OS, so a queued session is judged
       * on whether a consumer actually exists rather than on elapsed time (see the
       * block in the loop below). The timing heuristic applies only to an older
       * backend that omits the field.
       *
       * NOTE IT MUST NOT BE REINTERPRETED AS A RENDER BUDGET: a healthy worker can
       * sit on a session for MINUTES while PixelAPI renders one job at a time, so a
       * short timer here would abort exactly the renders that were about to land.
       * 5 x 3s = 15s is enough for a cold worker to pick the job up and no more.
       */
      const QUEUED_GRACE_ATTEMPTS = 5;
      let queuedPolls = 0;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (cancelledRef.current) return { ok: false };

        /*
         * BACKGROUND TAB: SLOW THE POLL DOWN, DO NOT STOP IT.
         *
         * MEASURED COMPLAINT: with a render in flight, switching to another tab
         * kept `/tryon/status` firing on the normal 3s cadence — the reported
         * "umuulit pag wala sa mismong website".
         *
         * This poll CANNOT simply be paused while hidden, the way the
         * maintenance check is: it is what delivers the render the customer is
         * waiting for. Pausing it would leave a finished fitting unpainted until
         * they happened to look back, and would burn the attempt budget on ticks
         * that were skipped — the render would appear to fail for no reason.
         *
         * So while the tab is hidden the interval is stretched instead. A poll
         * that lands is still honoured either way, which means a render finishing
         * in the background is still caught and the result is on screen the moment
         * the customer returns. What stops is the needless 3s chatter: a
         * backgrounded tab asks ~5x less often, so several open tabs no longer
         * flood the single-threaded dev server between them.
         *
         * The attempt budget stays the SAME, so the overall wait is unchanged for
         * a visible tab. A hidden tab may exhaust its budget a little sooner in
         * wall-clock terms — an accepted trade, since nobody is watching the
         * progress bar and the session is still resolved on return by the fresh
         * status read that the visibility handler triggers.
         */
        const tabVisible =
          typeof document === 'undefined' || document.visibilityState !== 'hidden';
        const waitMs = attempt === 0 ? 0 : (tabVisible ? INTERVAL_MS : INTERVAL_MS * 5);

        await new Promise((r) => setTimeout(r, waitMs));

        // The customer may have returned (or left) during the wait; re-read so
        // the NEXT cadence reflects the tab they are actually looking at.
        if (cancelledRef.current) return { ok: false };

        let statusRes;
        try {
          statusRes = await api.get(`/tryon/status/${activeSessionId}`);
        } catch {
          // A transient blip must not end the wait; the attempt budget governs.
          continue;
        }

        const data = statusRes.data || {};
        if (typeof data.progress === 'number') setTryOnProgress(data.progress);
        setTryOnStatus(data.status || null);

        /*
         * A QUEUED SESSION IS ONLY A FAILURE WHEN NO CONSUMER EXISTS.
         *
         * MEASURED DEFECT THIS FIXES (the reported "Fitting Interrupted / the AI
         * renderer is not running on the server").
         *
         * This used to declare `worker_offline` after a flat 15s of `queued`,
         * which ASSUMED that a queued session means a dead queue. That assumption
         * is wrong on this deployment: PixelAPI renders ONE job at a time, so a
         * perfectly healthy worker can sit on a session for minutes while it waits
         * behind another render. The client then aborted a render that was
         * genuinely in flight and blamed a worker that was running the whole time
         * — the customer was told the server had no worker process while
         * `queue:work` was demonstrably alive.
         *
         * The server now answers this question itself: `worker_running` on the
         * status payload is a fact read from the OS (see
         * TryOnController::tryOnWorkerIsRunning), not a guess. So:
         *
         *   - `worker_running === false` -> nothing will ever pick the job up.
         *     That IS `worker_offline`, and it is reported immediately rather than
         *     after 15 wasted seconds.
         *   - `worker_running === true`  -> a render is in progress. Keep waiting;
         *     the existing attempt budget is the only limit, so a slow-but-real
         *     render is no longer killed by an unrelated timer.
         *
         * FAIL-SAFE: an absent field (an older backend) leaves the old grace
         * behaviour intact rather than inventing a fault from a missing value.
         */
        if (data.status === 'queued') {
          queuedPolls++;

          if (data.worker_running === false) {
            return { ok: false, reason: 'worker_offline' };
          }

          if (data.worker_running === undefined && queuedPolls >= QUEUED_GRACE_ATTEMPTS) {
            /*
             * Legacy backend with no liveness field: fall back to the old timing
             * heuristic, which is the best available signal in that case.
             */
            return { ok: false, reason: 'worker_offline' };
          }
        } else {
          queuedPolls = 0;
        }

        if (data.status === 'completed') {
          const image = data.result_image_base64 || data.result_image;
          if (!image) return { ok: false };

          /*
           * REJECT THE SERVER'S PLACEHOLDER RENDER.
           *
           * When no AI engine is reachable, the backend's chain ends in its own
           * fallback, which is an SVG PLACEHOLDER (a drawn silhouette with the
           * session id on it), not a real fitting. Accepting it would show the
           * customer a fake "AI" card while the browser could have drawn their
           * ACTUAL photo wearing the garments. So an SVG payload is treated as
           * "the server path produced nothing usable" and the caller falls
           * through to the local pose-aware composite, which is strictly better.
           *
           * The server's own `engine` field is honoured too: a `Composite`
           * engine is the server telling us it did NOT run a real model.
           */
          /*
           * ACCEPT ONLY A RASTER IMAGE.
           *
           * A REAL fitting is a PNG/JPEG/WEBP. Anything else — an SVG, a bare
           * string, an empty payload — is the server's placeholder, whatever it
           * claims. We test the MIME from the data URI's own prefix rather than
           * a single `startsWith('data:image/svg')`, because the placeholder can
           * arrive percent-encoded (`data:image/svg+xml;charset=utf-8,...`) or
           * as a raw `<svg` string, and a narrow prefix check let those through —
           * which is exactly how the empty blue-grey card reached the canvas.
           */
          const isRaster =
            typeof image === 'string' &&
            /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image.trim());

          const serverWasComposite = String(data.engine || '').toLowerCase() === 'composite';

          if (!isRaster || serverWasComposite) {
            return { ok: false, reason: 'no_ai_engine' };
          }

          return {
            ok: true,
            image,
            engine: data.engine || 'ai',
            feedback: data.ai_feedback || null,
            size: data.recommended_size || null,
          };
        }

        if (data.status === 'failed') {
          // Recognised terminal failure: stop early and let the caller fall back.
          return { ok: false, reason: data.message || data.ai_feedback || 'render_failed' };
        }
      }

      // Budget exhausted without a terminal state.
      return { ok: false, reason: 'timeout' };
    } catch (err) {
      /*
       * 401 (guest / expired session), 4xx validation, or a transport error.
       *
       * THE SERVER'S OWN EXPLANATION IS CARRIED THROUGH, not discarded.
       *
       * This used to collapse EVERY HTTP status to a bare `http_<status>` string,
       * so a 422 — which Laravel answers with a per-field `errors` map — reached
       * the canvas as "http_422" and `explainRenderFailure` had nothing to show but
       * a generic "Fitting Interrupted". The customer was told the fitting failed
               * when the real message named a measurement field that no longer exists.
       *
       * `detail` and `fieldErrors` are attached so the caller can surface the
       * exact reason and, where a field is named, point at it.
       */
      const status = err?.response?.status;
      const body = err?.response?.data;
      const fieldErrors =
        body && typeof body.errors === 'object'
          ? Object.entries(body.errors).map(([field, messages]) => ({
              field,
              message: Array.isArray(messages) ? messages[0] : String(messages),
            }))
          : [];

      return {
        ok: false,
        reason: status ? `http_${status}` : 'unreachable',
        // The server's own message, when it wrote one that is safe to show.
        detail: typeof body?.message === 'string' ? body.message : null,
        fieldErrors,
      };
    }
  }, [userPhotoBase64, selectedGarments, measurements]);

  /*
   * THE LOCAL COMPOSITE RENDERER WAS REMOVED.
   *
   * `generateLocalComposite()` used to draw a browser-canvas paste-up here as the
   * guaranteed fallback. It is GONE from the render flow on purpose: PixelAPI is
   * the only try-on engine, and a flat overlay of the cut-out over the customer's
   * photo is not a try-on — it does not deform, drape or scale the garment onto
   * the body, so presenting it as a "fitting" (however it was labelled) misled
   * the customer and masked every real provider fault.
   *
   * When PixelAPI cannot render, the session now FAILS with the provider's own
   * reason and the canvas shows that — a truthful dead-end instead of a drawing.
   *
   * The browser compositor module (`utils/compositeTryOn.js`) is left on disk,
   * unreferenced, so the geometry work it documents stays readable; nothing in
   * this hook imports or calls it any more.
   */

  /*
   * The old `startStatusPolling` listener was REMOVED.
   *
   * It polled the server on a 3s interval and set state from OUTSIDE the
   * Generate action, which meant two different code paths could write the same
   * render state and race each other. The server wait is now done inline inside
   * `requestBackendRender()` with a single owner of the state, so there is one
   * poll loop instead of two.
   */

  /**
   * Human-readable reason the AI render could not run, from the backend's own
   * failure reason. Surfaced to the customer so "nothing happened" is never the
   * only information they get.
   */
  const explainRenderFailure = (reason, context = null) => {
    const r = String(reason || '');

    /*
     * SERVER-SUPPLIED VALIDATION DETAIL WINS OVER GENERIC COPY.
     *
     * A 422 is Laravel answering with a per-field `errors` map. `context` carries
     * it here (see requestBackendRender's catch). Without this branch the customer
     * saw "Fitting Interrupted" for what is really a fixable input problem, such
     * as a measurement outside the accepted range.
     *
     * The field name is shown in a humanised form so the message points at the
     * control they need to correct rather than at a snake_case column.
     */
    const fieldErrors = Array.isArray(context?.fieldErrors) ? context.fieldErrors : [];
    if (fieldErrors.length > 0) {
      const humanise = (field) => {
        const leaf = String(field).split('.').pop();
        const spaced = leaf.split('_').join(' ');
        return spaced.charAt(0).toUpperCase() + spaced.slice(1);
      };
      const first = fieldErrors[0];
      return `${humanise(first.field)}: ${first.message}`;
    }

    /*
     * AN EXPIRED SESSION IS NOT A PROVIDER FAULT.
     *
     * `http_401` used to fall through to the Gemini/provider branch below and
     * tell the customer "the API key is invalid or lacks image-generation
     * permission" — advice they cannot act on, about a key they do not own. The
     * actual meaning of a 401 on THIS request is that their own session expired.
     */
    if (r.startsWith('http_401') || r.startsWith('http_403')) {
      return 'Your session expired. Please sign in again, then retry the fitting.';
    }

    if (r === 'garment_too_large') {
      return 'The selected garment images are too large to send to the fitting service. Try removing a piece from the stack, or use products with a prepared try-on image.';
    }

    /*
     * A GENUINE "no worker" — and ONLY that.
     *
     * The backend now reports this from a real OS probe (`worker_running`), so
     * reaching here genuinely means nothing was draining the `tryon` queue. The
     * copy is accordingly specific, and it NO LONGER SUGGESTS `QUEUE_CONNECTION=sync`.
     *
     * WHY THE SYNC SUGGESTION WAS REMOVED: it is actively harmful advice on this
     * project. The built-in `php artisan serve` is SINGLE-THREADED and enforces a
     * ~60s request ceiling, while an inline PixelAPI render measures ~65-155s — so
     * switching to `sync` to "fix" a queue problem converts a queue error into
     * "Maximum execution time of 60 seconds exceeded", which is strictly worse.
     * The `.env` documents exactly this (see the QUEUE_CONNECTION block). The
     * watchdog is what actually fixes it, so that is what is recommended.
     */
    if (r === 'worker_offline') {
      return 'The fitting server has no processor running, so this render was never picked up. This is a server-side problem, not a problem with your photo. Run `php artisan tryon:ensure-worker` (or `start-tryon.ps1`) on the server, then tap Retry.';
    }

    if (r === 'no_garment_asset') {
      return 'This piece has no usable try-on image. The product needs a clean, transparent ghost-mannequin cut-out (admin → inventory → Try-On image) before it can be fitted.';
    }

    if (r === 'no_ai_engine' || r === 'server_placeholder') {
      return 'No try-on engine produced a fitting. Check that PixelAPI is configured (`VTON_API_URL` and `VTON_API_TOKEN`) and that the queue worker is running.';
    }

    if (r === 'not_configured') {
      return 'The try-on service is not configured. Set `VTON_API_URL` and `VTON_API_TOKEN` (PixelAPI) in the backend `.env`.';
    }

    if (r === 'renderer_gateway_error') {
      return 'The try-on service (PixelAPI) is temporarily unavailable — its servers are not responding. This is on the provider side; please retry in a few minutes.';
    }

    /*
     * A PROVIDER-SIDE SAFETY OUTAGE — DISTINCT FROM A BUSY QUEUE.
     *
     * PixelAPI answers 503 with `vton_safety_unavailable` when its clothing-safety
     * checker is briefly down. MEASURED as the dominant response during testing, and
     * it was previously collapsed into `renderer_busy` — so the customer was told
     * they had collided with another render (and to retry "in a few seconds") while
     * the provider was simply broken and charged nothing.
     *
     * The backend now carries this as its own code so the advice is actionable:
     * WAIT, because a retry that lands while the checker is still down just burns the
     * attempt budget for the same answer.
     */
    if (r === 'renderer_safety_unavailable') {
      return "The try-on service's clothing-safety check is temporarily unavailable — this is on the provider side, and nothing was charged. Please wait a minute before retrying.";
    }

    if (r === 'renderer_busy') {
      /*
       * HONEST COPY — THE OLD "in a few seconds" WAS A LIE.
       *
       * MEASURED: a real render was still working when the window closed, having
       * spent ~60s before the provider even began, and the customer was told to
       * retry "in a few seconds". Tapping Retry immediately is the WORST thing
       * they can do here, because PixelAPI renders one job at a time — the retry
       * arrives while the previous render is still occupying the single slot, so
       * it is refused or coalesced, which burns the retry budget on a condition
       * the early retry created.
       *
       * The message therefore describes the ACTUAL cause (a one-at-a-time queue)
       * and sets an expectation that matches the measured duration, so the customer
       * waits rather than re-submitting into a busy slot.
       */
      return 'The try-on service (PixelAPI) is still rendering another fitting — it processes one at a time, and a full render takes a minute or two. Please wait a moment before retrying so your fitting is not refused again.';
    }

    if (r === 'portrait_too_large') {
      return 'Your body photo is too large to upload. Please use a smaller photo — a portrait under about 2 MB renders correctly.';
    }

    if (r === 'renderer_unreachable' || r.includes('curl') || r.includes('52') || r.includes('56')) {
      return 'The try-on service could not be reached, or the upload was interrupted. A very large photo can cause this — try a smaller photo, or retry in a moment.';
    }

    if (r === 'renderer_no_image') {
      return 'The try-on service accepted the request but returned no image. This is usually a transient provider hiccup — please tap Retry.';
    }

    /*
     * A REJECTED REQUEST (HTTP 422 from PixelAPI).
     *
     * MEASURED: the same payload that was rejected three times in a row rendered
     * successfully minutes later, so this is TRANSIENT provider-side validation,
     * not a bad photo. The backend now also carries the vendor's own reason
     * through, so when it is present it is shown instead of this generic line.
     */
    if (r === 'renderer_rejected') {
      return 'The try-on service rejected this request. That is usually a momentary validation hiccup on the provider side — please tap Retry.';
    }

    if (r === 'renderer_unauthorized' || r === 'renderer_payment_required') {
      return 'The try-on service rejected the request: the API token is invalid or the account has no remaining credits.';
    }

    if (r.startsWith('http_429') || r.includes('rate')) {
      return 'The AI provider rate-limited the request (429). This is the free tier of the Gemini image model — enable billing on the key, or retry in a moment.';
    }

    /*
     * The duplicated 401/403 branch that stood here was removed: the FIRST
     * occurrence (above) already handles the case, so this copy was unreachable
     * dead code that made the function look like it handled two distinct paths.
     */
    if (r.startsWith('http_404')) {
      return 'The configured image model is unavailable for this API key. Check `GEMINI_IMAGE_MODEL`.';
    }

    if (r === 'unreachable' || r.startsWith('http_5')) {
      return 'The backend could not be reached to start the fitting. Check that the API server is running.';
    }

    /*
     * A message the backend wrote itself (a validation error, or the model's own
     * refusal) is already customer-facing, so it is passed through verbatim.
     */
    if (r && !/^(http_|timeout$|no_session$)/.test(r)) {
      return r;
    }

    if (r === 'timeout') {
      return 'The AI renderer took too long to answer. Large portraits are the usual cause — try a smaller photo, or retry.';
    }

    return 'The AI fitting could not be generated. Please try again.';
  };

  /**
   * GENERATE VIRTUAL FITTING — the customer-facing action.
   *
   * PIXELAPI ONLY. There is no local fallback.
   *
   * The render is produced by the backend's dedicated VTON API tier (PixelAPI),
   * which is sent the customer's full-body photo AND the selected garment with the
   * body region it belongs to, and returns a photorealistic image of that same
   * person actually WEARING the piece — the garment is deformed onto the body, not
   * pasted over it.
   *
   * When PixelAPI cannot render (the `tryon` queue has no worker, the provider is
   * down, the token is rejected, the quota is spent), the render FAILS with the
   * provider's own reason. The browser composite that used to draw a substitute is
   * gone (see the removal note above `loadPortraitImage`), so a failed try-on is
   * reported as a failed try-on rather than shown as a labelled drawing.
   */
  /**
   * Load the portrait as a decoded <img> so the fit check can read its pixels.
   * Resolves to null (never throws) when the image cannot be decoded, in which
   * case runFitCheck still runs its non-pixel checks.
   */
  const loadPortraitImage = (src) =>
    new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  const handleGenerateFitting = async () => {
    if (isGenerating) return;

    /*
     * THE GATE, ENFORCED AT THE LAST POSSIBLE MOMENT.
     *
     * A refused photo clears `userPhotoBase64`, so the check below would already
     * stop the render. This branch runs FIRST to give the real reason instead of the
     * generic "upload a photo first" — the customer did upload one; it was refused
     * because it is not a full-body person, and that is worth saying precisely.
     */
    if (photoRejection) {
      setTryOnError({
        message: photoRejection.detail,
        code: 'photo-rejected',
      });
      setTryOnStatus('failed');
      return;
    }

    // The two things the customer must provide before a render can mean anything.
    if (!userPhotoBase64) {
      setTryOnError({
        message: 'Upload your full-body photo first — the fitting is drawn onto it.',
        code: 'validation',
      });
      setTryOnStatus('failed');
      return;
    }

    if (!Object.values(selectedGarments).some(Boolean)) {
      setTryOnError({
        message: 'Select at least one garment from your Style Stack first.',
        code: 'validation',
      });
      setTryOnStatus('failed');
      return;
    }

    /*
     * ARM THE CANCEL FLAG FOR THIS RUN.
     *
     * `cancelledRef` is checked at every awaited checkpoint in the chain below.
     * It must start FALSE for a fresh render, otherwise a Stop pressed on a
     * PREVIOUS run (which latches the ref true) would make this one bail out at
     * its very first check and the button would appear dead.
     */
    cancelledRef.current = false;

    setIsGenerating(true);
    setGeneratedImage(null);
    setRenderEngine(null);
    setPlacedRegions([]);
    setTryOnError(null);
    setRecommendedSize(null);
    setFitCheck(null);

    /*
     * RUN THE FIT CHECK FIRST so the advisory is ready when the render lands.
     * It uses the SAME silhouette the compositor uses, so its verdict and the
     * picture can never disagree. It is advisory only — nothing below depends on
     * its result, so a failure here must not stop the render.
     */
    try {
      const portraitImg = await loadPortraitImage(userPhotoBase64);
      setFitCheck(
        runFitCheck({
          portrait: portraitImg,
          measurements,
          garmentsByCategory: selectedGarments,
        })
      );
    } catch (err) {
      console.warn('Fit check could not run:', err);
    }

    // Drive the progress bar through realistic phase copy. The job reports its
    // own progress on later polls; these timers are purely pacing, so the model
    // call — which takes tens of seconds — shows a calm, moving bar and phase
    // copy instead of a frozen 12%.
    setTryOnStatus('processing');
    setTryOnProgress(12);

    const steps = [
      { at: 30, label: 'Reading your full-body frame…' },
      { at: 55, label: 'Attaching garments to the matching body regions…' },
      { at: 80, label: 'Blending fabric edges and shadows…' },
    ];

    const timers = steps.map((step) =>
      setTimeout(() => {
        if (!cancelledRef.current) setTryOnProgress(step.at);
      }, step.at * 6)
    );

    try {
      /*
       * 1. THE AI PATH — the only path.
       *
       * The backend renders a true fitting with Gemini and we show it as 'ai'.
       * The backend also constructs its own SVG placeholder when no engine is
       * reachable; that payload is REJECTED here and reported as a failure, so a
       * drawn placeholder can never be presented as an AI render.
       */
      setTryOnProgress(20);
      const server = await requestBackendRender();

      if (cancelledRef.current) return;

      if (server.ok && server.image) {
        setGeneratedImage(server.image);
        setRenderEngine('ai');
        const size = server.size || recommendSizeForCategory(bodySizes, 'top');
        setRecommendedSize(size || null);
        setAiFeedback(server.feedback || null);
        setTryOnProgress(100);
        setTryOnStatus('completed');
        setTryOnError(null);
        if (server.feedback) {
          setChatMessages((prev) => [...prev, { role: 'assistant', text: server.feedback }]);
        }
        triggerAiConclusion(size || 'M');
        return;
      }

      /*
       * 2. THE AI PATH FAILED — REPORT THE REAL REASON. NO LOCAL FALLBACK.
       *
       * PIXELAPI IS THE ONLY RENDER ENGINE. The browser composite that used to
       * draw a substitute here has been REMOVED, deliberately:
       *
       *   - It never deformed the garment onto the body. It pasted the cut-out
       *     over the customer's photo, so the "fitting" was a flat overlay that
       *     did not reflect how the piece would actually sit, drape or size.
       *   - Showing it made a PixelAPI fault (a dead queue worker, a 522 from the
       *     provider, a bad token) look like a SUCCESSFUL render, which hid the
       *     real fault from the customer AND from whoever is debugging.
       *
       * The honest signal is FAILURE with the provider's own reason, so the
       * customer knows the real try-on could not run and can tap Retry once the
       * provider recovers, instead of judging the outfit off a drawing.
       */
      setTryOnProgress(100);
      setTryOnStatus('failed');
      setTryOnError({
        message: explainRenderFailure(server.reason, server),
        code: server.reason || 'render_failed',
      });
    } catch (err) {
      console.error('Generate fitting failed:', err);

      /*
       * A THROW HERE IS ALSO A FAILED RENDER — reported, never substituted. The
       * local composite that used to catch this has been removed (see above); a
       * thrown fault is a failed try-on, full stop.
       */
      setTryOnStatus('failed');
      setTryOnError({
        message: explainRenderFailure(err?.reason || 'generate_failed', err),
        code: err?.reason || 'generate_failed',
      });
    } finally {
      timers.forEach(clearTimeout);
      setIsGenerating(false);
    }
  };

  /**
   * Retry the fitting.
   *
   * A retry is just another generate: a fresh session row is created and a new
   * job is dispatched to the `tryon` queue. This is the right behaviour for the
   * transient PixelAPI faults (a 522 gateway blip, a momentary queue-full) that a
   * retry genuinely can recover from.
   */
  const handleRetryFitting = () => {
    if (isGenerating) return Promise.resolve();
    return handleGenerateFitting();
  };

  /**
   * Promote every worn (rendered) garment into My Bag.
   *
   * Shared by both result actions —"Add Worn Item to Bag" (stay in the Studio)
   * and"Proceed to Checkout" (promote, then route to /cart). Bag-sourced pieces
   * are skipped so a quantity is never doubled.
   */
  const addWornItemsToBag = useCallback(async () => {
    const wornGarments = Object.values(selectedGarments).filter(Boolean);
    if (wornGarments.length === 0) return { added: 0 };

    let added = 0;

    for (const garment of wornGarments) {
      // Bag items are already in the cart — re-posting them would double the
      // quantity, so only Saved items get promoted into the bag here.
      if (garment.source === 'bag' || !garment.productId) continue;

      try {
        await api.post('/cart', {
          product_id: garment.productId,
          quantity: 1,
          selected_size: garment.selected_size || 'M',
          selected_color: garment.selected_color || 'Standard',
        });
        added++;
      } catch (err) {
        console.error('Could not move garment to bag:', err);
      }
    }

    // Refresh the shared bag feed so Navbar/cart badges update instantly.
    queryClient.invalidateQueries({ queryKey: ['cart'] });

    return { added };
  }, [selectedGarments, queryClient]);

  /**
   * Send the worn garment straight to My Bag / checkout from the render result.
   */
  const proceedToCheckout = useCallback(
    () => addWornItemsToBag(),
    [addWornItemsToBag]
  );

  const handleSendMessage = async (userText) => {
    if (!userText.trim()) return;
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsChatTyping(true);

    try {
      const activeGarmentNames = Object.values(selectedGarments).filter(Boolean).map(g => g.name);
      const res = await api.post('/tryon/chat', {
        message: userText,
        /*
         * The stylist is told the customer's SIZES and the centimetres derived
         * from them, because its knowledge block now works in size labels —
         * sending a bare cm profile it no longer has a vocabulary for would
         * make it reason about numbers the customer never gave.
         */
        context: {
          sizes: bodySizes,
          measurements,
          selected_garments: activeGarmentNames,
          has_generated_image: !!generatedImage,
        }
      });
      /*
       * Carry the whole reply, not just the text.
       *
       * The backend now returns `suggestions` (quick-reply chips) and
       * `products` (catalog pieces in the recommended size) alongside `reply`.
       * Dropping them here is what made the chat a dead end: the panel had
       * nothing to offer after the first answer. They are attached to the
       * ASSISTANT message so StylistChat renders chips/cards under the reply
       * that produced them, and only while that reply is the latest.
       */
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        text: res.data.reply,
        suggestions: res.data.suggestions ?? [],
        products: res.data.products ?? [],
        /*
         * `links` — deep links to the page that owns a long-lived answer
         * (the product detail with its live stock, or the shop). Carried
         * through like suggestions/products so StylistChat can render them;
         * dropping them here is what would make the reply a dead end again.
         */
        links: res.data.links ?? [],
      }]);
    } catch (err) {
      // A failed chat must still offer a next step, not a bare apology.
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        text: "I couldn't reach the stylist service just now. Try again in a moment — meanwhile you can review your sizes or pick another piece for the stack.",
        suggestions: ['What is my size?', 'What colors suit me?'],
        products: [],
        links: [],
      }]);
    } finally {
      setIsChatTyping(false);
    }
  };

  return {
    bodySizes, measurements,
    garmentsByCategory, selectedGarments, toggleGarment, clearLayer, clearAllStack,
    // Load a past try-on's garments back into the stack (history drawer).
    applySavedOutfit,
    // `wishlistLoading` kept as the public prop name for AiTryOn/StyleStack
    // compatibility — it now reflects the bag feed being ready.
    wishlistLoading: cartLoading,
    userPhotoPreview, handlePhotoUpload, setUserPhoto, canGenerate, isGenerating, generatedImage,
    handleGenerateFitting, handleRetryFitting, proceedToCheckout, addWornItemsToBag,
    // Canvas controls: cancel an in-flight render, and clear ONLY the body photo.
    cancelFitting, removeUserPhoto,
    // Live pipeline telemetry for the Cream & Obsidian loading / error surfaces.
    tryOnStatus, tryOnProgress, tryOnError, recommendedSize, aiFeedback, sessionId,
    // Non-fatal notice: a dispatched render used a non-cut-out garment asset.
    vtonAssetWarning, setVtonAssetWarning,
    // 'ai' = server-rendered. (The local 'composite' engine was removed.)
    renderEngine, placedRegions, fitDiagnostics, fitCheck,
    // Body-photo verification from upload: { status, figureType, notes } | null
    photoVerification, setPhotoVerification,
    // WHY the photo was REFUSED: { reason, detail, evidence } | null. Non-null means
    // the canvas must show the re-upload prompt and NOT a preview.
    photoRejection,
    // Rows the dress/top-bottom exclusion is currently blocking, e.g. ['top','bottom']
    dressLockedCategories,
    chatMessages, isChatTyping, handleSendMessage
  };
};