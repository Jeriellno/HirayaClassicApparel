import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Sparkles,
  Wand2,
  ChevronRight,
  Layers,
  ArrowUpRight,
  Check,
  Ruler,
  Shirt,
  ShoppingBag,
  Scissors,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { trackSpotlight } from '../../utils/pointerSpotlight';

/*
 * THE CANVAS READINESS PREVIEW — logic unchanged.
 *
 * The console card is driven by the customer's REAL studio state and names the
 * next step. What it can honestly know from here:
 *   1. measurements — server-side on the user record, the one durable signal
 *   2. the bag — the studio's garment picker is fed by `/cart` and the
 *      recommendation feed, so a non-empty bag is a real, visible prerequisite
 *   3. the server-side body photo, when one has been saved
 *
 * The photo and the in-progress stack are session state inside /try-on (React
 * state, never persisted), so the card deliberately does not claim to know
 * about them and says so instead.
 */
const getTryOnReadiness = (user) => {
    const hasMeasurements = Boolean(
        user?.chest_bust || user?.waist || user?.hips || user?.shoulder_width || user?.sleeve_length
    );
    const hasSavedPhoto = Boolean(user?.body_photo_path);

    return {
        hasMeasurements,
        hasSavedPhoto,
        ready: hasMeasurements,
    };
};

const EASE = [0.22, 1, 0.36, 1];

