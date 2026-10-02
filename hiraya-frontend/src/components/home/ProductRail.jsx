import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { motion, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import ProductCard from '../product/ProductCard';

const EASE = [0.22, 1, 0.36, 1];
const SLIDE = 'w-[min(72vw,260px)] shrink-0 snap-start';

/*
 * THE SHELF — the scrolling track and its control bar. A separate component
 * so the scroll hooks only exist while there is a track to measure.
 */
const Shelf = ({ title, products, loading, isRecommended, renderBadge }) => {
  const reduce = useReducedMotion();
  const trackRef = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const { scrollXProgress } = useScroll({ container: trackRef });
  const progress = useSpring(scrollXProgress, { stiffness: 220, damping: 32, mass: 0.4 });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = trackRef.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, products.length, loading]);

  const page = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' });
  };

  const scrollable = !loading && !(edges.start && edges.end);

  return (
    <>
      {/*
        * `key` REMOUNTS the shelf when the cards replace the skeletons. The
        * one-shot `whileInView` reveal used to fire on the SKELETONS; the real
        * cards then mounted in their `hidden` state (opacity 0) and never
        * animated in, so a rail that loaded slowly stayed blank until the page
        * was revisited.
        */}
      <motion.ul
        key={loading ? 'loading' : `loaded-${products.length}`}
        ref={trackRef}
        onScroll={measure}
        tabIndex={0}
        aria-label={`${title} — scroll sideways`}
        initial={reduce ? false : 'hidden'}
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        variants={{ show: { transition: { staggerChildren: 0.07 } } }}
        className="-mx-2 flex snap-x snap-mandatory gap-5 overflow-x-auto px-2 pb-6 pt-2 [scrollbar-width:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus/60 [&::-webkit-scrollbar]:hidden"
      >
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <li key={`skeleton-${i}`} className={SLIDE}>
                <div className="h-[23rem] animate-pulse rounded-[24px] bg-cream-200/60 shadow-neu-inset" />
              </li>
            ))
          : products.map((product) => (
              <motion.li
                key={product.id}
                variants={{ hidden: { opacity: 0, x: 28 }, show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE } } }}
                className={SLIDE}
              >
                <ProductCard
                  product={product}
                  isRecommended={isRecommended ? isRecommended(product) : false}
                  fitBadge={renderBadge ? renderBadge(product) : null}
                />
              </motion.li>
            ))}
      </motion.ul>

      {/* Control bar: prev plate · progress thread · next plate. */}
      {scrollable && (
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => page(-1)}
            disabled={edges.start}
            aria-label={`Scroll ${title} back`}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-hiraya-surface text-navy-900 shadow-neu-sm ring-1 ring-cream-50/80 transition-[background-color,color,opacity] duration-300 hover:bg-navy-900 hover:text-cream-100 disabled:pointer-events-none disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
          >
            <ChevronLeft size={16} />
          </button>
          <div aria-hidden="true" className="h-[3px] w-40 overflow-hidden rounded-full bg-cream-300/70 sm:w-56">
            <motion.div style={{ scaleX: progress }} className="h-full origin-left rounded-full bg-navy-800" />
          </div>
          <button
            type="button"
            onClick={() => page(1)}
            disabled={edges.end}
            aria-label={`Scroll ${title} forward`}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-hiraya-surface text-navy-900 shadow-neu-sm ring-1 ring-cream-50/80 transition-[background-color,color,opacity] duration-300 hover:bg-navy-900 hover:text-cream-100 disabled:pointer-events-none disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </>
  );
};

Shelf.propTypes = {
  title: PropTypes.string.isRequired,
  products: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  isRecommended: PropTypes.func,
  renderBadge: PropTypes.func,
};

/*
 * PRODUCT RAIL — a horizontally scrolling shelf of shop cards.
 *
 * Each slide is the SAME `ProductCard` the shop and the old spotlight grid
 * used, so opening a piece works exactly as before. The rail adds scroll-snap,
 * prev / next plates that page by one view and grey out at either end, a
 * progress thread driven by the scroll position, and a staggered rise as the
 * rail enters the viewport.
 *
 * `children` renders in place of the shelf (an empty state or a call to
 * action); `loading` renders skeleton cards of the same size.
 */
const ProductRail = ({
  tourId,
  kicker,
  title,
  subtitle,
  action = null,
  products = [],
  loading = false,
  isRecommended,
  renderBadge,
  children = null,
}) => (
  <section data-tour={tourId} aria-label={title} className="container-page">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div className="max-w-2xl">
        <span className="kicker text-hiraya-ink-muted">{kicker}</span>
        <h2 className="display-section mt-2 text-navy-900">{title}</h2>
        {subtitle && <p className="mt-3 text-[0.85rem] leading-relaxed text-charcoal-600">{subtitle}</p>}
      </div>
      {action}
    </div>

    {children ||
      ((loading || products.length > 0) && (
        <Shelf
          title={title}
          products={products}
          loading={loading}
          isRecommended={isRecommended}
          renderBadge={renderBadge}
        />
      ))}
  </section>
);

ProductRail.propTypes = {
  tourId: PropTypes.string,
  kicker: PropTypes.node,
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.node,
  action: PropTypes.node,
  products: PropTypes.array,
  loading: PropTypes.bool,
  isRecommended: PropTypes.func,
  renderBadge: PropTypes.func,
  children: PropTypes.node,
};

export default ProductRail;
