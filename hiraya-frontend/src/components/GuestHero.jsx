import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ShieldCheck, Zap, ArrowRight } from 'lucide-react';

const GuestHero = () => {
    const navigate = useNavigate();

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { 
            opacity: 1,
            transition: { staggerChildren: 0.3, delayChildren: 0.2 }
        }
    };

    const itemVariants = {
        hidden: { y: 30, opacity: 0 },
        visible: { y: 0, opacity: 1, transition: { duration: 1, ease: [0.16, 1, 0.3, 1] } }
    };

    return (
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0A0C10] pt-20">
            {/* Ambient Navy/Midnight Background Elements */}
            <div className="absolute top-[-15%] left-[-10%] w-[60%] h-[60%] bg-[#1A2536] rounded-full blur-[150px] opacity-40" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[70%] bg-[#0F172A] rounded-full blur-[130px] opacity-50" />
            
            {/* Subtle Navy Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0A0C10]/60 to-[#0A0C10] z-0" />

            <motion.div 
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="container mx-auto px-8 relative z-10 text-center"
            >
                {/* Brand Tagline */}
                <motion.div variants={itemVariants} className="flex justify-center mb-10">
                    <span className="px-8 py-3 rounded-full border border-[#E9C46A]/40 bg-[#E9C46A]/5 backdrop-blur-xl text-[13px] uppercase tracking-[0.5em] text-[#E9C46A] font-black shadow-[0_0_20px_rgba(245,235,224,0.12)]">
                        The Future of Fitting
                    </span>
                </motion.div>

                {/* Main Heading */}
                <motion.h1 variants={itemVariants} className="text-6xl md:text-[6rem] font-light text-[#E9C46A] mb-10 tracking-tighter leading-[1.05]">
                    Your Closet, <span className="italic font-serif text-[#E9C46A]">Redefined.</span><br />
                    <span className="font-medium">AI-Powered Style.</span>
                </motion.h1>

                {/* System Introduction */}
                <motion.p variants={itemVariants} className="max-w-3xl mx-auto text-gray-400 text-lg md:text-2xl leading-relaxed mb-16 font-light tracking-wide">
                    Experience a seamless virtual fit and expert AI styling to discover your perfect look.
                    Hiraya blends traditional elegance with modern intelligence.
                </motion.p>

                {/* Call to Actions */}
                <motion.div variants={itemVariants} className="flex flex-col md:flex-row items-center justify-center gap-8 mb-28">
                    <button
                        onClick={() => navigate('/register')}
                        className="group px-14 py-7 bg-[#F5F5F5] text-[#0A0C10] rounded-full text-[14px] uppercase tracking-[0.3em] font-black hover:bg-white transition-all shadow-[0_20px_40px_rgba(0,0,0,0.4)] flex items-center gap-4"
                    >
                        Get Started for Free <ArrowRight size={20} className="group-hover:translate-x-2 transition-transform" />
                    </button>
                    <button
                        onClick={() => navigate('/login')}
                        className="px-14 py-7 bg-transparent border-2 border-white/10 text-[#F5F5F5] rounded-full text-[14px] uppercase tracking-[0.3em] font-bold hover:bg-white/5 hover:border-white/30 transition-all backdrop-blur-md"
                    >
                        Sign In to Profile
                    </button>
                </motion.div>

                {/* Feature Highlights (Dark Glass Cards) */}
                <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-3 gap-10 max-w-6xl mx-auto">
                    {[
                        { icon: <Sparkles size={28} />, title:"AI-Driven Precision", desc:"Our neural engine analyzes your anatomical profile for a mathematically perfect fit." },
                        { icon: <ShieldCheck size={28} />, title:"Privacy First", desc:"Your portraits are processed locally and securely, ensuring your data remains yours." },
                        { icon: <Zap size={28} />, title:"Instant Styling", desc:"No more guesswork. Visualize outfits on your body in real-time with one click." }
                    ].map((feature, index) => (
                        <div key={index} className="p-12 rounded-[3.5rem] bg-white/[0.03] backdrop-blur-2xl border border-white/5 text-left hover:border-[#E9C46A]/30 transition-all duration-500 group hover:bg-white/[0.05]">
                            <div className="w-16 h-16 bg-[#1A1C20] border border-white/5 rounded-2xl flex items-center justify-center text-[#E9C46A] mb-8 shadow-2xl group-hover:scale-110 group-hover:shadow-[#E9C46A]/10 transition-all duration-500">
                                {feature.icon}
                            </div>
                            <h4 className="text-[14px] uppercase tracking-[0.3em] font-black text-[#E9C46A] mb-5">{feature.title}</h4>
                            <p className="text-[16px] text-gray-400 leading-relaxed font-light">{feature.desc}</p>
                        </div>
                    ))}
                </motion.div>
            </motion.div>

            {/* Decorative Tech Grid */}
            <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" 
                 style={{ backgroundImage: `radial-gradient(#F5F5F5 0.5px, transparent 0.5px)`, backgroundSize: '50px 50px' }} 
            />
        </section>
    );
};

export default GuestHero;