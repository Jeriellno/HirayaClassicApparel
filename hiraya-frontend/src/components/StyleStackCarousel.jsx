import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, Loader2, Shirt, Sparkles } from 'lucide-react';
import { useTransparentImage } from '../hooks/useTransparentImage';

/**
 * StyleStackCarousel — the"My Bag" garment style stack as a swipable,
 * coverflow-style carousel (think video-game character/inventory selection).
 *
 * WHY COVERFLOW (and not the old flat row):
 *   The previous UI was a horizontally-scrolling strip per category. That made
 *   the ACTIVE garment visually indistinguishable from its neighbours and hid
 *   half the wardrobe off-screen. Here the focused garment sits dead-centre at
 *   full scale/opacity, while the previous and next items curve away on either
 *   side with reduced scale, rotation and brightness — so the eye is instantly
 *   drawn to the piece that will be worn, and the neighbours are still visible.
 *
 * BEHAVIOUR CONTRACT:
 *   - `items`           the garments for the ACTIVE category.
 *   - `focusedId`       which garment is currently centred (owned by the parent).
 *   - `onFocusChange`   fired when the user clicks/swipes/arrow-keys to a new item.
 *   - `onActivate`      fired when the user confirms the focused garment
 *                       (clicking the centre card or the"Wear" button). This is
 *                       where the parent calls `toggleGarment`.
 *
 * The component is intentionally CONTROLLED: it never owns"which item is
 * selected" — that lives in useTryOnState. It only owns the transient FOCUSED
 * index, and mirrors it back up so sibling surfaces (the price/size/colour
 * read-out) stay in lockstep with the centre slot.
 */

// How many neighbours are rendered on each side. Kept small so the perspective
// stays legible in the narrow Studio sidebar.
const VISIBLE_SIDE = 2;

// Layout knobs for the coverflow transform, in px. Tuned for a ~340px panel.
const STEP_X = 96;   // horizontal distance between adjacent slots
const STEP_Y = 18;   // downward drift for off-centre slots (the"curve")
const MIN_SCALE = 0.62;
const SCALE_STEP = 0.16;

/** Signed distance from the focused slot: -2,-1,0,1,2 ... */
const offsetOf = (index, focused, length) => {
  if (!length) return 0;
  // Pick the shortest signed distance around the ring so the carousel wraps
  // seamlessly instead of jamming at the ends.
  let diff = index - focused;
  const half = length / 2;
  if (diff > half) diff -= length;
  if (diff < -half) diff += length;
  return diff;
};

