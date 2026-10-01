import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import {
    AnimatePresence,
    motion,
    useInView,
    useReducedMotion,
    useScroll,
    useTransform,
} from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Currency from '../common/Currency';
import { getProductImageUrl } from '../../utils/imageHelper';
import { useFloatingCutouts } from '../../hooks/useFloatingCutouts';

/*
 * ============================================================================
 * SHOP STAGE — featured pieces as free-floating cut-outs
 * ============================================================================
 *
 * NO CARD BEHIND THE GARMENTS. The featured area used to be a navy panel with
 * each catalogue image — itself a finished card (flat colour, frame, emblem) —
 * floating inside it. Now the garment is lifted off its card in the browser
 * (utils/garmentCutout.js) and floats directly over the page, with only a
 * soft halo in the garment's own colour and a ground shadow beneath it.
 *
 * THE CAROUSEL LOOPS ON ITS OWN. Every piece has a slot — centre, next,
 * previous or hidden — and advancing rotates the slots, so pieces glide
 * around a loop rather than being swapped. It auto-advances every few
 * seconds and pauses on hover, on keyboard focus, when scrolled out of view,
 * when the tab is hidden, when the visitor presses Pause, and entirely under
 * reduced motion. Arrows, swipe and ←/→ still work at any time.
 *
 * SCROLL-LINKED DEPTH. As the section scrolls through the viewport the stage
 * drifts against the page and the index numeral drifts the other way.
 *
 * READ-ONLY, as before: it shows the first few products the Shop already
 * loaded and filtered, and links to the existing product page.
 */

const MAX_FEATURED = 5;
const AUTOPLAY_MS = 5500;
const EASE = [0.22, 1, 0.36, 1];

// The first image reference that resolves — the same order ProductCard tries.
const primaryImage = (product) => {
    const raw = [product?.display_image_url, product?.image_url, product?.image_path, product?.image].find(Boolean);
    const src = raw ? getProductImageUrl(raw) : null;
    return src && src !== '/images/placeholder.svg' ? src : null;
};

const priceOf = (product) => parseFloat(String(product?.price ?? '').replace(/[^0-9.-]+/g, '')) || 0;
const categoryOf = (product) => product?.category?.replace('_', ' ') || product?.garment_type || 'Garment';
const pad2 = (n) => String(n).padStart(2, '0');

// "rgb(66, 28, 41)" → "rgba(66, 28, 41, a)"; navy when unknown.
const tint = (color, a) => {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color || '');
    return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : `rgba(29, 44, 69, ${a})`;
};

/*
 * Slot geometry. `x` is a share of the stage width; side pieces sit smaller,
 * softer and further back, so the loop reads as depth rather than a strip.
 */
const SLOTS = {
    center: { x: '0%', scale: 1, opacity: 1, rotate: 0, filter: 'blur(0px)' },
    next: { x: '34%', scale: 0.44, opacity: 0.5, rotate: 5, filter: 'blur(1.5px)' },
    prev: { x: '-34%', scale: 0.44, opacity: 0.5, rotate: -5, filter: 'blur(1.5px)' },
    hiddenRight: { x: '62%', scale: 0.25, opacity: 0, rotate: 8, filter: 'blur(4px)' },
    hiddenLeft: { x: '-62%', scale: 0.25, opacity: 0, rotate: -8, filter: 'blur(4px)' },
};
const DEPTH = { center: 3, next: 2, prev: 2, hiddenRight: 1, hiddenLeft: 1 };

