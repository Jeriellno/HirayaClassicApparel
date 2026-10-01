import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Lock } from 'lucide-react';
import { getProductImageUrl } from '../../utils/imageHelper';
import FloatingStage from './FloatingStage';

/**
 * Product image display with an optional thumbnail switcher.
 *
 * `images` may arrive as an array, a JSON string, or not at all — we normalise
 * defensively so a malformed payload can never blank the whole page.
 *
 * Presentation: the active shot floats on the FloatingStage (the motion
 * reference's hovering garment, tinted stage and direction-aware carousel);
 * the thumbnails below are the same switcher as before, as neumorphic chips.
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
  // Which way the carousel is travelling — purely for the slide animation.
  const [direction, setDirection] = useState(1);

  // Reset to the primary shot if this component is reused for another product.
  useEffect(() => {
    setActiveIndex(0);
  }, [imageUrl]);

  const hasThumbnails = gallery.length > 1;

  const goTo = (next) => {
    if (!gallery.length) return;
    const wrapped = (next + gallery.length) % gallery.length;
    setDirection(next > activeIndex ? 1 : -1);
    setActiveIndex(wrapped);
  };

  const slides = gallery.length
    ? gallery.map((src, i) => ({ key: `${src}-${i}`, src, alt: name }))
    : [{ key: 'none', src: null, alt: name }];

  return (
    <div
      className="mx-auto w-full max-w-md space-y-4 lg:sticky lg:top-28 lg:mx-0 lg:max-w-none"
      data-tour="product-gallery"
    >
      <FloatingStage
        slides={slides}
        index={Math.min(activeIndex, slides.length - 1)}
        direction={direction}
        onPrev={() => goTo(activeIndex - 1)}
        onNext={() => goTo(activeIndex + 1)}
        label={`${name || 'Product'} images`}
        className="aspect-[4/5] w-full rounded-[28px] shadow-[0_40px_80px_-40px_rgba(13,21,36,0.8)] ring-1 ring-navy-900/10"
        overlay={
          isGuest ? (
            <div className="absolute left-4 top-4 rounded-full border border-cream-50/20 bg-noir/40 px-3.5 py-1.5 backdrop-blur-md">
              <p className="flex items-center gap-1.5 text-[0.56rem] font-semibold uppercase tracking-[0.2em] text-cream-100">
                <Lock size={11} /> Preview Mode
              </p>
            </div>
          ) : null
        }
      />

      {/* THUMBNAIL SWITCHER — only rendered when there is more than one shot. */}
      {hasThumbnails && (
        <div className="flex gap-3 overflow-x-auto p-1 pb-2 scrollbar-none">
          {gallery.map((src, index) => (
            <button
              key={`${src}-${index}`}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`View image ${index + 1} of ${gallery.length}`}
              aria-current={activeIndex === index}
              className={`relative h-20 w-16 shrink-0 cursor-pointer overflow-hidden rounded-xl bg-noir transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus ${activeIndex === index
                  ? 'shadow-neu-sm ring-2 ring-navy-800 ring-offset-2 ring-offset-cream-100'
                  : 'opacity-55 shadow-neu-sm hover:-translate-y-0.5 hover:opacity-100'
                }`}
            >
              <img src={src} alt={`${name} view ${index + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

ProductGallery.propTypes = {
  imageUrl: PropTypes.string,
  images: PropTypes.oneOfType([PropTypes.array, PropTypes.string]),
  name: PropTypes.string,
  isGuest: PropTypes.bool,
};

export default ProductGallery;
