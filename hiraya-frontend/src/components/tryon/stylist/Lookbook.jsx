import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, ChevronDown, Check, Sparkles, Wand2, Footprints, SlidersHorizontal, AlertTriangle, Dices,
} from 'lucide-react';
import CalloutLayer from './CalloutLayer';
import LookFilmstrip from './LookFilmstrip';
import Currency from '../../common/Currency';
import { getProductImageUrl } from '../../../utils/imageHelper';
import { ANCHOR_FOR_SLOT } from '../../../utils/containRect';
import { useContainRect } from '../../../hooks/useContainRect';
import { DUR, enter, leave, spring, stagger } from '../../../utils/motion';

/*
 * THE LOOKBOOK — card 2 of the AI Stylist.
 *
 * LookbookOverlay is drawn ON the customer's photo: a dot on each body part the
 * look dresses, a line out to a card naming the suggested piece, a filmstrip of
 * looks A/B/C, per-piece swaps (arrows or a swipe, like a deck of cards),
 * "Surprise me", and one primary action, "Try this look".
 *
 * LookbookDetails sits under the canvas as an OUTFIT BOARD: the pieces as a
 * flat-lay collage, each with its reasons. Pointing at a tile lights the same
 * body part on the photo above, so the board and the photo stay linked. On a
 * phone (no room for lines) the photo shows numbered dots and the board
 * carries the cards.
 */

const SLOT_LABEL = { upper: 'Top', lower: 'Bottom', full: 'Outfit', feet: 'Shoes' };
const PREFERENCE_LABEL = { womenswear: "Women's", menswear: "Men's", both: "Women's + men's" };

/* Controls drawn ON the canvas well use token pairs that invert with it. */
const WELL_PRIMARY = 'inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full bg-cream-100 px-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-900 shadow-[0_12px_28px_-10px_rgba(0,0,0,0.65)] transition-colors hover:bg-cream-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 focus-visible:ring-offset-2 focus-visible:ring-offset-noir';
const WELL_SECONDARY = 'min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-2 rounded-full bg-noir/70 px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-cream-100 ring-1 ring-cream-100/20 backdrop-blur-md transition-colors hover:bg-noir/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100';

const sideFor = (slot, hasLower) => {
  if (slot === 'lower') return 'right';
  if (slot === 'feet') return hasLower ? 'left' : 'right';
  return 'left';
};

const Thumb = ({ src, alt, className = '' }) => (
  <img
    src={src ? getProductImageUrl(src) : '/images/placeholder.svg'}
    alt={alt}
    loading="lazy"
    draggable={false}
    className={`shrink-0 rounded-lg bg-white object-contain ${className}`}
    onError={(e) => { e.currentTarget.src = '/images/placeholder.svg'; }}
  />
);

Thumb.propTypes = { src: PropTypes.string, alt: PropTypes.string.isRequired, className: PropTypes.string };

