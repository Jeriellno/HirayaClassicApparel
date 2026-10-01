import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Sparkles,
    PlusCircle,
    Ruler,
    ArrowRight,
} from 'lucide-react';

import ProductCard from './ProductCard';
import FitMatchBadge from './FitMatchBadge';
import { useOutfitRecommendations } from '../../hooks/useOutfitRecommendations';
import { useAuth } from '../../context/AuthContext';

const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const SpotlightSection = ({ fallbackProducts = [], isFallbackLoading = false }) => {
    const { user } = useAuth();
    const navigate = useNavigate();

    const {
        data: recPayload,
        isLoading: recLoading,
        isError: recError,
    } = useOutfitRecommendations(8);

    const hasSizes = recPayload?.has_sizes === true;

    /*
     * The fit style the shopper chose, in the catalog's vocabulary
     * (SLIM / REGULAR / LOOSE). Null means the account has no fit preference on
     * file, in which case the feed ranks on the size gate alone and the copy
     * must not claim a fit-style personalization it did not perform.
     */
    const fitStyle = recPayload?.fit_style || null;
    const fitStyleWord = { SLIM: 'slim', REGULAR: 'regular', LOOSE: 'oversized' }[fitStyle] || null;

    // Keep a stable reference so the useMemo below doesn't re-run on
    // every render when the API returns a fresh array each time.
    const recommendations = useMemo(
        () => recPayload?.recommendations || [],
        [recPayload?.recommendations]
    );

    // Show personalized picks first, then fill the remaining slots with the
    // latest catalog garments without marking those fallback items as matches.
    const usingFallback = !user || recommendations.length === 0;
    const visibleProducts = useMemo(() => {
        // Guard against a non-array payload (e.g. an error envelope or a string
        // body) so a malformed feed degrades to an empty grid instead of
        // throwing `filter is not a function` and white-screening the page.
        const safeFallback = Array.isArray(fallbackProducts) ? fallbackProducts : [];

        const latestProducts = safeFallback.filter(
            (product) => !recommendations.some((recommendation) => recommendation.id === product.id)
        );

        return [
            ...recommendations.slice(0, 4),
            ...latestProducts.slice(0, Math.max(0, 4 - recommendations.length)),
        ];
    }, [recommendations, fallbackProducts]);

    const recommendedIds = useMemo(
        () => new Set(recommendations.map((product) => product.id)),
        [recommendations]
    );

    return (
        <section className="container-page section-y">
            {/*
             * Section Header — CENTRED.
             *
             * This was a `flex justify-between` row: the kicker/heading block sat
             * hard LEFT with "View Full Shop" pinned hard RIGHT. On a wide screen
             * that read as a lopsided header — a big empty gutter on the left of
             * the title while the section itself is a centred multi-column grid,
             * so the header did not line up with anything below it.
             *
             * It is now a centred stack (kicker + heading + caption + rule),
             * matching the other section heads on the site, with the "View Full
             * Shop" link centred beneath it instead of stranded in the corner.
             * The maroon rule under the head is preserved.
             */}
            <div className="section-head mb-12 flex flex-col items-center text-center">
                <div className="flex flex-col items-center">
                    <span className="kicker kicker-center text-hiraya-ink-muted">
                        {user ? 'Personalized for You' : 'Featured'}
                    </span>
                    <h2 className="display-section mt-3 text-navy-900">
                        {user
                            ? fitStyleWord
                                ? `Your ${fitStyleWord} Fit Spotlight`
                                : 'Your Size Spotlight'
                            : 'Curated Spotlight'}
                    </h2>
                    {/*
                     * The copy must describe what is ACTUALLY on screen.
                     *
                     * When the engine returns no matches the grid is filled with
                     * plain "latest" garments (`usingFallback`), yet the old text
                     * still read "Best matches first" — so the section claimed a
                     * personalization that no card in it had. Each count is now
                     * named explicitly.
                     */}
                    <span className="mt-4 block max-w-xl text-[0.85rem] leading-relaxed text-charcoal-600">
                        {!user
                            ? 'Handselected pieces ready for AI virtual try-on'
                            : !hasSizes
                                ? 'Set your sizes to unlock personalized picks'
                                : recommendations.length > 0
                                    ? fitStyleWord
                                        ? `${recommendations.length} piece${recommendations.length !== 1 ? 's' : ''} cut for ${fitStyleWord} fits, in your size, with the latest pieces below`
                                        : `${recommendations.length} match${recommendations.length !== 1 ? 'es' : ''} for your measurements, with the latest pieces below`
                                    : fitStyleWord
                                        ? `Latest pieces — we have nothing in your size cut for ${fitStyleWord} fits yet`
                                        : 'Latest pieces — we have no size match for your measurements yet'}
                    </span>
                </div>
                <Link
                    to="/shop"
                    className="btn-quiet group mt-5 hidden sm:inline-flex"
                >
                    View Full Shop <PlusCircle size={15} className="transition-transform group-hover:rotate-90" />
                </Link>
            </div>

            {/* Fallback CTA — user is signed in but has no sizes on file */}
            {user && !hasSizes && !recError && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    /*
                     * A RULED PANEL, NOT A GLOWING GRADIENT SLAB.
                     *
                     * This was a 24px-radius panel under a maroon-to-transparent
                     * gradient with a coloured bloom inside it — the exact "soft
                     * SaaS" idiom the restyle removed. It is now a cut-cloth card
                     * with a maroon rule down its left edge and a squared icon
                     * stamp, which is how every other notice in the system reads.
                     */
                    className="card-raised mb-12 flex flex-col items-center justify-between gap-6 p-6 md:flex-row md:p-8"
                >
                    <div className="flex items-start gap-5">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-hiraya-accent text-hiraya-on-accent shadow-neu-sm">
                            <Ruler size={20} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-hiraya-ink md:text-base">
                                Unlock Personalized Recommendations
                            </h3>
                            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-hiraya-ink-soft md:text-xs">
                                Add your upper and lower body size plus the fit you like — that is all Hiraya needs — and our engine will surface pieces cut for your body in your size at the top of the spotlight feed.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/account-settings')}
                        className="btn-primary shrink-0 rounded-full"
                    >
                        Set My Measurements <ArrowRight size={14} />
                    </button>
                </motion.div>
            )}

            {/* Grid */}
            {recLoading || (usingFallback && isFallbackLoading) ? (
                <div className="py-20 text-center text-xs font-semibold uppercase tracking-[0.4em] text-hiraya-ink-muted">
                    Loading Spotlight Pieces...
                </div>
            ) : visibleProducts.length > 0 ? (
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    className="mx-auto grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-7"
                >
                    {visibleProducts.map((product) => (
                        <motion.div
                            key={product.id}
                            variants={itemVariants}
                            className="relative"
                        >
                            <ProductCard
                                product={product}
                                isRecommended={recommendedIds.has(product.id)}
                                fitBadge={recommendedIds.has(product.id) ? (
                                    <FitMatchBadge
                                        score={product.fit_score}
                                        recommendedSize={product.recommended_size}
                                        customerFit={product.customer_fit}
                                        garmentFit={product.garment_fit}
                                    />
                                ) : null}
                            />
                        </motion.div>
                    ))}
                </motion.div>
            ) : (
                <div className="card-raised py-16 text-center text-xs uppercase leading-relaxed tracking-widest text-hiraya-ink-muted">
                    <Sparkles size={18} className="mx-auto mb-2 text-hiraya-accent" />
                    No spotlight garments currently available for your size.
                    <br />
                    Try browsing the full shop or updating your measurements.
                </div>
            )}
        </section>
    );
};

export default SpotlightSection;
