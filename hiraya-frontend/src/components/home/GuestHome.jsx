 import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Wand2,
  Compass,
  Shirt,
  ShieldCheck,
  Layers,
  ArrowRight,
  Lock,
  Play,
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
 */
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

const GuestHome = () => {
  const navigate = useNavigate();

  return (
    <div className="bg-hiraya-bg min-h-screen text-hiraya-ink overflow-hidden">
      {/* HERO — WHAT HIRAYA IS */}
      <section className="relative pt-40 pb-20 px-8 md:px-20 flex flex-col items-center justify-center text-center">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-white/[0.04] blur-[140px] rounded-full pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-hiraya-cream-deep border border-hiraya-olive/20 text-hiraya-ink text-[10px] font-bold uppercase tracking-[0.3em] mb-8"
        >
          <Sparkles size={14} /> Virtual Fitting Room
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15 }}
          className="text-4xl md:text-6xl font-extralight uppercase tracking-[0.2em] text-hiraya-ink max-w-4xl leading-tight"
        >
          Hiraya is your{' '}
          <span className="text-[#FFE8D6] font-serif italic lowercase tracking-normal">
            virtual
          </span>{' '}
          fitting room
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-hiraya-ink text-xs md:text-sm max-w-2xl mt-6 uppercase tracking-[0.25em] leading-relaxed"
        >
          Try a garment on your own body photo before you buy it. No fitting room,
          no guessing at sizes — just your frame, the piece, and an honest preview.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45 }}
          className="mt-10 flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto"
        >
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate('/register')}
            className="w-full sm:w-auto px-8 py-4 bg-[#CB997E] hover:bg-[#A5A58D] text-hiraya-ink font-black rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center justify-center gap-3 shadow-lg shadow-hiraya-sand"
          >
            <Wand2 size={16} /> Create Your Account
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate('/shop')}
            className="w-full sm:w-auto px-8 py-4 border border-hiraya-olive/30 hover:border-[#CB997E] hover:bg-[#CB997E]/15 text-hiraya-ink font-extrabold rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center justify-center gap-3"
          >
            Browse the Collection <ArrowRight size={16} />
          </motion.button>
        </motion.div>
      </section>

      {/* INTRODUCING HIRAYA — THE THREE THINGS IT ACTUALLY DOES */}
      <section className="px-8 md:px-20 py-20">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <span className="text-hiraya-olive/70 text-[10px] font-bold uppercase tracking-[0.4em] block mb-2">
            Meet Hiraya
          </span>
          <h2 className="text-3xl md:text-4xl font-light uppercase tracking-[0.3em] text-hiraya-ink">
            How it works
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {STEPS.map(({ Icon, step, title, body }, i) => (
            <motion.div
              key={title}
              /*
               * `whileInView` + `initial={{opacity: 0}}` is a trap here: if the
               * block never enters the viewport (a short page, a screenshot, an
               * automated capture, or a user who lands mid-page), the cards stay
               * at opacity 0 FOREVER — rendered, but invisible. The entrance
               * animation is kept, but the resting state is VISIBLE, so the
               * worst case is "no animation" rather than "no content".
               */
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              whileHover={{ y: -5 }}
              className="p-8 rounded-3xl bg-hiraya-cream border border-hiraya-olive/10 flex flex-col justify-between shadow-xl"
            >
              <div>
                <div className="w-12 h-12 rounded-2xl bg-[#CB997E]/25 text-hiraya-olive flex items-center justify-center mb-6">
                  <Icon size={22} />
                </div>
                {/**
                  * THE ACCENT IS SURFACE-DEPENDENT.
                  *
                  * On the olive CANVAS, terracotta text only reaches ~3.2:1 — too
                  * weak for a heading, so there the accent lives in the icon and
                  * the heading is cream. On a LIGHT CARD (#FFE8D6 / #DDBEA9) that
                  * ratio INVERTS: olive ink is ~5.5:1 and terracotta is readable
                  * too, so the accent can come back to the heading and the card
                  * keeps its brand identity instead of going monochrome.
                  */}
                <h3 className="text-lg font-bold uppercase tracking-wider text-[#6B705C] mb-3">
                  {title}
                </h3>
                <p className="text-hiraya-ink text-xs leading-relaxed">{body}</p>
              </div>
              <span className="text-[10px] text-[#CB997E] font-extrabold uppercase tracking-widest mt-8 block">
                {step}
              </span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* WHAT AN ACCOUNT UNLOCKS — the honest reason to sign up, no gate implied. */}
      <section className="px-8 md:px-20 pb-16">
        <div className="p-8 md:p-12 rounded-[2.5rem] bg-hiraya-cream border border-hiraya-olive/10 shadow-xl">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 shrink-0 rounded-2xl bg-[#CB997E]/25 text-hiraya-olive flex items-center justify-center">
              <Lock size={20} />
            </div>
            <div>
              {/* Ink on a light card is olive — see the note in the steps above. */}
              <h3 className="text-lg font-bold uppercase tracking-wider text-hiraya-olive mb-2">
                What you get with an account
              </h3>
              <ul className="text-hiraya-ink text-xs leading-relaxed space-y-2">
                <li>• The AI fitting studio, with your saved body measurements.</li>
                <li>• A wardrobe stack you can build and re-render at any time.</li>
                <li>• Size recommendations drawn from your own frame, not a chart.</li>
              </ul>
              <p className="text-hiraya-olive/70 text-[11px] mt-4">
                Browsing stays open to everyone — an account is only needed to run a fitting.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="px-8 md:px-20 pb-28">
        <div className="p-12 md:p-16 rounded-[3rem] bg-hiraya-cream border border-hiraya-olive/10 text-center relative overflow-hidden shadow-2xl">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#CB997E]/[0.22] blur-[120px] rounded-full pointer-events-none" />
          <h2 className="text-3xl md:text-5xl font-extralight uppercase tracking-[0.3em] text-hiraya-olive relative z-10">
            See it on your own frame
          </h2>
          <p className="text-hiraya-ink text-xs md:text-sm uppercase tracking-[0.3em] mt-4 max-w-xl mx-auto relative z-10">
            Create an account and take the fitting studio for a spin.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row justify-center items-center gap-4 relative z-10">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/register')}
              className="px-10 py-4 bg-[#CB997E] hover:bg-[#A5A58D] text-hiraya-ink font-black rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center gap-3 shadow-lg shadow-hiraya-sand"
            >
              <Play size={15} /> Get Started
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/login')}
              className="px-10 py-4 border border-hiraya-olive/30 hover:border-[#CB997E] hover:bg-[#CB997E]/10 text-hiraya-olive font-extrabold rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center gap-3"
            >
              <Layers size={15} /> I already have an account
            </motion.button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default GuestHome;