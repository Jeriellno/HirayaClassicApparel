import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { Compass, Shirt, ShieldCheck } from 'lucide-react';
import CinematicScrollText from '../common/CinematicScrollText';
import { trackSpotlight } from '../../utils/pointerSpotlight';

const STEPS = [
  {
    icon: Compass,
    title: '1. Pick Garments',
    desc: 'Browse through curated collections of tops, bottoms, and full outfits built specifically for fitting analysis.',
    step: 'Step 01'
  },
  {
    icon: Shirt,
    title: '2. Virtual Model Fit',
    desc: 'Send items directly to your AI fitting room stack to see how sizes, textures, and silhouettes pair together.',
    step: 'Step 02'
  },
  {
    icon: ShieldCheck,
    title: '3. Confident Choice',
    desc: 'Make confident style choices with high accuracy visual rendering without the need to visit physical fitting rooms.',
    step: 'Step 03'
  }
];

const EASE = [0.22, 1, 0.36, 1];

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

const rise = {
  hidden: { opacity: 0, y: 22, filter: 'blur(6px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.75, ease: EASE } },
};

/*
 * HOW HIRAYA WORKS — the member twin of the guest page's "How it works".
 *
 * Three stations on one rail: a neumorphic disc per step with the icon pressed
 * into it, and a hairline between the discs that inks itself navy as the
 * section scrolls past. The step copy is unchanged.
 */
const HowItWorksSection = () => {
  const reduce = useReducedMotion();
  const railRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: railRef, offset: ['start 85%', 'end 60%'] });
  const rail = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });

  return (
    <section className="relative bg-cream-200/50">
      <div className="container-page section-y">
        <div className="section-head mx-auto max-w-3xl items-center text-center">
          <span className="kicker kicker-center text-hiraya-ink-muted">
            Seamless Virtual Experience
          </span>
          <h2 className="display-section mt-2 text-navy-900">How Hiraya Works</h2>
          {/*
           * THE MANIFESTO LINE — the one piece of copy on the member Home that is
           * long enough to carry the cinematic scroll treatment. It sits under the
           * section head, BEFORE the three steps, because it is the thesis the
           * steps then illustrate.
           */}
          <CinematicScrollText
              text="One photo. A handful of pieces. A fitting you can trust before you spend a peso — rendered on your own frame, not a model’s."
              variant="sub"
              className="mx-auto mt-2 text-center"
          />
        </div>

        <div ref={railRef} className="relative mt-16 lg:mt-20">
          <div aria-hidden="true" className="absolute left-[16.66%] right-[16.66%] top-10 hidden h-px bg-hiraya-structure-line md:block">
            <motion.div style={{ scaleX: reduce ? 1 : rail }} className="h-full origin-left bg-navy-800" />
          </div>

          <motion.ol
            variants={stagger}
            initial={reduce ? false : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-6"
          >
            {STEPS.map((item) => {
              const IconComponent = item.icon;
              return (
                <motion.li key={item.step} variants={rise} className="group relative flex flex-col items-center">
                  <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-cream-100 shadow-neu ring-1 ring-cream-50">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy-900 text-cream-100 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-rotate-12 group-hover:scale-105">
                      <IconComponent size={22} />
                    </span>
                  </div>

                  <div
                    onPointerMove={trackSpotlight}
                    className="spotlight mt-8 flex w-full flex-1 flex-col rounded-[24px] border border-cream-50/80 bg-cream-50 p-8 shadow-neu transition-[translate] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1.5"
                  >
                    <span className="text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-charcoal-500">{item.step}</span>
                    <h3 className="mt-5 font-serif text-[1.1rem] uppercase leading-snug tracking-[0.05em] text-navy-900">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-[0.86rem] leading-relaxed text-charcoal-600">{item.desc}</p>
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
