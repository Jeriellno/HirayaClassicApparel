import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const FooterCtaBanner = () => {
  const navigate = useNavigate();

  return (
    <section className="px-8 md:px-20 pb-28">
      <div className="p-12 md:p-16 rounded-[3rem] bg-gradient-to-r from-[#DDBEA9] via-hiraya-cream-deep to-[#6B705C] border border-hiraya-olive/15 text-center relative overflow-hidden shadow-2xl">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#CB997E]/10 blur-[120px] rounded-full pointer-events-none" />
        <h2 className="text-3xl md:text-5xl font-extralight uppercase tracking-[0.3em] text-hiraya-ink relative z-10">
          Ready to Transform Your Wardrobe?
        </h2>
        <p className="text-hiraya-ink text-xs md:text-sm uppercase tracking-[0.3em] mt-4 max-w-xl mx-auto relative z-10 font-light">
          Start curating your personal AI fitting stack today.
        </p>
        <div className="mt-8 flex justify-center relative z-10">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/shop')}
            className="px-10 py-4 bg-[#CB997E] hover:bg-hiraya-cream-deep text-[#6B705C] font-black rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center gap-3 shadow-xl"
          >
            Explore Shop <ArrowRight size={16} />
          </motion.button>
        </div>
      </div>
    </section>
  );
};

export default FooterCtaBanner;