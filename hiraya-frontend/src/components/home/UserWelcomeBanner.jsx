import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layers } from 'lucide-react';

const UserWelcomeBanner = ({ user }) => {
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <section className="px-8 md:px-20 mb-20">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        className="p-10 rounded-[2.5rem] bg-gradient-to-r from-[#DDBEA9] via-hiraya-cream-deep to-[#6B705C] border border-hiraya-olive/15 flex flex-col md:flex-row justify-between items-center gap-8 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#CB997E]/5 blur-[100px] rounded-full pointer-events-none" />
        <div className="z-10">
          <span className="text-[10px] text-hiraya-sand uppercase tracking-widest block mb-1">Exclusive Portal</span>
          <h2 className="text-2xl font-light tracking-[0.3em] uppercase text-hiraya-ink">
            Welcome back, {user.full_name?.split(' ')[0] || 'Stylist'}
          </h2>
          <p className="text-hiraya-ink text-[11px] mt-2 uppercase tracking-[0.3em] font-bold italic">
            Your wardrobe stack and AI model configurations are ready.
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => navigate('/try-on')}
          className="z-10 flex items-center gap-2.5 bg-[#CB997E] text-[#6B705C] px-8 py-4 rounded-full text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-[#CB997E]/10 shrink-0"
        >
          <Layers size={16} /> Open AI Studio
        </motion.button>
      </motion.div>
    </section>
  );
};

export default UserWelcomeBanner;