/* A greeting that knows what time it is where the member is sitting. */
const greetingFor = (date) => {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

/*
 * MEMBER HERO — "Vintage Atelier" greeting banner + fitting console.
 *
 * The member's front door is now about THEM, not a marketing headline: a
 * time-aware greeting with their monogram, a status strip built from data the
 * page already has (bag count, sizing profile, fit preference), and the two
 * primary routes (studio, collection). At right, the navy fitting console —
 * the same readiness checklist and the same buttons as before, now with a
 * pointer-tracked lamp glow.
 *
 * Every destination is unchanged: Enter AI Studio → /try-on, Explore
 * Collection → /shop, the console CTA → /try-on, Measurements → /settings,
 * Find a piece → /shop.
 */
const HeroSection = ({ bagCount = 0, fitStyleWord = null }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reduce = useReducedMotion();

  // Derived on every render: `user` is already the live source for all of it.
  const readiness = getTryOnReadiness(user);

  const firstName = user?.full_name?.split(' ')[0] || 'Stylist';
  const now = new Date();
  const today = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const rise = (delay) => ({
    initial: reduce ? false : { opacity: 0, y: 20, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: 0.75, ease: EASE, delay },
  });

  const status = [
    {
      key: 'bag',
      icon: ShoppingBag,
      label: 'Bag',
      value: bagCount > 0 ? `${bagCount} ${bagCount === 1 ? 'piece' : 'pieces'}` : 'Empty',
    },
    {
      key: 'sizing',
      icon: Ruler,
      label: 'Sizes',
      value: readiness.hasMeasurements ? 'Saved' : 'Not set',
    },
    {
      key: 'fit',
      icon: Scissors,
      label: 'Fit',
      value: fitStyleWord ? fitStyleWord.charAt(0).toUpperCase() + fitStyleWord.slice(1) : 'Not set',
    },
  ];

  return (
    <section className="relative isolate">
      {/* House texture: lamp-light glows, two rings and a whisper of grain. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-0 -z-10 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(252,250,245,0.95),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-24 -z-10 h-[620px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(29,44,69,0.13),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-10 -z-10 h-[560px] w-[560px] rounded-full border border-navy-900/[0.06]" />
      <div aria-hidden="true" className="vintage-grain pointer-events-none absolute inset-0 -z-10 opacity-[0.05] mix-blend-multiply" />

      <div className="container-page grid items-center gap-12 pb-14 pt-32 lg:grid-cols-12 lg:gap-10 lg:pb-20">

        {/* LEFT: the greeting banner */}
        <div data-tour="member-greeting" className="text-left lg:col-span-7">
          <motion.div {...rise(0)} className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-2 rounded-full border border-cream-50/80 bg-cream-50/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink shadow-neu-sm backdrop-blur-md">
              <Sparkles size={13} /> Atelier Member
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-charcoal-500">{today}</span>
          </motion.div>

          <div className="mt-8 flex items-center gap-5 sm:gap-7">
            {/* The monogram: a cream coin on a navy seal that turns on hover. */}
            <motion.span
              aria-hidden="true"
              initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -20 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 16, delay: 0.1 }}
              whileHover={reduce ? undefined : { rotate: 8, scale: 1.04 }}
              className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-navy-900 font-serif text-[1.6rem] font-semibold text-cream-100 shadow-[0_18px_30px_-14px_rgba(13,21,36,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] ring-4 ring-cream-50 sm:h-20 sm:w-20 sm:text-[2rem]"
            >
              {firstName.charAt(0).toUpperCase()}
              <span className="absolute inset-1.5 rounded-full border border-cream-50/15" />
            </motion.span>

            <motion.h1 {...rise(0.08)} className="font-serif uppercase leading-[1.02] tracking-[0.04em]">
              <span className="block text-[clamp(0.95rem,1.6vw,1.2rem)] tracking-[0.18em] text-charcoal-600">
                {greetingFor(now)},
              </span>
              <span className="mt-1 block text-[clamp(2.3rem,5.4vw,4.4rem)] text-navy-900">{firstName}</span>
            </motion.h1>
          </div>

          <motion.p {...rise(0.16)} className="mt-7 max-w-xl text-[0.95rem] leading-relaxed text-charcoal-600">
            {readiness.ready
              ? 'Your fitting room is ready for a render. Pick up where you left off, or let the collection surprise you.'
              : 'Your fitting room is one step from ready — add your sizes and every piece below is ranked for your frame.'}
          </motion.p>

          <motion.div {...rise(0.24)} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <motion.button
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/try-on')}
              className="btn-primary w-full cursor-pointer rounded-full px-8 py-4 sm:w-auto"
            >
              <Wand2 size={16} /> Enter AI Studio
            </motion.button>

            <motion.button
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/shop')}
              className="btn-secondary group w-full cursor-pointer rounded-full px-8 py-4 sm:w-auto"
            >
              Explore Collection <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </motion.button>
          </motion.div>

          {/* The status strip — three pressed-in wells, read-only. */}
          <motion.dl
            initial={reduce ? false : 'hidden'}
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.34 } } }}
            className="mt-10 grid max-w-xl grid-cols-3 gap-2.5 sm:gap-3"
          >
            {status.map(({ key, icon: Icon, label, value }) => (
              <motion.div
                key={key}
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}
                className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-cream-200/50 px-3.5 py-3 shadow-neu-inset"
              >
                <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-hiraya-surface text-navy-800 shadow-neu-sm sm:flex">
                  <Icon size={14} />
                </span>
                <span className="min-w-0">
                  <dt className="text-[9px] font-semibold uppercase tracking-[0.18em] text-charcoal-500">{label}</dt>
                  <dd className="truncate text-[0.8rem] font-semibold text-navy-900">{value}</dd>
                </span>
              </motion.div>
            ))}
          </motion.dl>
        </div>

        {/* RIGHT: the fitting console */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.85, ease: EASE, delay: 0.2 }}
          className="relative lg:col-span-5"
        >
          {/* A cream plate behind the console, offset like a mounted print. */}
          <div aria-hidden="true" className="absolute inset-0 translate-x-3 translate-y-3 rounded-[30px] bg-cream-300/50 shadow-neu-inset" />

          <div
            onPointerMove={trackSpotlight}
            className="spotlight relative isolate space-y-6 overflow-hidden rounded-[28px] bg-navy-900 p-7 [--spotlight:rgba(247,242,231,0.09)] text-cream-100 shadow-neu-dark sm:p-8"
          >
            <div aria-hidden="true" className="absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full border border-cream-50/[0.08]" />
            <div aria-hidden="true" className="vintage-grain absolute inset-0 -z-10 opacity-30 mix-blend-soft-light" />

            {/* Title bar — a real status strip, not fake window chrome. */}
            <div className="flex items-center justify-between gap-3 border-b border-cream-50/10 pb-5">
              <span className="flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cream-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cream-50/10">
                  <Layers size={14} />
                </span>
                AI Virtual Fitting Canvas
              </span>
              <span
                className={`shrink-0 rounded-full border px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] ${
                  readiness.ready
                    ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-200'
                    : 'border-cream-400/40 bg-cream-400/10 text-cream-300'
                }`}
              >
                {readiness.ready ? 'Measurements saved' : 'Setup needed'}
              </span>
            </div>

            {/* THE CHECKLIST — two rows, both claims the card can verify. */}
            <ul className="space-y-3">
              {[
                  {
                      key: 'measurements',
                      label: 'Measurements saved',
                      done: readiness.hasMeasurements,
                      hint: 'Enter your 5 core sizes',
                  },
                  {
                      key: 'photo',
                      label: 'Body photo',
                      done: readiness.hasSavedPhoto,
                      hint: 'Upload a full-body shot in the studio',
                  },
              ].map((step) => (
                <li key={step.key} className="flex items-center gap-3.5 rounded-2xl bg-cream-50/[0.05] px-4 py-3 transition-colors hover:bg-cream-50/[0.08]">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      step.done
                        ? 'bg-cream-100 text-navy-900'
                        : 'border border-cream-50/25 text-cream-400'
                    }`}
                  >
                    {step.done ? <Check size={14} strokeWidth={2.5} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <span className="flex-1 text-left">
                    <span
                      className={`block text-[11px] font-semibold uppercase tracking-[0.1em] ${
                        step.done ? 'text-cream-50' : 'text-cream-200'
                      }`}
                    >
                      {step.label}
                    </span>
                    {!step.done && (
                      <span className="mt-0.5 block text-[10px] text-cream-300">{step.hint}</span>
                    )}
                  </span>
                  {step.done && (
                    <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                      Done
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {/* WHAT THIS PAGE CANNOT SEE — one honest line. */}
            <p className="text-[10.5px] leading-relaxed text-cream-300">
              Garments and your in-progress outfit live inside the studio, so this card cannot
              see them. Open the studio to continue where you left off.
            </p>

            {/* The single next action — a cream plate, the light counterpart on a dark card. */}
            <button
              type="button"
              onClick={() => navigate('/try-on')}
              data-tour="studio-cta"
              className="group flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-cream-100 px-6 py-3.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-navy-950 shadow-[0_12px_24px_-12px_rgba(0,0,0,0.8)] transition-colors hover:bg-cream-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream-100"
            >
              {readiness.ready ? (
                <>
                  <Wand2 size={15} className="transition-transform duration-500 group-hover:-rotate-12" /> Open Canvas &amp; Render
                </>
              ) : (
                <>
                  <ArrowUpRight size={15} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /> Set Measurements
                </>
              )}
            </button>

            {/* Secondary routes into the two supporting surfaces. */}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => navigate('/settings')}
                className="inline-flex cursor-pointer items-center gap-2 border-b border-cream-50/20 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream-200 transition-colors hover:border-cream-100 hover:text-cream-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
              >
                <Ruler size={12} /> Measurements
              </button>
              <button
                type="button"
                onClick={() => navigate('/shop')}
                className="inline-flex cursor-pointer items-center gap-2 border-b border-cream-50/20 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream-200 transition-colors hover:border-cream-100 hover:text-cream-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
              >
                <Shirt size={12} /> Find a piece
              </button>
            </div>

          </div>
        </motion.div>

      </div>
    </section>
  );
};

HeroSection.propTypes = {
  bagCount: PropTypes.number,
  fitStyleWord: PropTypes.string,
};

export default HeroSection;
