import { useRef } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';
import GuestHero from '../GuestHero';
import CinematicScrollText from '../common/CinematicScrollText';
import { trackSpotlight } from '../../utils/pointerSpotlight';
import logoImg from '../../assets/logo.png';
import jacketImg from '../../assets/hiraya-suit-jacket.png.png';
import {
  Compass,
  Shirt,
  ShieldCheck,
  Layers,
  Lock,
  Play,
  Check,
} from 'lucide-react';

/*
 * GUEST LANDING — what a VISITOR sees, versus what a MEMBER sees.
 *
 * WHY THE TWO MUST DIFFER
 * -----------------------
 * The member Home is a WORKSPACE: it greets the customer by name, points at
 * their saved wardrobe stack and measurements, and pushes them straight back
 * into the fitting studio. None of that means anything to someone who has not
 * signed up — a "Welcome back, Stylist" banner on a first visit is a lie, and a
 * button into a studio they cannot use yet is a dead end.
 *
 * So a guest gets an INTRODUCTION instead: what Hiraya is, what it does with a
 * photo and a garment, and the single honest next step (create an account). The
 * catalogue remains fully browsable — the walkthrough is an invitation, not a
 * gate — and every claim below maps to a real feature in the app, so nothing
 * here promises something the studio cannot do.
 *
 * It is deliberately a SEPARATE component rather than a branch inside Home: the
 * two audiences share no copy, no layout and no calls to action, and keeping
 * them apart means editing the member dashboard can never damage the landing
 * page (or the reverse).
 *
 * LAYOUT ("Vintage Atelier")
 * --------------------------
 * Every block shares `.container-page` + `.section-y`, a `.kicker`, and the
 * `.display-section` title, so spacing and type are identical down the page.
 * The `data-tour` anchors the guided walkthrough points at are unchanged.
 */
const EASE = [0.22, 1, 0.36, 1];

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

const rise = {
  hidden: { opacity: 0, y: 22, filter: 'blur(6px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.75, ease: EASE } },
};

const STEPS = [
  {
    Icon: Compass,
    step: 'Step 01',
    title: 'Browse the collection',
    body: 'Explore curated tops, bottoms and full outfits. Every piece is prepared for fitting analysis, so what you see is what the studio can wear.',
  },
  {
    Icon: Shirt,
    step: 'Step 02',
    title: 'Upload one full-body photo',
    body: 'A single standing photo is all the studio needs. Your photo is used only to place garments on your body, and it is never shared.',
  },
  {
    Icon: ShieldCheck,
    step: 'Step 03',
    title: 'See the fit before you buy',
    body: 'The AI renders the garment on your own frame, recommends a size, and flags anything that may limit the fit — before you spend a single peso.',
  },
];

const PERKS = [
  'The AI fitting studio, with your saved body measurements.',
  'A wardrobe stack you can build and re-render at any time.',
  'Size recommendations drawn from your own frame, not a chart.',
];

/* ============================================================================
 * HOW IT WORKS — three stations on one rail that draws itself as you scroll.
 * ========================================================================== */
const HowItWorks = ({ reduce }) => {
  const railRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: railRef, offset: ['start 85%', 'end 60%'] });
  const rail = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });

  return (
    <section className="relative bg-cream-200/50" data-tour="guest-intro">
      <div className="container-page section-y">
        <div className="section-head mx-auto max-w-3xl items-center text-center">
          <span className="kicker kicker-center text-hiraya-ink-muted">Meet Hiraya</span>
          <h2 className="display-section mt-2 text-navy-900">How it works</h2>
          {/*
           * THE MANIFESTO — the same cinematic scroll line the member Home shows
           * under "How Hiraya Works", so the two audiences read one thesis
           * instead of two unrelated introductions. Centred to match the head.
           */}
          <CinematicScrollText
            text="One photo. A handful of pieces. A fitting you can trust before you spend a peso — rendered on your own frame, not a model’s."
            variant="sub"
            className="mx-auto mt-2 text-center"
          />
        </div>

        <div ref={railRef} className="relative mt-16 lg:mt-20">
          {/* The rail — a hairline through the three station discs, inked in
              navy as the section scrolls past. Desktop only. */}
          <div aria-hidden="true" className="absolute left-[16.66%] right-[16.66%] top-10 hidden h-px bg-hiraya-structure-line md:block">
            <motion.div
              style={{ scaleX: reduce ? 1 : rail }}
              className="h-full origin-left bg-navy-800"
            />
          </div>

          <motion.ol
            variants={stagger}
            initial={reduce ? false : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-6"
          >
            {STEPS.map(({ Icon, step, title, body }, i) => (
              <motion.li key={title} variants={rise} className="group relative flex flex-col items-center">
                {/* Station disc — neumorphic, with the icon pressed into it. */}
                <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-cream-100 shadow-neu ring-1 ring-cream-50">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy-900 text-cream-100 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-rotate-12 group-hover:scale-105">
                    <Icon size={22} />
                  </span>
                </div>

                <div
                  onPointerMove={trackSpotlight}
                  className="spotlight mt-8 flex w-full flex-1 flex-col rounded-[24px] border border-cream-50/80 bg-cream-50 p-8 shadow-neu transition-[translate] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1.5"
                >
                  <div className="flex items-baseline justify-between">
                    <span aria-hidden="true" className="font-serif text-5xl leading-none text-navy-900/10 transition-colors duration-500 group-hover:text-navy-900/20">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-charcoal-500">{step}</span>
                  </div>
                  <h3 className="mt-6 font-serif text-[1.1rem] uppercase leading-snug tracking-[0.05em] text-navy-900">
                    {title}
                  </h3>
                  <p className="mt-3 text-[0.86rem] leading-relaxed text-charcoal-600">{body}</p>
                </div>
              </motion.li>
            ))}
          </motion.ol>
        </div>
      </div>
    </section>
  );
};

