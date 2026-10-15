import { useEffect } from 'react';
import PropTypes from 'prop-types';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { EASE_OUT } from '../../../utils/motion';

/*
 * SCORE RING — the verdict at a glance.
 *
 * The ring fills to the share of checks that passed while the number counts
 * up to it ("3/3"). All passed: green and a small brass sparkle; anything to
 * note: amber. The words under it ("All checks passed") carry the same
 * meaning, so it never relies on colour alone.
 */

const SPARKS = [0, 60, 120, 180, 240, 300];

const ScoreRing = ({ good, total, size = 116, stroke = 9 }) => {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const share = total ? good / total : 0;
  const allGood = total > 0 && good === total;
  const count = useMotionValue(reduce ? good : 0);
  const shown = useTransform(count, (v) => Math.round(v));

  useEffect(() => {
    if (reduce) {
      count.set(good);
      return undefined;
    }
    const controls = animate(count, good, { duration: 0.9, delay: 0.25, ease: EASE_OUT });
    return () => controls.stop();
  }, [good, reduce, count]);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${good} of ${total} checks passed`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-hiraya-structure-line" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={allGood ? '#059669' : '#D97706'}
          strokeWidth={stroke}
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: share }}
          transition={reduce ? { duration: 0 } : { duration: 1, delay: 0.25, ease: EASE_OUT }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className="font-serif text-3xl leading-none tabular-nums text-hiraya-ink">
          <motion.span>{shown}</motion.span>
          <span className="text-hiraya-ink-muted">/{total}</span>
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-hiraya-ink-muted">checks</span>
      </div>

      {/* A small brass burst once the ring closes on a perfect score. */}
      {allGood && !reduce && SPARKS.map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const reach = size / 2 + 10;
        return (
          <motion.span
            key={deg}
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 -ml-1 -mt-1 h-2 w-2 rotate-45 rounded-[2px] bg-cream-600"
            initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
            animate={{ x: Math.cos(rad) * reach, y: Math.sin(rad) * reach, scale: [0, 1.2, 0], opacity: [0, 1, 0] }}
            transition={{ duration: 0.9, delay: 1.2 + i * 0.03, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
};

ScoreRing.propTypes = {
  good: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  size: PropTypes.number,
  stroke: PropTypes.number,
};

export default ScoreRing;
