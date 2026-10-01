import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import { SlidersHorizontal } from 'lucide-react';
import SearchBar from '../common/SearchBar';

const GARMENT_FILTERS = [
  { label: 'All Garments', value: 'all' },
  { label: 'Tops', value: 'top' },
  { label: 'Bottoms', value: 'bottom' },
  { label: 'Footwear', value: 'footwear' },
  { label: 'Outerwear', value: 'outerwear' },
  { label: 'Dresses', value: 'dress' }
];

const ShopHeader = ({ activeSubCat, onSelectSubCat }) => {
  return (
    <div
      data-tour="shop-header"
      className="mb-12 flex flex-col justify-between gap-8 border-b border-hiraya-structure-line pb-10 lg:flex-row lg:items-end"
    >
      <div className="section-head">
        <span className="kicker text-hiraya-ink-muted">Handpicked for AI Fitting</span>
        <h1 className="display-section mt-2 text-navy-900">
          The Collection
        </h1>
      </div>

      {/*
       * RIGHT-HAND COLUMN — the filter tabs, with the search field directly beneath
       * them. The search lives next to the thing it filters and writes the same
       * `?search=` param the grid reads.
       *
       * The tabs sit on a pressed-in track, and ONE navy pill glides to the
       * active filter (a shared `layoutId`) — the same active-state motion as
       * the navigation bar. The track still scrolls sideways on narrow screens.
       */}
      {/* `min-w-0` + shrinkable, not `shrink-0`: at this root size 40rem is
          740px, which pushed the page 22px wider than a 1024px viewport. */}
      <div className="flex w-full min-w-0 flex-col gap-4 lg:w-auto lg:max-w-[40rem] lg:flex-1">
        <div className="flex items-center gap-3">
          <SlidersHorizontal size={15} className="shrink-0 text-hiraya-ink-muted" aria-hidden="true" />
          <div
            data-tour="shop-filters"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full bg-cream-200/70 p-1 shadow-neu-inset scrollbar-none"
          >
            {GARMENT_FILTERS.map((opt) => {
              const active = activeSubCat === opt.value;
              return (
                <motion.button
                  key={opt.value}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onSelectSubCat(opt.value)}
                  aria-pressed={active}
                  className={`relative shrink-0 cursor-pointer rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus ${
                    active ? 'text-hiraya-on-accent' : 'text-hiraya-ink-soft hover:text-hiraya-ink'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="shop-filter-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-full bg-hiraya-accent shadow-[0_8px_16px_-8px_rgba(21,32,54,0.7)]"
                    />
                  )}
                  <span className="relative">{opt.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div data-tour="shop-search">
          <SearchBar />
        </div>
      </div>
    </div>
  );
};

ShopHeader.propTypes = {
  activeSubCat: PropTypes.string,
  onSelectSubCat: PropTypes.func.isRequired,
};

export default ShopHeader;
