import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  ShoppingBag,
  Minus,
  Plus,
  Check,
  Truck,
  Ruler,
  FileText,
  Loader2,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';

import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import SizeTable, { sortSizes } from '../components/product/SizeTable';
import ProductGallery from '../components/product/ProductGallery';
import StylistBox from '../components/product/StylistBox';
import ProductReviews from '../components/product/ProductReviews';
import CompleteTheLook from '../components/product/CompleteTheLook';
import { ColorSelector, SizeSelector } from '../components/product/VariantSelector';
import AccordionItem from '../components/common/AccordionItem';
import Currency from '../components/common/Currency';
import { getStylistRecommendation, parseVariants } from '../utils/stylistHelper';
import { useT } from '../context/PreferencesContext';

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const t = useT();

  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [isTryingOn, setIsTryingOn] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'error' | 'success', message }

  const { data: product, isLoading, isError } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const cleanId = id.split(':')[0];
      const response = await api.get(`/products/${cleanId}`);
      return response.data;
    },
  });

  useEffect(() => {
    if (product?.name) document.title = `Hiraya | ${product.name}`;
    return () => {
      document.title = 'Hiraya';
    };
  }, [product]);

  //"Add to Bag" writes to the real cart API (cart_items table).
  const addToCartMutation = useMutation({
    mutationFn: (newItem) => api.post('/cart', newItem),
    onSuccess: () => {
      setFeedback({ type: 'success', message: t('product.addedToBag') });
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: (err) => {
      console.error('Cart Error:', err);
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || 'Failed to add to bag. Please try again.',
      });
    },
  });

  // --- Derived product data (all hooks run before any early return) ---

  /*
   * COLOUR VARIANTS. `colors[0]` is the main photo's colour; every entry in
   * `color_variants` is another colour with its own photo, stock and optional
   * name / description. A product with no colours on file shows no colour
   * picker at all (it used to invent Black / Cream / Brown, which could be
   * ordered but did not exist).
   */
  const colorVariants = useMemo(
    () => (Array.isArray(product?.color_variants) ? product.color_variants.filter((v) => v?.color) : []),
    [product?.color_variants]
  );
  const activeVariant = useMemo(
    () => colorVariants.find((v) => v.color.toLowerCase() === String(selectedColor).toLowerCase()) || null,
    [colorVariants, selectedColor]
  );

  const parsedSizeStocks = useMemo(() => {
    if (activeVariant) return activeVariant.size_stocks || {};
    const raw = product?.size_stocks;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) || {};
      } catch {
        return {};
      }
    }
    return raw || {};
  }, [product?.size_stocks, activeVariant]);

  const productColors = useMemo(() => {
    const list = parseVariants(product?.colors, []).filter((c) => typeof c === 'string' && c.trim());
    colorVariants.forEach((v) => {
      if (!list.some((c) => c.toLowerCase() === v.color.toLowerCase())) list.push(v.color);
    });
    return list;
  }, [product?.colors, colorVariants]);

  const colorSwatches = useMemo(() => {
    const map = {};
    const primary = productColors[0];
    if (primary && product?.ai_tags?.primary_hex) map[primary] = product.ai_tags.primary_hex;
    colorVariants.forEach((v) => {
      if (v.hex) map[v.color] = v.hex;
    });
    return map;
  }, [productColors, colorVariants, product?.ai_tags?.primary_hex]);

  // With no colours on file the line is sold as the single "Standard" colour.
  const effectiveColor = productColors.length > 0 ? selectedColor : 'Standard';

  /*
   * The real size list. `size_stocks` is authoritative when present — its KEYS
   * are exactly the sizes the admin actually stocked — and `sizes` is the
   * fallback for older rows that predate the stock matrix.
   *
   * Reading `sizes` alone fell back to a hard-coded ['S','M','L','XL'] for any
   * garment stored as `{L: 350, M: 350}`, so the page offered sizes that did
   * not exist and none of them could satisfy the "is this size in stock?"
   * check that gates the purchase buttons.
   */
  const productSizes = useMemo(() => {
    // Always in size order (XS → 2XL), never the JSON key order.
    const stockKeys = Object.keys(parsedSizeStocks || {});
    if (stockKeys.length > 0) return sortSizes(stockKeys);
    return sortSizes(parseVariants(product?.sizes, []));
  }, [product?.sizes, parsedSizeStocks]);

  // Does this product carry real per-size stock data?
  const hasSizeStockData = useMemo(
    () => Object.keys(parsedSizeStocks).length > 0,
    [parsedSizeStocks]
  );

  // Stock for the chosen size, falling back to the aggregate column.
  const baseStock = activeVariant ? Number(activeVariant.stock) || 0 : product?.stock ?? 0;
  const availableStock = selectedSize
    ? (parsedSizeStocks[selectedSize] ?? (hasSizeStockData ? 0 : baseStock))
    : baseStock;

  const isSelectedSizeOutOfStock = Boolean(selectedSize) && availableStock <= 0;
  const isVariantSelected = Boolean(selectedSize) && Boolean(effectiveColor);
  const canPurchase = Boolean(user) && isVariantSelected && !isSelectedSizeOutOfStock;

  /*
   * Auto-select sensible defaults so the purchase buttons are usable on first
   * paint.
   *
   * PREVIOUS BEHAVIOUR only auto-selected a variant when there was EXACTLY ONE,
   * which left a garment stocked in L and M with nothing selected — every
   * action button rendered disabled under a bare "Please select a size and
   * colour" hint, so "Add to Bag" and "Try in Virtual Try-On" looked broken
   * even though both were implemented correctly.
   *
   * Now: the colour defaults to the first (or only) option, and the size
   * defaults to the FIRST IN-STOCK size rather than merely the first listed, so
   * a size that is sold out never becomes the pre-selected one.
   */
  useEffect(() => {
    if (!product) return;

    if (!selectedColor && productColors.length > 0) {
      setSelectedColor(productColors[0]);
    }

    if (!selectedSize && productSizes.length > 0) {
      const inStock = (size) => !hasSizeStockData || (parsedSizeStocks[size] ?? 0) > 0;
      // The shopper's own saved size first, when it is in stock.
      const lowerWords = ['pant', 'trouser', 'jean', 'skirt', 'short', 'legging', 'bottom', 'slack'];
      const isLower = lowerWords.some((w) => `${product.category} ${product.name}`.toLowerCase().includes(w));
      const mine = isLower ? user?.lower_body_size : user?.upper_body_size;
      const own = productSizes.find((size) => mine && size.toUpperCase() === String(mine).toUpperCase() && inStock(size));
      setSelectedSize(own ?? productSizes.find(inStock) ?? productSizes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, productColors.length, productSizes.length, hasSizeStockData]);

  // Keep quantity within a sane range when the size or stock changes.
  useEffect(() => {
    setQuantity(1);
  }, [selectedSize, selectedColor]);

  // A colour with its own stock may not carry the size picked for the last
  // colour: move to its first in-stock size instead of a dead selection.
  useEffect(() => {
    if (!selectedSize || productSizes.length === 0) return;
    const stillValid = productSizes.includes(selectedSize) && (!hasSizeStockData || (parsedSizeStocks[selectedSize] ?? 0) > 0);
    if (!stillValid) {
      const next = productSizes.find((size) => !hasSizeStockData || (parsedSizeStocks[size] ?? 0) > 0);
      setSelectedSize(next ?? productSizes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVariant?.id]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="glass w-full max-w-xs space-y-4 px-8 py-10 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-hiraya-accent" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-hiraya-ink-muted">
            {t('product.loading')}
          </p>
        </div>
      </div>
    );
  }

  if (isError || !product) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="card-raised flex w-full max-w-sm flex-col items-center gap-4 px-8 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-cream-100 shadow-neu-sm">
            <AlertCircle className="h-5 w-5" />
          </span>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-hiraya-ink">
            {t('product.notFound')}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="btn-quiet"
          >
            {t('product.goBack')}
          </button>
        </div>
      </div>
    );
  }

  const maxQuantity = Math.max(1, Math.min(10, availableStock || 1));

  const handleRequireSelection = () => {
    if (!selectedSize && !effectiveColor) return 'Please select a size and colour.';
    if (!selectedSize) return 'Please select a size.';
    if (!effectiveColor) return 'Please select a colour.';
    if (isSelectedSizeOutOfStock) return 'The selected size is currently out of stock.';
    return null;
  };

  const handleAddToCart = () => {
    if (!user) return navigate('/login');

    const problem = handleRequireSelection();
    if (problem) return setFeedback({ type: 'error', message: problem });

    addToCartMutation.mutate({
      product_id: product.id,
      selected_color: effectiveColor,
      selected_size: selectedSize,
      quantity,
    });
  };

  /**
   * Adds the garment to My Bag (cart_items) — the single pre-purchase container.
   * This is the shared handoff for BOTH"Save" and the AI Try-On flow.
   */
  const persistToBag = async () => {
    await api.post('/cart', {
      product_id: product.id,
      selected_color: effectiveColor,
      selected_size: selectedSize,
      quantity,
    });
    // Resync every bag-backed surface: My Bag, the navbar badge and the
    // AI Try-On garment picker all read the same ['cart'] query.
    queryClient.invalidateQueries({ queryKey: ['cart'] });
  };

  /**
   * Sends the garment into the AI Studio (StyleStack left panel).
   *
   * WHY THE BAG: StyleStack renders its category rows from `garmentsByCategory`
   * in useTryOnState, which now derives from GET /cart (the bag wins over any
   * duplicate). Writing to cart_items is therefore the supported handoff — there
   * is no shared React context between this page and /try-on, so a navigate()
   * with route state alone would be dropped. The item is added to the bag and
   * pre-selected with its chosen size/colour when the Studio mounts.
   */
  const sendToStudio = async ({ successMessage, trackingPath }) => {
    if (!user) return navigate('/login');

    const problem = handleRequireSelection();
    if (problem) return setFeedback({ type: 'error', message: problem });

    try {
      await persistToBag();

      if (trackingPath) {
        // Analytics is best-effort; never block the actual handoff.
        try {
          await api.post(trackingPath);
        } catch (err) {
          console.error('Failed to track Studio engagement:', err);
        }
      }

      setFeedback({ type: 'success', message: successMessage });
      // Pass the variant through so the Studio can re-apply the exact selection.
      navigate('/try-on', {
        state: {
          product_id: product.id,
          selected_size: selectedSize,
          selected_color: effectiveColor,
        },
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.message || 'Could not add this piece to the Studio.',
      });
    }
  };

  const handleAiTryOn = async () => {
    if (!user) return navigate('/login');
    setIsTryingOn(true);
    try {
      await sendToStudio({
        successMessage: 'Added to your Style Studio canvas.',
        trackingPath: `/products/${product.id}/track-tryon`,
      });
    } finally {
      setIsTryingOn(false);
    }
  };


  const price = parseFloat(product.price) || 0;
  // What the chosen colour shows: its own photo / name / description when set.
  const shownName = activeVariant?.name || product.name;
  const shownDescription = activeVariant?.description || product.description;
  const shownImage = activeVariant?.display_image_url || product.display_image_url || product.image_url;

  return (
    <div className="min-h-screen w-full text-hiraya-ink">
      <div className="container-page pb-20 pt-28 md:pt-32">
        {/* Back link */}
        <button
          onClick={() => navigate(-1)}
          className="btn-quiet group mb-8"
        >
          <ArrowLeft size={13} className="transition-transform group-hover:-translate-x-0.5" />
          {t('common.back')}
        </button>

        <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-6 xl:col-span-7">
          {/* ============ LEFT: GALLERY ============ */}
          <ProductGallery
            key={activeVariant?.id || 'primary'}
            imageUrl={shownImage}
            images={activeVariant ? null : product.images}
            name={shownName}
            isGuest={!user}
          />
          </div>

          {/* ============ RIGHT: DETAILS + CONVERSION ZONE ============ */}
          <div className="space-y-7 lg:col-span-6 xl:col-span-5">
            {/* Title & price. */}
            <div className="border-b border-hiraya-structure-line pb-6">
              {product.category && (
                <span className="kicker text-hiraya-ink-muted">
                  {product.category.replace('_', ' ')}
                </span>
              )}
              <h1 className="mt-4 font-serif text-[clamp(1.8rem,3vw,2.6rem)] uppercase leading-[1.08] tracking-[0.04em] text-navy-900">
                {shownName}
              </h1>

              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Currency
                  amount={price}
                  className="text-2xl font-semibold tracking-wide text-navy-900 md:text-[1.7rem]"
                />
                <span className="rounded-full bg-cream-200/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-charcoal-600 shadow-neu-inset">
                  {t('product.dp')}
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
                {t('product.description')}
              </p>
              <p className="text-[13px] font-normal leading-relaxed text-hiraya-ink-soft">
                {shownDescription || t('product.noDescription')}
              </p>
            </div>

            {/* AI Stylist */}
            <StylistBox recommendation={getStylistRecommendation(user, product)} />

            {/* Variant selection */}
            <div className="space-y-5" data-tour="product-variants">
              {productColors.length > 0 && (
                <ColorSelector
                  colors={productColors}
                  swatches={colorSwatches}
                  selectedColor={selectedColor}
                  onSelectColor={(color) => {
                    setSelectedColor(color);
                    setFeedback(null);
                  }}
                />
              )}

              {productSizes.length > 0 && (
                <SizeSelector
                  sizes={productSizes}
                  selectedSize={selectedSize}
                  sizeStocks={parsedSizeStocks}
                  onSelectSize={(size) => {
                    setSelectedSize(size);
                    setFeedback(null);
                  }}
                />
              )}

              {/* Stock indicator */}
              {selectedSize && (
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${isSelectedSizeOutOfStock ? 'bg-red-500' : 'bg-emerald-500'
                      }`}
                  />
                  <p
                    className={`text-[10px] font-medium uppercase tracking-[0.15em] ${isSelectedSizeOutOfStock ? 'text-red-700' : 'text-emerald-700'
                      }`}
                  >
                    {isSelectedSizeOutOfStock
                      ? t('product.soldOutSize')
                      : availableStock <= 5
                        ? t('product.onlyLeft', { n: availableStock, size: selectedSize })
                        : t('product.inStock', { n: availableStock })}
                  </p>
                </div>
              )}
            </div>

            {/* Quantity */}
            {user && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
                  {t('product.quantity')}
                </p>
                {/*
                 * THE STEPPER SITS ON A RULED PLATE.
                 *
                 * It was `bg-hiraya-olive` — a DARK INDIGO fill — with
                 * `text-hiraya-sand` labels, and `sand` is also indigo. So the
                 * control was indigo-on-indigo: measured 1.00:1, i.e. the minus
                 * and plus glyphs were literally invisible. The plate is now the
                 * light raised surface with the standard hairline, and the glyphs
                 * carry full ink.
                 */}
                <div className="inline-flex items-center gap-1 rounded-full bg-cream-200/70 p-1 shadow-neu-inset">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-cream-50 text-hiraya-ink shadow-neu-sm transition hover:bg-hiraya-accent hover:text-hiraya-on-accent disabled:cursor-not-allowed disabled:bg-transparent disabled:text-hiraya-disabled-ink disabled:shadow-none"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="min-w-[2.75rem] text-center text-[14px] font-semibold text-hiraya-ink">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                    disabled={quantity >= maxQuantity}
                    aria-label="Increase quantity"
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-cream-50 text-hiraya-ink shadow-neu-sm transition hover:bg-hiraya-accent hover:text-hiraya-on-accent disabled:cursor-not-allowed disabled:bg-transparent disabled:text-hiraya-disabled-ink disabled:shadow-none"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* ========== CONVERSION ZONE ========== */}
            <div className="space-y-3 border-t border-hiraya-structure-line pt-5">
              {/* Feedback (replaces alert()) */}
              {feedback && (
                <div
                  className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[11.5px] ${feedback.type === 'error'
                      ? 'border-red-600/40 bg-red-500/12 text-red-700'
                      : 'border-emerald-600/40 bg-emerald-500/12 text-emerald-700'
                    }`}
                >
                  {feedback.type === 'error' ? (
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  ) : (
                    <Check size={14} className="mt-0.5 shrink-0" />
                  )}
                  <span className="leading-relaxed">{feedback.message}</span>
                </div>
              )}

              {/* Helper text when a variant is still missing */}
              {user && !isVariantSelected && productSizes.length > 0 && (
                <p className="text-center text-[10px] font-medium uppercase tracking-[0.18em] text-hiraya-ink-muted">
                  {t('product.selectVariant')}
                </p>
              )}

              {/* ===== ACTION ZONE =====
                  - Add to Bag             : the single entry into the bag, which
                                             also feeds the AI Try-On picker.
                  - Try in Virtual Try-On  : adds to bag + hands to /try-on.

"Save to My Bag" was retired alongside those: it POSTed to the same /cart as
                  "Add to Bag", so the two buttons were one action rendered twice.
"Buy Now" and"Add to Studio" were retired: Buy Now only
                  duplicated the bag->checkout path, and Add to Studio targeted
                  the same /try-on destination as the try-on button. */}
              {user ? (
                <div data-tour="product-actions" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* PRIMARY: Add to Bag — the shared .btn-primary plate, so its
                      disabled / hover / focus states match every other primary
                      action in the app instead of re-deriving them inline. */}
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={!canPurchase || addToCartMutation.isPending}
                    className="btn-primary w-full rounded-full py-4"
                  >
                    {addToCartMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> {t('product.adding')}
                      </>
                    ) : isSelectedSizeOutOfStock ? (
                      t('product.outOfStock')
                    ) : (
                      <>
                        <ShoppingBag size={14} /> {t('product.addToBag')}
                      </>
                    )}
                  </button>

                  {/* SECONDARY: Try in Virtual Try-On */}
                  <button
                    type="button"
                    onClick={handleAiTryOn}
                    disabled={!canPurchase || isTryingOn}
                    data-tour="product-tryon"
                    className="btn-secondary w-full rounded-full py-4"
                  >
                    {isTryingOn ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> {t('product.fitting')}
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> {t('product.tryOn')}
                      </>
                    )}
                  </button>

                  {/*
                   * REMOVED: "Save to My Bag".
                   *
                   * It called the same `POST /cart` as "Add to Bag" above, so the
                   * page offered two buttons that did one identical thing — the
                   * bag is a single pre-purchase container, not a bag plus a
                   * bookmark. "Add to Bag" already covers it.
                   *
                   * The wishlist / "Saved" bookmark layer was retired entirely;
                   * the heart on each ProductCard now reflects BAG membership, so
                   * there is still exactly one pre-purchase container.
                   */}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="btn-primary w-full rounded-full py-4"
                >
                  {t('product.signInToBuy')}
                </button>
              )}

              {!user && (
                <p className="pt-1 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-hiraya-ink-muted">
                  Log in to unlock the AI try-on studio and your virtual wardrobe.
                </p>
              )}
            </div>

            {/* ========== ACCORDIONS ========== */}
            <div className="card px-5 py-1 sm:px-6">
              <AccordionItem
                title={t('product.guidelines')}
                subtitle="3:00 PM cutoff · 50% DP or full payment"
                icon={FileText}
                defaultOpen={false}
              >
                <ul className="space-y-2">
                  <li className="flex gap-2.5">
                    <span className="text-hiraya-accent">·</span>
                    Orders placed before <strong className="text-hiraya-ink">3:00 PM</strong> are processed
                    the same day.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-hiraya-accent">·</span>
                    Pay a <strong className="text-hiraya-ink">50% down payment</strong> to secure your order, or
                    pay in full at checkout.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-hiraya-accent">·</span>
                    Any remaining balance must be settled <strong className="text-hiraya-ink">before courier
                    pickup</strong> — orders with an unpaid balance may be cancelled.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-hiraya-accent">·</span>
                    Once payment is confirmed the order is <strong className="text-hiraya-ink">final</strong> — no
                    cancellations or refunds.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-hiraya-accent">·</span>
                    Shipping via <strong className="text-hiraya-ink">LBC</strong> or{' '}
                    <strong className="text-hiraya-ink">Lalamove</strong>, chosen at checkout.
                  </li>
                </ul>
              </AccordionItem>

              <AccordionItem
                title={t('product.sizing')}
                subtitle="Flat-lay measurements in centimetres"
                icon={Ruler}
              >
                <SizeTable
                  category={product.category}
                  name={product.name}
                  measurements={product.size_measurements}
                  sizes={productSizes}
                  highlight={user?.upper_body_size || ''}
                />
              </AccordionItem>

              <AccordionItem title={t('product.shipping')} subtitle="Couriers, DP and balance" icon={Truck}>
                <p>
                  We ship nationwide. Choose <strong className="text-hiraya-ink">LBC</strong> for door-to-door
                  delivery, or <strong className="text-hiraya-ink">Lalamove</strong> for same-day bookings you
                  arrange yourself once the piece is ready.
                </p>
                <p className="mt-2.5">
                  Payment follows our two-step flow: settle the 50% down payment to reserve your piece,
                  then the remaining balance before dispatch. Upload your receipt from your dashboard and
                  we will verify it.
                </p>
              </AccordionItem>
            </div>
          </div>
        </div>

        {/* Pieces an admin paired with this one (Inventory > Pair With). */}
        <CompleteTheLook pairs={product.paired_products} />

        {/* Verified-purchase reviews, written from delivered orders. */}
        <ProductReviews productId={product.id} />
      </div>
    </div>
  );
};

export default ProductDetail;
