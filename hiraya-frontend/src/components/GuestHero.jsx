import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import {
    motion,
    useMotionTemplate,
    useReducedMotion,
    useScroll,
    useSpring,
    useTransform,
} from 'framer-motion';
import { Sparkles, ShieldCheck, Zap, ArrowRight, ArrowUpRight } from 'lucide-react';
import { trackSpotlight } from '../utils/pointerSpotlight';
import suitImg from '../assets/hiraya suit-hero.png';
import shirtImg from '../assets/hiraya-suit-shirt.png.png';
import tieImg from '../assets/hiraya-suit-tie.png.png';
import vestImg from '../assets/hiraya-suit-vest.png.png';
import jacketImg from '../assets/hiraya-suit-jacket.png.png';

/*
 * ============================================================================
 * HIRAYA — GUEST HERO ("Vintage Atelier")
 * ============================================================================
 *
 * WHAT THIS IS
 * ------------
 * The landing experience a VISITOR sees before signing in, in three beats:
 *
 *   1. THE WINDOW   Editorial two-column hero: copy on the cream canvas, the
 *                   assembled suit in an arched "fitting mirror" that straddles
 *                   a navy panel, with a black garment tag layered over it.
 *   2. THE STACK    A navy band that OPENS to full bleed as it scrolls in, then
 *                   deals out the four garment layers in dressing order
 *                   (shirt -> tie -> waistcoat -> jacket) — the Outfit Stack.
 *   3. THE PLATES   The three feature claims, unchanged in copy.
 *
 * STRUCTURAL FOUNDATIONS (21st.dev)
 * ---------------------------------
 *  - "Editorial Collage Hero" — the two-column serif layout, the layered
 *    primary/secondary collage, and the staggered blur-in entrance variants.
 *  - "Smooth Scroll Hero" — the scroll-driven clip-path that grows an inset
 *    panel to full bleed (`useScroll` + `useTransform` + `useMotionTemplate`).
 *
 * WHY NOTHING IS PINNED
 * ---------------------
 * The page wrapper this component renders into sets `overflow: hidden`, which
 * disables `position: sticky` for every descendant. Rather than fight that
 * with a JS pin (the old GSAP version), every effect here is scroll-LINKED
 * but not pinned: parallax, clip reveals and card dealing are pure functions
 * of each block's own scroll progress, smoothed by a light spring. Scrolling
 * up plays everything backwards for free, and nothing hijacks the scrollbar.
 *
 * PALETTE
 * -------
 * Only the Vintage Atelier tokens from index.css: navy-*, charcoal-* (dark
 * grey), noir (black) and cream-*. No maroon, no indigo — this component is
 * the reference implementation of the new global standard.
 *
 * ASSET NOTES
 * -----------
 *  - The shirt and waistcoat PNGs ship with an opaque, baked-in checkerboard
 *    instead of transparency. They sit on cream plates with
 *    `brightness(1.07)` (clips the checkerboard to white) + `multiply` (white
 *    disappears into the plate), so the garment reads as cut out.
 *  - The tie and jacket PNGs have real alpha with a navy glow, so they sit on
 *    navy plates where the glow reads as studio light.
 *
 * ACCESSIBILITY / PERFORMANCE
 * ---------------------------
 *  - `useReducedMotion()` drops every scroll transform and entrance, leaving
 *    the final, fully legible layout.
 *  - Only transform, opacity and clip-path animate.
 *  - The garment layers are 1024x1536 PNGs (~2 MB each), so they lazy-load;
 *    only the 168 KB assembled suit loads with the page.
 */

const EASE = [0.22, 1, 0.36, 1];

// A light spring over raw scroll progress: motion trails the wheel by a few
// frames instead of stepping with it, which is what reads as "smooth scroll".
const SCROLL_SPRING = { stiffness: 140, damping: 30, mass: 0.35, restDelta: 0.0005 };

const stagger = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const rise = {
    hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: EASE } },
};

// Copy carried over verbatim from the previous hero.
const FEATURES = [
    {
        icon: <Sparkles size={22} />,
        title: 'AI-Driven Precision',
        desc: 'Our neural engine analyzes your anatomical profile for a mathematically perfect fit.',
    },
    {
        icon: <ShieldCheck size={22} />,
        title: 'Privacy First',
        desc: 'Your portraits are processed locally and securely, ensuring your data remains yours.',
    },
    {
        icon: <Zap size={22} />,
        title: 'Instant Styling',
        desc: 'No more guesswork. Visualize outfits on your body in real-time with one click.',
    },
];

