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
import SizeTable from '../components/product/SizeTable';
import ProductGallery from '../components/product/ProductGallery';
import StylistBox from '../components/product/StylistBox';
import { ColorSelector, SizeSelector } from '../components/product/VariantSelector';
import AccordionItem from '../components/common/AccordionItem';
import Currency from '../components/common/Currency';
import { getStylistRecommendation, parseVariants } from '../utils/stylistHelper';

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

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
      setFeedback({ type: 'success', message: 'Added to your bag.' });
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
  const parsedSizeStocks = useMemo(() => {
    const raw = product?.size_stocks;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) || {};
      } catch {
        return {};
      }
    }
    return raw || {};
  }, [product?.size_stocks]);

  const productColors = useMemo(
    () => parseVariants(product?.colors, ['Black', 'Cream', 'Brown']),
    [product?.colors]
  );

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
    const stockKeys = Object.keys(parsedSizeStocks || {});
    if (stockKeys.length > 0) return stockKeys;
    return parseVariants(product?.sizes, []);
  }, [product?.sizes, parsedSizeStocks]);

  // Does this product carry real per-size stock data?
  const hasSizeStockData = useMemo(
    () => Object.keys(parsedSizeStocks).length > 0,
    [parsedSizeStocks]
  );

  // Stock for the chosen size, falling back to the aggregate column.
  const availableStock = selectedSize
    ? (parsedSizeStocks[selectedSize] ?? (hasSizeStockData ? 0 : product?.stock ?? 0))
    : product?.stock ?? 0;

  const isSelectedSizeOutOfStock = Boolean(selectedSize) && availableStock <= 0;
  const isVariantSelected = Boolean(selectedSize) && Boolean(selectedColor);
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
      const firstInStock = productSizes.find((size) => {
        if (!hasSizeStockData) return true; // no per-size data: all are fair game
        return (parsedSizeStocks[size] ?? 0) > 0;
      });
      setSelectedSize(firstInStock ?? productSizes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, productColors.length, productSizes.length, hasSizeStockData]);

  // Keep quantity within a sane range when the size or stock changes.
  useEffect(() => {
    setQuantity(1);
  }, [selectedSize, selectedColor]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 text-stone-200 animate-spin mx-auto" />
          <p className="uppercase tracking-[0.35em] text-[10px] text-zinc-500 font-semibold">
            Loading Details
          </p>
        </div>
      </div>
    );
  }

  if (isError || !product) {
    return (
      <div className="flex min-h-screen bg-black flex-col items-center justify-center gap-4 px-6 text-center">
        <AlertCircle className="w-7 h-7 text-stone-200" />
        <p className="uppercase tracking-[0.25em] text-zinc-400 text-xs font-semibold">
          Product not found
        </p>
        <button
          onClick={() => navigate(-1)}
          className="text-[10px] underline uppercase tracking-[0.2em] font-semibold text-zinc-500 hover:text-stone-200 transition"
        >
          Go Back
        </button>
      </div>
    );
  }

  const maxQuantity = Math.max(1, Math.min(10, availableStock || 1));

  const handleRequireSelection = () => {
    if (!selectedSize && !selectedColor) return 'Please select a size and colour.';
    if (!selectedSize) return 'Please select a size.';
    if (!selectedColor) return 'Please select a colour.';
    if (isSelectedSizeOutOfStock) return 'The selected size is currently out of stock.';
    return null;
  };

  const handleAddToCart = () => {
    if (!user) return navigate('/login');

    const problem = handleRequireSelection();
    if (problem) return setFeedback({ type: 'error', message: problem });

    addToCartMutation.mutate({
      product_id: product.id,
      selected_color: selectedColor,
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
      selected_color: selectedColor,
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
          selected_color: selectedColor,
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

  return (
    <div className="min-h-screen bg-black">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 md:pt-28 pb-16">
        {/* Back link */}
        <button
          onClick={() => navigate(-1)}
          className="group inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-semibold text-zinc-500 hover:text-stone-200 transition mb-6"
        >
          <ArrowLeft size={13} className="group-hover:-translate-x-0.5 transition-transform" />
          Back
        </button>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* ============ LEFT: GALLERY ============ */}
          <ProductGallery
            imageUrl={product.display_image_url || product.image_url}
            images={product.images}
            name={product.name}
            isGuest={!user}
          />

          {/* ============ RIGHT: DETAILS + CONVERSION ZONE ============ */}
          <div className="space-y-6">
            {/* Title & price */}
            <div className="border-b border-zinc-900 pb-5">
              {product.category && (
                <span className="text-[10px] uppercase tracking-[0.25em] font-semibold text-stone-200">
                  {product.category}
                </span>
              )}
              <h1 className="text-2xl md:text-3xl font-normal tracking-tight text-[#E9C46A] uppercase leading-snug mt-1.5">
                {product.name}
              </h1>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-3">
                <Currency
                  amount={price}
                  className="text-xl md:text-2xl text-stone-200 font-semibold tracking-wide"
                />
                <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-medium">
                  50% DP to secure
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.25em] font-semibold text-zinc-500">
                Description
              </p>
              <p className="text-zinc-400 font-normal leading-relaxed text-[13px]">
                {product.description || 'No description provided for this piece.'}
              </p>
            </div>

            {/* AI Stylist */}
            <StylistBox recommendation={getStylistRecommendation(user, product)} />

            {/* Variant selection */}
            <div className="space-y-5">
              {productColors.length > 0 && (
                <ColorSelector
                  colors={productColors}
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
                    className={`text-[10px] uppercase tracking-[0.15em] font-medium ${isSelectedSizeOutOfStock ? 'text-red-400' : 'text-emerald-400'
                      }`}
                  >
                    {isSelectedSizeOutOfStock
                      ? 'Out of stock in this size'
                      : availableStock <= 5
                        ? `Only ${availableStock} left in size ${selectedSize}`
                        : `In stock — ${availableStock} units available`}
                  </p>
                </div>
              )}
            </div>

            {/* Quantity */}
            {user && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-zinc-500">
                  Quantity
                </p>
                <div className="inline-flex items-center border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                    className="px-3 py-2 text-zinc-500 hover:text-stone-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="px-4 text-[13px] font-semibold min-w-[2.5rem] text-center text-white">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                    disabled={quantity >= maxQuantity}
                    aria-label="Increase quantity"
                    className="px-3 py-2 text-zinc-500 hover:text-stone-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* ========== CONVERSION ZONE ========== */}
            <div className="pt-5 border-t border-zinc-900 space-y-3">
              {/* Feedback (replaces alert()) */}
              {feedback && (
                <div
                  className={`flex items-start gap-2 text-[11.5px] rounded-lg px-3 py-2.5 border ${feedback.type === 'error'
                      ? 'text-red-400 bg-red-950/40 border-red-900/60'
                      : 'text-emerald-400 bg-emerald-950/40 border-emerald-900/60'
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
              {user && !isVariantSelected && (
                <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium text-center">
                  Please select a size and colour
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* PRIMARY: Add to Bag */}
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={!canPurchase || addToCartMutation.isPending}
                    className={`w-full py-4 rounded-lg uppercase text-[11px] tracking-[0.2em] font-bold transition duration-300 flex items-center justify-center gap-2 ${!canPurchase || addToCartMutation.isPending
                        ? 'bg-zinc-900 text-zinc-600 cursor-not-allowed'
                        : 'bg-[#E9C46A] text-black hover:bg-[#D4A94F] active:scale-[0.98] shadow-lg shadow-stone-200/10'
                      }`}
                  >
                    {addToCartMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> Adding
                      </>
                    ) : isSelectedSizeOutOfStock ? (
                      'Out of Stock'
                    ) : (
                      <>
                        <ShoppingBag size={14} /> Add to Bag
                      </>
                    )}
                  </button>

                  {/* SECONDARY: Try in Virtual Try-On */}
                  <button
                    type="button"
                    onClick={handleAiTryOn}
                    disabled={!canPurchase || isTryingOn}
                    className={`w-full py-4 rounded-lg uppercase text-[11px] tracking-[0.2em] font-bold transition duration-300 flex items-center justify-center gap-2 border ${!canPurchase || isTryingOn
                        ? 'border-zinc-900 text-zinc-600 cursor-not-allowed'
                        : 'border-stone-300/50 text-stone-200 hover:bg-[#E9C46A] hover:text-black active:scale-[0.98]'
                      }`}
                  >
                    {isTryingOn ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> Fitting
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> Try in Virtual Try-On
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
                  className="w-full py-4 rounded-lg bg-[#E9C46A] text-black uppercase text-[11px] tracking-[0.25em] font-bold transition duration-300 hover:bg-[#D4A94F] active:scale-[0.98]"
                >
                  Sign in to Purchase
                </button>
              )}

              {!user && (
                <p className="text-center text-[10px] uppercase tracking-[0.18em] text-zinc-600 font-medium pt-1">
                  Log in to unlock the AI try-on studio and your virtual wardrobe.
                </p>
              )}
            </div>

            {/* ========== ACCORDIONS ========== */}
            <div className="pt-2 border-t border-zinc-900">
              <AccordionItem
                title="Order Guidelines"
                subtitle="3:00 PM cutoff · 50% DP · non-refundable"
                icon={FileText}
                defaultOpen={false}
              >
                <ul className="space-y-2">
                  <li className="flex gap-2.5">
                    <span className="text-stone-200">•</span>
                    Orders placed before <strong className="text-white">3:00 PM</strong> are processed
                    the same day.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-stone-200">•</span>
                    A <strong className="text-white">50% down payment</strong> is required to secure your
                    order.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-stone-200">•</span>
                    The remaining balance must be settled <strong className="text-white">before shipping</strong>.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-stone-200">•</span>
                    Down payments are <strong className="text-white">non-refundable</strong>, and all sales
                    are final once confirmed.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="text-stone-200">•</span>
                    Shipping via <strong className="text-white">LBC</strong> or{' '}
                    <strong className="text-white">Lalamove</strong>, chosen at checkout.
                  </li>
                </ul>
              </AccordionItem>

              <AccordionItem
                title="Sizing Information"
                subtitle="Flat-lay measurements in centimetres"
                icon={Ruler}
              >
                <SizeTable category={product.category} />
              </AccordionItem>

              <AccordionItem title="Shipping & Payment" subtitle="Couriers, DP and balance" icon={Truck}>
                <p>
                  We ship nationwide. Choose <strong className="text-white">LBC</strong> for door-to-door
                  delivery, or <strong className="text-white">Lalamove</strong> for same-day bookings you
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
      </div>
    </div>
  );
};

export default ProductDetail;
