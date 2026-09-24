import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Sparkles, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import Currency from '../common/Currency';
import { getProductImageUrl } from '../../utils/imageHelper';

/*
 * Placeholder shown when a product has no image, or the one it has fails to load.
 */
const DEFAULT_IMAGE_URL = '/images/placeholder.svg';

/**
 * Kept as a named export because other files import `getImageUrl` from here.
 */
export const getImageUrl = getProductImageUrl;

const ProductCard = ({
  product,
  isSaved = false,
  onWishlistToggle,
  onTryOn,
  onQuickView,
  showStackIcon = false,
  heightClass = 'h-72',
  fitBadge = null,
  isRecommended = false,
}) => {
  /*
   * CANDIDATE CHAIN, not a single source.
   *
   * A row can carry several image references and they are NOT equally valid.
   * Live example (verified against the database): product #19 has
   *
   *   display_image_url = http://127.0.0.1:8000/storage/catalog/lJamb….png  (file MISSING)
   *   image_url         = /supabase-storage/…/products/catalog/1789728007966-7k5biae.jpg (file EXISTS)
   *
   * The old code resolved `display_image_url` ONLY, and on `onError` jumped
   * straight to the placeholder — so a stale first reference hid a perfectly
   * good second one and the card rendered the broken "NO IMAGE" tile.
   *
   * Building the whole ordered chain and advancing on error lets the card fall
   * through to the first reference whose bytes actually load.
   */
  const rawImageSources = [
    product?.display_image_url,
    product?.image_url,
    product?.image_path,
    product?.image,
  ].filter(Boolean);

  const resolvedSources = rawImageSources
    .map((src) => getImageUrl(src))
    .filter((src) => src && src !== DEFAULT_IMAGE_URL);

  // Cursor into `resolvedSources`. `resolvedSources.length` means "exhausted".
  const [sourceIndex, setSourceIndex] = useState(0);

  // Reset to the primary source when a different product (or chain) is rendered.
  const sourceKey = resolvedSources.join('|');
  useEffect(() => {
    setSourceIndex(0);
  }, [sourceKey]);

  // Past the last candidate the placeholder shows, so a fully-dead row degrades
  // gracefully instead of resting on a source we already know failed.
  const displayImage = resolvedSources[sourceIndex] || DEFAULT_IMAGE_URL;

  const handleImageError = () => {
    setSourceIndex((i) => Math.min(i + 1, resolvedSources.length));
  };

  // Price fallback parsing
  const numericPrice = parseFloat(String(product?.price ?? '').replace(/[^0-9.-]+/g, '')) || 0;

  const handleWishlistClick = (e) => {
    e.stopPropagation();
    if (onWishlistToggle) onWishlistToggle(product);
  };

  const isFormalWear = product?.category === 'FORMAL_MEN' || product?.category === 'FORMAL_WOMEN';
  const categoryLabel = product?.category?.replace('_', ' ') || product?.garment_type || 'GARMENT';

  return (
    <Link
      to={'/product/' + product?.id}
      aria-label={'View ' + (product?.name || 'garment') + ' details'}
      className={
        'block bg-zinc-950 rounded-xl overflow-hidden group transition-all duration-300 flex-col h-full relative ' +
        (isRecommended
          ? 'border-2 border-stone-300 shadow-[0_0_24px_rgba(245,235,224,0.22)]'
          : 'border border-zinc-800 hover:border-stone-300/50')
      }
    >
      {/* MEDIA */}
      <div className={'relative w-full ' + heightClass + ' bg-black overflow-hidden flex-shrink-0'}>
        {/*
         * `object-contain`, NOT `object-cover`.
         *
         * The catalog image is an already-finished 4:5 marketing card — the
         * garment cut-out centred on the HIRAYA frame. `object-cover` scaled it
         * to FILL the card's media box and then CROPPED the overflow, so on any
         * card whose ratio differs from 4:5 (the h-72 spotlight/shop cards) the
         * frame's own padding and wordmark were cut away and the garment was
         * magnified until it filled the tile.
         *
         * Visually that destruction is indistinguishable from "the original
         * photo is still showing": the shopper sees a zoomed-in garment on a
         * flat backdrop instead of the framed catalog card that was actually
         * stored. `object-contain` letterboxes instead, so the whole finished
         * card is always visible. The tile behind it is already black
         * (`bg-black` below), so the letterboxing is invisible against the
         * frame's own obsidian background.
         */}
        <img
          src={displayImage}
          alt={product?.name || 'Garment'}
          onError={handleImageError}
          loading="lazy"
          className="w-full h-full object-contain object-center group-hover:scale-105 transition-transform duration-700"
        />

        {fitBadge}

        {/* CATEGORY TAG */}
        <span className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full text-[9px] uppercase tracking-[0.15em] text-stone-200 font-bold border-stone-300/20 z-20 flex items-center gap-1">
          {isFormalWear && <Sparkles size={10} />}
          {categoryLabel}
        </span>

        {/* WISHLIST */}
        {onWishlistToggle && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleWishlistClick}
            aria-label={isSaved ? 'Remove from bag' : 'Add to bag'}
            title={isSaved ? 'In your bag' : 'Add to Bag'}
            className={
              'absolute top-3 right-3 z-20 h-9 w-9 rounded-full flex items-center justify-center backdrop-blur-md border transition duration-300 ' +
              (isSaved
                ? 'bg-[#E9C46A] border-stone-300 text-black'
                : 'bg-black/60 border-white/15 text-white hover:bg-[#E9C46A] hover:border-stone-300 hover:text-black')
            }
          >
            <Heart size={15} className={isSaved ? 'fill-black' : ''} />
          </motion.button>
        )}

        {/* HOVER ACTION BAR */}
        {onQuickView && (
          <div className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out z-10">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onQuickView(product);
              }}
              className="w-full flex items-center justify-center gap-2 bg-[#E9C46A] text-black text-[10px] font-bold uppercase tracking-[0.2em] py-3 hover:bg-[#D4A94F] transition"
            >
              View Details <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>

      {/* DETAILS */}
      <div className="px-4 py-4 bg-zinc-950 border-t border-zinc-900 flex-col justify-between flex-1">
        {isRecommended && (
          <div className="mb-3 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-stone-200">
            <Sparkles size={11} /> Recommended for your measurements
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-white tracking-wide leading-snug">
            {product?.name || 'Untitled Item'}
          </h3>

          {product?.attributes && typeof product.attributes === 'object' && Object.keys(product.attributes).length > 0 && (
            <div className="mt-2 flex-wrap gap-1">
              {Object.entries(product.attributes).map(([key, value]) =>
                value ? (
                  <span key={key} className="text-[9px] bg-zinc-900 border-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                    <span className="text-stone-200 capitalize">{key.replace('_', ' ')}:</span> {value}
                  </span>
                ) : null
              )}
            </div>
          )}

          {product?.description && (
            <p className="text-[10px] text-zinc-500 mt-1.5 leading-relaxed line-clamp-2">
              {product.description}
            </p>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-900 flex items-center justify-between gap-3">
          <Currency amount={numericPrice} className="text-[15px] font-bold text-stone-200 tracking-wide" />

          <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-zinc-500 group-hover:text-stone-200 transition flex items-center gap-1">
            View <ArrowRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
};

export default ProductCard;