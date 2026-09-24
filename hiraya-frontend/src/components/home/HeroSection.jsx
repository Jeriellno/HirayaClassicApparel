import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Wand2, ChevronRight, Layers, ArrowUpRight } from 'lucide-react';

const HeroSection = () => {
  const navigate = useNavigate();

  return (
    <section className="relative pt-36 pb-20 px-8 md:px-20 max-w-7xl mx-auto min-h-[85vh] flex items-center">
      {/* Background Glows */}
      <div className="absolute top-1/3 left-10 w-[350px] h-[350px] bg-[#E9C46A]/10 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-[#E9C46A]/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center w-full z-10">
        
        {/* LEFT COLUMN: Text Content */}
        <div className="lg:col-span-7 text-left space-y-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-[#E9C46A] text-[10px] font-bold uppercase tracking-[0.3em]"
          >
            <Sparkles size={14} /> Next-Gen AI Virtual Fitting Room
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl sm:text-6xl font-extralight uppercase tracking-[0.2em] text-[#E9C46A] leading-[1.15]"
          >
            Redefine Your <br />
            <span className="text-[#E9C46A] font-serif italic lowercase tracking-normal">Personal</span> Style
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-gray-400 text-xs sm:text-sm max-w-lg uppercase tracking-[0.25em] leading-relaxed font-light"
          >
            Experience tailored garment previewing with AI. Try on premium collections instantly before making a choice.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="pt-4 flex flex-col sm:flex-row items-center gap-4"
          >
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => navigate('/try-on')}
              className="w-full sm:w-auto px-8 py-4 bg-[#E9C46A] hover:bg-[#D4A94F] text-[#0A0C10] font-black rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center justify-center gap-3 shadow-xl shadow-[#E9C46A]/10"
            >
              <Wand2 size={16} /> Enter AI Studio
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => navigate('/shop')}
              className="w-full sm:w-auto px-8 py-4 bg-white/5 border border-white/10 hover:border-[#E9C46A] text-white font-extrabold rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center justify-center gap-3"
            >
              Explore Collection <ChevronRight size={16} />
            </motion.button>
          </motion.div>
        </div>

        {/* RIGHT COLUMN: Interactive / Showcase Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="lg:col-span-5 relative"
        >
          {/* Main Visual Frame */}
          <div className="relative rounded-3xl p-1 bg-gradient-to-b from-white/15 to-white/0 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden group">
            <div className="bg-[#12161f] rounded-[22px] p-6 space-y-6">
              
              {/* Top Bar / Header of Mockup */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <span className="text-[9px] uppercase tracking-[0.3em] text-[#E9C46A] font-mono">AI Virtual Canvas v2.0</span>
              </div>

              {/* Graphic Placeholder or Interactive Highlight */}
              <div className="h-64 rounded-2xl bg-gradient-to-tr from-[#161b22] to-[#0A0C10] border border-white/5 flex flex-col items-center justify-center relative overflow-hidden text-center p-6">
                <div className="absolute inset-0 bg-radial-gradient from-[#E9C46A]/10 to-transparent pointer-events-none" />
                <Layers size={40} className="text-[#E9C46A] mb-3 animate-pulse" />
                <p className="text-white text-xs font-bold uppercase tracking-widest">Real-time Silhouette Mapping</p>
                <p className="text-gray-500 text-[10px] uppercase tracking-widest mt-1">Instant fit assessment active</p>
              </div>

              {/* Quick Action Link in Card */}
              <div className="flex items-center justify-between text-xs text-gray-400 pt-2">
                <span className="text-[10px] uppercase tracking-widest text-gray-500">Try AI Fitting Studio</span>
                <button 
                  // '/aitryon' is not a registered route — /try-on is.
                  onClick={() => navigate('/try-on')} 
                  className="text-[#E9C46A] hover:underline flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold"
                >
                  Launch Now <ArrowUpRight size={14} />
                </button>
              </div>

            </div>
          </div>
        </motion.div>

      </div>
    </section>
  );
};

export default HeroSection;