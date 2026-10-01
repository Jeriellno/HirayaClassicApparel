import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Sparkles, ArrowRight, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import Currency from '../common/Currency';
import { getProductImageUrl } from '../../utils/imageHelper';
import { themeSurfaceFor } from '../../utils/framePresets';

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
   *   display_image_url = http://127.0.0.1:8000/storage/catalog/lJamb”¦.png  (file MISSING)
   *   image_url         = /supabase-storage/”¦/products/catalog/1789728007966-7k5biae.jpg (file EXISTS)
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
      /*
       * "VINTAGE ATELIER" CARD — a sheet of cream stock lifted on the
       * neumorphic light, holding the black catalog frame inset like a
       * mounted print. Hover lifts the card and floats the garment inside it
       * over a ground shadow (the motion reference's hovering piece, in
       * miniature). A recommended piece carries a navy ring instead of a
       * hairline.
       */
      className={
        'group relative flex h-full flex-col rounded-[24px] bg-hiraya-surface p-2.5 shadow-neu transition-[translate,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1.5 hover:shadow-[var(--shadow-neu),0_30px_50px_-30px_rgba(21,32,54,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus focus-visible:ring-offset-2 ' +
        (isRecommended ? 'ring-2 ring-hiraya-accent' : 'ring-1 ring-cream-50/80')
      }
    >
      {/* MEDIA */}
      {/*
       * The tile takes the product's BACKGROUND THEME colour (set when the admin
       * saved it), so a cream Summer card is not letterboxed with black bars.
       * Legacy black-card products resolve to black, exactly as before.
       */}
      <div
        className={'relative w-full ' + heightClass + ' bg-black overflow-hidden flex-shrink-0 rounded-[18px]'}
        style={{ backgroundColor: themeSurfaceFor(product) }}
      >
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
         * card is always visible. The tile behind it is BLACK (`bg-black`
         * above), matching QuickViewModal and the catalog frame's own obsidian
         * background, so the letterboxing is invisible. It previously used
         * `bg-hiraya-olive` — an indigo that no longer matches this comment or
         * the sibling components, and which showed as coloured bars inside a
         * black-framed catalog card.
         */}
        <img
          src={displayImage}
          alt={product?.name || 'Garment'}
          onError={handleImageError}
          loading="lazy"
          className="relative z-[1] w-full h-full object-contain object-center transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-2 group-hover:scale-[1.04]"
        />
        {/* The ground shadow the garment lifts away from on hover. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-4 left-1/2 h-3 w-1/2 -translate-x-1/2 rounded-[50%] bg-cream-100/10 opacity-0 blur-md transition-opacity duration-700 group-hover:opacity-100"
        />

        {fitBadge}

        {/* CATEGORY TAG */}
        {/**
          * CATEGORY TAG — a chip ON the image, so it stays dark-ink-on-light for
          * legibility against an unknown photo, using the palette's olive rather
          * than pure black.
          */}
        <span className="absolute top-3 left-3 bg-noir/45 backdrop-blur-md px-3 py-1 rounded-full text-[9px] uppercase tracking-[0.15em] text-cream-100 font-semibold border border-cream-50/15 z-20 flex items-center gap-1">
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
              'absolute top-3 right-3 z-20 h-9 w-9 rounded-full flex items-center justify-center backdrop-blur-md border transition duration-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 ' +
              (isSaved
                ? 'bg-cream-100 border-cream-100 text-navy-900'
                : 'bg-noir/40 border-cream-50/20 text-cream-100 hover:bg-cream-100 hover:border-cream-100 hover:text-navy-900')
            }
          >
            {/*
             * The heart fills in the SAVED state only, and it fills with the
             * current text colour rather than black. `fill-black` on maroon
             * produced a black shape with a maroon outline — which read as a
             * pair of dark horns on the accent plate rather than a filled
             * heart in the button's own ink.
             */}
            <Heart size={15} className={isSaved ? 'fill-current' : ''} />
          </motion.button>
        )}

        {/* HOVER ACTION BAR */}
        {onQuickView && (
          <div className="absolute inset-x-3 bottom-3 z-10 translate-y-3 opacity-0 transition-all duration-400 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onQuickView(product);
              }}
              className="w-full flex items-center justify-center gap-2 rounded-full bg-cream-100 text-navy-950 text-[10px] font-semibold uppercase tracking-[0.2em] py-3 shadow-[0_12px_24px_-12px_rgba(0,0,0,0.8)] hover:bg-cream-50 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 focus-visible:ring-offset-2 focus-visible:ring-offset-noir"
            >
              View Details <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>

      {/**
        * DETAILS — the card's LIGHT half.
        *
        * Ink here is olive (#0A2947 on #FBE8CE ≈ 5.5:1), NOT cream: the card is
        * a light surface sitting on the olive canvas, so its text inverts relative
        * to the page. That inversion is what separates a card from the background
        * in this palette — surface contrast, not a drop shadow alone.
        */}
      <div className="flex flex-1 flex-col justify-between px-2.5 pb-2 pt-4">
        {isRecommended && (
          <div className="mb-3 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-hiraya-accent">
            <Sparkles size={11} /> Recommended for your measurements
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-hiraya-ink tracking-[0.02em] leading-snug">
            {product?.name || 'Untitled Item'}
          </h3>

          {/* Verified-purchase rating (reviews_avg_rating / reviews_count from the catalog). */}
          {Number(product?.reviews_count) > 0 ? (
            <div
              className="mt-1 flex items-center gap-1 text-[10px] text-hiraya-ink-muted"
              aria-label={`Rated ${Number(product.reviews_avg_rating).toFixed(1)} out of 5 from ${product.reviews_count} reviews`}
            >
              <span className="flex items-center" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    size={11}
                    className={Number(product.reviews_avg_rating) >= n - 0.25 ? 'text-amber-500' : 'text-hiraya-structure-line'}
                    fill={Number(product.reviews_avg_rating) >= n - 0.25 ? 'currentColor' : 'none'}
                  />
                ))}
              </span>
              <span className="font-semibold text-hiraya-ink tabular-nums">{Number(product.reviews_avg_rating).toFixed(1)}</span>
              <span>({product.reviews_count})</span>
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-hiraya-ink-muted">New · no reviews yet</p>
          )}

          {product?.attributes && typeof product.attributes === 'object' && Object.keys(product.attributes).length > 0 && (
            <div className="mt-2 flex-wrap gap-1">
              {Object.entries(product.attributes).map(([key, value]) =>
                value ? (
                  <span key={key} className="mr-1 inline-block text-[9px] bg-cream-200/70 text-hiraya-ink px-2.5 py-0.5 rounded-full shadow-neu-inset">
                    <span className="text-hiraya-ink-muted capitalize">{key.replace('_', ' ')}:</span> {value}
                  </span>
                ) : null
              )}
            </div>
          )}

          {product?.description && (
            <p className="text-[10px] text-hiraya-ink-muted mt-1.5 leading-relaxed line-clamp-2">
              {product.description}
            </p>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-hiraya-structure-line/70 flex items-center justify-between gap-3">
          <Currency amount={numericPrice} className="text-[16px] font-semibold text-navy-900 tracking-[0.02em]" />

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