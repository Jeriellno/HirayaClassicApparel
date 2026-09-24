import React, { useEffect, useMemo, useState } from 'react';
import { Lock, ImageOff } from 'lucide-react';
import { getProductImageUrl } from '../../utils/imageHelper';

/**
 * Product image display with an optional thumbnail switcher.
 *
 * `images` may arrive as an array, a JSON string, or not at all — we normalise
 * defensively so a malformed payload can never blank the whole page.
 */
const ProductGallery = ({ imageUrl, images, name, isGuest }) => {
  // 1. Normalise every source into one clean list of usable URLs.
  const gallery = useMemo(() => {
    let parsed = [];

    if (Array.isArray(images)) {
      parsed = images;
    } else if (typeof images === 'string' && images.trim().startsWith('[')) {
      try {
        const json = JSON.parse(images);
        parsed = Array.isArray(json) ? json : [];
      } catch {
        parsed = [];
      }
    }

    const all = [imageUrl, ...parsed].filter(Boolean).map((src) => getProductImageUrl(src));

    // De-duplicate: the primary image is often repeated inside `images`.
    return [...new Set(all)];
  }, [imageUrl, images]);

  const [activeIndex, setActiveIndex] = useState(0);

  // Reset to the primary shot if this component is reused for another product.
  useEffect(() => {
    setActiveIndex(0);
  }, [imageUrl]);

  const activeImage = gallery[activeIndex] || gallery[0];
  const hasThumbnails = gallery.length > 1;

  return (
    <div className="space-y-3 lg:sticky lg:top-28 max-w-md mx-auto lg:mx-0 w-full">
      <div className="overflow-hidden bg-zinc-900 rounded-2xl relative group border-zinc-800">
        {activeImage ? (
          <img
            src={activeImage}
            alt={name}
            className="w-full aspect-[3/4] object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full aspect-[3/4] flex-col items-center justify-center gap-2 text-zinc-600">
            <ImageOff size={30} />
            <span className="text-[9px] uppercase tracking-[0.25em] font-bold">No image available</span>
          </div>
        )}

        {isGuest && (
          <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md border-zinc-800 px-3 py-1.5 rounded-full">
            <p className="text-[9px] uppercase tracking-[0.2em] font-bold text-stone-200 flex items-center gap-1.5">
              <Lock size={11} /> Preview Mode
            </p>
          </div>
        )}

        {hasThumbnails && (
          <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-md border-zinc-800 text-zinc-300 text-[9px] font-bold tracking-widest px-2.5 py-1 rounded-full">
            {activeIndex + 1} / {gallery.length}
          </div>
        )}
      </div>

      {/* THUMBNAIL SWITCHER — only rendered when there is more than one shot. */}
      {hasThumbnails && (
        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
          {gallery.map((src, index) => (
            <button
              key={`${src}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`View image ${index + 1} of ${gallery.length}`}
              aria-current={activeIndex === index}
              className={`relative w-14 h-[4.5rem] shrink-0 rounded-xl overflow-hidden border transition-all duration-300 ${activeIndex === index
                  ? 'border-stone-300'
                  : 'border-zinc-800 opacity-50 hover:opacity-100 hover:border-zinc-700'
                }`}
            >
              <img src={src} alt={`${name} view ${index + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductGallery;
