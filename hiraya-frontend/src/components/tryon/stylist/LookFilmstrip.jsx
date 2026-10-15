import PropTypes from 'prop-types';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getProductImageUrl } from '../../../utils/imageHelper';
import { enter, spring } from '../../../utils/motion';

/*
 * LOOK FILMSTRIP — replaces the text-only "Look A · 1/2" switcher.
 *
 * Each look is a tab showing its own pieces as small overlapping thumbnails,
 * so the customer can SEE the other looks before switching. A highlight slides
 * to the active tab (shared layout), and ‹ › plus the ←/→ keys step through.
 */

const LookFilmstrip = ({ looks, active, onSelect, onStep, hidden = false }) => {
  const reduce = useReducedMotion();
  if (!looks.length) return null;

  const arrow = 'hidden h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-cream-100/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 sm:flex';

  return (
    <motion.div
      /* Phones: below the photo-check chip in the corner. */
      className="absolute inset-x-0 top-14 z-30 flex justify-center px-3 sm:top-4"
      initial={reduce ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? -10 : 0 }}
      transition={enter(reduce)}
      style={{ pointerEvents: hidden ? 'none' : 'auto' }}
    >
      <div className="flex items-center gap-1 rounded-full bg-noir/70 p-1 text-cream-100 ring-1 ring-cream-100/15 backdrop-blur-md">
        {looks.length > 1 && (
          <button type="button" onClick={() => onStep(-1)} aria-label="Previous look" className={arrow}>
            <ChevronLeft size={18} />
          </button>
        )}
        <div role="tablist" aria-label="Looks" className="flex items-center gap-1">
          {looks.map((l, i) => {
            const selected = i === active;
            return (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onSelect(i)}
                title={l.name}
                className="relative flex h-11 cursor-pointer items-center gap-2 rounded-full py-1 pl-1.5 pr-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
              >
                {selected && (
                  <motion.span
                    layoutId="stylist-look-active"
                    className="absolute inset-0 rounded-full bg-cream-100 shadow-[0_6px_16px_-6px_rgba(0,0,0,0.6)]"
                    transition={spring(reduce)}
                  />
                )}
                <span className="relative flex -space-x-3" aria-hidden="true">
                  {l.pieces.slice(0, 3).map((p, k) => (
                    <img
                      key={p.slot}
                      src={p.image_url ? getProductImageUrl(p.image_url) : '/images/placeholder.svg'}
                      alt=""
                      loading="lazy"
                      className={`h-8 w-8 rounded-full bg-white object-contain ring-2 ${selected ? 'ring-cream-100' : 'ring-noir/60'} ${k === 2 ? 'hidden sm:block' : ''}`}
                      onError={(e) => { e.currentTarget.src = '/images/placeholder.svg'; }}
                    />
                  ))}
                </span>
                <span className={`relative text-xs font-bold uppercase tracking-[0.12em] transition-colors ${selected ? 'text-navy-900' : 'text-cream-100'}`}>
                  <span className="sr-only">Look </span>{l.letter}
                </span>
              </button>
            );
          })}
        </div>
        {looks.length > 1 && (
          <button type="button" onClick={() => onStep(1)} aria-label="Next look" className={arrow}>
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </motion.div>
  );
};

LookFilmstrip.propTypes = {
  looks: PropTypes.arrayOf(PropTypes.object).isRequired,
  active: PropTypes.number.isRequired,
  onSelect: PropTypes.func.isRequired,
  onStep: PropTypes.func.isRequired,
  hidden: PropTypes.bool,
};

export default LookFilmstrip;
