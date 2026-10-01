import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, History, Package, ShoppingBag, Wand2 } from 'lucide-react';
import { trackSpotlight } from '../../utils/pointerSpotlight';

const EASE = [0.22, 1, 0.36, 1];

/*
 * SHORTCUT DECK — the four places a member goes most, as raised cream tiles.
 *
 * Every tile is a plain link to a route that already exists (the same
 * destinations the navbar offers); nothing here adds a flow. The bag tile
 * carries the live count from `useCart`, passed down by Home.
 *
 * Micro-interactions: the tile lifts, a lamp-glow follows the pointer, the
 * icon plate turns navy and the corner arrow slides out.
 */
const ShortcutDeck = ({ bagCount = 0 }) => {
  const reduce = useReducedMotion();

  const tiles = [
    { to: '/try-on', icon: Wand2, label: 'AI Studio', note: 'Render a fitting on your photo' },
    {
      to: '/cart',
      icon: ShoppingBag,
      label: 'My Bag',
      note: bagCount > 0 ? `${bagCount} ${bagCount === 1 ? 'piece' : 'pieces'} waiting` : 'Nothing saved yet',
      badge: bagCount > 0 ? bagCount : null,
    },
    { to: '/orders', icon: Package, label: 'My Orders', note: 'Track payment and delivery' },
    { to: '/try-on?history=1', icon: History, label: 'Try-On History', note: 'Revisit your past looks' },
  ];

  return (
    <section data-tour="home-shortcuts" aria-label="Shortcuts" className="container-page">
      <motion.ul
        initial={reduce ? false : 'hidden'}
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={{ show: { transition: { staggerChildren: 0.07 } } }}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {tiles.map(({ to, icon: Icon, label, note, badge }) => (
          <motion.li
            key={to}
            variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }}
          >
            <Link
              to={to}
              onPointerMove={trackSpotlight}
              className="spotlight group flex h-full flex-col gap-5 rounded-[22px] bg-hiraya-surface p-4 shadow-neu ring-1 ring-cream-50/80 transition-[translate,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-[var(--shadow-neu),0_24px_40px_-28px_rgba(21,32,54,0.55)] focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus sm:p-5"
            >
              <span className="flex items-start justify-between">
                <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-cream-200/60 text-navy-800 shadow-neu-inset transition-colors duration-300 group-hover:bg-navy-900 group-hover:text-cream-100 group-hover:shadow-none">
                  <Icon size={18} className="transition-transform duration-500 group-hover:scale-110" />
                  {badge !== null && badge !== undefined && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-navy-900 px-1 text-[9px] font-bold text-cream-100 ring-2 ring-hiraya-surface">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
                <ArrowUpRight
                  size={16}
                  aria-hidden="true"
                  className="text-charcoal-400 transition-[translate,color] duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-navy-900"
                />
              </span>
              <span className="min-w-0">
                <span className="block font-serif text-[0.95rem] uppercase tracking-[0.06em] text-navy-900">{label}</span>
                <span className="mt-1 block text-[0.72rem] leading-snug text-charcoal-500">{note}</span>
              </span>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
};

ShortcutDeck.propTypes = {
  bagCount: PropTypes.number,
};

export default ShortcutDeck;