/* ‹ 2/3 › with a dot per option, so the customer sees how deep the deck is. */
const SwapBar = ({ piece, onSwap, size = 'sm' }) => {
  if (!piece.optionCount || piece.optionCount < 2) return null;
  const btn = size === 'lg' ? 'h-11 w-11' : 'h-7 w-7';
  const what = SLOT_LABEL[piece.slot]?.toLowerCase() || 'piece';
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => onSwap(piece.slot, -1)}
        aria-label={`Previous ${what} option`}
        className={`${btn} flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-hiraya-surface-sunken text-hiraya-ink transition-colors hover:bg-navy-900 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus`}
      >
        <ChevronLeft size={size === 'lg' ? 18 : 15} />
      </button>
      <span className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: piece.optionCount }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-200 ${i === piece.optionIndex ? 'w-4 bg-navy-900' : 'w-1.5 bg-hiraya-ink-muted/40'}`}
          />
        ))}
      </span>
      <span className="sr-only" aria-live="polite">Option {piece.optionIndex + 1} of {piece.optionCount}</span>
      <button
        type="button"
        onClick={() => onSwap(piece.slot, 1)}
        aria-label={`Next ${what} option`}
        className={`${btn} flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-hiraya-surface-sunken text-hiraya-ink transition-colors hover:bg-navy-900 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus`}
      >
        <ChevronRight size={size === 'lg' ? 18 : 15} />
      </button>
    </div>
  );
};

SwapBar.propTypes = { piece: PropTypes.object.isRequired, onSwap: PropTypes.func.isRequired, size: PropTypes.oneOf(['sm', 'lg']) };

const deck = (reduce) => ({
  enter: (d) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * 44, rotate: d * 5 }),
  center: { opacity: 1, x: 0, rotate: 0, transition: spring(reduce) },
  exit: (d) => (reduce ? { opacity: 0, transition: leave(reduce) } : { opacity: 0, x: d * -44, rotate: d * -5, transition: leave(reduce) }),
});

/** The card at the end of a leader line. Swipe (or ‹ ›) deals the next option. */
const PieceCallout = ({ piece, number, onSwap, dir = 1, active = false }) => {
  const reduce = useReducedMotion();
  const swappable = piece.optionCount > 1;
  const onDragEnd = (_, info) => {
    if (info.offset.x < -40) onSwap(piece.slot, 1);
    else if (info.offset.x > 40) onSwap(piece.slot, -1);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-hiraya-surface text-hiraya-ink transition-shadow duration-200 ${
        active ? 'shadow-[0_20px_40px_-12px_rgba(0,0,0,0.6)] ring-2 ring-cream-400' : 'shadow-[0_10px_26px_-8px_rgba(0,0,0,0.5)]'
      }`}
    >
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={`${piece.id}-${piece.color}`}
          custom={dir}
          variants={deck(reduce)}
          initial="enter"
          animate="center"
          exit="exit"
          drag={swappable && !reduce ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.35}
          onDragEnd={swappable ? onDragEnd : undefined}
          className={`p-3 ${swappable ? 'cursor-grab touch-pan-y active:cursor-grabbing' : ''}`}
        >
          <div className="flex gap-2.5">
            <Thumb src={piece.image_url} alt={piece.name} className="h-16 w-[52px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-hiraya-ink-muted">
                {number} · {SLOT_LABEL[piece.slot]}
              </p>
              <p className="line-clamp-2 text-[13px] font-semibold leading-snug" title={piece.name} translate="no">{piece.name}</p>
              <p className="truncate text-xs text-hiraya-ink-muted">
                <span translate="no">{piece.color}</span>{piece.size ? ` · ${piece.size}` : ''}
              </p>
            </div>
          </div>
          {piece.reasons?.[0] && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-hiraya-accent-wash px-2 py-1.5 text-xs leading-snug" title={piece.reasons[0]}>
              <Check size={13} className="mt-px shrink-0" aria-hidden="true" />
              <span className="line-clamp-2">{piece.reasons[0]}</span>
            </p>
          )}
        </motion.div>
      </AnimatePresence>
      {swappable && (
        <div className="px-3 pb-3">
          <SwapBar piece={piece} onSwap={onSwap} />
        </div>
      )}
    </div>
  );
};

PieceCallout.propTypes = {
  piece: PropTypes.object.isRequired,
  number: PropTypes.number.isRequired,
  onSwap: PropTypes.func.isRequired,
  dir: PropTypes.number,
  active: PropTypes.bool,
};

const TipCallout = ({ tip, number }) => (
  <div className="rounded-2xl border border-dashed border-cream-100/50 bg-noir/70 p-3 text-cream-100 backdrop-blur-md">
    <div className="flex items-center gap-3">
      <Thumb src={tip.image_url} alt={tip.name} className="h-11 w-11" />
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-80">
          <Footprints size={12} aria-hidden="true" /> {number} · Styling tip
        </p>
        <p className="truncate text-[13px] font-semibold" translate="no">{tip.name}</p>
        <p className="text-xs opacity-80">Not part of the try-on render</p>
      </div>
    </div>
  </div>
);

TipCallout.propTypes = { tip: PropTypes.object.isRequired, number: PropTypes.number.isRequired };