HowItWorks.propTypes = { reduce: PropTypes.bool };

/* ============================================================================
 * WHAT AN ACCOUNT UNLOCKS — the honest reason to sign up, no gate implied.
 * The visual is a member card that floats and tilts toward the pointer.
 * ========================================================================== */
const MemberCard = ({ reduce }) => {
  const rotX = useMotionValue(0);
  const rotY = useMotionValue(0);
  const springX = useSpring(rotX, { stiffness: 160, damping: 18 });
  const springY = useSpring(rotY, { stiffness: 160, damping: 18 });
  const sheenX = useTransform(springY, [-8, 8], ['-35%', '35%']);

  const onMove = (e) => {
    if (reduce) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotY.set(px * 16);
    rotX.set(py * -16);
  };
  const onLeave = () => {
    rotX.set(0);
    rotY.set(0);
  };

  return (
    <div aria-hidden="true" className="relative py-6 [perspective:1200px]" onPointerMove={onMove} onPointerLeave={onLeave}>
      <motion.div
        animate={reduce ? undefined : { y: [0, -10, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          style={{ rotateX: springX, rotateY: springY, transformStyle: 'preserve-3d' }}
          className="relative mx-auto aspect-[1.586] w-full max-w-[420px] overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#283A57_0%,#152036_45%,#0D1524_100%)] p-5 text-cream-100 shadow-[0_40px_80px_-30px_rgba(13,21,36,0.8)] ring-1 ring-cream-50/10 sm:p-7"
        >
          {/* Guilloche + moving sheen — the security-print look of a real card. */}
          <div className="pointer-events-none absolute inset-0 opacity-60 bg-[repeating-radial-gradient(circle_at_85%_120%,transparent_0_10px,rgba(239,230,210,0.05)_10px_11px)]" />
          <motion.div
            style={{ x: sheenX }}
            className="pointer-events-none absolute -inset-y-10 left-1/4 w-1/3 rotate-12 bg-[linear-gradient(90deg,transparent,rgba(252,250,245,0.14),transparent)]"
          />

          <div className="relative flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <img src={logoImg} alt="" className="h-8 w-8 object-contain" />
                <span className="font-serif text-lg font-semibold tracking-[0.1em]">HIRAYA</span>
              </div>
              <span className="hidden text-[0.55rem] font-semibold uppercase tracking-[0.3em] text-cream-400 sm:inline">Atelier Member</span>
            </div>

            {/* The brass "chip". */}
            <div className="h-9 w-12 rounded-md bg-[linear-gradient(135deg,#E4D6BA,#BCA47C_55%,#9C845D)] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
              <div className="mx-auto h-full w-px bg-navy-950/25" />
            </div>

            <div>
              <p className="text-[0.55rem] font-semibold uppercase tracking-[0.3em] text-cream-400">Your fitting profile</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-serif text-[0.7rem] uppercase tracking-[0.08em] text-cream-100 sm:gap-x-4 sm:text-[0.8rem] sm:tracking-[0.12em]">
                <span>Fittings</span>
                <span className="text-cream-400">·</span>
                <span>Wardrobe</span>
                <span className="text-cream-400">·</span>
                <span>Sizes</span>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
      {/* Ground shadow, breathing opposite to the float. */}
      <motion.div
        className="mx-auto mt-4 h-4 w-3/5 rounded-[50%] bg-navy-950/25 blur-md"
        animate={reduce ? undefined : { scaleX: [1, 0.85, 1], opacity: [0.8, 0.5, 0.8] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
};

MemberCard.propTypes = { reduce: PropTypes.bool };

const AccountPerks = ({ reduce }) => (
  <section className="relative bg-cream-100" data-tour="guest-account">
    <div className="container-page section-y">
      <motion.div
        variants={stagger}
        initial={reduce ? false : 'hidden'}
        whileInView="visible"
        viewport={{ once: true, amount: 0.25 }}
        className="grid items-center gap-12 rounded-[32px] border border-cream-50/80 bg-cream-100 p-6 shadow-neu sm:p-12 lg:grid-cols-12 lg:gap-10 lg:p-16"
      >
        <motion.div variants={rise} className="min-w-0 lg:col-span-6">
          <span className="kicker text-hiraya-ink-muted">Membership</span>
          <h2 className="mt-5 font-serif text-[clamp(1.7rem,3vw,2.6rem)] uppercase leading-[1.08] tracking-[0.04em] text-navy-900">
            What you get with an account
          </h2>
          <ul className="mt-8 space-y-4">
            {PERKS.map((perk, i) => (
              <motion.li
                key={perk}
                initial={reduce ? false : { opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.25 + i * 0.12 }}
                className="flex items-start gap-4"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-cream-100 shadow-neu-sm">
                  <Check size={14} strokeWidth={2.5} />
                </span>
                <span className="text-[0.95rem] leading-relaxed text-charcoal-700">{perk}</span>
              </motion.li>
            ))}
          </ul>
          <p className="mt-8 flex items-start gap-2.5 border-t border-hiraya-structure-line pt-6 text-[0.82rem] leading-relaxed text-charcoal-600">
            <Lock size={15} className="mt-0.5 shrink-0 text-navy-800" />
            Browsing stays open to everyone — an account is only needed to run a fitting.
          </p>
        </motion.div>

        <motion.div variants={rise} className="min-w-0 lg:col-span-6">
          <MemberCard reduce={reduce} />
        </motion.div>
      </motion.div>
    </div>
  </section>
);

AccountPerks.propTypes = { reduce: PropTypes.bool };

/* ============================================================================
 * CLOSING CTA — the jacket floats over its own shadow (the motion reference's
 * "floating garment"), beside the one next step.
 * ========================================================================== */
const ClosingCta = ({ navigate, reduce }) => (
  <section className="relative bg-cream-100 pb-20 lg:pb-28" data-tour="guest-cta">
    <div className="container-page">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.8, ease: EASE }}
        className="relative isolate overflow-hidden rounded-[32px] bg-navy-950 px-8 py-16 text-cream-100 shadow-neu-dark sm:px-12 lg:grid lg:grid-cols-12 lg:items-center lg:gap-10 lg:px-16 lg:py-20"
      >
        {/* Backdrop: a navy bloom, two rings, grain. */}
        <div aria-hidden="true" className="absolute -right-24 top-1/2 -z-10 h-[520px] w-[520px] -translate-y-1/2 rounded-full bg-navy-700/50 blur-[110px]" />
        <div aria-hidden="true" className="absolute -right-16 top-1/2 -z-10 h-[420px] w-[420px] -translate-y-1/2 rounded-full border border-cream-50/[0.07]" />
        <div aria-hidden="true" className="absolute -right-2 top-1/2 -z-10 h-[300px] w-[300px] -translate-y-1/2 rounded-full border border-cream-50/[0.05]" />
        <div aria-hidden="true" className="vintage-grain absolute inset-0 -z-10 opacity-30 mix-blend-soft-light" />

        <div className="relative lg:col-span-7">
          <span className="kicker text-cream-400">Your fitting room</span>
          <h2 className="display-section mt-5 text-cream-50">See it on your own frame</h2>
          <p className="mt-6 max-w-md text-[0.95rem] leading-relaxed text-cream-300">
            Create an account and take the fitting studio for a spin.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <motion.button
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              onClick={() => navigate('/register')}
              className="inline-flex items-center justify-center gap-2.5 rounded-full bg-cream-100 px-8 py-4 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-navy-950 shadow-[0_14px_30px_-14px_rgba(0,0,0,0.8)] transition-colors hover:bg-cream-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream-100"
            >
              <Play size={15} /> Get Started
            </motion.button>
            <motion.button
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              onClick={() => navigate('/login')}
              className="inline-flex items-center justify-center gap-2.5 rounded-full border border-cream-100/40 px-8 py-4 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cream-100 transition-colors hover:border-cream-100 hover:bg-cream-50/[0.06] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream-100"
            >
              <Layers size={15} /> I already have an account
            </motion.button>
          </div>
        </div>

        {/* The floating jacket and its breathing ground shadow. */}
        <div aria-hidden="true" className="relative mt-14 lg:col-span-5 lg:mt-0">
          <div className="relative mx-auto flex h-[320px] w-[240px] flex-col items-center justify-end sm:h-[360px]">
            <div className="absolute inset-x-0 top-6 bottom-10 rounded-full bg-[radial-gradient(closest-side,rgba(239,230,210,0.16),transparent)]" />
            <motion.img
              src={jacketImg}
              alt=""
              loading="lazy"
              decoding="async"
              draggable="false"
              animate={reduce ? undefined : { y: [0, -14, 0], rotate: [0, -1.2, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
              className="relative mb-6 h-[260px] w-auto select-none object-contain sm:h-[300px]"
            />
            <motion.div
              className="h-4 w-40 rounded-[50%] bg-noir/70 blur-md"
              animate={reduce ? undefined : { scaleX: [1, 0.78, 1], opacity: [0.75, 0.45, 0.75] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </div>
      </motion.div>
    </div>
  </section>
);

ClosingCta.propTypes = {
  navigate: PropTypes.func.isRequired,
  reduce: PropTypes.bool,
};

const GuestHome = () => {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  return (
    /*
     * `overflow-x-clip` (not `overflow-hidden`): it still stops the decorative
     * blooms from causing a sideways scrollbar, but unlike `hidden` it does not
     * turn this wrapper into a scroll container — so `position: sticky` keeps
     * working for anything on the page that needs it.
     */
    <div className="min-h-screen text-hiraya-ink overflow-x-clip">
      {/*
       * HERO — WHAT HIRAYA IS. The dedicated `GuestHero` component: the suit in
       * its fitting mirror, the Outfit Stack band and the "Why Hiraya" bento.
       * It owns its own background layers.
       */}
      <div data-tour="guest-hero">
        <GuestHero />
      </div>

      <HowItWorks reduce={reduce} />
      <AccountPerks reduce={reduce} />
      <ClosingCta navigate={navigate} reduce={reduce} />
    </div>
  );
};

export default GuestHome;
