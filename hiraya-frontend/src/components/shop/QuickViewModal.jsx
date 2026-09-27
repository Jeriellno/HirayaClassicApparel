import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, ShoppingBag, Sparkles, Loader2, Wand2 } from 'lucide-react';
import { getProductImageUrl } from '../../utils/imageHelper';
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
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border-hiraya-sand/30 bg-hiraya-olive p-6 shadow-2xl md:p-8"
          >
            <button
              onClick={onClose}
              aria-label="Close quick view"
              className="absolute right-5 top-5 rounded-full border-hiraya-sand/30 bg-hiraya-sand/80 p-2 text-hiraya-sand transition hover:border-hiraya-olive/20 hover:text-hiraya-ink"
            >
              <X size={18} />
            </button>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              {/* PRODUCT IMAGE */}
              <div className="relative h-80 overflow-hidden rounded-2xl border-hiraya-sand/30 bg-black">
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
                <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full border-hiraya-olive/20 bg-hiraya-cream-deep/80 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-hiraya-ink backdrop-blur-md">
                  <Sparkles size={10} />
                  {product.category?.replace('_', ' ') || 'GARMENT'}
                </span>
              </div>

              <div className="flex flex-col justify-between space-y-4">
                <div>
                  <h2 className="mt-1 text-xl font-bold text-hiraya-ink">{product.name}</h2>
                  <Currency
                    amount={product.price || 0}
                    decimals={false}
                    className="mt-1 block text-2xl font-black text-hiraya-ink"
                  />
                  <p className="mt-2 text-xs leading-relaxed text-hiraya-sand">
                    {product.description}
                  </p>

                  {(product?.material || product?.gender) && (
                    <div className="mt-3 grid-cols-2 gap-1.5 rounded-xl border-hiraya-sand/30 bg-hiraya-sand/60 p-2.5 font-mono text-[10px]">
                      {product?.material && (
                        <div>
                          <span className="text-hiraya-ink">Fabric:</span>{' '}
                          <span className="text-hiraya-ink">{product.material}</span>
                        </div>
                      )}
                      {product?.gender && (
                        <div>
                          <span className="text-hiraya-ink">Gender:</span>{' '}
                          <span className="text-hiraya-ink">{product.gender}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* SIZE SELECTION */}
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-hiraya-sand">
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
                          className={`rounded-xl border py-2 px-3 text-center font-mono text-xs transition-all ${
                            soldOut
                              ? 'cursor-not-allowed border-hiraya-sand bg-hiraya-sand/80 text-hiraya-sand line-through opacity-40'
                              : isSelected
                                ? 'border-hiraya-gold bg-[#CB997E] font-bold text-hiraya-olive shadow-md'
                                : 'border-hiraya-sand/30 bg-hiraya-sand/60 text-hiraya-ink hover:border-hiraya-gold/50'
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
                    <label className="block text-[9px] font-bold uppercase tracking-widest text-hiraya-sand">
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
                            className={`rounded-xl border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                              isSelected
                                ? 'border-hiraya-gold bg-[#CB997E]/12 text-hiraya-ink'
                                : 'border-hiraya-sand/30 bg-hiraya-sand/60 text-hiraya-ink hover:border-hiraya-gold/50'
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
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#CB997E] py-3.5 text-xs font-extrabold uppercase tracking-widest text-hiraya-olive transition hover:bg-hiraya-cream-deep disabled:cursor-not-allowed disabled:bg-hiraya-sand/70 disabled:text-hiraya-sand"
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
                    <p className="rounded-lg border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-400">
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
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border-hiraya-sand/30 bg-hiraya-sand/60 py-3 text-[11px] font-bold uppercase tracking-widest text-hiraya-ink transition hover:border-hiraya-gold/50 hover:text-hiraya-ink"
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
                      className="flex-1 rounded-xl border-hiraya-sand/30 bg-hiraya-sand/60 py-3 text-center text-[11px] font-bold uppercase tracking-widest text-hiraya-ink transition hover:border-hiraya-gold/50 hover:text-hiraya-ink"
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