/* While the stylist works: the body points pulse, as if being measured. */
export const MeasuringPulse = ({ src, anchors }) => {
  const reduce = useReducedMotion();
  const { ref, rect } = useContainRect(src);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      {rect && ['torso', 'legs', 'feet'].map((name, i) => {
        const a = anchors?.[name];
        if (!a) return null;
        return (
          <span
            key={name}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: rect.left + a.x * rect.width, top: rect.top + a.y * rect.height }}
          >
            {!reduce && (
              <motion.span
                className="absolute left-1/2 top-1/2 -ml-3 -mt-3 h-6 w-6 rounded-full bg-cream-400"
                animate={{ scale: [1, 2.8], opacity: [0.55, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.25, ease: 'easeOut' }}
              />
            )}
            <span className="relative block h-3 w-3 rounded-full bg-cream-400 ring-2 ring-noir/60" />
          </span>
        );
      })}
    </div>
  );
};

MeasuringPulse.propTypes = { src: PropTypes.string, anchors: PropTypes.object };

/* -------------------------------------------------------------------------- */

export const LookbookOverlay = ({ stylist, photoSrc, isGenerating, onModeChange }) => {
  const reduce = useReducedMotion();
  const {
    lookbook, looks, look, activeLook, changeLook, selectLook, resolvedPieces, swapPiece, swapMeta,
    activeSlot, setActiveSlot, canShuffle, shuffleLook, tryLook, trying, openModal, modalOpen,
  } = stylist;
  const [spins, setSpins] = useState(0);
  const browsing = lookbook.status === 'ready' && looks.length > 1 && !isGenerating && !trying;

  // ←/→ browse looks (not while typing, or while a dialog/drawer is open).
  useEffect(() => {
    if (!browsing) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="radiogroup"], [role="slider"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      changeLook(e.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [browsing, changeLook]);

  if (isGenerating) return null;

  // Before any lookbook: one clear way in.
  if (lookbook.status === 'idle' || lookbook.status === 'error') {
    if (modalOpen) return null;
    return (
      <motion.div
        className="absolute inset-x-0 bottom-5 z-30 flex flex-col items-center gap-2 px-4"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter(reduce)}
      >
        {lookbook.status === 'error' && (
          <p role="alert" className="flex items-center gap-2 rounded-full bg-noir/75 px-4 py-2 text-xs text-cream-100 backdrop-blur-md">
            <AlertTriangle size={14} aria-hidden="true" />
            {lookbook.error || 'The stylist could not build looks right now.'} Try again.
          </p>
        )}
        <button type="button" onClick={openModal} className={WELL_PRIMARY}>
          <Sparkles size={16} aria-hidden="true" /> Style me
        </button>
      </motion.div>
    );
  }

  if (lookbook.status === 'loading') {
    return (
      <>
        <MeasuringPulse src={photoSrc} anchors={stylist.anchors} />
        <div className="absolute inset-x-0 bottom-5 z-30 flex justify-center px-4" role="status">
          <span className="flex items-center gap-2 rounded-full bg-noir/75 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-cream-100 backdrop-blur-md">
            <Sparkles size={14} className="animate-pulse" aria-hidden="true" /> Building your looks…
          </span>
        </div>
      </>
    );
  }

  if (!look) {
    return (
      <motion.div
        className="absolute inset-x-0 bottom-5 z-30 flex flex-col items-center gap-3 px-4"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter(reduce)}
      >
        <p className="max-w-md rounded-2xl bg-noir/80 px-5 py-3 text-center text-sm leading-relaxed text-cream-100 backdrop-blur-md">
          {lookbook.data?.notice || 'No looks for these answers yet.'}
        </p>
        <button type="button" onClick={openModal} className={WELL_PRIMARY}>
          <SlidersHorizontal size={16} aria-hidden="true" /> Change answers
        </button>
      </motion.div>
    );
  }

  const hasLower = resolvedPieces.some((p) => p.slot === 'lower');
  const items = resolvedPieces.map((piece, i) => ({
    key: piece.slot,
    anchor: ANCHOR_FOR_SLOT[piece.slot] || 'torso',
    side: sideFor(piece.slot, hasLower),
    number: i + 1,
    ripple: swapMeta?.[piece.slot]?.n || 0,
    node: (
      <PieceCallout
        piece={piece}
        number={i + 1}
        onSwap={swapPiece}
        dir={swapMeta?.[piece.slot]?.dir || 1}
        active={activeSlot === piece.slot}
      />
    ),
  }));
  if (look.styling_tip) {
    items.push({
      key: 'tip',
      anchor: 'feet',
      side: sideFor('feet', hasLower),
      number: items.length + 1,
      dashed: true,
      height: 76,
      node: <TipCallout tip={look.styling_tip} number={items.length + 1} />,
    });
  }

  const surprise = () => {
    setSpins((n) => n + 1);
    shuffleLook();
  };

  return (
    <>
      <LookFilmstrip looks={looks} active={activeLook} onSelect={selectLook} onStep={changeLook} hidden={trying} />

      {/* Keyed by look: switching looks re-assembles the callouts. */}
      <CalloutLayer
        key={look.id}
        src={photoSrc}
        anchors={stylist.anchors}
        items={items}
        cardHeight={150}
        reserveBottom={64}
        onModeChange={onModeChange}
        activeKey={activeSlot}
        onActiveChange={setActiveSlot}
        exiting={trying}
      />

      {/* One primary action; the rest stay quiet. */}
      <motion.div
        className="absolute inset-x-0 bottom-5 z-30 flex flex-wrap items-center justify-center gap-2 px-4"
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: trying ? 0 : 1, y: trying ? 12 : 0 }}
        transition={enter(reduce, { delay: trying ? 0 : 0.35 })}
        style={{ pointerEvents: trying ? 'none' : 'auto' }}
      >
        <motion.button
          type="button"
          onClick={tryLook}
          className={WELL_PRIMARY}
          whileHover={reduce ? undefined : { y: -2 }}
          whileTap={reduce ? undefined : { scale: 0.97 }}
        >
          <Wand2 size={16} aria-hidden="true" /> Try this look
        </motion.button>
        {canShuffle && (
          <button type="button" onClick={surprise} aria-label="Surprise me" className={`${WELL_SECONDARY} inline-flex`}>
            <motion.span
              className="flex"
              animate={{ rotate: spins * 360 }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 14 }}
              aria-hidden="true"
            >
              <Dices size={16} />
            </motion.span>
            {/* Phones: icon only, so the actions fit on one row above the legs dot. */}
            <span className="hidden sm:inline">Surprise me</span>
          </button>
        )}
        <button
          type="button"
          onClick={openModal}
          /* Phones: hidden here (it sits on the legs dot); the board has it. */
          className={`${WELL_SECONDARY} hidden sm:inline-flex`}
        >
          <SlidersHorizontal size={14} aria-hidden="true" /> Change answers
        </button>
      </motion.div>
    </>
  );
};

