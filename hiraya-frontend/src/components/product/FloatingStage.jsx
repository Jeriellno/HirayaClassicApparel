import { useState } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';

/*
 * ============================================================================
 * FLOATING STAGE — the product presentation from the motion reference
 * ============================================================================
 *
 * PRESENTATION ONLY: it is told which slide is active and asks its parent to
 * change it. It owns no product data.
 *
 * THE THREE MECHANICS (after "video reference.mp4")
 * -------------------------------------------------
 *  1. THE FLOAT — the garment hovers and breathes above a soft ground shadow
 *     that shrinks as it rises, so the piece reads as suspended, not pasted.
 *  2. THE CAROUSEL — arrows (or a swipe, or ← →) carry the current piece out
 *     to one side while the next swings in from the other: a direction-aware
 *     slide with a slight turn and a spring settle.
 *  3. THE TINT — the stage takes its colour from the piece on it. A heavily
 *     blurred copy of the active image sits behind everything, so each garment
 *     washes the stage in its own tones and the wash cross-fades on change.
 *
 * Catalog images are finished cards on a black ground, so the image is
 * feathered at its edges with a radial mask: it melts into the stage instead
 * of sitting on it as a black rectangle, whatever the stage colour.
 */

const SWIPE_DISTANCE = 60;

const slideVariants = {
    enter: (dir) => ({ x: dir * 90, opacity: 0, rotate: dir * 5, scale: 0.94, filter: 'blur(6px)' }),
    center: {
        x: 0,
        opacity: 1,
        rotate: 0,
        scale: 1,
        filter: 'blur(0px)',
        transition: { type: 'spring', stiffness: 170, damping: 22, mass: 0.9 },
    },
    exit: (dir) => ({
        x: dir * -90,
        opacity: 0,
        rotate: dir * -5,
        scale: 0.94,
        filter: 'blur(6px)',
        transition: { duration: 0.32, ease: [0.65, 0, 0.35, 1] },
    }),
};

// Solid through the garment, fully faded by the card's edge — so the frame
// line baked into catalog cards dissolves and the piece reads as floating.
const FEATHER = 'radial-gradient(ellipse 56% 58% at 50% 48%, #000 60%, transparent 100%)';