// Dressing order. `plate` picks the card ground to suit each PNG (see ASSET
// NOTES above): cream for the opaque shots, navy for the transparent ones.
const LAYERS = [
    { no: '01', name: 'Dress Shirt', note: 'Light blue, point collar', src: shirtImg, plate: 'cream' },
    { no: '02', name: 'Windowpane Tie', note: 'Navy, cream check', src: tieImg, plate: 'navy' },
    { no: '03', name: 'Waistcoat', note: 'Cream, five-button', src: vestImg, plate: 'cream' },
    { no: '04', name: 'Jacket', note: 'Navy, notch lapel', src: jacketImg, plate: 'navy' },
];

const NAVY_PLATE = 'radial-gradient(85% 65% at 50% 38%, #283A57 0%, #1D2C45 55%, #152036 100%)';
const MIRROR_LIGHT =
    'radial-gradient(95% 70% at 50% 30%, #FCFAF5 0%, #EFE6D2 50%, #E4D6BA 80%, #BCA47C 100%)';
const PINSTRIPE =
    'repeating-linear-gradient(90deg, transparent 0 26px, rgba(239, 230, 210, 0.05) 26px 27px)';
const RULER =
    'repeating-linear-gradient(180deg, #D3C09C 0 1px, transparent 1px 60px), repeating-linear-gradient(180deg, rgba(211, 192, 156, 0.55) 0 1px, transparent 1px 12px)';

