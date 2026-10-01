import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layers } from 'lucide-react';

/*
 * THE MEMBER WELCOME BANNER — "Vintage Atelier".
 *
 * A deep navy panel on the cream page: the one dark surface near the top of
 * Home and Shop, so the member's own greeting is the first thing the eye
 * lands on. A monogram of the member's initial sits beside it, the rings and
 * grain are the house texture, and the action is a cream plate — the
 * light-on-dark counterpart of the navy buttons elsewhere.
 *
 * The copy, the button and the /try-on destination are unchanged. The banner
 * no longer adds its own side gutters; the page around it provides them.
 */
const UserWelcomeBanner = ({ user }) => {
  const navigate = useNavigate();
  if (!user) return null;

  const firstName = user.full_name?.split(' ')[0] || 'Stylist';

  return (
    <section className="mb-14">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate flex flex-col items-start justify-between gap-8 overflow-hidden rounded-[28px] bg-navy-900 px-7 py-8 text-cream-100 shadow-neu-dark sm:px-10 sm:py-9 md:flex-row md:items-center"
      >
        <div aria-hidden="true" className="absolute -right-20 -top-24 -z-10 h-64 w-64 rounded-full border border-cream-50/[0.08]" />
        <div aria-hidden="true" className="absolute -bottom-28 right-24 -z-10 h-56 w-56 rounded-full border border-cream-50/[0.06]" />
        <div aria-hidden="true" className="vintage-grain absolute inset-0 -z-10 opacity-30 mix-blend-soft-light" />

        <div className="flex items-center gap-5">
          <span
            aria-hidden="true"
            className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-full bg-cream-100 font-serif text-2xl font-semibold text-navy-900 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)] sm:flex"
          >
            {firstName.charAt(0).toUpperCase()}
          </span>
          <div>
            <span className="kicker text-cream-400">Exclusive Portal</span>
            <h2 className="mt-3 font-serif text-[clamp(1.35rem,2.4vw,2rem)] uppercase leading-tight tracking-[0.05em] text-cream-50">
              Welcome back, {firstName}
            </h2>
            <p className="mt-2 text-[0.7rem] uppercase leading-relaxed tracking-[0.16em] text-cream-300">
              Your wardrobe stack and AI model configurations are ready.
            </p>
          </div>
        </div>

        <motion.button
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/try-on')}
          className="inline-flex shrink-0 cursor-pointer items-center gap-2.5 rounded-full bg-cream-100 px-7 py-3.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-navy-950 shadow-[0_12px_24px_-12px_rgba(0,0,0,0.8)] transition-colors hover:bg-cream-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream-100"
        >
          <Layers size={16} /> Open AI Studio
        </motion.button>
      </motion.div>
    </section>
  );
};

UserWelcomeBanner.propTypes = {
  user: PropTypes.shape({
    full_name: PropTypes.string,
  }),
};

export default UserWelcomeBanner;