const FloatingStage = ({
    slides,
    index,
    direction = 1,
    onPrev,
    onNext,
    label = 'Product images',
    className = '',
    imageClassName = 'h-[82%]',
    overlay = null,
    showControls = true,
    surfaceClassName = 'bg-noir',
    tint = true,
}) => {
    const reduce = useReducedMotion();
    const [failed, setFailed] = useState({});

    const slide = slides[index] || slides[0];
    const total = slides.length;
    const hasMany = total > 1;
    const broken = !slide?.src || failed[slide.key];

    const onKeyDown = (e) => {
        if (!hasMany) return;
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onPrev?.();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            onNext?.();
        }
    };

    const onDragEnd = (_e, info) => {
        if (!hasMany) return;
        if (info.offset.x < -SWIPE_DISTANCE) onNext?.();
        else if (info.offset.x > SWIPE_DISTANCE) onPrev?.();
    };

    return (
        <div
            role="region"
            aria-roledescription="carousel"
            aria-label={label}
            tabIndex={hasMany ? 0 : undefined}
            onKeyDown={onKeyDown}
            className={`relative isolate overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100/70 ${surfaceClassName} ${className}`}
        >
            {/* THE TINT — a blurred echo of the active piece. A parent that
                tints a larger surface itself passes `tint={false}`. */}
            <AnimatePresence initial={false}>
                {tint && !broken && (
                    <motion.img
                        key={`tint-${slide.key}`}
                        src={slide.src}
                        alt=""
                        aria-hidden="true"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.55 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.7 }}
                        className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-125 object-cover blur-[60px] saturate-150"
                    />
                )}
            </AnimatePresence>
            {tint && (
                <>
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_40%,transparent_20%,rgba(13,21,36,0.75)_100%)]" />
                    <div aria-hidden="true" className="vintage-grain pointer-events-none absolute inset-0 -z-10 opacity-25 mix-blend-soft-light" />
                </>
            )}

            {/* THE FLOAT — the bob lives on a wrapper so a slide change never
                restarts it. */}
            <div className="absolute inset-0 flex items-center justify-center pb-[8%]">
                <motion.div
                    className="relative flex h-full w-full items-center justify-center"
                    animate={reduce ? undefined : { y: [0, -12, 0] }}
                    transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                    <AnimatePresence initial={false} custom={direction} mode="popLayout">
                        {broken ? (
                            <motion.div
                                key={`empty-${slide?.key ?? 'none'}`}
                                custom={direction}
                                variants={slideVariants}
                                initial={reduce ? false : 'enter'}
                                animate="center"
                                exit={reduce ? undefined : 'exit'}
                                className="flex flex-col items-center gap-2 text-cream-300/70"
                            >
                                <ImageOff size={30} />
                                <span className="text-[0.58rem] font-semibold uppercase tracking-[0.25em]">No image available</span>
                            </motion.div>
                        ) : (
                            <motion.img
                                key={slide.key}
                                src={slide.src}
                                alt={slide.alt}
                                custom={direction}
                                variants={slideVariants}
                                initial={reduce ? false : 'enter'}
                                animate="center"
                                exit={reduce ? undefined : 'exit'}
                                drag={hasMany && !reduce ? 'x' : false}
                                dragConstraints={{ left: 0, right: 0 }}
                                dragElastic={0.5}
                                onDragEnd={onDragEnd}
                                onError={() => setFailed((f) => ({ ...f, [slide.key]: true }))}
                                draggable="false"
                                style={{ maskImage: FEATHER, WebkitMaskImage: FEATHER }}
                                className={`w-auto max-w-[88%] select-none object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.45)] ${hasMany ? 'cursor-grab active:cursor-grabbing' : ''} ${imageClassName}`}
                            />
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>

            {/* The ground shadow, breathing opposite to the float. */}
            <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-[7%] left-1/2 h-5 w-[42%] -translate-x-1/2 rounded-[50%] bg-black/60 blur-lg"
                animate={reduce ? undefined : { scaleX: [1, 0.82, 1], opacity: [0.8, 0.5, 0.8] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
            />

            {overlay}

            {showControls && hasMany && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-4 pb-4 sm:px-5 sm:pb-5">
                    <StageButton label="Previous image" onClick={onPrev}>
                        <ChevronLeft size={18} />
                    </StageButton>
                    <div className="flex items-center gap-3 rounded-full border border-cream-50/15 bg-noir/40 px-3.5 py-1.5 backdrop-blur-md">
                        <span className="font-serif text-[0.7rem] tracking-[0.2em] text-cream-100">
                            {String(index + 1).padStart(2, '0')}
                            <span className="text-cream-400"> / {String(total).padStart(2, '0')}</span>
                        </span>
                        <span aria-hidden="true" className="flex gap-1">
                            {slides.map((s, i) => (
                                <span
                                    key={s.key}
                                    className={`h-1 rounded-full transition-all duration-500 ${i === index ? 'w-4 bg-cream-100' : 'w-1 bg-cream-100/35'}`}
                                />
                            ))}
                        </span>
                    </div>
                    <StageButton label="Next image" onClick={onNext}>
                        <ChevronRight size={18} />
                    </StageButton>
                </div>
            )}
        </div>
    );
};

FloatingStage.propTypes = {
    slides: PropTypes.arrayOf(
        PropTypes.shape({
            key: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
            src: PropTypes.string,
            alt: PropTypes.string,
        })
    ).isRequired,
    index: PropTypes.number.isRequired,
    direction: PropTypes.oneOf([1, -1]),
    onPrev: PropTypes.func,
    onNext: PropTypes.func,
    label: PropTypes.string,
    className: PropTypes.string,
    imageClassName: PropTypes.string,
    overlay: PropTypes.node,
    showControls: PropTypes.bool,
    surfaceClassName: PropTypes.string,
    tint: PropTypes.bool,
};

export const StageButton = ({ label, onClick, children }) => (
    <motion.button
        type="button"
        onClick={onClick}
        aria-label={label}
        whileTap={{ scale: 0.9 }}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-cream-50/20 bg-cream-50/10 text-cream-100 backdrop-blur-md transition-colors duration-300 hover:border-cream-100 hover:bg-cream-100 hover:text-navy-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
    >
        {children}
    </motion.button>
);

StageButton.propTypes = {
    label: PropTypes.string.isRequired,
    onClick: PropTypes.func,
    children: PropTypes.node.isRequired,
};

export default FloatingStage;
