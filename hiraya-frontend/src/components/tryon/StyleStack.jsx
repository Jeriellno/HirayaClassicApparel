import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, ShoppingBag, Trash2, Shirt, Loader2, ChevronLeft, ChevronRight, Sparkles, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';
import StyleStackGarmentCard from './StyleStackGarmentCard';
import { resolveStackCategory } from '../../utils/categoryHelpers';

// --- Category SVG Icons ---
const BottomsIcon = ({ size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M6 2h12l1 7-3 13h-4l-2-8-2 8H8L5 9l1-7z" /></svg>
);
const FootwearIcon = ({ size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 16l3-10h10l3 10v4H4v-4z" /><path d="M4 20h16" /></svg>
);
const OuterwearIcon = ({ size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M16 2l4 4v16H4V6l4-4h8z" /><path d="M12 2v20" /><path d="M8 2l4 5 4-5" /></svg>
);
const AccessoriesIcon = ({ size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
);
const DressIcon = ({ size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M9 2l3 3 3-3" /><path d="M9 2v4l-4 14h14L15 6V2" /></svg>
);

const CATEGORY_ROWS = [
  { key: 'top', label: 'Tops', icon: Shirt },
  { key: 'bottom', label: 'Bottoms', icon: BottomsIcon },
  { key: 'dress', label: 'Dresses', icon: DressIcon },
  { key: 'outerwear', label: 'Outerwear', icon: OuterwearIcon },
  { key: 'footwear', label: 'Footwear', icon: FootwearIcon },
  { key: 'accessories', label: 'Accessories', icon: AccessoriesIcon },
];

const toPrice = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? '').replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Buckets raw cart_items into category rows using extracted helper. */
const bucketBagItems = (items) => {
  const buckets = { top: [], bottom: [], dress: [], outerwear: [], footwear: [], accessories: [] };

  (Array.isArray(items) ? items : []).forEach((item) => {
    const product = item?.product || {};
    const key = resolveStackCategory(product.category || item?.category);
    buckets[key].push({
      id: item.id ?? product.id,
      productId: item.product_id ?? product.id,
      name: product.name || 'Unnamed Garment',
      price: toPrice(product.price),
      category: key,
      image_url: product.display_image_url || product.image_url || product.image_base64 || product.image || '',
      raw_image_url: product.image_url || product.image_base64 || product.image || '',
      display_image_url: product.display_image_url || '',
      ghost_mannequin_url: product.ghost_mannequin_url || '',
      selected_size: item.selected_size || '',
      selected_color: item.selected_color || '',
      source: 'bag',
    });
  });

  return buckets;
};

const CategoryStackRow = ({ meta, items, selected, onToggle, disabled, excludedByRule = false }) => {
  const { label, icon: Icon } = meta;
  const scrollerRef = useRef(null);

  const scrollBy = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 300, behavior: 'smooth' });
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] text-hiraya-ink">
          <Icon size={14} />
          {label}
          <span className="rounded-full bg-hiraya-sand px-1.5 py-0.5 text-[8px] font-bold text-hiraya-sand">
            {items.length}
          </span>
        </h4>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={`Scroll ${label} left`}
            className="flex h-6 w-6 items-center justify-center rounded-full border-hiraya-sand/30 text-hiraya-sand transition-colors hover:border-[#CB997E]/50 hover:text-hiraya-ink"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={`Scroll ${label} right`}
            className="flex h-6 w-6 items-center justify-center rounded-full border-hiraya-sand/30 text-hiraya-sand transition-colors hover:border-[#CB997E]/50 hover:text-hiraya-ink"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border-dashed border-hiraya-sand/30 bg-hiraya-sand/20 px-4 py-6 text-center">
          <p className="text-[10px] italic text-hiraya-sand">No {label.toLowerCase()} in your bag yet</p>
        </div>
      ) : (
        /* Rendered as a wrapper so the exclusion hint can sit above the scroller
           without becoming a snap item itself. */
        <div>
        <div
          ref={scrollerRef}
          className="scrollbar-none flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1"
        >
          {items.map((garment) => (
            <div key={garment.id} className="snap-start">
              <StyleStackGarmentCard
                garment={garment}
                isSelected={selected?.id === garment.id}
                onToggle={onToggle}
                disabled={disabled}
                /*
                 * The card's native title is written for the photo lock. When the
                 * row is blocked by the dress rule instead, the reason is named
                 * here so hovering a greyed tile does not give the wrong advice.
                 */
                disabledReason={
                  excludedByRule
                    ? (label === 'Dresses'
                        ? 'A top or bottom is already worn — clear it to wear a dress'
                        : 'A dress is worn — it covers the top and bottom already')
                    : null
                }
              />
            </div>
          ))}
          </div>

          {/* Explains WHY the row is greyed out, so it never looks broken. */}
          {excludedByRule && (
            <p className="mt-1.5 text-[9px] leading-snug text-amber-300/80">
              {label === 'Dresses'
                ? 'Remove your top or bottom to wear a dress.'
                : 'A dress covers these — remove the dress to layer separately.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export const StyleStack = ({
  garmentsByCategory,
  selectedGarments = {},
  toggleGarment,
  clearLayer,
  clearAllStack,
  isLoading,
  locked = false,
  lockedMessage = 'Upload your full-body photo first.',
  /*
   * Rows blocked by the dress / top-bottom exclusion, derived by the hook (see
   * `dressLockedCategories` in useTryOnState).
   *
   * This REPLACES the local `dressBlocks` check that used to live below. That one
   * only ever disabled Top/Bottom when a dress was worn, and it read
   * `selectedGarments.dress` directly — so it could not express the reverse case
   * (a dress blocked BY a worn top or bottom) and silently disagreed with the
   * hook's own toggle logic whenever the two mappers bucketed a piece
   * differently. Taking the answer from the hook keeps the disabled state and the
   * actual selection rule in one place.
   */
  lockedCategories = [],
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const shouldSelfFetch = !garmentsByCategory || Object.keys(garmentsByCategory || {}).length === 0;
  const [bagCategories, setBagCategories] = useState(null);
  const [isFetchingBag, setIsFetchingBag] = useState(false);

  const fetchBag = useCallback(async () => {
    if (!user) return;
    setIsFetchingBag(true);
    try {
      const res = await api.get('/cart');
      const payload = res.data;
      const items = Array.isArray(payload) ? payload : payload?.items || [];
      setBagCategories(bucketBagItems(items));
    } catch (err) {
      console.error('[StyleStack] Could not load My Bag:', err);
      setBagCategories(bucketBagItems([]));
    } finally {
      setIsFetchingBag(false);
    }
  }, [user]);

  useEffect(() => {
    if (shouldSelfFetch && user) fetchBag();
  }, [shouldSelfFetch, user, fetchBag]);

  const resolvedByCategory = useMemo(() => {
    if (!shouldSelfFetch) return garmentsByCategory || {};
    return bagCategories || {};
  }, [shouldSelfFetch, garmentsByCategory, bagCategories]);

  const isBusy = isLoading || (shouldSelfFetch && isFetchingBag && !bagCategories);

  const hasSelectedItems = Object.values(selectedGarments).some(Boolean);
  const selectedCount = Object.values(selectedGarments).filter(Boolean).length;

  const handleToggle = useCallback(
    (garment) => {
      if (typeof toggleGarment === 'function') toggleGarment(garment);

      /*
       * CANVAS ENGAGEMENT TRACKING.
       *
       * When a piece is ADDED to the canvas, record it against the product so
       * the admin/superadmin dashboards have real "canvas_drag_count" data.
       * This endpoint existed but was NEVER called from anywhere, so the counter
       * was always 0 and the "Trending Garments" list had nothing to rank by.
       * Fire-and-forget: a tracking failure must never block the styling action.
       */
      const productId = garment?.productId ?? garment?.product_id ?? garment?.id;
      if (productId) {
        api.post(`/products/${productId}/track-canvas`).catch(() => {});
      }
    },
    [toggleGarment],
  );

  return (
    <aside className="relative z-10 flex w-[380px] shrink-0 flex-col justify-between overflow-hidden border-r border-hiraya-sand/30 bg-hiraya-olive/60 p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-hiraya-sand/30 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.3em] text-hiraya-ink">
            <Layers size={16} className="text-hiraya-ink" /> My Bag Style Stack
          </h3>
          <p className="mt-0.5 text-[10px] text-hiraya-sand">
            {locked ? 'Step 1 — add your photo, then pick pieces' : 'Tap a piece to wear it · scroll each row for more'}
          </p>
        </div>
        <button
          onClick={() => navigate('/cart')}
          title="Go to My Bag"
          className="rounded-xl border-hiraya-sand/30 bg-hiraya-sand/60 p-2 text-hiraya-sand transition-colors duration-200 hover:bg-[#CB997E]/15 hover:text-hiraya-ink"
        >
          <ShoppingBag size={15} />
        </button>
      </div>

      {locked && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border-amber-400/25 bg-amber-500/10 px-3 py-2.5">
          <Lock size={12} className="mt-0.5 shrink-0 text-amber-300" />
          <p className="text-[10px] leading-relaxed text-amber-200">{lockedMessage}</p>
        </div>
      )}

      <div className="scrollbar-none flex-1 space-y-5 overflow-y-auto py-4">
        {isBusy ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 size={22} className="animate-spin text-hiraya-ink" />
            <span className="text-[10px] uppercase tracking-widest text-hiraya-sand">
              Loading your bag…
            </span>
          </div>
        ) : (
          CATEGORY_ROWS.map((meta) => {
            const items = resolvedByCategory?.[meta.key] || [];
            const selected = selectedGarments[meta.key] || null;
            /*
             * Two separate reasons a tile can be unusable, kept distinct so the
             * hint below can name the RIGHT one:
             *   - `locked`            : no body photo yet (step 1 not done)
             *   - `excludedByRule`    : a dress is worn, or a top/bottom is
             *                           worn and this row is Dresses
             */
            const excludedByRule = Array.isArray(lockedCategories) && lockedCategories.includes(meta.key);
            const disabled = locked || excludedByRule;
            const canClear = typeof clearLayer === 'function' && selected && !locked;

            return (
              <div key={meta.key}>
                <CategoryStackRow
                  meta={meta}
                  items={items}
                  selected={selected}
                  onToggle={handleToggle}
                  disabled={disabled}
                  /* Names the exclusion so a greyed-out row explains itself. */
                  excludedByRule={excludedByRule}
                />
                {canClear && (
                  <button
                    type="button"
                    onClick={() => clearLayer(meta.key)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-hiraya-ink hover:underline"
                  >
                    <Trash2 size={10} /> Remove {meta.label} layer
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <AnimatePresence>
        {hasSelectedItems && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="border-t border-hiraya-sand/30 bg-hiraya-cream-deep/80 pt-3 backdrop-blur-md"
          >
            <div className="mb-2 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-hiraya-sand">
              <Sparkles size={10} className="text-hiraya-ink" /> Active outfit
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-hiraya-sand">
                {selectedCount} item(s) layered
              </span>
              <button
                type="button"
                onClick={clearAllStack}
                className="flex items-center gap-1.5 rounded-xl border-red-500/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-400 transition-colors duration-200 hover:bg-red-500/10"
              >
                <Trash2 size={12} /> Clear Stack
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
};

export default StyleStack;