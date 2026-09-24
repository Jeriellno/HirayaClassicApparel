import React from 'react';
import Currency from './common/Currency';

export default function GarmentCard({
  image,
  title,
  category,
  price,
  badgeText ="GARMENT",
  onTryOn,
  onWishlist,
  onClick
}) {
  return (
    <div
      onClick={onClick}
      className="group relative bg-[#121212] border border-white/10 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:border-stone-300/50 hover:shadow-lg hover:shadow-stone-200/10 flex flex-col"
    >
      {/* 1. Image Area & Top Badge */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#1a1a1a]">
        <img
          src={image || '/placeholder.jpg'}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />

        {/* Gold Category / Status Badge */}
        {badgeText && (
          <span className="absolute top-3 right-3 text-[10px] font-bold tracking-wider uppercase bg-black/60 backdrop-blur-md text-stone-200 border border-stone-300/30 px-2.5 py-1 rounded-full">
            {badgeText}
          </span>
        )}

        {/* Hover Action Overlay Icons (Center) */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-3">
          {onTryOn && (
            <button
              onClick={(e) => { e.stopPropagation(); onTryOn(); }}
              className="p-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white hover:bg-[#E9C46A] hover:border-stone-300 transition-colors"
              title="AI Try-On"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
              </svg>
            </button>
          )}
          {onWishlist && (
            <button
              onClick={(e) => { e.stopPropagation(); onWishlist(); }}
              className="p-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white hover:bg-rose-500 hover:border-rose-500 transition-colors"
              title="Add to Bag"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 2. Bottom Label / Details Section */}
      <div className="p-4 bg-[#141414] border-t border-white/5 flex flex-col justify-between flex-1">
        <div>
          <p className="text-[10px] tracking-widest text-stone-200/80 uppercase font-semibold">
            {category || 'GARMENT'}
          </p>
          <h3 className="text-sm font-medium text-white/90 mt-1 line-clamp-1 group-hover:text-stone-200 transition-colors">
            {title}
          </h3>
        </div>

        {price !== undefined && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-white/50">PRICE</span>
            {/* Currency pins a font stack that actually contains U+20B1, so the
                peso sign renders instead of falling back to a "?". */}
            <Currency
              amount={price}
              decimals={false}
              className="text-sm font-bold tracking-wide text-stone-200"
            />
          </div>
        )}
      </div>
    </div>
  );
}