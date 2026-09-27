import React from 'react';
import { motion } from 'framer-motion';
import { Compass, Shirt, ShieldCheck } from 'lucide-react';

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

const HowItWorksSection = () => {
  return (
    <section className="px-8 md:px-20 py-24 my-12 bg-gradient-to-b from-transparent via-hiraya-cream-deep/50 to-transparent">
      <div className="text-center max-w-3xl mx-auto mb-16">
        <span className="text-hiraya-ink text-[10px] font-bold uppercase tracking-[0.4em] block mb-2">
          Seamless Virtual Experience
        </span>
        <h2 className="text-3xl md:text-4xl font-light uppercase tracking-[0.3em] text-hiraya-ink">How Hiraya Works</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {STEPS.map((item, idx) => {
          const IconComponent = item.icon;
          return (
            <motion.div
              key={idx}
              whileHover={{ y: -5 }}
              className="p-8 rounded-3xl bg-hiraya-cream-deep border border-hiraya-olive/15 flex flex-col justify-between"
            >
              <div>
                <div className="w-12 h-12 rounded-2xl bg-[#CB997E]/10 text-hiraya-ink flex items-center justify-center mb-6">
                  <IconComponent size={22} />
                </div>
                <h3 className="text-lg font-bold uppercase tracking-wider text-hiraya-ink mb-3">{item.title}</h3>
                <p className="text-hiraya-ink text-xs leading-relaxed">{item.desc}</p>
              </div>
              <span className="text-[10px] text-hiraya-ink font-extrabold uppercase tracking-widest mt-8 block">
                {item.step}
              </span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
};

export default HowItWorksSection;