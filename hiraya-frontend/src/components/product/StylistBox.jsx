import React from 'react';
import { Lock } from 'lucide-react';

const StylistBox = ({ recommendation }) => {
  return (
    <div className="p-5 bg-hiraya-olive border-hiraya-sand/30 rounded-xl relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-3 opacity-[0.06] group-hover:rotate-12 transition-transform">
        <Lock size={48} className="text-hiraya-ink" />
      </div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="h-1.5 w-1.5 bg-[#CB997E] rounded-full animate-pulse" />
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-hiraya-ink">
          Hiraya AI Stylist
        </span>
      </div>
      <p className="text-[12.5px] text-hiraya-ink font-normal italic leading-relaxed relative z-10">
"{recommendation}"
      </p>
    </div>
  );
};

export default StylistBox;