/* One garment: the cut-out (or its fallback) with a continuous gentle float. */
const Garment = ({ src, cutout, alt, phase, still }) => {
    // Still processing: a soft silhouette breathes where the piece will land.
    if (cutout === undefined) {
        return <div aria-hidden="true" className="h-[70%] w-[46%] animate-pulse rounded-[40%] bg-cream-300/40 blur-xl" />;
    }

    const image = cutout ? (
        <img
            src={cutout.src}
            alt={alt}
            draggable={false}
            className="max-h-full w-auto select-none object-contain drop-shadow-[0_28px_28px_rgba(21,32,54,0.22)]"
        />
    ) : (
        // Not a flat card: show the original, softened at the edges.
        <img
            src={src}
            alt={alt}
            draggable={false}
            className="max-h-full w-auto select-none rounded-[28px] object-contain [mask-image:radial-gradient(ellipse_60%_62%_at_50%_48%,#000_62%,transparent_100%)]"
        />
    );

    return (
        <motion.div
            animate={still ? undefined : { y: [0, -14, 0], rotate: [-0.8, 0.8, -0.8] }}
            transition={still ? undefined : { duration: 6.5, ease: 'easeInOut', repeat: Infinity, delay: phase }}
            className="flex h-full items-center justify-center"
        >
            {image}
        </motion.div>
    );
};

Garment.propTypes = {
    src: PropTypes.string,
    cutout: PropTypes.oneOfType([PropTypes.object, PropTypes.oneOf([null])]),
    alt: PropTypes.string,
    phase: PropTypes.number,
    still: PropTypes.bool,
};

/*
 * The stage itself. Split from `ShopStage` so its scroll hooks only mount when
 * there is a section to measure (the Shop renders this with an empty list
 * while the catalogue loads).
 */
