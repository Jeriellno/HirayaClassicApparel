import React from 'react';
import { motion } from 'framer-motion';
import { ScanEye, Cpu, Layers, MousePointer2 } from 'lucide-react';

const GuestVisualAid = () => {
    return (
        <section className="px-6 md:px-20 py-20 relative overflow-hidden">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-16 space-y-3">
                    <h3 className="text-[10px] uppercase tracking-[0.5em] text-hiraya-ink font-bold">The Core Process</h3>
                    <h2 className="text-3xl font-light text-[#2D2D2D]">How Hiraya Architectures Style</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                    {/* Visual Side: Simulated App Interface */}
                    <div className="relative aspect-square md:aspect-video rounded-[3rem] bg-gradient-to-br from-[#F0EBE5] to-[#E8E2DA] p-8 flex items-center justify-center overflow-hidden border border-white">
                        {/* Decorative background circle */}
                        <div className="absolute w-64 h-64 bg-[#CB997E]/10 rounded-full blur-3xl" />
                        
                        {/* Simulated Glass Panel 1 */}
                        <motion.div 
                            initial={{ x: -20, opacity: 0 }}
                            whileInView={{ x: 0, opacity: 1 }}
                            className="absolute top-10 left-10 w-48 h-56 bg-hiraya-cream/40 backdrop-blur-xl rounded-3xl border border-hiraya-olive/60 shadow-2xl z-20 p-5 flex flex-col justify-between"
                        >
                            <div className="space-y-2">
                                <div className="w-8 h-8 rounded-lg bg-[#CB997E]/20 flex items-center justify-center text-hiraya-ink"><ScanEye size={16}/></div>
                                <div className="h-2 w-20 bg-[#2D2D2D]/10 rounded-full" />
                                <div className="h-2 w-12 bg-[#2D2D2D]/5 rounded-full" />
                            </div>
                            <div className="space-y-2">
                                <div className="h-10 w-full bg-[#2D2D2D] rounded-xl" />
                            </div>
                        </motion.div>

                        {/* Simulated Glass Panel 2 (Main Showcase) */}
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0 }}
                            whileInView={{ scale: 1, opacity: 1 }}
                            className="w-64 h-80 bg-hiraya-cream/60 backdrop-blur-2xl rounded-[2.5rem] border border-white shadow-2xl z-10 flex flex-col items-center justify-center p-6 text-center"
                        >
                            <div className="w-full h-full border-2 border-dashed border-[#CB997E]/30 rounded-[2rem] flex flex-col items-center justify-center gap-3">
                                <div className="p-4 rounded-full bg-hiraya-cream shadow-sm"><Cpu size={24} className="text-hiraya-ink" /></div>
                                <span className="text-[9px] uppercase tracking-widest text-hiraya-ink font-bold">Neural Mapping</span>
                            </div>
                        </motion.div>

                        {/* Mouse Pointer Animation */}
                        <motion.div 
                            animate={{ x: [0, 50, 0], y: [0, -30, 0] }}
                            transition={{ duration: 4, repeat: Infinity }}
                            className="absolute z-30 text-hiraya-ink"
                        >
                            <MousePointer2 fill="currentColor" size={20} />
                        </motion.div>
                    </div>

                    {/* Text Side: Explanation */}
                    <div className="space-y-10">
                        {[
                            { 
                                icon: <Layers size={18}/>, 
                                title:"Fabric Virtualization", 
                                text:"Every garment is digitized into high-fidelity 3D assets, preserving texture, drape, and light behavior." 
                            },
                            { 
                                icon: <Cpu size={18}/>, 
                                title:"Real-time Synthesis", 
                                text:"Our AI overlays your selected stack onto your anatomical profile with mathematical precision in seconds." 
                            }
                        ].map((item, i) => (
                            <div key={i} className="flex gap-6">
                                <div className="w-12 h-12 flex-shrink-0 bg-hiraya-cream shadow-sm rounded-2xl flex items-center justify-center text-hiraya-ink border border-hiraya-olive/15">
                                    {item.icon}
                                </div>
                                <div className="space-y-2">
                                    <h4 className="text-xs uppercase tracking-widest font-bold text-[#2D2D2D]">{item.title}</h4>
                                    <p className="text-sm text-hiraya-sand font-light leading-relaxed">{item.text}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default GuestVisualAid;