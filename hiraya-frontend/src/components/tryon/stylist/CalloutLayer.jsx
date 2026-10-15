import { useEffect, useId, useState } from 'react';
import PropTypes from 'prop-types';
import { motion, useReducedMotion } from 'framer-motion';
import { useContainRect } from '../../../hooks/useContainRect';
import { enter, leave, spring } from '../../../utils/motion';

/*
 * CALLOUT LAYER — dots on the customer's body, leader lines out to boxes.
 *
 * Modelled on an "anatomy" diagram: the subject in the middle, a dot on each
 * relevant part, a line to a labelled box beside it. It is shared by the
 * Lookbook (what to wear on each part) and the Verdict (how it looks on each
 * part) so the stylist speaks one visual language before and after a render.
 *
 * MOTION (all skipped for reduced motion):
 *   assembly — dots pop in, lines draw from each box to the body, then a brass
 *              light pulse travels down each line ("the piece goes onto you").
 *   link     — pointing at a box or a dot (`activeKey`) makes its body part
 *              glow and its line thicken while the others dim.
 *   swap     — a changed piece (`ripple` count) ripples its dot and re-sends
 *              the pulse.
 *   exiting  — the boxes shrink and glide into their dots (the hand-off to a
 *              render).
 *
 * Dots sit at fractions of the PICTURE (from the photo analysis), mapped onto
 * the letterboxed rectangle the image is actually painted in. When the canvas
 * has no room beside the picture (phones, landscape photos) the boxes collapse
 * into NUMBERED dots and the numbered panel under the canvas carries them.
 *
 * Colours are theme tokens: the well (`bg-noir`) is black in light mode and
 * WHITE in dark mode, and `cream-100` / `cream-400` invert with it.
 */

const GAP = 20;      // space between the picture and a box
const MARGIN = 8;    // keep boxes off the canvas edge
const ASSEMBLY_MS = 1400;

