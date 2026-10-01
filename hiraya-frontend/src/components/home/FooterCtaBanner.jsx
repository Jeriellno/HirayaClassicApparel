import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import tieImg from '../../assets/hiraya-suit-tie.png.png';

/*
 * THE CLOSING CTA BAND — "Vintage Atelier".
 *
 * A deep navy panel that closes the page, with a garment floating over its
 * own breathing shadow beside the call to action (the motion reference's
 * hovering piece). The tie is a transparent cut-out with a navy glow, so it
 * sits in the panel's light without a frame. The copy, the button and the
 * /shop destination are unchanged.
 */
const FooterCtaBanner = () => {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  return (
    <section className="relative pb-20 lg:pb-28">
      <div className="container-page">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="relative isolate overflow-hidden rounded-[32px] bg-navy-950 px-8 py-16 text-cream-100 shadow-neu-dark sm:px-12 lg:grid lg:grid-cols-12 lg:items-center lg:gap-10 lg:px-16 lg:py-20"
        >
          <div aria-hidden="true" className="absolute -right-24 top-1/2 -z-10 h-[520px] w-[520px] -translate-y-1/2 rounded-full bg-navy-700/50 blur-[110px]" />
          <div aria-hidden="true" className="absolute -right-10 top-1/2 -z-10 h-[400px] w-[400px] -translate-y-1/2 rounded-full border border-cream-50/[0.07]" />
          <div aria-hidden="true" className="vintage-grain absolute inset-0 -z-10 opacity-30 mix-blend-soft-light" />

          <div className="relative lg:col-span-8">
            <span className="kicker text-cream-400">Your next fitting</span>
            <h2 className="display-section mt-5 text-cream-50">
              Ready to Transform Your Wardrobe?
            </h2>
            <p className="mt-6 max-w-xl text-[0.95rem] leading-relaxed text-cream-300">
              Start curating your personal AI fitting stack today.
            </p>
            <motion.button
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/shop')}
              className="mt-10 inline-flex cursor-pointer items-center gap-2.5 rounded-full bg-cream-100 px-8 py-4 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-navy-950 shadow-[0_14px_30px_-14px_rgba(0,0,0,0.8)] transition-colors hover:bg-cream-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream-100"
            >
              Explore Shop <ArrowRight size={16} />
            </motion.button>
          </div>

          {/* The floating tie and its breathing ground shadow. */}
          <div aria-hidden="true" className="relative mt-12 lg:col-span-4 lg:mt-0">
            <div className="relative mx-auto flex h-[300px] w-[200px] flex-col items-center justify-end sm:h-[340px]">
              <div className="absolute inset-x-0 top-4 bottom-10 rounded-full bg-[radial-gradient(closest-side,rgba(239,230,210,0.14),transparent)]" />
              <motion.img
                src={tieImg}
                alt=""
                loading="lazy"
                decoding="async"
                draggable="false"
                animate={reduce ? undefined : { y: [0, -14, 0], rotate: [0, 2, 0] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
                className="relative mb-6 h-[250px] w-auto select-none object-contain sm:h-[290px]"
              />
              <motion.div
                className="h-3.5 w-24 rounded-[50%] bg-noir/70 blur-md"
                animate={reduce ? undefined : { scaleX: [1, 0.75, 1], opacity: [0.75, 0.45, 0.75] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default FooterCtaBanner;