LookbookOverlay.propTypes = {
  stylist: PropTypes.object.isRequired,
  photoSrc: PropTypes.string,
  isGenerating: PropTypes.bool,
  onModeChange: PropTypes.func,
};

/* -------------------------------------------------------------------------- */

const TILE_ROTATE = [-5, 4, -2, 3];
const TILE_DROP = [0, 20, 8, 26];

/* One flat-lay tile on the outfit board: a paper card with a strip of tape. */
const BoardTile = ({ piece, number, index, active, onPoint, dir = 1, dashed = false }) => {
  const reduce = useReducedMotion();
  const rotate = TILE_ROTATE[index % TILE_ROTATE.length];
  const drop = TILE_DROP[index % TILE_DROP.length];
  return (
    <motion.li
      className="relative -ml-5 w-32 shrink-0 first:ml-0 sm:-ml-6 sm:w-40"
      style={{ zIndex: active ? 20 : 10 - index }}
      initial={reduce ? false : { opacity: 0, y: drop + 24, rotate: rotate * 2 }}
      animate={{ opacity: 1, y: active ? drop - 10 : drop, rotate: active ? 0 : rotate, scale: active ? 1.05 : 1 }}
      transition={reduce ? { duration: 0 } : { ...spring(reduce), delay: 0 }}
      onMouseEnter={() => onPoint(piece.slot)}
      onMouseLeave={() => onPoint(null)}
    >
      {/* Paper and tape keep their light colours in both themes (a real flat-lay). */}
      <div
        className={`relative rounded-xl p-2 pb-3 shadow-[0_14px_30px_-12px_rgba(13,21,36,0.45)] ${dashed ? 'outline-dashed outline-2 outline-offset-2 outline-hiraya-structure-line' : ''}`}
        style={{ backgroundColor: '#FCFAF5' }}
      >
        <span aria-hidden="true" className="absolute -top-2 left-1/2 h-4 w-14 -translate-x-1/2 -rotate-3 rounded-sm shadow-sm" style={{ backgroundColor: 'rgba(228, 214, 186, 0.85)' }} />
        <div className="relative h-32 overflow-hidden rounded-lg sm:h-40">
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.img
              key={`${piece.id}-${piece.color}`}
              src={piece.image_url ? getProductImageUrl(piece.image_url) : '/images/placeholder.svg'}
              alt={piece.name}
              loading="lazy"
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
              custom={dir}
              variants={deck(reduce)}
              initial="enter"
              animate="center"
              exit="exit"
              onError={(e) => { e.currentTarget.src = '/images/placeholder.svg'; }}
            />
          </AnimatePresence>
        </div>
        {/* Top-right: the next tile overlaps this one's left edge. */}
        <span className="theme-locked absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-cream-100 shadow-md ring-2 ring-cream-50">
          {number}
        </span>
      </div>
    </motion.li>
  );
};