const CalloutLayer = ({
  src, anchors, items, cardWidth = 196, cardHeight = 112, onModeChange = null,
  activeKey = null, onActiveChange = null, exiting = false, pulse = true, reserveBottom = 0,
}) => {
  const reduce = useReducedMotion();
  const glowId = `callout-glow-${useId().replace(/:/g, '')}`;
  const { ref, box, rect } = useContainRect(src);
  const [assembled, setAssembled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAssembled(true), reduce ? 0 : ASSEMBLY_MS);
    return () => clearTimeout(t);
  }, [reduce]);

  const wide = !!rect
    && rect.left >= cardWidth + GAP + MARGIN
    && box.width - (rect.left + rect.width) >= cardWidth + GAP + MARGIN;

  const mode = rect ? (wide ? 'callouts' : 'numbered') : null;
  useEffect(() => {
    if (onModeChange && mode) onModeChange(mode);
  }, [mode, onModeChange]);

  if (!rect) {
    return <div ref={ref} className="pointer-events-none absolute inset-0" aria-hidden="true" />;
  }

  const point = (name) => {
    const a = anchors?.[name] || { x: 0.5, y: 0.5 };
    return { x: rect.left + a.x * rect.width, y: rect.top + a.y * rect.height };
  };

  const setActive = (key) => onActiveChange?.(key);
  const someActive = !!activeKey && !exiting;
  const delay = (base) => (assembled ? 0 : base);

  // Place boxes per side, top to bottom, pushing down any that would overlap.
  const placed = [];
  ['left', 'right'].forEach((side) => {
    let lastBottom = MARGIN - GAP;
    items
      .filter((it) => it.side === side)
      .map((it) => ({ ...it, dot: point(it.anchor) }))
      .sort((a, b) => a.dot.y - b.dot.y)
      .forEach((it) => {
        const h = it.height || cardHeight;
        // Boxes stay above `reserveBottom` (the action row drawn over the canvas).
        let top = Math.max(MARGIN, Math.min(box.height - h - MARGIN - reserveBottom, it.dot.y - h / 2));
        top = Math.max(top, lastBottom + 8);
        lastBottom = top + h;
        const left = side === 'left' ? rect.left - GAP - cardWidth : rect.left + rect.width + GAP;
        placed.push({ ...it, top, left, h });
      });
  });

  // Numbered dots: offset dots that share an anchor so the numbers never stack.
  const shared = {};
  // A number that would sit under the action row is lifted above it, with a
  // short dashed tie back to the real point.
  const numberFloor = box.height - reserveBottom - 18;
  const numbered = items.map((it) => {
    const p = point(it.anchor);
    shared[it.anchor] = (shared[it.anchor] || 0) + 1;
    return { ...it, x: p.x + (shared[it.anchor] - 1) * 26, y: Math.min(p.y, numberFloor), trueY: p.y };
  });

  // A ring that spreads from a dot when its piece changes (keyed by the count).
  const ripple = (key, x, y, n) => (n > 0 && !reduce ? (
    <motion.circle
      key={`${key}-ripple-${n}`}
      cx={x}
      cy={y}
      fill="none"
      stroke="var(--color-cream-400)"
      strokeWidth="2"
      initial={{ r: 6, opacity: 0.8 }}
      animate={{ r: 30, opacity: 0 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
    />
  ) : null);

  if (!wide) {
    return (
      <div ref={ref} className="pointer-events-none absolute inset-0 z-20">
        <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {numbered.map((it) => (it.trueY > it.y + 4 && !exiting ? (
            <line key={`tie-${it.key}`} x1={it.x} y1={it.y} x2={it.x} y2={it.trueY} stroke="var(--color-cream-100)" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="3 3" />
          ) : null))}
          {numbered.map((it) => ripple(it.key, it.x, it.y, it.ripple || 0))}
        </svg>
        {numbered.map((it, i) => (
          <span key={it.key} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: it.x, top: it.y }} aria-hidden="true">
            <motion.span
              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-navy-900 bg-cream-50 text-xs font-bold text-navy-900 shadow-[0_4px_6px_rgba(0,0,0,0.35)] ${activeKey === it.key ? 'ring-4 ring-cream-400/70' : ''}`}
              initial={reduce ? false : { scale: 0 }}
              animate={exiting ? { scale: 1.6, opacity: 0 } : { scale: 1, opacity: 1 }}
              transition={exiting ? leave(reduce, 0.4) : spring(reduce, delay(0.05 + i * 0.08))}
            >
              {it.number}
            </motion.span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-20">
      <svg className="absolute inset-0 h-full w-full overflow-visible text-cream-100" aria-hidden="true">
        <defs>
          <radialGradient id={glowId}>
            <stop offset="0%" style={{ stopColor: 'var(--color-cream-400)', stopOpacity: 0.7 }} />
            <stop offset="100%" style={{ stopColor: 'var(--color-cream-400)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        {placed.map((it, i) => {
          const isActive = activeKey === it.key && !exiting;
          const dim = someActive && !isActive;
          const fromX = it.side === 'left' ? it.left + cardWidth : it.left;
          const fromY = it.top + it.h / 2;
          const elbowX = it.side === 'left' ? fromX + 12 : fromX - 12;
          const d = `M ${fromX} ${fromY} L ${elbowX} ${fromY} L ${it.dot.x} ${it.dot.y}`;
          return (
            <g key={`line-${it.key}`}>
              {/* The body part this box is about, lit while pointed at. */}
              <motion.circle
                cx={it.dot.x}
                cy={it.dot.y}
                r="56"
                fill={`url(#${glowId})`}
                initial={false}
                animate={{ opacity: isActive ? 1 : 0 }}
                transition={enter(reduce)}
              />
              {it.dashed ? (
                <motion.path
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: exiting ? 0 : dim ? 0.3 : 0.8 }}
                  transition={enter(reduce, { delay: delay(0.2 + i * 0.08) })}
                />
              ) : (
                <motion.path
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  initial={reduce ? false : { pathLength: 0, pathOffset: 0, opacity: 0.85 }}
                  /* On exit the line is eaten from the box end, following the box into the dot. */
                  animate={{
                    pathLength: exiting ? 0 : 1,
                    pathOffset: exiting ? 1 : 0,
                    opacity: dim ? 0.3 : 0.85,
                    strokeWidth: isActive ? 2.5 : 1.5,
                  }}
                  transition={{
                    pathLength: exiting ? enter(reduce, { duration: 0.42 }) : enter(reduce, { delay: delay(0.15 + i * 0.08), duration: 0.45 }),
                    pathOffset: exiting ? enter(reduce, { duration: 0.42 }) : { duration: 0 },
                    opacity: enter(reduce),
                    strokeWidth: enter(reduce),
                  }}
                />
              )}
              {/* The brass light: once on arrival, again after every swap. */}
              {pulse && !reduce && !it.dashed && !exiting && (
                <motion.path
                  key={`pulse-${it.ripple || 0}`}
                  d={d}
                  fill="none"
                  stroke="var(--color-cream-400)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  style={{ filter: 'drop-shadow(0 0 4px var(--color-cream-400))' }}
                  initial={{ pathLength: 0.14, pathOffset: 0, opacity: 0 }}
                  animate={{ pathOffset: 0.86, opacity: [0, 1, 1, 0] }}
                  transition={{
                    pathOffset: { duration: 0.65, delay: delay(0.6 + i * 0.1), ease: 'easeInOut' },
                    opacity: { duration: 0.65, delay: delay(0.6 + i * 0.1), times: [0, 0.15, 0.8, 1] },
                  }}
                />
              )}
              {ripple(it.key, it.dot.x, it.dot.y, it.ripple || 0)}
              {/* The dot is a hover target too: pointing at it lifts its box. */}
              <g
                style={{ pointerEvents: exiting ? 'none' : 'auto', cursor: 'pointer' }}
                onMouseEnter={() => setActive(it.key)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(isActive ? null : it.key)}
              >
                <circle cx={it.dot.x} cy={it.dot.y} r="18" fill="transparent" style={{ pointerEvents: 'all' }} />
                <motion.circle
                  cx={it.dot.x}
                  cy={it.dot.y}
                  r="10"
                  fill="currentColor"
                  fillOpacity="0.2"
                  initial={reduce ? false : { scale: 0 }}
                  animate={{ scale: exiting ? 1.8 : 1, opacity: exiting ? 0 : 1 }}
                  transition={exiting ? leave(reduce, 0.45) : spring(reduce, delay(0.05 + i * 0.08))}
                />
                <motion.circle
                  cx={it.dot.x}
                  cy={it.dot.y}
                  r="5"
                  fill="currentColor"
                  stroke="var(--color-navy-900)"
                  strokeWidth="2"
                  initial={reduce ? false : { scale: 0 }}
                  animate={{ scale: exiting ? 1.6 : isActive ? 1.35 : 1 }}
                  transition={spring(reduce, delay(0.05 + i * 0.08))}
                />
              </g>
            </g>
          );
        })}
      </svg>
      {placed.map((it, i) => {
        const isActive = activeKey === it.key && !exiting;
        const dim = someActive && !isActive;
        // Where this box must travel to land on its dot (for the hand-off).
        const dx = it.dot.x - (it.left + cardWidth / 2);
        const dy = it.dot.y - (it.top + it.h / 2);
        return (
          <motion.div
            key={it.key}
            className="pointer-events-auto absolute"
            style={{ top: it.top, left: it.left, width: cardWidth, minHeight: it.h, zIndex: isActive ? 2 : 1 }}
            initial={reduce ? false : { opacity: 0, x: it.side === 'left' ? -14 : 14 }}
            animate={exiting
              ? { opacity: 0, x: dx, y: dy, scale: 0.15 }
              : { opacity: dim ? 0.55 : 1, x: 0, y: isActive ? -3 : 0, scale: 1 }}
            transition={exiting
              ? enter(reduce, { duration: 0.42, delay: i * 0.04 })
              : enter(reduce, { delay: delay(0.2 + i * 0.07) })}
            onMouseEnter={() => setActive(it.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(it.key)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setActive(null); }}
          >
            {it.node}
          </motion.div>
        );
      })}
    </div>
  );
};

CalloutLayer.propTypes = {
  src: PropTypes.string,
  anchors: PropTypes.object,
  items: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    anchor: PropTypes.oneOf(['torso', 'legs', 'feet']).isRequired,
    side: PropTypes.oneOf(['left', 'right']).isRequired,
    number: PropTypes.number,
    dashed: PropTypes.bool,
    height: PropTypes.number,
    ripple: PropTypes.number,
    node: PropTypes.node,
  })).isRequired,
  cardWidth: PropTypes.number,
  cardHeight: PropTypes.number,
  onModeChange: PropTypes.func,
  activeKey: PropTypes.string,
  onActiveChange: PropTypes.func,
  exiting: PropTypes.bool,
  pulse: PropTypes.bool,
  reserveBottom: PropTypes.number,
};

export default CalloutLayer;