const useIsDesktop = () => {
    const query = '(min-width: 1024px)';
    const [matches, setMatches] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(query).matches
    );
    useEffect(() => {
        const mql = window.matchMedia(query);
        const onChange = (e) => setMatches(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);
    return matches;
};

const focusRing =
    'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy-900';

/* ============================================================================
 * 1. THE WINDOW
 * ========================================================================== */
const HeroWindow = ({ navigate, reduce }) => {
    const ref = useRef(null);

    // 0 while the hero fills the viewport, 1 once its bottom leaves the top.
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
    const p = useSpring(scrollYProgress, SCROLL_SPRING);

    // Parallax rates, back to front: panel slowest, tag fastest. Copy lifts
    // and fades so the band below takes over.
    const copyY = useTransform(p, [0, 1], [0, -90]);
    const copyOpacity = useTransform(p, [0, 0.55], [1, 0]);
    const panelY = useTransform(p, [0, 1], [0, 70]);
    const mirrorY = useTransform(p, [0, 1], [0, 130]);
    const suitY = useTransform(p, [0, 1], [0, -34]);
    const suitScale = useTransform(p, [0, 1], [1, 1.06]);
    const tagY = useTransform(p, [0, 1], [0, -120]);
    const tagRotate = useTransform(p, [0, 1], [-5, 3]);

    const motionStyle = (style) => (reduce ? undefined : style);

    return (
        <section ref={ref} className="relative isolate overflow-hidden bg-cream-100 text-navy-900">
            {/* ---- Backdrop: navy panel (right on desktop, a lower band on
                 mobile), pinstripe, paper grain. ---- */}
            <motion.div
                aria-hidden="true"
                style={motionStyle({ y: panelY })}
                className="absolute -bottom-24 -top-24 right-0 -z-10 hidden w-[36%] bg-navy-900 lg:block"
            >
                <div className="absolute inset-0" style={{ backgroundImage: PINSTRIPE }} />
                <p className="absolute right-7 top-1/2 -translate-y-1/2 text-[0.58rem] font-semibold uppercase tracking-[0.5em] text-cream-400/70 [writing-mode:vertical-rl]">
                    Hiraya Atelier — Virtual Fitting Room
                </p>
            </motion.div>
            <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 -z-10 h-[34%] bg-navy-900 lg:hidden"
                style={{ backgroundImage: PINSTRIPE }}
            />
            <div
                aria-hidden="true"
                className="vintage-grain pointer-events-none absolute inset-0 -z-10 opacity-[0.07] mix-blend-multiply"
            />

            <div className="mx-auto grid min-h-[100svh] w-full max-w-7xl grid-cols-1 items-center gap-14 px-6 pb-16 pt-28 sm:px-10 lg:grid-cols-12 lg:gap-8 lg:pt-32">
                {/* ---- Copy ---- */}
                <motion.div style={motionStyle({ y: copyY, opacity: copyOpacity })} className="lg:col-span-6">
                    <motion.div variants={stagger} initial={reduce ? false : 'hidden'} animate="visible">
                        <motion.p variants={rise} className="kicker text-charcoal-600">
                            The Future of Fitting
                        </motion.p>

                        <motion.h1
                            variants={rise}
                            className="mt-7 font-serif text-[clamp(2.2rem,4.6vw,4rem)] uppercase leading-[1.06] tracking-[0.04em] text-navy-900"
                        >
                            Make Every
                            <br />
                            <span className="my-1 inline-block bg-navy-900 px-[0.18em] text-cream-100">
                                Impression
                            </span>
                            <br />
                            Count.
                        </motion.h1>

                        <motion.p
                            variants={rise}
                            className="mt-7 max-w-md text-[0.95rem] leading-relaxed text-charcoal-600"
                        >
                            Experience a seamless virtual fit and expert AI styling to discover
                            your perfect look. Hiraya blends traditional elegance with modern
                            intelligence.
                        </motion.p>

                        <motion.div variants={rise} className="mt-10 flex flex-col gap-3 sm:flex-row">
                            <button
                                type="button"
                                onClick={() => navigate('/register')}
                                className={`group inline-flex items-center justify-center gap-3 rounded-sm bg-navy-900 px-8 py-4 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-cream-100 shadow-[0_18px_40px_-18px_rgba(13,21,36,0.7)] transition-colors duration-300 hover:bg-noir ${focusRing}`}
                            >
                                Get Started for Free
                                <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className={`inline-flex items-center justify-center rounded-sm border border-navy-900/35 px-8 py-4 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-navy-900 transition-colors duration-300 hover:border-navy-900 hover:bg-navy-900/[0.05] ${focusRing}`}
                            >
                                Sign In to Profile
                            </button>
                        </motion.div>

                        {/* Scroll cue — a chalk line with a travelling mark. */}
                        <motion.div
                            variants={rise}
                            aria-hidden="true"
                            className="mt-14 hidden items-center gap-4 text-[0.58rem] font-semibold uppercase tracking-[0.34em] text-charcoal-500 lg:flex"
                        >
                            <span className="relative h-10 w-px overflow-hidden bg-navy-900/15">
                                <motion.span
                                    className="absolute inset-x-0 top-0 h-4 bg-navy-900"
                                    animate={reduce ? undefined : { y: ['-100%', '250%'] }}
                                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                                />
                            </span>
                            Scroll to build the look
                        </motion.div>
                    </motion.div>
                </motion.div>

                {/* ---- The fitting mirror (primary) + garment tag (secondary) ---- */}
                <motion.div style={motionStyle({ y: mirrorY })} className="relative flex justify-center lg:col-span-6">
                    <motion.figure
                        initial={reduce ? false : { clipPath: 'inset(100% 0% 0% 0%)' }}
                        animate={{ clipPath: 'inset(0% 0% 0% 0%)' }}
                        transition={{ duration: 1.3, ease: [0.76, 0, 0.24, 1], delay: 0.15 }}
                        className="relative aspect-[3/4] w-[min(84%,320px)] lg:h-[min(66vh,620px)] lg:w-auto"
                    >
                        <div className="absolute inset-0 rounded-t-[999px] bg-cream-50 p-2.5 shadow-[0_40px_80px_-30px_rgba(13,21,36,0.55)] ring-1 ring-charcoal-900/10">
                            <div
                                className="relative h-full w-full overflow-hidden rounded-t-[999px] ring-1 ring-inset ring-navy-900/15"
                                style={{ background: MIRROR_LIGHT }}
                            >
                                <div className="absolute inset-x-[20%] bottom-[9%] h-8 rounded-[50%] bg-noir/25 blur-xl" />
                                <motion.img
                                    src={suitImg}
                                    alt="HIRAYA three-piece suit: navy jacket, light blue dress shirt, cream waistcoat and navy windowpane tie."
                                    style={motionStyle({ y: suitY, scale: suitScale })}
                                    className="absolute inset-x-0 bottom-[2%] mx-auto h-[90%] w-auto select-none object-contain drop-shadow-[0_24px_30px_rgba(13,21,36,0.28)]"
                                    draggable="false"
                                />
                                <div className="vintage-grain pointer-events-none absolute inset-0 opacity-[0.09] mix-blend-multiply" />
                            </div>
                        </div>

                        {/* Tailor's ruler down the mirror's right edge. */}
                        <div
                            aria-hidden="true"
                            className="absolute -right-6 top-[22%] hidden h-[56%] w-3 lg:block"
                            style={{ backgroundImage: RULER, backgroundSize: '12px 100%, 6px 100%', backgroundRepeat: 'no-repeat' }}
                        />
                    </motion.figure>

                    <motion.div
                        style={motionStyle({ y: tagY, rotate: tagRotate })}
                        className="absolute bottom-[8%] left-[4%] z-10 hidden w-48 sm:block lg:left-[-5%]"
                    >
                        <motion.div
                            initial={reduce ? false : { opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
                            className="relative rounded-[3px] bg-noir px-5 pb-5 pt-8 text-cream-100 shadow-[0_24px_40px_-18px_rgba(17,17,16,0.65)]"
                        >
                            <span
                                aria-hidden="true"
                                className="absolute left-1/2 top-3 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cream-100 ring-1 ring-cream-500"
                            />
                            <p className="font-serif text-[0.68rem] tracking-[0.3em] text-cream-400">No. 01</p>
                            <p className="mt-2 font-serif text-[0.95rem] uppercase leading-snug tracking-[0.06em] text-cream-50">
                                Heritage
                                <br />
                                Three-Piece
                            </p>
                            <p className="mt-3 border-t border-cream-50/15 pt-3 text-[0.56rem] uppercase leading-relaxed tracking-[0.22em] text-cream-300">
                                Shirt · Tie
                                <br />
                                Vest · Jacket
                            </p>
                        </motion.div>
                    </motion.div>
                </motion.div>
            </div>
        </section>
    );
};

// Shared by the sections: `reduce` is useReducedMotion()'s boolean | null.
const sectionPropTypes = {
    navigate: PropTypes.func.isRequired,
    reduce: PropTypes.bool,
};

HeroWindow.propTypes = sectionPropTypes;

/* ============================================================================
 * 2. THE STACK
 * ========================================================================== */
const LayerCard = ({ layer, index, isDesktop, reduce }) => {
    const ref = useRef(null);

    // Each card tracks ITSELF: 0 as its top enters the viewport bottom, 1 once
    // it reaches 45% from the top. Cards in one row share the same progress,
    // so the index offset below is what staggers them.
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 45%'] });
    const p = useSpring(scrollYProgress, SCROLL_SPRING);

    const start = index * 0.08;
    const end = 0.7 + index * 0.08;
    // Distance from the row's centre (-1.5 .. 1.5). On desktop the cards start
    // gathered toward the middle, fanned like a dealt hand, and spread into the
    // row; on mobile (2x2 grid) they only rise and straighten.
    const spread = 1.5 - index;
    const x = useTransform(p, [start, end], [isDesktop ? `${spread * 55}%` : '0%', '0%']);
    const y = useTransform(p, [start, end], [isDesktop ? 140 : 70, 0]);
    const rotate = useTransform(p, [start, end], [spread * (isDesktop ? -7 : -3), 0]);
    const opacity = useTransform(p, [start, start + 0.25], [0, 1]);

    const isCream = layer.plate === 'cream';

    return (
        <motion.li ref={ref} style={reduce ? undefined : { x, y, rotate, opacity }} className="group">
            <figure>
                <div
                    className={`relative aspect-[4/5] overflow-hidden rounded-t-[999px] ring-1 ring-cream-50/10 ${isCream ? 'bg-cream-100' : ''}`}
                    style={isCream ? undefined : { background: NAVY_PLATE }}
                >
                    <img
                        src={layer.src}
                        alt={`${layer.name} — ${layer.note}`}
                        loading="lazy"
                        decoding="async"
                        draggable="false"
                        className={`h-full w-full select-none object-contain px-[6%] pb-[4%] pt-[12%] transition-transform duration-700 ease-out group-hover:scale-[1.04] ${isCream ? 'mix-blend-multiply brightness-[1.07]' : ''}`}
                    />
                </div>
                <figcaption className="mt-5 flex items-baseline gap-4 border-t border-cream-50/15 pt-4">
                    <span className="font-serif text-xl text-cream-500">{layer.no}</span>
                    <span className="min-w-0">
                        <span className="block font-serif text-[0.9rem] uppercase tracking-[0.06em] text-cream-50">
                            {layer.name}
                        </span>
                        <span className="mt-1 block text-[0.78rem] text-cream-300">{layer.note}</span>
                    </span>
                </figcaption>
            </figure>
        </motion.li>
    );
};

LayerCard.propTypes = {
    layer: PropTypes.shape({
        no: PropTypes.string.isRequired,
        name: PropTypes.string.isRequired,
        note: PropTypes.string.isRequired,
        src: PropTypes.string.isRequired,
        plate: PropTypes.oneOf(['cream', 'navy']).isRequired,
    }).isRequired,
    index: PropTypes.number.isRequired,
    isDesktop: PropTypes.bool,
    reduce: PropTypes.bool,
};

const OutfitStack =({ navigate, reduce }) => {
    const ref = useRef(null);
    const isDesktop = useIsDesktop();

    // 21st.dev "Smooth Scroll Hero" technique: the band enters as an inset,
    // rounded panel and opens to full bleed as its top climbs the viewport.
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start start'] });
    const p = useSpring(scrollYProgress, SCROLL_SPRING);
    const insetX = useTransform(p, [0, 0.75], [6, 0]);
    const radius = useTransform(p, [0, 0.75], [44, 0]);
    const clipPath = useMotionTemplate`inset(0% ${insetX}% 0% ${insetX}% round ${radius}px ${radius}px 0px 0px)`;

    return (
        // The cream wrapper is what shows in the inset gutters while the band
        // is still opening, so the old canvas never peeks through.
        <div className="bg-cream-100">
            <motion.section
                ref={ref}
                style={reduce ? undefined : { clipPath }}
                className="relative isolate overflow-hidden bg-navy-950 text-cream-100"
            >
                <div
                    aria-hidden="true"
                    className="absolute left-1/2 top-0 -z-10 h-[60%] w-[80%] -translate-x-1/2 rounded-full bg-navy-800/60 blur-[120px]"
                />
                <div
                    aria-hidden="true"
                    className="vintage-grain pointer-events-none absolute inset-0 -z-10 opacity-40 mix-blend-soft-light"
                />

                <div className="container-page section-y">
                    <motion.div
                        variants={stagger}
                        initial={reduce ? false : 'hidden'}
                        whileInView="visible"
                        viewport={{ once: true, margin: '-100px' }}
                        className="grid gap-10 lg:grid-cols-12 lg:items-end"
                    >
                        <motion.div variants={rise} className="lg:col-span-6">
                            <p className="kicker text-cream-400">The Outfit Stack</p>
                            <h2 className="display-section mt-5 text-cream-50">
                                Four layers.
                                <br />
                                One fitting.
                            </h2>
                        </motion.div>
                        <motion.div variants={rise} className="lg:col-span-5 lg:col-start-8">
                            <p className="text-[0.95rem] leading-relaxed text-cream-300">
                                Hiraya reads a look the way a tailor dresses it — shirt, tie,
                                waistcoat, jacket — then lets you try the whole outfit on your own
                                portrait in the virtual fitting room.
                            </p>
                        </motion.div>
                    </motion.div>

                    <ol className="mt-16 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:mt-20 lg:grid-cols-4">
                        {LAYERS.map((layer, i) => (
                            <LayerCard key={layer.no} layer={layer} index={i} isDesktop={isDesktop} reduce={reduce} />
                        ))}
                    </ol>

                    <motion.div
                        initial={reduce ? false : { opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-60px' }}
                        transition={{ duration: 0.8, ease: EASE }}
                        className="mt-16 flex flex-col items-start gap-6 border-t border-cream-50/10 pt-10 sm:flex-row sm:items-center sm:justify-between"
                    >
                        <p className="font-serif text-[0.95rem] uppercase tracking-[0.08em] text-cream-200">
                            Assembled: the Heritage Three-Piece
                        </p>
                        <button
                            type="button"
                            onClick={() => navigate('/register')}
                            className="group inline-flex items-center gap-3 rounded-sm bg-cream-100 px-7 py-3.5 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-navy-900 transition-colors duration-300 hover:bg-cream-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream-100"
                        >
                            Build your first look
                            <ArrowUpRight size={16} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                        </button>
                    </motion.div>
                </div>
            </motion.section>
        </div>
    );
};

OutfitStack.propTypes = sectionPropTypes;

/* ============================================================================
 * 3. THE PLATES — a bento of the three promises
 * ============================================================================
 *
 * One large dark card for the headline promise (precision, shown as a live
 * body scan over the suit) and two neumorphic cream cards for the others,
 * each with its own small, looping illustration. Every card carries the
 * pointer spotlight and lifts on hover. The feature copy is unchanged.
 */
const MEASURE_TAGS = [
    { label: 'Shoulder', top: '30%' },
    { label: 'Chest', top: '44%' },
    { label: 'Waist', top: '60%' },
];

const PrecisionScan = ({ reduce }) => (
    <div aria-hidden="true" className="relative mx-auto aspect-[3/4] w-full max-w-[250px]">
        <div className="absolute inset-0 overflow-hidden rounded-t-[999px] bg-[radial-gradient(95%_70%_at_50%_30%,#FCFAF5_0%,#EFE6D2_55%,#D3C09C_100%)] ring-1 ring-cream-50/25">
            <img
                src={suitImg}
                alt=""
                loading="lazy"
                draggable="false"
                className="absolute inset-x-0 bottom-0 mx-auto h-[92%] w-auto select-none object-contain"
            />
            {/* The scan line sweeps the figure; static under reduced motion. */}
            <motion.div
                className="absolute inset-x-0 top-[44%] h-px bg-navy-800 shadow-[0_0_14px_3px_rgba(29,44,69,0.35)]"
                animate={reduce ? undefined : { top: ['20%', '78%', '20%'] }}
                transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
            />
        </div>
        {MEASURE_TAGS.map((tag, i) => (
            <motion.span
                key={tag.label}
                style={{ top: tag.top }}
                initial={reduce ? false : { opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.4 + i * 0.15 }}
                className="absolute -right-6 flex -translate-y-1/2 items-center gap-2 sm:-right-10"
            >
                <span className="h-px w-8 border-t border-dashed border-cream-300/70" />
                <span className="rounded-full bg-cream-100 px-2.5 py-1 text-[0.55rem] font-semibold uppercase tracking-[0.2em] text-navy-900 shadow-[0_6px_14px_-6px_rgba(0,0,0,0.6)]">
                    {tag.label}
                </span>
            </motion.span>
        ))}
    </div>
);

PrecisionScan.propTypes = { reduce: PropTypes.bool };

// A shield with a slow sonar ring — "guarded", without a stock padlock.
const PrivacyPulse = ({ reduce }) => (
    <div aria-hidden="true" className="relative flex h-14 w-14 items-center justify-center">
        {!reduce && (
            <motion.span
                className="absolute inset-0 rounded-2xl border border-navy-800/40"
                animate={{ scale: [1, 1.55], opacity: [0.6, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            />
        )}
        <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-900 text-cream-100 shadow-neu-sm transition-colors duration-500 group-hover:bg-noir">
            {FEATURES[1].icon}
        </span>
    </div>
);

PrivacyPulse.propTypes = { reduce: PropTypes.bool };

// A one-click render bar that fills and resets — "instant", shown not told.
const InstantRender = ({ reduce }) => (
    <div aria-hidden="true" className="flex items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-navy-900 text-cream-100 shadow-neu-sm transition-colors duration-500 group-hover:bg-noir">
            {FEATURES[2].icon}
        </span>
        <div className="flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-cream-200 shadow-neu-inset">
                <motion.div
                    className="h-full origin-left rounded-full bg-[linear-gradient(90deg,#1D2C45,#687A98)]"
                    initial={false}
                    animate={reduce ? { scaleX: 1 } : { scaleX: [0, 1, 1, 0] }}
                    transition={reduce ? undefined : { duration: 3, times: [0, 0.35, 0.85, 1], repeat: Infinity, ease: 'easeInOut' }}
                />
            </div>
            <div className="mt-2 flex justify-between text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-charcoal-500">
                <span>One click</span>
                <span>Styled</span>
            </div>
        </div>
    </div>
);

InstantRender.propTypes = { reduce: PropTypes.bool };

const cardLift =
    'group transition-[translate,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1.5';

const FeaturePlates = ({ reduce }) => (
    <section className="relative bg-cream-100">
        <div className="container-page section-y">
            <motion.div
                variants={stagger}
                initial={reduce ? false : 'hidden'}
                whileInView="visible"
                viewport={{ once: true, margin: '-80px' }}
                className="grid gap-6 lg:grid-cols-12 lg:items-end"
            >
                <motion.div variants={rise} className="lg:col-span-7">
                    <p className="kicker text-hiraya-ink-muted">Why Hiraya</p>
                    <h2 className="display-section mt-5 text-navy-900">
                        Tailored by
                        <br />
                        intelligence.
                    </h2>
                </motion.div>
                <motion.p variants={rise} className="max-w-md text-[0.95rem] leading-relaxed text-charcoal-600 lg:col-span-5">
                    A fitting room that learns your frame, keeps your portraits to itself and
                    answers in a moment — the three promises every Hiraya fitting is built on.
                </motion.p>
            </motion.div>

            <motion.ul
                variants={stagger}
                initial={reduce ? false : 'hidden'}
                whileInView="visible"
                viewport={{ once: true, margin: '-80px' }}
                className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6"
            >
                {/* Precision — the headline card */}
                <motion.li
                    variants={rise}
                    onPointerMove={trackSpotlight}
                    className={`spotlight ${cardLift} overflow-hidden rounded-[28px] border border-cream-50/10 bg-navy-900 p-8 text-cream-100 shadow-neu-dark [--spotlight:rgba(211,192,156,0.14)] sm:p-10 lg:col-span-7 lg:row-span-2`}
                >
                    <div className="grid h-full gap-10 sm:grid-cols-2 sm:items-center">
                        <div>
                            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cream-100 text-navy-900 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)] transition-transform duration-500 group-hover:-rotate-6">
                                {FEATURES[0].icon}
                            </span>
                            <h3 className="mt-8 font-serif text-[1.45rem] uppercase leading-tight tracking-[0.05em] text-cream-50">
                                {FEATURES[0].title}
                            </h3>
                            <p className="mt-4 text-[0.9rem] leading-relaxed text-cream-300">{FEATURES[0].desc}</p>
                            <p className="mt-8 border-t border-cream-50/10 pt-5 text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-cream-400">
                                01 — Precision
                            </p>
                        </div>
                        <PrecisionScan reduce={reduce} />
                    </div>
                </motion.li>

                {/* Privacy */}
                <motion.li
                    variants={rise}
                    onPointerMove={trackSpotlight}
                    className={`spotlight ${cardLift} rounded-[28px] border border-cream-50/80 bg-cream-50 p-8 shadow-neu hover:shadow-[var(--shadow-neu),0_28px_50px_-30px_rgba(21,32,54,0.45)] sm:p-10 lg:col-span-5`}
                >
                    <PrivacyPulse reduce={reduce} />
                    <h3 className="mt-7 font-serif text-[1.2rem] uppercase tracking-[0.05em] text-navy-900">
                        {FEATURES[1].title}
                    </h3>
                    <p className="mt-3 text-[0.88rem] leading-relaxed text-charcoal-600">{FEATURES[1].desc}</p>
                    <p className="mt-6 text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-charcoal-500">02 — Privacy</p>
                </motion.li>

                {/* Instant styling */}
                <motion.li
                    variants={rise}
                    onPointerMove={trackSpotlight}
                    className={`spotlight ${cardLift} rounded-[28px] border border-cream-50/80 bg-cream-50 p-8 shadow-neu hover:shadow-[var(--shadow-neu),0_28px_50px_-30px_rgba(21,32,54,0.45)] sm:p-10 lg:col-span-5`}
                >
                    <InstantRender reduce={reduce} />
                    <h3 className="mt-7 font-serif text-[1.2rem] uppercase tracking-[0.05em] text-navy-900">
                        {FEATURES[2].title}
                    </h3>
                    <p className="mt-3 text-[0.88rem] leading-relaxed text-charcoal-600">{FEATURES[2].desc}</p>
                    <p className="mt-6 text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-charcoal-500">03 — Speed</p>
                </motion.li>
            </motion.ul>
        </div>
    </section>
);

FeaturePlates.propTypes = { reduce: PropTypes.bool };

const GuestHero = () => {
    const navigate = useNavigate();
    const reduce = useReducedMotion();

    return (
        <>
            <HeroWindow navigate={navigate} reduce={reduce} />
            <OutfitStack navigate={navigate} reduce={reduce} />
            <FeaturePlates reduce={reduce} />
        </>
    );
};

export default GuestHero;
