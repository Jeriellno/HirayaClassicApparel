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

    const hasMeasurements = recPayload?.has_measurements === true;

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
        <section className="px-8 md:px-20 py-12">
            {/* Section Header */}
            <div className="flex justify-between items-end mb-8 border-l-[3px] border-[#E9C46A] pl-6">
                <div>
                    <span className="text-[10px] text-[#E9C46A] uppercase tracking-[0.3em] font-bold block mb-1">
                        {user ? 'Personalized for You' : 'Featured'}
                    </span>
                    <h2 className="text-2xl md:text-3xl font-light uppercase tracking-[0.25em] text-white">
                        {user ? 'Your Size Spotlight' : 'Curated Spotlight'}
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
                    <span className="text-[10px] text-gray-500 uppercase tracking-[0.3em] mt-1 block">
                        {!user
                            ? 'Handselected pieces ready for AI virtual try-on'
                            : !hasMeasurements
                                ? 'Set your measurements to unlock personalized picks'
                                : recommendations.length > 0
                                    ? `${recommendations.length} match${recommendations.length !== 1 ? 'es' : ''} for your measurements, with the latest pieces below`
                                    : 'Latest pieces — we have no size match for your measurements yet'}
                    </span>
                </div>
                <Link
                    to="/shop"
                    className="hidden sm:flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-gray-500 hover:text-[#E9C46A] transition-all group"
                >
                    View Full Shop <PlusCircle size={15} className="group-hover:rotate-90 transition-transform" />
                </Link>
            </div>

            {/* Fallback CTA — user is signed in but has no measurements */}
            {user && !hasMeasurements && !recError && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8 p-6 md:p-8 rounded-3xl bg-gradient-to-r from-[#E9C46A]/10 via-[#E9C46A]/5 to-transparent border border-[#E9C46A]/30 flex flex-col md:flex-row items-center justify-between gap-5"
                >
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 shrink-0 rounded-2xl bg-[#E9C46A]/15 text-[#E9C46A] flex items-center justify-center">
                            <Ruler size={20} />
                        </div>
                        <div>
                            <h3 className="text-sm md:text-base font-bold uppercase tracking-widest text-white">
                                Unlock Personalized Recommendations
                            </h3>
                            <p className="text-[11px] md:text-xs text-gray-400 mt-1 leading-relaxed max-w-2xl">
                                Add your 5 Core Body Measurements — chest/bust, waist, hips, shoulder width, and sleeve length — and our engine will surface outfits that fit your exact size in the spotlight feed.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/account-settings')}
                        className="shrink-0 inline-flex items-center gap-2 px-6 py-3 bg-[#E9C46A] text-black rounded-full text-[10px] font-extrabold uppercase tracking-[0.25em] hover:bg-[#D4A94F] transition"
                    >
                        Set My Measurements <ArrowRight size={14} />
                    </button>
                </motion.div>
            )}

            {/* Grid */}
            {recLoading || (usingFallback && isFallbackLoading) ? (
                <div className="py-20 text-center text-[#E9C46A] uppercase tracking-[0.4em] text-xs font-semibold">
                    Loading Spotlight Pieces...
                </div>
            ) : visibleProducts.length > 0 ? (
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8"
                >
                    {visibleProducts.map((product) => (
                        <motion.div
                            key={product.id}
                            variants={itemVariants}
                            whileHover={{ y: -6, transition: { duration: 0.2 } }}
                            className="relative"
                        >
                            <ProductCard
                                product={product}
                                isRecommended={recommendedIds.has(product.id)}
                                fitBadge={recommendedIds.has(product.id) ? (
                                    <FitMatchBadge
                                        score={product.fit_score}
                                        recommendedSize={product.recommended_size}
                                    />
                                ) : null}
                            />
                        </motion.div>
                    ))}
                </motion.div>
            ) : (
                <div className="text-center py-16 text-gray-500 uppercase tracking-widest text-xs border border-white/5 rounded-2xl bg-white/[0.02]">
                    <Sparkles size={18} className="mx-auto mb-2 text-[#E9C46A]/60" />
                    No spotlight garments currently available for your size.
                    <br />
                    Try browsing the full shop or updating your measurements.
                </div>
            )}
        </section>
    );
};

export default SpotlightSection;
