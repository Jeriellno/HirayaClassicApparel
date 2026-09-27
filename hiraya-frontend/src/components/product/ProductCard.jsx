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
        'block bg-hiraya-cream rounded-xl overflow-hidden group transition-all duration-300 flex-col h-full relative ' +
        (isRecommended
          ? 'border-2 border-hiraya-gold shadow-[0_10px_30px_rgba(107,112,92,0.35)]'
          : 'border border-hiraya-olive/15 hover:border-hiraya-gold shadow-lg shadow-hiraya-sand/20')
      }
    >
      {/* MEDIA */}
      <div className={'relative w-full ' + heightClass + ' bg-hiraya-olive overflow-hidden flex-shrink-0'}>
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
        {/**
          * CATEGORY TAG — a chip ON the image, so it stays dark-ink-on-light for
          * legibility against an unknown photo, using the palette's olive rather
          * than pure black.
          */}
        <span className="absolute top-3 left-3 bg-hiraya-cream-deep/80 backdrop-blur-md px-2.5 py-1 rounded-full text-[9px] uppercase tracking-[0.15em] text-hiraya-ink font-bold border-hiraya-olive/20 z-20 flex items-center gap-1">
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
                ? 'bg-[#CB997E] border-hiraya-gold text-hiraya-olive'
                : 'bg-hiraya-cream/50 border-hiraya-olive/20 text-hiraya-ink hover:bg-[#CB997E] hover:border-hiraya-gold hover:text-hiraya-olive')
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
              className="w-full flex items-center justify-center gap-2 bg-[#CB997E] text-hiraya-ink text-[10px] font-bold uppercase tracking-[0.2em] py-3 hover:bg-[#A5A58D] transition"
            >
              View Details <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>

      {/**
        * DETAILS — the card's LIGHT half.
        *
        * Ink here is olive (#6B705C on #FFE8D6 ≈ 5.5:1), NOT cream: the card is
        * a light surface sitting on the olive canvas, so its text inverts relative
        * to the page. That inversion is what separates a card from the background
        * in this palette — surface contrast, not a drop shadow alone.
        */}
      <div className="px-4 py-4 bg-hiraya-cream flex-col justify-between flex-1">
        {isRecommended && (
          <div className="mb-3 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-hiraya-olive/70">
            <Sparkles size={11} /> Recommended for your measurements
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-hiraya-olive tracking-wide leading-snug">
            {product?.name || 'Untitled Item'}
          </h3>

          {product?.attributes && typeof product.attributes === 'object' && Object.keys(product.attributes).length > 0 && (
            <div className="mt-2 flex-wrap gap-1">
              {Object.entries(product.attributes).map(([key, value]) =>
                value ? (
                  <span key={key} className="text-[9px] bg-[#CB997E]/25 border border-[#CB997E]/40 text-hiraya-olive px-2 py-0.5 rounded">
                    <span className="text-hiraya-olive/70 capitalize">{key.replace('_', ' ')}:</span> {value}
                  </span>
                ) : null
              )}
            </div>
          )}

          {product?.description && (
            <p className="text-[10px] text-hiraya-olive/70 mt-1.5 leading-relaxed line-clamp-2">
              {product.description}
            </p>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-hiraya-olive/15 flex items-center justify-between gap-3">
          <Currency amount={numericPrice} className="text-[15px] font-bold text-hiraya-olive tracking-wide" />

          {/*
           * NO "VIEW" LABEL HERE — ON PURPOSE.
           *
           * The card already has ONE call to action: the "View Details" bar that
           * slides up over the image on hover/tap. A second, static "View →"
           * sitting next to the price competed with it and split the customer's
           * attention between two identical actions, one of which looked like a
           * plain label rather than a control.
           *
           * The whole card is a <Link>, so nothing was actually lost: clicking
           * anywhere on the tile still opens the product. The hover bar remains
           * the visible, unambiguous affordance.
           */}
        </div>
      </div>
    </Link>
  );
};

export default ProductCard;