const Stage = ({ featured }) => {
    const reduce = useReducedMotion();
    const sectionRef = useRef(null);

    const urls = useMemo(() => featured.map(primaryImage), [featured]);
    const cutouts = useFloatingCutouts(urls);

    const [index, setIndex] = useState(0);
    const [direction, setDirection] = useState(1);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [userPaused, setUserPaused] = useState(false);
    const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.hidden);

    const inView = useInView(sectionRef, { amount: 0.35 });

    useEffect(() => {
        const onVisibility = () => setPageHidden(document.hidden);
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start end', 'end start'] });
    const stageY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [60, -60]);
    const numeralY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-50, 70]);
    const haloScale = useTransform(scrollYProgress, [0, 0.5, 1], reduce ? [1, 1, 1] : [0.82, 1.04, 0.9]);

    const count = featured.length;

    const go = useCallback(
        (step) => {
            if (count < 2) return;
            setDirection(step);
            setIndex((i) => (Math.min(i, count - 1) + step + count) % count);
        },
        [count]
    );

    const safeIndex = Math.min(index, count - 1);
    const current = featured[safeIndex];
    const next = featured[(safeIndex + 1) % count];
    const hasMany = count > 1;
    const currentCutout = cutouts[urls[safeIndex]];
    const nextCutout = cutouts[urls[(safeIndex + 1) % count]];
    const playing = hasMany && !reduce && !userPaused && !hovered && !focused && !pageHidden && inView;

    const slotOf = (i) => {
        const rel = (i - safeIndex + count) % count;
        if (rel === 0) return 'center';
        if (rel === 1) return 'next';
        if (rel === count - 1 && count > 2) return 'prev';
        return direction > 0 ? 'hiddenRight' : 'hiddenLeft';
    };

    return (
        <section
            ref={sectionRef}
            data-tour="shop-stage"
            aria-label="Featured pieces"
            aria-roledescription="carousel"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
            }}
            onKeyDown={(e) => {
                if (e.key === 'ArrowRight') go(1);
                if (e.key === 'ArrowLeft') go(-1);
            }}
            className="relative isolate mb-16 grid items-center gap-6 overflow-x-clip lg:grid-cols-12 lg:gap-4"
        >
            {/* ---- The copy, which changes with the piece ---- */}
            <div className="order-2 flex flex-col gap-8 lg:order-1 lg:col-span-5">
                <div className="flex items-center gap-4">
                    <span className="kicker text-hiraya-ink-muted">Featured piece</span>
                    <span className="font-serif text-[0.8rem] tracking-[0.2em] text-navy-900">
                        {pad2(safeIndex + 1)}
                        <span className="text-charcoal-400"> / {pad2(count)}</span>
                    </span>
                </div>

                <div className="relative min-h-[15rem]" aria-live={playing ? 'off' : 'polite'}>
                    <AnimatePresence mode="wait" initial={false} custom={direction}>
                        <motion.div
                            key={current.id}
                            initial={reduce ? false : { opacity: 0, x: direction * 24, filter: 'blur(6px)' }}
                            animate={{ opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: EASE } }}
                            exit={reduce ? undefined : { opacity: 0, x: direction * -18, filter: 'blur(6px)', transition: { duration: 0.25 } }}
                        >
                            <span className="inline-flex rounded-full border border-navy-900/15 bg-cream-50/70 px-3 py-1 text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-navy-800 shadow-neu-sm">
                                {categoryOf(current)}
                            </span>
                            <h2 className="mt-5 font-serif text-[clamp(1.8rem,3.2vw,2.8rem)] uppercase leading-[1.06] tracking-[0.04em] text-navy-900">
                                {current.name || 'Untitled Item'}
                            </h2>
                            {current.description && (
                                <p className="mt-4 line-clamp-3 max-w-md text-[0.9rem] leading-relaxed text-charcoal-600">
                                    {current.description}
                                </p>
                            )}
                            <div className="mt-7 flex flex-wrap items-center gap-5">
                                <Currency amount={priceOf(current)} className="text-2xl font-semibold tracking-wide text-navy-900" />
                                <Link to={`/product/${current.id}`} className="btn-primary group cursor-pointer rounded-full">
                                    View Piece
                                    <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
                                </Link>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Controls: arrows, the autoplay thread with pause, and "up next". */}
                {hasMany && (
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            {[
                                { step: -1, icon: ChevronLeft, label: 'Previous piece' },
                                { step: 1, icon: ChevronRight, label: 'Next piece' },
                            ].map(({ step, icon: Icon, label }) => (
                                <button
                                    key={step}
                                    type="button"
                                    onClick={() => go(step)}
                                    aria-label={label}
                                    className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-hiraya-surface text-navy-900 shadow-neu-sm ring-1 ring-cream-50/80 transition-[background-color,color,translate] duration-300 hover:-translate-y-0.5 hover:bg-navy-900 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                                >
                                    <Icon size={17} />
                                </button>
                            ))}
                        </div>

                        {!reduce && (
                            <div className="flex items-center gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => setUserPaused((p) => !p)}
                                    aria-label={userPaused ? 'Resume the featured carousel' : 'Pause the featured carousel'}
                                    aria-pressed={userPaused}
                                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-navy-800 transition-colors hover:bg-cream-200/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                                >
                                    {userPaused ? <Play size={13} /> : <Pause size={13} />}
                                </button>
                                {/* The thread fills while the piece is on stage; it IS the timer. */}
                                <span aria-hidden="true" className="h-[3px] w-24 overflow-hidden rounded-full bg-cream-300/70">
                                    <span
                                        key={`${current.id}-${safeIndex}`}
                                        onAnimationEnd={() => go(1)}
                                        className="block h-full origin-left rounded-full bg-navy-800 [animation-name:hiraya-stage-progress] [animation-timing-function:linear] [animation-fill-mode:forwards]"
                                        style={{
                                            animationDuration: `${AUTOPLAY_MS}ms`,
                                            animationPlayState: playing ? 'running' : 'paused',
                                        }}
                                    />
                                </span>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => go(1)}
                            className="group ml-auto flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 text-left transition-colors hover:bg-cream-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus lg:ml-0"
                        >
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cream-200/60 shadow-neu-inset">
                                {nextCutout ? (
                                    <img src={nextCutout.src} alt="" className="h-9 w-9 object-contain transition-transform duration-500 group-hover:scale-110" />
                                ) : null}
                            </span>
                            <span>
                                <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.26em] text-charcoal-500">Up next</span>
                                <span className="mt-0.5 block max-w-[11rem] truncate text-[0.8rem] font-semibold text-navy-900">{next.name || 'Untitled Item'}</span>
                            </span>
                        </button>
                    </div>
                )}
            </div>

            {/* ---- The stage: floating cut-outs, no card ---- */}
            <motion.div
                style={{ y: stageY, touchAction: 'pan-y' }}
                onPanEnd={(e, info) => {
                    if (info.offset.x < -60 || info.velocity.x < -400) go(1);
                    else if (info.offset.x > 60 || info.velocity.x > 400) go(-1);
                }}
                className="relative order-1 h-[360px] select-none sm:h-[440px] lg:order-2 lg:col-span-7 lg:h-[560px]"
            >
                {/* The index numeral, drifting against the scroll. */}
                <motion.span
                    aria-hidden="true"
                    style={{ y: numeralY }}
                    className="pointer-events-none absolute -top-2 right-0 -z-10 select-none font-serif text-[clamp(7rem,18vw,15rem)] leading-none text-transparent [-webkit-text-stroke:1px_rgba(21,32,54,0.12)]"
                >
                    {pad2(safeIndex + 1)}
                </motion.span>

                {/* The halo — the garment's own colour, crossfading between pieces. */}
                <motion.div aria-hidden="true" style={{ scale: haloScale }} className="pointer-events-none absolute inset-0 -z-10">
                    <AnimatePresence initial={false}>
                        <motion.div
                            key={`halo-${current.id}-${currentCutout ? 'c' : 'p'}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1.1 }}
                            className="absolute left-1/2 top-1/2 aspect-square h-[108%] -translate-x-1/2 -translate-y-1/2 rounded-full"
                            style={{
                                background: `radial-gradient(closest-side, ${tint(currentCutout?.color, 0.3)}, ${tint(currentCutout?.color, 0.1)} 52%, transparent 74%)`,
                            }}
                        />
                    </AnimatePresence>
                    {/* A cream lamp-light above, for the neumorphic glow. */}
                    <div className="absolute left-1/2 top-[8%] h-[46%] w-[62%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(252,250,245,0.85),transparent)]" />
                </motion.div>

                {/* The ground shadow, breathing with the float. */}
                <motion.div
                    aria-hidden="true"
                    animate={reduce ? undefined : { scaleX: [1, 0.84, 1], opacity: [0.55, 0.32, 0.55] }}
                    transition={reduce ? undefined : { duration: 6.5, ease: 'easeInOut', repeat: Infinity }}
                    className="pointer-events-none absolute bottom-[4%] left-1/2 h-6 w-[34%] -translate-x-1/2 rounded-[50%] bg-navy-950/35 blur-lg"
                />

                {/* The loop: every piece holds a slot, and advancing rotates them. */}
                {featured.map((product, i) => {
                    const slot = slotOf(i);
                    const side = slot === 'next' || slot === 'prev';
                    return (
                        <motion.div
                            key={product.id}
                            initial={false}
                            animate={SLOTS[slot]}
                            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20, mass: 0.9 }}
                            onClick={side ? () => go(slot === 'next' ? 1 : -1) : undefined}
                            aria-hidden={slot !== 'center'}
                            style={{ zIndex: DEPTH[slot] }}
                            className={`absolute inset-x-0 bottom-[7%] top-[3%] flex items-center justify-center ${
                                side ? 'cursor-pointer' : slot === 'center' ? '' : 'pointer-events-none'
                            }`}
                        >
                            <Garment
                                src={urls[i]}
                                cutout={cutouts[urls[i]]}
                                alt={slot === 'center' ? product.name || 'Garment' : ''}
                                phase={i * 0.9}
                                still={Boolean(reduce)}
                            />
                        </motion.div>
                    );
                })}
            </motion.div>
        </section>
    );
};

Stage.propTypes = {
    featured: PropTypes.array.isRequired,
};

const ShopStage = ({ products }) => {
    const featured = useMemo(
        () => (Array.isArray(products) ? products.filter(Boolean).slice(0, MAX_FEATURED) : []),
        [products]
    );
    return featured.length > 0 ? <Stage featured={featured} /> : null;
};

ShopStage.propTypes = {
    products: PropTypes.array,
};

export default ShopStage;
