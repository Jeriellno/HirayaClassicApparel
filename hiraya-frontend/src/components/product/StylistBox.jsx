import React from 'react';
import { Lock } from 'lucide-react';

const StylistBox = ({ recommendation }) => {
  return (
    <div className="p-5 bg-zinc-950 border-zinc-800 rounded-xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-3 opacity-[0.06] group-hover:rotate-12 transition-transform">
        <Lock size={48} className="text-stone-200" />
      </div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="h-1.5 w-1.5 bg-[#E9C46A] rounded-full animate-pulse" />
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-stone-200">
          Hiraya AI Stylist
        </span>
      </div>
      <p className="text-[12.5px] text-zinc-300 font-normal italic leading-relaxed relative z-10">
"{recommendation}"
      </p>
    </div>
  );
};

export default StylistBox;