BoardTile.propTypes = {
  piece: PropTypes.object.isRequired,
  number: PropTypes.number.isRequired,
  index: PropTypes.number.isRequired,
  active: PropTypes.bool,
  onPoint: PropTypes.func.isRequired,
  dir: PropTypes.number,
  dashed: PropTypes.bool,
};

export const LookbookDetails = ({ stylist }) => {
  const reduce = useReducedMotion();
  const { lookbook, look, looks, resolvedPieces, swapPiece, swapMeta, activeSlot, setActiveSlot, openModal } = stylist;
  const [whyOpen, setWhyOpen] = useState(false);

  if (lookbook.status !== 'ready' || !lookbook.data) return null;
  const { occasion, preference, undertone, notice } = lookbook.data;
  const tip = look?.styling_tip || null;

  return (
    <motion.section
      aria-label="Your lookbook"
      className="card-raised rounded-[24px] p-5 text-hiraya-ink sm:p-6"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enter(reduce, { duration: DUR.slow })}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
            <Sparkles size={14} aria-hidden="true" /> AI Stylist{look ? ` · Look ${look.letter} of ${looks.length}` : ''}
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={look?.id || 'none'}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: enter(reduce) }}
              exit={{ opacity: 0, transition: leave(reduce) }}
            >
              <h3 className="mt-1 font-serif text-xl leading-tight">{look ? look.name : 'Your lookbook'}</h3>
              {look && <p className="mt-1 text-sm text-hiraya-ink-muted" translate="no">{look.summary}</p>}
            </motion.div>
          </AnimatePresence>
          <p className="mt-2 text-xs text-hiraya-ink-muted">
            For {occasion?.label} · {PREFERENCE_LABEL[preference] || preference}
            {undertone ? ` · ${undertone} palette` : ''}
          </p>
        </div>
        <button type="button" onClick={openModal} className="btn-secondary min-h-[44px] cursor-pointer rounded-full px-4">
          <SlidersHorizontal size={14} aria-hidden="true" /> Change answers
        </button>
      </div>

      {notice && (
        <p className="notice-warn mt-4 flex gap-2 rounded-xl px-4 py-3 text-sm leading-relaxed">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      {look && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
          {/* THE BOARD — a flat-lay of the look; pointing at a tile lights the photo. */}
          <ol className="flex items-start justify-center px-3 pb-8 pt-4" aria-label="Outfit board">
            {resolvedPieces.map((piece, i) => (
              <BoardTile
                key={piece.slot}
                piece={piece}
                number={i + 1}
                index={i}
                active={activeSlot === piece.slot}
                onPoint={setActiveSlot}
                dir={swapMeta?.[piece.slot]?.dir || 1}
              />
            ))}
            {tip && (
              <BoardTile
                key="tip"
                piece={{ ...tip, slot: 'tip' }}
                number={resolvedPieces.length + 1}
                index={resolvedPieces.length}
                active={activeSlot === 'tip'}
                onPoint={setActiveSlot}
                dashed
              />
            )}
          </ol>

          {/* THE PIECES — name, price, the top reason, and the swap deck. */}
          <div>
            <ol className="space-y-2">
              {resolvedPieces.map((piece, i) => (
                <li
                  key={piece.slot}
                  onMouseEnter={() => setActiveSlot(piece.slot)}
                  onMouseLeave={() => setActiveSlot(null)}
                  className={`rounded-2xl p-3 transition-colors duration-200 ${activeSlot === piece.slot ? 'bg-hiraya-accent-wash' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-cream-100">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-hiraya-ink-muted">{SLOT_LABEL[piece.slot]}</p>
                      <Link to={piece.url || `/product/${piece.id}`} className="block truncate text-[15px] font-semibold text-hiraya-ink hover:underline" translate="no">
                        {piece.name}
                      </Link>
                      <p className="text-sm text-hiraya-ink-muted">
                        <span translate="no">{piece.color}</span>
                        {piece.size ? ` · Size ${piece.size}` : ''} · <Currency amount={piece.price} decimals={false} />
                      </p>
                      {piece.reasons?.[0] && (
                        <p className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded-lg bg-hiraya-surface-sunken px-2.5 py-1 text-xs leading-snug">
                          <Check size={13} className="mt-px shrink-0" aria-hidden="true" />
                          <span>{piece.reasons[0]}</span>
                        </p>
                      )}
                    </div>
                    <div className="hidden w-36 shrink-0 self-center sm:block">
                      <SwapBar piece={piece} onSwap={swapPiece} size="lg" />
                    </div>
                  </div>
                  <div className="mt-2 sm:hidden">
                    <SwapBar piece={piece} onSwap={swapPiece} size="lg" />
                  </div>
                </li>
              ))}
              {tip && (
                <li className="rounded-2xl p-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hiraya-ink text-xs font-bold">{resolvedPieces.length + 1}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-hiraya-ink-muted">Styling tip</p>
                      <Link to={tip.url || `/product/${tip.id}`} className="block truncate text-[15px] font-semibold hover:underline" translate="no">
                        {tip.name}
                      </Link>
                      <p className="text-[13px] text-hiraya-ink-muted">Not part of the try-on render — add it to your bag if you like it.</p>
                    </div>
                  </div>
                </li>
              )}
            </ol>

            {/* WHY THIS LOOK — every reason the rules gave, on request. */}
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              aria-expanded={whyOpen}
              aria-controls="stylist-why"
              className="mt-3 flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-xl px-3 text-sm font-semibold transition-colors hover:bg-hiraya-accent-wash focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
            >
              <span>{whyOpen ? 'Hide why' : 'Why this look?'}</span>
              <motion.span animate={{ rotate: whyOpen ? 180 : 0 }} transition={enter(reduce)} className="flex" aria-hidden="true">
                <ChevronDown size={16} />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {whyOpen && (
                <motion.div
                  id="stylist-why"
                  className="overflow-hidden"
                  initial={reduce ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1, transition: enter(reduce) }}
                  exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, transition: leave(reduce, 0.2) }}
                >
                  <div className="space-y-3 px-3 pb-1 pt-2">
                    {look.notes?.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {look.notes.map((n) => (
                          <li key={n} className="flex items-center gap-1.5 rounded-full bg-hiraya-accent-wash px-3 py-1.5 text-xs">
                            <Check size={13} aria-hidden="true" /> {n}
                          </li>
                        ))}
                      </ul>
                    )}
                    {resolvedPieces.map((piece, i) => (
                      <div key={piece.slot}>
                        <p className="text-xs font-semibold"><span className="tabular-nums">{i + 1}</span> · <span translate="no">{piece.name}</span></p>
                        <ul className="mt-1 space-y-1">
                          {(piece.reasons || []).map((r, k) => (
                            <motion.li
                              key={r}
                              className="flex gap-1.5 text-[13px] leading-snug text-hiraya-ink-muted"
                              initial={reduce ? false : { opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0, transition: enter(reduce, { delay: stagger(k, 0.04, 0.05) }) }}
                            >
                              <Check size={14} className="mt-0.5 shrink-0 text-hiraya-ink" aria-hidden="true" /> {r}
                            </motion.li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </motion.section>
  );
};

LookbookDetails.propTypes = { stylist: PropTypes.object.isRequired };
