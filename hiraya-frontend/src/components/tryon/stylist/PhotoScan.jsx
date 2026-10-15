import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loader2, ScanLine } from 'lucide-react';
import { useContainRect } from '../../../hooks/useContainRect';
import { enter, leave, spring, stagger } from '../../../utils/motion';

/*
 * PHOTO SCAN — the customer SEES the stylist read their photo.
 *
 * While the analysis runs, a brass beam sweeps down the picture over a faint
 * tailor's grid. When it returns, dots pop in where the model found the chest
 * and legs, and "AI sees" chips name what it read: the colours being worn and
 * the suggested palette. Nothing here is decided by the AI — it only describes;
 * the customer confirms the palette in the step beside it.
 *
 * Drawn inside `theme-locked` on navy so it looks the same in both themes.
 */

const BRASS = '#D3C09C';
const PALETTE_WORD = { warm: 'Warm tones', cool: 'Cool tones', neutral: 'Neutral tones' };
const POINT_LABEL = { torso: 'Top', legs: 'Bottom' };

/** A CSS colour for a word the model used ("navy", "light blue"), or null. */
const swatchFor = (word) => {
  if (typeof CSS === 'undefined' || !CSS.supports) return null;
  const joined = String(word).toLowerCase().replace(/\s+/g, '');
  if (CSS.supports('color', joined)) return joined;
  const last = String(word).toLowerCase().trim().split(/\s+/).pop();
  return CSS.supports('color', last) ? last : null;
};

const Chip = ({ children, delay, reduce, swatch = undefined }) => (
  <motion.span
    className="inline-flex items-center gap-1.5 rounded-full bg-navy-950/75 px-2.5 py-1 text-xs font-medium text-cream-100 ring-1 ring-cream-50/15 backdrop-blur-md"
    initial={reduce ? false : { opacity: 0, y: 8, scale: 0.9 }}
    animate={{ opacity: 1, y: 0, scale: 1, transition: spring(reduce, delay) }}
    exit={{ opacity: 0, transition: leave(reduce) }}
  >
    {swatch !== undefined && (
      <span
        className="h-3 w-3 rounded-full ring-1 ring-cream-50/40"
        style={{ background: swatch || 'linear-gradient(135deg,#8C8984,#E4D6BA)' }}
        aria-hidden="true"
      />
    )}
    {children}
  </motion.span>
);

Chip.propTypes = { children: PropTypes.node, delay: PropTypes.number, reduce: PropTypes.bool, swatch: PropTypes.string };

const PhotoScan = ({ src, status, result, compact = false }) => {
  const reduce = useReducedMotion();
  const { ref, rect } = useContainRect(src);
  const scanning = status === 'processing';
  const done = status === 'done' && !!result;
  const points = done
    ? Object.entries(POINT_LABEL).filter(([key]) => result.anchors?.[key]).map(([key, label]) => ({ key, label, ...result.anchors[key] }))
    : [];
  const colors = done ? (result.wearing_colors || []).slice(0, compact ? 2 : 3) : [];

  return (
    <div className="theme-locked relative isolate h-full w-full overflow-hidden rounded-[22px] bg-navy-950">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_35%,rgba(54,74,106,0.55)_0%,transparent_70%)]" />
      <div ref={ref} className="absolute inset-0">
        {src && <img src={src} alt="Your photo" className="h-full w-full object-contain" />}

        {rect && (
          <div
            className="pointer-events-none absolute"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            aria-hidden="true"
          >
            {/* While reading, the photo dims under a tailor's grid; it lifts when done. */}
            <motion.div
              className="absolute inset-0"
              style={{
                backgroundColor: 'rgba(13, 21, 36, 0.38)',
                backgroundImage: `linear-gradient(${BRASS}4D 1px, transparent 1px), linear-gradient(90deg, ${BRASS}4D 1px, transparent 1px)`,
                backgroundSize: '22px 22px',
              }}
              initial={false}
              animate={{ opacity: scanning ? 1 : 0 }}
              transition={enter(reduce, { duration: 0.4 })}
            />

            {/* The beam sweeping down the picture. */}
            {scanning && !reduce && (
              <motion.div
                className="absolute inset-x-0 top-0 h-16"
                style={{
                  background: `linear-gradient(to bottom, transparent, ${BRASS}47)`,
                  borderBottom: `2px solid ${BRASS}`,
                  boxShadow: `0 6px 18px ${BRASS}80`,
                }}
                initial={{ y: -64 }}
                animate={{ y: [-64, rect.height] }}
                transition={{ duration: 2.2, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.15 }}
              />
            )}

            {/* Where the stylist found you. */}
            {points.map((p, i) => (
              <span
                key={p.key}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              >
                <motion.span
                  className="relative flex items-center"
                  initial={reduce ? false : { scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={spring(reduce, stagger(i, 0.18, 0.1))}
                >
                  {!reduce && (
                    <motion.span
                      className="absolute left-0 h-4 w-4 rounded-full"
                      style={{ background: BRASS }}
                      initial={{ scale: 1, opacity: 0.6 }}
                      animate={{ scale: 3, opacity: 0 }}
                      transition={{ duration: 1.1, delay: stagger(i, 0.18, 0.2), ease: 'easeOut' }}
                    />
                  )}
                  <span className="relative h-4 w-4 rounded-full ring-2 ring-navy-950" style={{ background: BRASS }} />
                  {!compact && (
                    <span className="ml-2 rounded-full bg-navy-950/80 px-2 py-0.5 text-[11px] font-semibold text-cream-100 ring-1 ring-cream-50/15">
                      {p.label}
                    </span>
                  )}
                </motion.span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* What the stylist is doing / what it read. */}
      <div className={`absolute inset-x-3 flex flex-wrap items-center gap-1.5 ${compact ? 'bottom-2' : 'bottom-3'}`}>
        <AnimatePresence initial={false}>
          {scanning && (
            <Chip key="reading" reduce={reduce} delay={0}>
              <Loader2 size={12} className="animate-spin text-cream-400" aria-hidden="true" />
              <span>Reading your photo…</span>
            </Chip>
          )}
          {done && (
            <Chip key="sees" reduce={reduce} delay={0.25}>
              <ScanLine size={12} className="text-cream-400" aria-hidden="true" />
              <span>AI sees</span>
            </Chip>
          )}
          {colors.map((c, i) => (
            <Chip key={`c-${c}`} reduce={reduce} delay={stagger(i, 0.08, 0.35)} swatch={swatchFor(c)}>
              <span translate="no">{c}</span>
            </Chip>
          ))}
          {done && PALETTE_WORD[result.undertone] && (
            <Chip key="tone" reduce={reduce} delay={stagger(colors.length, 0.08, 0.35)}>
              <span>{PALETTE_WORD[result.undertone]}</span>
            </Chip>
          )}
        </AnimatePresence>
      </div>

      <p className="sr-only" aria-live="polite">
        {scanning ? 'Reading your photo…' : done ? `The stylist sees ${colors.join(', ') || 'your outfit'}. ${PALETTE_WORD[result.undertone] || ''}` : ''}
      </p>
    </div>
  );
};

PhotoScan.propTypes = {
  src: PropTypes.string,
  status: PropTypes.string,
  result: PropTypes.object,
  compact: PropTypes.bool,
};

export default PhotoScan;