/** Single coverflow slot: image + price, with the focus/activation affordances. */
const CarouselSlot = ({ garment, offset, isFocused, isSelected, isDisabled, onFocus, onActivate }) => {
  /*
   * Only run the heavy in-browser removal when the garment has NO prepared
   * cut-out. When the admin pipeline already produced a transparent
   * `display_image_url`, running the model would cost a ~95 MB model load plus
   * CPU inference to recompute a result we already have — the cause of the
   * multi-second "hang" before a tile appeared.
   */
  const hasPreparedCutout = !!garment.image_url && /\.[a-z]*png(\?|$)/i.test(garment.image_url);
  const { transparentUrl, isProcessing } = useTransparentImage(
    hasPreparedCutout ? null : garment.image_url
  );
  const absOffset = Math.abs(offset);

  const width = isFocused ? 168 : 138;
  const height = isFocused ? 196 : 164;
  const scale = Math.max(MIN_SCALE, 1 - absOffset * SCALE_STEP);
  const rotateY = isFocused ? 0 : offset < 0 ? 26 : -26;
  const opacity = isFocused ? 1 : absOffset === 1 ? 0.72 : 0.38;
  const zIndex = 100 - absOffset;
  const x = offset * STEP_X;
  const y = absOffset * STEP_Y;

  return (
    <motion.div
      className="absolute left-1/2 top-0"
      style={{ zIndex }}
      animate={{
        x: `calc(-50% + ${x}px)`,
        y,
        scale,
        opacity,
        rotateY,
      }}
      transition={{ type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }}
      onClick={() => (isFocused ? onActivate?.(garment) : onFocus?.(garment))}
    >
      <div
        role="button"
        tabIndex={isFocused ? 0 : -1}
        aria-label={`${garment.name}${isFocused ? ' (focused)' : ''}`}
        aria-pressed={isSelected}
        aria-disabled={isDisabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            isFocused ? onActivate?.(garment) : onFocus?.(garment);
          }
        }}
        style={{ width, height, transformStyle: 'preserve-3d' }}
        className={[
          'relative flex flex-col items-center justify-between rounded-3xl border p-3 cursor-pointer select-none',
          'bg-gradient-to-b from-hiraya-sand/90 to-hiraya-bg/90 backdrop-blur-sm transition-colors duration-300',
          isFocused
            ? 'border-hiraya-gold/70 shadow-[0_0_28px_rgba(245,235,224,0.30)]'
            : 'border-hiraya-olive/25 hover:border-hiraya-olive/20',
          isDisabled ? 'pointer-events-none' : '',
        ].join(' ')}
      >
        {/* Focus spotlight behind the centred garment */}
        {isFocused && (
          <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_50%_35%,rgba(245,235,224,0.16),transparent_70%)]" />
        )}

        {/* Tier badge: 'bag' = active purchase, 'recommended' = For You.
            The old 'saved' (bookmark) tier went with the wishlist. */}
        {garment.source && (
          <span
            className={`absolute left-2 top-2 z-10 rounded-full border px-2 py-0.5 text-[7px] font-black uppercase tracking-wider ${garment.source === 'bag'
              ? 'border-hiraya-gold/50 bg-[#541A1A]/15 text-hiraya-ink'
              : 'border-sky-600/40 bg-sky-400/10 text-sky-800'
              }`}
          >
            {garment.source === 'bag' ? 'Bag' : 'For You'}
          </span>
        )}

        {/* Selected check */}
        {isSelected && (
          <div className="absolute -right-1.5 -top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#541A1A] text-hiraya-on-accent shadow-lg shadow-stone-200/20">
            <Check size={13} strokeWidth={3} />
          </div>
        )}

        {/* Garment image — always painted; the optional cut-out streams in
            underneath a small spinner badge rather than blocking the tile. */}
        <div className="relative flex w-full flex-1 items-center justify-center">
          <img
            src={transparentUrl || garment.image_url}
            alt={garment.name}
            draggable={false}
            className="max-h-full max-w-full object-contain drop-shadow-lg"
            style={{ backgroundColor: 'transparent' }}
          />
          {isProcessing && (
            <span
              className="pointer-events-none absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-hiraya-peach/60"
              title="Enhancing cut-out”¦"
            >
              <Loader2 size={10} className="animate-spin text-hiraya-ink" />
            </span>
          )}
        </div>

        {/* Dynamic detail panel — only the focused slot spells out size/colour. */}
        <div className="w-full text-center">
          <p className={`truncate font-bold ${isFocused ? 'text-[11px] text-hiraya-ink' : 'text-[10px] text-hiraya-sand'}`}>
            {garment.name}
          </p>
          {isFocused && (
            <p className="mt-0.5 text-[9px] uppercase tracking-widest text-hiraya-sand">
              {garment.selected_size || 'Size —'} · {garment.selected_color || 'Colour —'}
            </p>
          )}
          <p className={`mt-0.5 font-extrabold text-hiraya-ink ${isFocused ? 'text-xs' : 'text-[10px]'}`}>
            â‚±{Number(garment.price || 0).toLocaleString()}
          </p>
        </div>

        {/* Explicit"Wear" confirm on the focused card */}
        {isFocused && (
          <button
            type="button"
            disabled={isDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onActivate?.(garment);
            }}
            className={`mt-2 w-full rounded-xl py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${isSelected
              ? 'bg-[#541A1A]/15 text-hiraya-ink hover:bg-[#541A1A]/30'
              : 'bg-[#541A1A] text-hiraya-on-accent hover:bg-hiraya-gold-deep'
              }`}
          >
            {isSelected ? 'Wearing' : 'Wear This'}
          </button>
        )}
      </div>
    </motion.div>
  );
};

