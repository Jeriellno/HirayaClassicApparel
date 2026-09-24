import React from 'react';
import { motion } from 'framer-motion';
import { Filter } from 'lucide-react';

const GARMENT_FILTERS = [
  { label: 'All Garments', value: 'all' },
  { label: 'Tops', value: 'top' },
  { label: 'Bottoms', value: 'bottom' },
  { label: 'Footwear', value: 'footwear' },
  { label: 'Outerwear', value: 'outerwear' },
  { label: 'Dresses', value: 'dress' }
];

const ShopHeader = ({ activeSubCat, onSelectSubCat }) => {
  return (
    <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/10 pb-8">
      <div>
        <h1 className="text-4xl font-extralight uppercase tracking-[0.35em] text-[#E9C46A]">
          The Collection
        </h1>
        <p className="text-[10px] text-gray-500 uppercase mt-2 tracking-[0.4em] italic font-medium">
          Handpicked Artifacts for AI Fitting
        </p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <Filter size={14} className="text-[#E9C46A] mr-2 shrink-0" />
        {GARMENT_FILTERS.map((opt) => (
          <motion.button
            key={opt.value}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelectSubCat(opt.value)}
            className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition shrink-0 ${
              activeSubCat === opt.value
                ? 'bg-[#E9C46A] text-black shadow-md'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/5'
            }`}
          >
            {opt.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default ShopHeader;