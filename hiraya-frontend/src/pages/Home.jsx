import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import SpotlightSection from '../components/product/SpotlightSection';
import {
  Sparkles,
  ArrowRight,
  Layers,
  Shirt,
  Compass,
  ShieldCheck,
  Wand2,
  ChevronRight,
} from 'lucide-react';
import { motion } from 'framer-motion';

const Home = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Featured / latest products — used as the Spotlight's fallback feed
  // when the user is a guest or hasn't set their body measurements yet.
  const { data: apiProducts, isLoading } = useQuery({
    /*
     * SAME KEY AS THE SHOP (`useShopData`).
     *
     * This used to be ['products-featured'], a second cache of the SAME
     * `/products` endpoint. Two keys for one resource meant the two surfaces could
     * disagree, and nothing that invalidated the shop's copy could reach this one —
     * so a product edit was invisible here regardless of what Shop did.
     *
     * Sharing the key also removes a duplicate request: Home and Shop now read one
     * cached payload instead of each fetching the catalog separately.
     */
    queryKey: ['products'],
    queryFn: async () => {
      try {
        const res = await api.get('/products');
        // The endpoint returns a bare array, but a stray PHP warning baked into
        // the body (or a future { data: [...] } envelope) can hand us a string
        // or an object. Normalize here so SpotlightSection always receives an
        // array and never crashes on `.filter`.
        const payload = res.data;
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.data)) return payload.data;
        return [];
      } catch {
        return [];
      }
    }
  });

  const featuredProducts = useMemo(() => {
    if (!Array.isArray(apiProducts) || !apiProducts.length) return [];
    return apiProducts.slice(0, 4);
  }, [apiProducts]);

  return (
    <div className="bg-[#0A0C10] min-h-screen text-gray-100 overflow-hidden">

      {/* HERO SECTION */}
      <section className="relative pt-40 pb-24 px-8 md:px-20 flex flex-col items-center justify-center text-center">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-white/[0.04] blur-[140px] rounded-full pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-zinc-300 text-[10px] font-bold uppercase tracking-[0.3em] mb-8"
        >
          <Sparkles size={14} /> Next-Gen AI Virtual Fitting Room
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-5xl md:text-7xl font-extralight uppercase tracking-[0.25em] text-[#E9C46A] max-w-5xl leading-tight"
        >
          Redefine Your <span className="text-hiraya-cream font-serif italic lowercase tracking-normal">Personal</span> Style
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="text-gray-400 text-xs md:text-sm max-w-2xl mt-6 uppercase tracking-[0.3em] leading-relaxed font-light"
        >
          Experience tailored garment previewing with AI. Try on premium collections instantly before making a choice.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="mt-10 flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto"
        >
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            // The registered Studio route is /try-on; '/aitryon' does not exist
            // and silently bounced the customer to the Home fallback.
            onClick={() => navigate('/try-on')}
            className="w-full sm:w-auto px-8 py-4 bg-[#E9C46A] hover:bg-[#D4A94F] text-zinc-950 font-black rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center justify-center gap-3 shadow-xl shadow-black/40"
          >
            <Wand2 size={16} /> Enter AI Fitting Studio
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate('/shop')}
            className="w-full sm:w-auto px-8 py-4 bg-white/5 border border-white/10 hover:border-white/40 hover:bg-white/10 text-white font-extrabold rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center justify-center gap-3"
          >
            Explore Collection <ChevronRight size={16} />
          </motion.button>
        </motion.div>
      </section>

      {/* MEMBER PERSONALIZED WELCOME BANNER */}
      {user && (
        <section className="px-8 md:px-20 mb-20">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="p-10 rounded-[2.5rem] bg-gradient-to-r from-[#161b22] via-[#11141c] to-[#0A0C10] border border-white/10 flex flex-col md:flex-row justify-between items-center gap-8 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/[0.03] blur-[100px] rounded-full pointer-events-none" />
            <div className="z-10">
              <span className="text-[10px] text-[#E9C46A]/70 uppercase tracking-widest block mb-1">Exclusive Portal</span>
              <h2 className="text-2xl font-light tracking-[0.3em] uppercase text-[#E9C46A]">Welcome back, {user.full_name?.split(' ')[0] || 'Stylist'}</h2>
              <p className="text-zinc-400 text-[11px] mt-2 uppercase tracking-[0.3em] font-bold italic">
                Your wardrobe stack and AI model configurations are ready.
              </p>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/try-on')}
              className="z-10 flex items-center gap-2.5 bg-[#E9C46A] hover:bg-[#D4A94F] text-zinc-950 px-8 py-4 rounded-full text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-black/40 shrink-0 transition-colors"
            >
              <Layers size={16} /> Open AI Studio
            </motion.button>
          </motion.div>
        </section>
      )}

      {/* PERSONALIZED / CURATED SPOTLIGHT */}
      <SpotlightSection
        fallbackProducts={featuredProducts}
        isFallbackLoading={isLoading}
      />

      {/* HOW IT WORKS / AI FITTING FEATURES */}
      <section className="px-8 md:px-20 py-24 my-12 bg-gradient-to-b from-transparent via-[#12161f]/50 to-transparent">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.4em] block mb-2">
            Seamless Virtual Experience
          </span>
          <h2 className="text-3xl md:text-4xl font-light uppercase tracking-[0.3em] text-[#E9C46A]">How Hiraya Works</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <motion.div
            whileHover={{ y: -5 }}
            className="p-8 rounded-3xl bg-[#12161f] border border-white/10 flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] text-zinc-200 flex items-center justify-center mb-6">
                <Compass size={22} />
              </div>
              <h3 className="text-lg font-bold uppercase tracking-wider text-[#E9C46A] mb-3">1. Pick Garments</h3>
              <p className="text-gray-400 text-xs leading-relaxed">
                Browse through curated collections of tops, bottoms, and full outfits built specifically for fitting analysis.
              </p>
            </div>
            <span className="text-[10px] text-zinc-500 font-extrabold uppercase tracking-widest mt-8 block">Step 01</span>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="p-8 rounded-3xl bg-[#12161f] border border-white/10 flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] text-zinc-200 flex items-center justify-center mb-6">
                <Shirt size={22} />
              </div>
              <h3 className="text-lg font-bold uppercase tracking-wider text-[#E9C46A] mb-3">2. Virtual Model Fit</h3>
              <p className="text-gray-400 text-xs leading-relaxed">
                Send items directly to your AI fitting room stack to see how sizes, textures, and silhouettes pair together.
              </p>
            </div>
            <span className="text-[10px] text-zinc-500 font-extrabold uppercase tracking-widest mt-8 block">Step 02</span>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="p-8 rounded-3xl bg-[#12161f] border border-white/10 flex flex-col justify-between"
          >
            <div>
              <div className="w-12 h-12 rounded-2xl bg-white/[0.06] text-zinc-200 flex items-center justify-center mb-6">
                <ShieldCheck size={22} />
              </div>
              <h3 className="text-lg font-bold uppercase tracking-wider text-[#E9C46A] mb-3">3. Confident Choice</h3>
              <p className="text-gray-400 text-xs leading-relaxed">
                Make confident style choices with high accuracy visual rendering without the need to visit physical fitting rooms.
              </p>
            </div>
            <span className="text-[10px] text-zinc-500 font-extrabold uppercase tracking-widest mt-8 block">Step 03</span>
          </motion.div>
        </div>
      </section>

      {/* FOOTER CTA BANNER */}
      <section className="px-8 md:px-20 pb-28">
        <div className="p-12 md:p-16 rounded-[3rem] bg-gradient-to-r from-[#161b22] via-[#12161f] to-[#0A0C10] border border-white/10 text-center relative overflow-hidden shadow-2xl">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-white/[0.04] blur-[120px] rounded-full pointer-events-none" />
          <h2 className="text-3xl md:text-5xl font-extralight uppercase tracking-[0.3em] text-[#E9C46A] relative z-10">
            Ready to Transform Your Wardrobe?
          </h2>
          <p className="text-gray-400 text-xs md:text-sm uppercase tracking-[0.3em] mt-4 max-w-xl mx-auto relative z-10 font-light">
            Start curating your personal AI fitting stack today.
          </p>
          <div className="mt-8 flex justify-center relative z-10">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/shop')}
              className="px-10 py-4 bg-[#E9C46A] hover:bg-[#D4A94F] text-zinc-950 font-black rounded-full text-xs uppercase tracking-[0.25em] transition flex items-center gap-3 shadow-xl shadow-black/40"
            >
              Explore Shop <ArrowRight size={16} />
            </motion.button>
          </div>
        </div>
      </section>

    </div>
  );
};

export default Home;