/** One carousel instance for one garment category. */
const CategoryCarousel = ({ items, selectedId, isDisabled, onActivate, focusedIndex, onFocusedIndexChange }) => {
  const count = items.length;

  // Guard the focused index against list changes (items can arrive async).
  const safeIndex = count ? ((focusedIndex % count) + count) % count : 0;

  const goTo = useCallback(
    (index) => {
      if (!count) return;
      onFocusedIndexChange(((index % count) + count) % count);
    },
    [count, onFocusedIndexChange],
  );

  const step = useCallback((delta) => goTo(safeIndex + delta), [goTo, safeIndex]);

  // Pointer swipe handling — a drag further than the threshold advances one slot.
  const dragStartX = useRef(null);
  const onPointerDown = (e) => { dragStartX.current = e.clientX; };
  const onPointerUp = (e) => {
    if (dragStartX.current == null) return;
    const dx = e.clientX - dragStartX.current;
    dragStartX.current = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  };

  // Keyboard support on the track itself.
  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  };

  if (!count) {
    return (
      <div className="rounded-2xl border-dashed border-hiraya-olive/25 bg-hiraya-sand p-6 text-center">
        <p className="text-[10px] italic text-hiraya-sand">Nothing in this layer yet</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* The 3D stage */}
      <div
        role="listbox"
        aria-label="Garment style stack"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="relative flex h-[248px] items-start justify-center outline-none"
        style={{ perspective: '1200px' }}
      >
        {items.map((garment, index) => {
          const offset = offsetOf(index, safeIndex, count);
          // Only render the focused slot and its immediate neighbours.
          if (Math.abs(offset) > VISIBLE_SIDE) return null;

          return (
            <CarouselSlot
              key={garment.id ?? `${garment.productId}-${index}`}
              garment={garment}
              offset={offset}
              isFocused={offset === 0}
              isSelected={selectedId != null && selectedId === garment.id}
              isDisabled={isDisabled}
              onFocus={() => goTo(index)}
              onActivate={onActivate}
            />
          );
        })}
      </div>

      {/* Nav arrows + position dots */}
      <div className="mt-3 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={count < 2}
          aria-label="Previous garment"
          className="flex h-7 w-7 items-center justify-center rounded-full border-hiraya-olive/25 bg-hiraya-peach/60 text-hiraya-sand transition-colors hover:border-hiraya-gold/50 hover:text-hiraya-ink disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </button>

        <div className="flex items-center gap-1.5">
          {items.map((g, i) => (
            <button
              key={g.id ?? i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to garment ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === safeIndex ? 'w-5 bg-[#541A1A]' : 'w-1.5 bg-hiraya-sand/80 hover:bg-hiraya-sand'}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={count < 2}
          aria-label="Next garment"
          className="flex h-7 w-7 items-center justify-center rounded-full border-hiraya-olive/25 bg-hiraya-peach/60 text-hiraya-sand transition-colors hover:border-hiraya-gold/50 hover:text-hiraya-ink disabled:opacity-30"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};

/**
 * StyleStackCarousel — category tabs + the carousel for the active category.
 *
 * @param {Object}   props.garmentsByCategory  { top: [], bottom: [], ... }
 * @param {Object}   props.selectedGarments    { top: garment|null, ... }
 * @param {Function} props.toggleGarment       (garment) => void
 * @param {Object}   props.categoryMeta        { top: { label, icon }, ... }
 * @param {string[]} props.categories          ordered category keys
 * @param {string}   props.activeCategory      controlled active tab
 * @param {Function} props.onCategoryChange    (key) => void
 * @param {boolean}  props.isLoading
 */
export const StyleStackCarousel = ({
  garmentsByCategory = {},
  selectedGarments = {},
  toggleGarment,
  categoryMeta = {},
  categories = ['top', 'bottom', 'footwear', 'outerwear', 'dress'],
  activeCategory = 'top',
  onCategoryChange,
  isLoading = false,
}) => {
  const items = garmentsByCategory[activeCategory] || [];

  /**
   * The carousel FOCUS is which card is centred — distinct from SELECTION
   * (what is actually worn). We seed focus from whatever is already selected so
   * returning to a category re-centres on the customer's chosen piece.
   */
  const [focusedByCategory, setFocusedByCategory] = useState({});

  const selectedForCategory = selectedGarments[activeCategory] || null;

  const focusedIndex = useMemo(() => {
    const explicit = focusedByCategory[activeCategory];
    if (typeof explicit === 'number') return explicit;
    if (!selectedForCategory) return 0;
    const idx = items.findIndex((g) => g.id === selectedForCategory.id);
    return idx >= 0 ? idx : 0;
  }, [focusedByCategory, activeCategory, items, selectedForCategory]);

  // If the item list shrinks underneath a stale index, clamp it back in range.
  useEffect(() => {
    if (!items.length) return;
    if (focusedIndex > items.length - 1) {
      setFocusedByCategory((prev) => ({ ...prev, [activeCategory]: 0 }));
    }
  }, [items.length, focusedIndex, activeCategory]);

  // A Dress replaces Tops+Bottoms in the outfit model, so those layers are
  // inert while a dress is active — same rule the flat rows enforced.
  const isDressActive = !!selectedGarments.dress;
  const isCategoryDisabled = isDressActive && (activeCategory === 'top' || activeCategory === 'bottom');

  const focusedGarment = items[focusedIndex] || null;

  const setFocusedIndex = useCallback(
    (index) => setFocusedByCategory((prev) => ({ ...prev, [activeCategory]: index })),
    [activeCategory],
  );

  /**
   * In the carousel a click does double duty:
   *   - on a NEIGHBOUR: bring it to centre (focus only — no outfit change).
   *   - on the FOCUSED card /"Wear This": commit it (selection changes).
   * `onActivate` is therefore only ever passed the garment the user confirms.
   */
  const handleActivate = useCallback(
    (garment) => {
      if (isCategoryDisabled) return;
      toggleGarment?.(garment);
    },
    [isCategoryDisabled, toggleGarment],
  );

  return (
    <div className="space-y-4">
      {/* CATEGORY TABS — the stack carousel persists across all 5 layers */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map((catKey) => {
          const meta = categoryMeta[catKey] || {};
          const Icon = meta.icon;
          const count = (garmentsByCategory[catKey] || []).length;
          const isActive = activeCategory === catKey;
          const isTabDisabled = isDressActive && (catKey === 'top' || catKey === 'bottom');

          return (
            <button
              key={catKey}
              type="button"
              onClick={() => !isTabDisabled && onCategoryChange?.(catKey)}
              disabled={isTabDisabled}
              className={[
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-all',
                isActive
                  ? 'border-hiraya-gold/60 bg-[#541A1A]/15 text-hiraya-ink'
                  : 'border-hiraya-olive/25 bg-hiraya-peach/50 text-hiraya-sand hover:border-hiraya-olive/20 hover:text-hiraya-ink',
                isTabDisabled ? 'cursor-not-allowed opacity-30' : '',
              ].join(' ')}
            >
              {Icon ? <Icon size={12} /> : null}
              {meta.label || catKey}
              <span className={`rounded-full px-1.5 text-[8px] ${isActive ? 'bg-[#541A1A]/30 text-hiraya-ink' : 'bg-hiraya-disabled-bg text-hiraya-disabled-ink'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* CAROUSEL STAGE */}
      <div className="relative overflow-hidden rounded-3xl border-hiraya-olive/25 bg-gradient-to-b from-hiraya-bg/60 to-hiraya-bg/60 p-3 pt-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 size={22} className="animate-spin text-hiraya-ink" />
            <span className="text-[10px] uppercase tracking-widest text-hiraya-sand">Loading your bag...</span>
          </div>
        ) : (
          <CategoryCarousel
            key={activeCategory}
            items={items}
            selectedId={selectedForCategory?.id ?? null}
            isDisabled={isCategoryDisabled}
            onActivate={handleActivate}
            focusedIndex={focusedIndex}
            onFocusedIndexChange={setFocusedIndex}
          />
        )}
      </div>

      {/* FOCUS READ-OUT — size / colour / price update as the focus moves */}
      <AnimatePresence mode="wait">
        {focusedGarment && (
          <motion.div
            key={focusedGarment.id ?? focusedGarment.productId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-between rounded-2xl border-hiraya-olive/25 bg-hiraya-sand/80 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-hiraya-sand">
                <Sparkles size={10} className="text-hiraya-ink" /> In Focus
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold text-hiraya-ink">{focusedGarment.name}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-hiraya-sand">
                {focusedGarment.selected_size || 'Size —'} · {focusedGarment.selected_color || 'Colour —'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[9px] uppercase tracking-widest text-hiraya-sand">Price</p>
              <p className="text-sm font-extrabold text-hiraya-ink">
                â‚±{Number(focusedGarment.price || 0).toLocaleString()}
              </p>
              {selectedForCategory?.id === focusedGarment.id && (
                <span className="mt-1 inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-hiraya-ink">
                  <Shirt size={9} /> Wearing
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StyleStackCarousel;
