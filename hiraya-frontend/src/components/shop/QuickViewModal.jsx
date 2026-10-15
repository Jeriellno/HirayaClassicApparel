import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, ShoppingBag, Sparkles, Loader2, Wand2 } from 'lucide-react';
import { getProductImageUrl } from '../../utils/imageHelper';
import { themeSurfaceFor } from '../../utils/framePresets';
import { productTypeLabel } from '../../constants/productCategories';
import Currency from '../common/Currency';
import { useCart } from '../../hooks/useCart';
import { useAuth } from '../../context/AuthContext';

/**
 * QuickViewModal — catalog quick-look with a single, unambiguous purchase path.
 *
 * The standalone wishlist was retired across Hiraya: My Bag is the one
 * pre-purchase container. This modal therefore exposes ONE action —"Add to Bag"
 * — wired straight into CartContext via `useCart().addToCart`. All wishlist
 * state (heart button, `isWishlistPending`, dual save/submit flags) has been
 * removed so the component has no dead paths and no duplicate write flows.
 */
const QuickViewModal = ({ product, onClose, onTryOn }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addToCart, isAdding } = useCart();

  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [justAddedToBag, setJustAddedToBag] = useState(false);
  const [cartError, setCartError] = useState('');

  const sizeStocks = product?.size_stocks || product?.sizes || {};

  const dynamicSizes =
    typeof sizeStocks === 'object' && !Array.isArray(sizeStocks) && Object.keys(sizeStocks).length > 0
      ? Object.keys(sizeStocks)
      : Array.isArray(product?.sizes) && product.sizes.length > 0
        ? product.sizes
        : ['XS', 'S', 'M', 'L', 'XL', '2XL'];

  const dynamicColors =
    Array.isArray(product?.colors) && product.colors.length > 0
      ? product.colors
      : product?.color
        ? [product.color]
        : [];

  // Pre-select the first in-stock size and the first colour whenever the
  // product changes, so the customer can hit"Add to Bag" immediately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!product) return;

    const firstAvailableSize =
      dynamicSizes.find((sz) => {
        const count =
          typeof sizeStocks === 'object' && !Array.isArray(sizeStocks)
            ? sizeStocks[sz]
            : product.stock;
        return (Number(count) || 0) > 0;
      }) ||
      dynamicSizes[0] ||
      '';

    setSelectedSize(firstAvailableSize);
    setSelectedColor(dynamicColors[0] || 'Default');
    setJustAddedToBag(false);
    setCartError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  // Reset the transient"added" confirmation when the variant changes.
  useEffect(() => {
    setJustAddedToBag(false);
  }, [selectedSize, selectedColor]);

  if (!product) return null;

  const currentStockCount =
    typeof sizeStocks === 'object' && !Array.isArray(sizeStocks)
      ? (sizeStocks[selectedSize] ?? product.stock ?? 0)
      : (product.stock ?? 0);

  const isOutOfStock = Number(currentStockCount) <= 0;

  const handleAddToBag = async () => {
    if (!user) {
      onClose?.();
      return navigate('/login');
    }
    if (isOutOfStock || isAdding) return;

    setCartError('');
    try {
      await addToCart({
        product_id: product.id,
        quantity: 1,
        selected_size: selectedSize,
        selected_color: selectedColor,
      });
      setJustAddedToBag(true);
      setTimeout(() => setJustAddedToBag(false), 2000);
    } catch (err) {
      setCartError(err?.response?.data?.message || 'Failed to add to your bag.');
    }
  };

  return (
    <AnimatePresence>
      {product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-hiraya-cream-deep/85 backdrop-blur-md"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 24 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-sm border border-hiraya-nav-ink/14 bg-hiraya-structure p-6 shadow-2xl md:p-8 text-hiraya-nav-ink"
          >
            {/* The maroon fascia rule, matching the navbar and console. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-hiraya-nav-rule"
            />
            <button
              onClick={onClose}
              aria-label="Close quick view"
              className="absolute right-5 top-5 rounded-sm border border-hiraya-nav-ink/20 bg-hiraya-nav-ink/10 p-2 text-hiraya-nav-ink transition hover:bg-hiraya-accent hover:border-hiraya-accent cursor-pointer"
            >
              <X size={18} />
            </button>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              {/* PRODUCT IMAGE — black ground retained for letterboxing. */}
              {/* Tile colour follows the product's background theme (black for legacy cards). */}
              <div
                className="relative h-80 overflow-hidden rounded-sm border border-hiraya-nav-ink/14 bg-black"
                style={{ backgroundColor: themeSurfaceFor(product) }}
              >
                <img
                  /*
                   * Resolved through the shared helper, and note the product is
                   * passed as a WHOLE object: `display_image_url` was preferred here
                   * but the result was handed to `getProductImageUrl` — the PATH
                   * resolver. Any row whose image was already stored as an absolute
                   * Supabase URL slipped past that resolver, stayed cross-origin,
                   * and COEP blocked it (the empty box in Quick View). The helper
                   * now rewrites Supabase public URLs onto the same-origin
                   * `/supabase-storage` proxy, whether absolute or relative.
                   */
                  src={getProductImageUrl(product.display_image_url || product.image_url || product.image_path || product.image)}
                  alt={product.name}
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-3 top-3 flex items-center gap-1 rounded-sm border border-hiraya-nav-ink/20 bg-hiraya-surface/90 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink backdrop-blur-md">
                  <Sparkles size={10} />
                  {productTypeLabel(product)}
                </span>
              </div>

              <div className="flex flex-col justify-between space-y-4">
                <div>
                  <h2 className="mt-1 font-serif text-xl uppercase tracking-[0.04em] text-hiraya-nav-ink">{product.name}</h2>
                  <Currency
                    amount={product.price || 0}
                    decimals={false}
                    className="mt-1 block font-serif text-2xl text-hiraya-nav-ink"
                  />
                  <p className="mt-2 text-xs leading-relaxed text-hiraya-nav-muted">
                    {product.description}
                  </p>

                  {(product?.material || product?.gender) && (
                    <div className="mt-3 grid-cols-2 gap-1.5 rounded-sm border border-hiraya-nav-ink/14 bg-hiraya-nav-ink/8 p-2.5 font-mono text-[10px]">
                      {product?.material && (
                        <div>
                          <span className="text-hiraya-nav-muted">Fabric:</span>{' '}
                          <span className="text-hiraya-nav-ink">{product.material}</span>
                        </div>
                      )}
                      {product?.gender && (
                        <div>
                          <span className="text-hiraya-nav-muted">Gender:</span>{' '}
                          <span className="text-hiraya-nav-ink">{product.gender}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* SIZE SELECTION */}
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-hiraya-nav-muted">
                    Select Size
                  </label>
                  <div className="grid max-h-36 grid-cols-3 gap-2 overflow-y-auto pr-1">
                    {dynamicSizes.map((sz) => {
                      const stockCount =
                        typeof sizeStocks === 'object' && !Array.isArray(sizeStocks)
                          ? Number(sizeStocks[sz]) || 0
                          : Number(product.stock) || 0;

                      const soldOut = stockCount <= 0;
                      const isSelected = selectedSize === sz;

                      return (
                        <button
                          key={sz}
                          type="button"
                          disabled={soldOut || isAdding}
                          onClick={() => setSelectedSize(sz)}
                          className={`rounded-sm border py-2 px-3 text-center font-mono text-xs transition-all ${
                            soldOut
                              ? 'cursor-not-allowed border-hiraya-nav-ink/10 bg-hiraya-nav-ink/10 text-hiraya-nav-muted line-through'
                              : isSelected
                                ? 'border-hiraya-accent bg-hiraya-accent font-semibold text-hiraya-on-accent cursor-pointer'
                                : 'border-hiraya-nav-ink/20 bg-hiraya-nav-ink/8 text-hiraya-nav-ink hover:border-hiraya-nav-rule cursor-pointer'
                          }`}
                        >
                          {sz}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* COLOR SELECTION */}
                {dynamicColors.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-hiraya-nav-muted">
                      Select Color
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {dynamicColors.map((color) => {
                        const isSelected = selectedColor === color;
                        return (
                          <button
                            key={color}
                            type="button"
                            disabled={isAdding}
                            onClick={() => setSelectedColor(color)}
                            className={`rounded-sm border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition cursor-pointer ${
                              isSelected
                                ? 'border-hiraya-accent bg-hiraya-accent-wash text-hiraya-accent'
                                : 'border-hiraya-nav-ink/20 bg-hiraya-nav-ink/8 text-hiraya-nav-ink hover:border-hiraya-nav-rule'
                            }`}
                          >
                            {color}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* PRIMARY ACTION — the only write path now */}
                <div className="space-y-3 pt-2">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleAddToBag}
                    disabled={isOutOfStock || isAdding}
                    className="btn-primary w-full"
                  >
                    {isOutOfStock ? (
                      'Sold Out'
                    ) : isAdding ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Adding...
                      </>
                    ) : justAddedToBag ? (
                      <>
                        <Check size={16} /> Added to Bag
                      </>
                    ) : (
                      <>
                        <ShoppingBag size={16} /> Add to Bag
                      </>
                    )}
                  </motion.button>

                  {cartError && (
                    <p className="rounded-sm border border-red-600/40 bg-red-500/12 px-3 py-2 text-[10px] text-red-700">
                      {cartError}
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    {onTryOn && (
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        type="button"
                        onClick={() => {
                          onClose?.();
                          onTryOn(product, selectedSize, selectedColor);
                        }}
                        className="flex flex-1 items-center justify-center gap-2 rounded-sm border border-hiraya-nav-ink/25 bg-hiraya-nav-ink/8 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-hiraya-nav-ink transition hover:border-hiraya-nav-rule hover:bg-hiraya-nav-ink/16 cursor-pointer"
                      >
                        <Wand2 size={15} /> Try On
                      </motion.button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        navigate(`/product/${product.id}`);
                      }}
                      className="flex-1 rounded-sm border border-hiraya-nav-ink/25 bg-hiraya-nav-ink/8 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-hiraya-nav-ink transition hover:border-hiraya-nav-rule hover:bg-hiraya-nav-ink/16 cursor-pointer"
                    >
                      Full Details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default QuickViewModal;