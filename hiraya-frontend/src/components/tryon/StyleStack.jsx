import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Layers, ShoppingBag, Trash2, Shirt, Loader2, ChevronLeft, ChevronRight, Sparkles, Lock, Link2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';
import StyleStackGarmentCard from './StyleStackGarmentCard';
import { resolveStackCategory } from '../../utils/categoryHelpers';
import { useFloatingCutouts } from '../../hooks/useFloatingCutouts';

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
      pairedProducts: product.paired_products || [],
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

  /*
   * A SHELF. The row title is a small engraved label; an empty category
   * collapses to one quiet line instead of a dashed box, so a bag with two
   * pieces does not read as four empty drawers. The scroll arrows only appear
   * when there is more than one piece to scroll to.
   */
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between px-0.5">
        <h4 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink">
          <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${items.length ? 'bg-cream-200/70 text-navy-800 shadow-neu-inset' : 'text-hiraya-ink-muted'}`}>
            <Icon size={13} />
          </span>
          {label}
          <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${items.length ? 'bg-navy-900 text-cream-100' : 'bg-cream-200 text-hiraya-ink-muted'}`}>
            {items.length}
          </span>
        </h4>

        {items.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label={`Scroll ${label} left`}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-hiraya-surface text-hiraya-ink shadow-neu-sm transition-colors hover:bg-navy-900 hover:text-cream-100"
            >
              <ChevronLeft size={12} />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label={`Scroll ${label} right`}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-hiraya-surface text-hiraya-ink shadow-neu-sm transition-colors hover:bg-navy-900 hover:text-cream-100"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-1 text-[10px] italic text-hiraya-ink-muted">No {label.toLowerCase()} in your bag yet</p>
      ) : (
        /* Rendered as a wrapper so the exclusion hint can sit above the scroller
           without becoming a snap item itself. */
        <div>
        <div
          ref={scrollerRef}
          className="scrollbar-none -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 pt-1"
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
                 * Only Dresses (a bottom is worn) and Bottoms (a dress is worn)
                 * are ever locked; a top or outerwear can be layered over a dress.
                 */
                disabledReason={
                  excludedByRule
                    ? (label === 'Dresses'
                        ? 'A bottom is already worn — remove it to wear a dress'
                        : 'A dress is worn — it already covers the bottom')
                    : null
                }
              />
            </div>
          ))}
          </div>

          {/* Explains WHY the row is greyed out, so it never looks broken. */}
          {excludedByRule && (
            <p className="mt-1.5 text-[9px] leading-snug text-amber-800">
              {label === 'Dresses'
                ? 'Remove your bottom to wear a dress — a top can stay on over it.'
                : 'A dress covers this — remove the dress to wear a bottom.'}
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

  // Showcase-only reads: how many pieces are on the shelves, and the worn
  // pieces' images for the outfit preview in the footer.
  const pieceCount = CATEGORY_ROWS.reduce((n, row) => n + (resolvedByCategory?.[row.key]?.length || 0), 0);
  const wornPieces = Object.values(selectedGarments).filter(Boolean);
  const wornImages = wornPieces.map((g) => g.display_image_url || g.image_url).filter(Boolean);
  const wornCutouts = useFloatingCutouts(wornImages);

  /*
   * PAIRED LOOKS — the try-on half of garment pairing.
   *
   * For every worn piece, the pieces an admin paired with it that are NOT
   * worn yet. A partner already in the bag can be worn with one tap; one that
   * is not in the bag links to its product page (a size has to be chosen
   * before it can join the bag). Each partner is listed once even when two
   * worn pieces both point to it.
   *
   * A dress + top or dress + outerwear pair is worn together too: the top or
   * outerwear is layered over the dress. A worn dress never locks the Tops or
   * Outerwear rows, so its paired piece just toggles on. A dress paired with
   * the worn top or outerwear while a BOTTOM is also worn is the one locked
   * partner that can still be worn: "Wear together" takes the bottom off first
   * (`swapsBottom`), so the dress keeps the upper piece instead of replacing
   * the whole set. Any other partner in a locked row links to its page,
   * because tapping it would take a worn piece off.
   */
  const pairSuggestions = useMemo(() => {
    const locks = Array.isArray(lockedCategories) ? lockedCategories : [];
    const inBag = new Map();
    Object.entries(resolvedByCategory || {}).forEach(([rowKey, rows]) =>
      (rows || []).forEach((g) => inBag.set(Number(g.productId), { garment: g, rowKey })),
    );
    const wornIds = new Set(wornPieces.map((g) => Number(g.productId)));
    const seen = new Set();
    const out = [];
    wornPieces.forEach((worn) => {
      (worn.pairedProducts || []).forEach((pair) => {
        const pid = Number(pair?.id);
        if (!pid || wornIds.has(pid) || seen.has(pid)) return;
        seen.add(pid);
        const hit = inBag.get(pid);
        const rowLocked = !!hit && locks.includes(hit.rowKey);
        const swapsBottom = rowLocked && hit.rowKey === 'dress' && ['top', 'outerwear'].includes(worn.category)
          && typeof clearLayer === 'function';
        const wearable = !!hit && (!rowLocked || swapsBottom);
        out.push({ pair, with: worn.name, garment: wearable ? hit.garment : null, swapsBottom });
      });
    });
    return out;
  }, [resolvedByCategory, wornPieces, lockedCategories, clearLayer]);

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
    /*
     * THE STACK PANEL IS A RULED CREAM SIDEBAR.
     *
     * It was `border-hiraya-olive/20 bg-hiraya-cream-deep` with a 20px shadow —
     * `olive` is INDIGO, so the panel's own edge rule was being struck in dark
     * ink, and the two hairlines inside it (the header rule and the row rules)
     * were the same dark band. Every divider now uses the system parchment
     * hairline, so the panel reads as stock with rules rather than as a boxed
     * widget.
     */
    <aside
      data-tour="style-stack"
      className="relative z-10 flex max-h-[80vh] w-full shrink-0 flex-col justify-between overflow-hidden rounded-[26px] bg-hiraya-surface p-3 shadow-neu ring-1 ring-cream-50/80 lg:max-h-none lg:w-[380px]"
    >
      {/*
        * THE VITRINE HEADER — a navy plate carrying the title, a live count
        * of what is on the shelves and what is worn, and the door to My Bag.
        */}
      {/* `theme-locked`: the plate is navy in BOTH themes, so its cream text
          must not follow the dark-mode ramp swap (it went near-invisible). */}
      <div className="theme-locked relative isolate overflow-hidden rounded-[20px] bg-[linear-gradient(150deg,#1D2C45_0%,#152036_55%,#0D1524_100%)] px-4 py-4 text-cream-100 shadow-[0_16px_30px_-20px_rgba(13,21,36,0.9)]">
        <div aria-hidden="true" className="absolute -right-10 -top-14 -z-10 h-36 w-36 rounded-full border border-cream-50/10" />
        <div aria-hidden="true" className="vintage-grain absolute inset-0 -z-10 opacity-25 mix-blend-soft-light" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.24em] text-cream-400">
              <Layers size={12} /> Style Stack
            </span>
            <h3 className="mt-1.5 font-serif text-[1.15rem] uppercase leading-none tracking-[0.06em] text-cream-50">My Bag</h3>
            <p className="mt-2 text-[10px] leading-snug text-cream-300">
              {locked ? 'Step 1 — add your photo, then pick pieces' : 'Tap a piece to wear it · scroll each shelf for more'}
            </p>
          </div>
          <button
            onClick={() => navigate('/cart')}
            title="Go to My Bag"
            aria-label="Go to My Bag"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-cream-100 text-navy-900 shadow-[0_8px_16px_-8px_rgba(0,0,0,0.8)] transition-colors hover:bg-cream-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream-100"
          >
            <ShoppingBag size={15} />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em]">
          <span className="rounded-full bg-cream-50/10 px-2.5 py-1 text-cream-200">{pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}</span>
          <span className={`rounded-full px-2.5 py-1 ${selectedCount ? 'bg-cream-100 text-navy-900' : 'bg-cream-50/10 text-cream-300'}`}>
            {selectedCount} worn
          </span>
        </div>
      </div>

      {locked && (
        <div className="notice-warn mx-1 mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5">
          <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs leading-relaxed">{lockedMessage}</p>
        </div>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto px-2 py-4 scrollbar-none">
        {isBusy ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 size={22} className="animate-spin text-hiraya-accent" />
            <span className="text-[10px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
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
                    className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted transition-colors hover:text-hiraya-accent hover:underline"
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
            className="mx-1 mb-1 rounded-[18px] bg-cream-200/50 p-3 shadow-neu-inset"
          >
            {pairSuggestions.length > 0 && !locked && (
              <div className="mb-3 rounded-xl border border-hiraya-structure-line/80 bg-hiraya-surface/70 p-2.5">
                <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-hiraya-ink-muted">
                  <Link2 size={10} className="text-navy-800" /> Paired looks
                </p>
                <ul className="space-y-1.5">
                  {pairSuggestions.slice(0, 3).map(({ pair, with: withName, garment, swapsBottom }) => (
                    <li key={pair.id} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="min-w-0 text-hiraya-ink">
                        <span className="block truncate font-semibold">{pair.name}</span>
                        <span className="block truncate text-[9px] text-hiraya-ink-muted">pairs with {withName}</span>
                      </span>
                      {garment ? (
                        <button
                          type="button"
                          onClick={() => {
                            // Free the Dresses row first, so the dress keeps the top / outerwear on over it.
                            if (swapsBottom) clearLayer('bottom');
                            handleToggle(garment);
                          }}
                          className="shrink-0 cursor-pointer rounded-full bg-navy-900 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-cream-100 transition-colors hover:bg-navy-800"
                        >
                          Wear together
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => navigate(`/product/${pair.id}`)}
                          className="shrink-0 cursor-pointer rounded-full border border-hiraya-structure-line px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-hiraya-ink transition-colors hover:bg-cream-200"
                        >
                          View piece
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mb-2 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-hiraya-ink-muted">
              <Sparkles size={10} className="text-navy-800" /> Active outfit
            </div>
            <div className="flex items-center justify-between gap-3">
              {/* The worn pieces as a fanned row of cut-outs. */}
              <div className="flex min-w-0 items-center">
                <div className="flex -space-x-3">
                  {wornPieces.slice(0, 5).map((g, i) => {
                    const img = g.display_image_url || g.image_url;
                    const cut = img ? wornCutouts[img] : null;
                    return (
                      <motion.span
                        key={g.id ?? i}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-hiraya-surface shadow-neu-sm ring-2 ring-cream-100"
                        style={{ zIndex: 10 - i }}
                        title={g.name}
                      >
                        {img && (cut !== undefined) && (
                          <img src={cut ? cut.src : img} alt="" className="h-8 w-8 object-contain" />
                        )}
                      </motion.span>
                    );
                  })}
                </div>
                <span className="currency ml-3 text-[10px] text-hiraya-ink-muted">
                  {selectedCount} item(s) layered
                </span>
              </div>
              <button
                type="button"
                onClick={clearAllStack}
                className="btn-danger shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-[10px]"
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

const iconPropTypes = { size: PropTypes.number };
BottomsIcon.propTypes = iconPropTypes;
FootwearIcon.propTypes = iconPropTypes;
OuterwearIcon.propTypes = iconPropTypes;
AccessoriesIcon.propTypes = iconPropTypes;
DressIcon.propTypes = iconPropTypes;

CategoryStackRow.propTypes = {
  meta: PropTypes.shape({
    key: PropTypes.string,
    label: PropTypes.string.isRequired,
    icon: PropTypes.elementType.isRequired,
  }).isRequired,
  items: PropTypes.array.isRequired,
  selected: PropTypes.object,
  onToggle: PropTypes.func,
  disabled: PropTypes.bool,
  excludedByRule: PropTypes.bool,
};

StyleStack.propTypes = {
  garmentsByCategory: PropTypes.object,
  selectedGarments: PropTypes.object,
  toggleGarment: PropTypes.func,
  clearLayer: PropTypes.func,
  clearAllStack: PropTypes.func,
  isLoading: PropTypes.bool,
  locked: PropTypes.bool,
  lockedMessage: PropTypes.string,
  lockedCategories: PropTypes.array,
};

export default StyleStack;