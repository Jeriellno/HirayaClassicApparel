import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, PlusCircle, Ruler, Sparkles } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../hooks/useCart';
import { useOutfitRecommendations } from '../hooks/useOutfitRecommendations';
import GuestHome from '../components/home/GuestHome';
import HeroSection from '../components/home/HeroSection';
import ShortcutDeck from '../components/home/ShortcutDeck';
import ProductRail from '../components/home/ProductRail';
import HowItWorksSection from '../components/home/HowItWorksSection';
import FooterCtaBanner from '../components/home/FooterCtaBanner';
import FitMatchBadge from '../components/product/FitMatchBadge';
import { useT } from '../context/PreferencesContext';

const FIT_WORDS = { SLIM: 'slim', REGULAR: 'regular', LOOSE: 'oversized' };
const PREFERRED_FIT_WORDS = { slim: 'slim', regular: 'regular', oversized: 'oversized' };
const GENDER_WORDS = { male: 'Men', female: 'Women' };

/*
 * HOME.
 *
 * Guests get `GuestHome` (the landing page, unchanged). Members get their own
 * dashboard, rebuilt around them:
 *
 *   1. HeroSection   — time-aware greeting, monogram, a read-only status strip
 *                      (bag, sizing profile, fit preference) and the fitting
 *                      console with its readiness checklist.
 *   2. ShortcutDeck  — Studio, Bag, Orders, History as raised tiles.
 *   3. Picks rail    — the personalised recommendation feed (same hook and
 *                      same fit badges the Spotlight grid used), or the call
 *                      to set sizes when there is nothing to rank yet.
 *   4. New rail      — the latest catalogue pieces, minus anything already in
 *                      the picks rail.
 *   5. How it works + the closing banner, as before.
 *
 * Every card is the shop's own `ProductCard`, so opening a piece behaves
 * exactly as it did in the Spotlight grid. All data comes from queries that
 * were already on this page or in the navbar (`['products']`, the outfit
 * recommendations, `['cart']`), so the redesign adds no requests.
 */
const Home = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useT();

  // Featured / latest products — SAME KEY AS THE SHOP (`useShopData`), so Home
  // and Shop read one cached payload instead of each fetching the catalog.
  const { data: apiProducts, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      try {
        const res = await api.get('/products');
        // Normalise a bare array, a { data: [...] } envelope, or a stray
        // string body, so the rails always receive an array.
        const payload = res.data;
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.data)) return payload.data;
        return [];
      } catch {
        return [];
      }
    }
  });

  const {
    data: recPayload,
    isLoading: recLoading,
    isError: recError,
  } = useOutfitRecommendations(8);

  const { cartCount } = useCart();

  const hasSizes = recPayload?.has_sizes === true;
  // Prefer the profile value (always present once set) over the feed echo,
  // which is null whenever the feed itself is empty.
  const fitStyleWord =
    PREFERRED_FIT_WORDS[user?.preferred_fit] || FIT_WORDS[recPayload?.fit_style] || null;
  const genderWord = GENDER_WORDS[user?.gender ?? recPayload?.gender] || null;

  const recommendations = useMemo(
    () => (Array.isArray(recPayload?.recommendations) ? recPayload.recommendations : []),
    [recPayload?.recommendations]
  );

  // The newest pieces, minus anything the picks rail is already showing.
  const newArrivals = useMemo(() => {
    const all = Array.isArray(apiProducts) ? apiProducts : [];
    const picked = new Set(recommendations.map((p) => p.id));
    return all.filter((p) => !picked.has(p.id)).slice(0, 10);
  }, [apiProducts, recommendations]);

  if (!user) {
    return <GuestHome />;
  }

  /*
   * The picks rail's copy describes what is ACTUALLY on screen — the same rule
   * the Spotlight header followed: never claim a personalisation no card has.
   */
  const fitLabel = fitStyleWord ? t(`fit.${fitStyleWord}`) : null;
  const genderLabel = genderWord ? t(genderWord === 'Men' ? 'gender.men' : 'gender.women') : null;
  const picksTitle = fitLabel ? t('home.picksTitleFit', { fit: fitLabel }) : t('home.picksTitle');

  // What the feed is matched on, shown beside the rail title.
  const profileChips = [
    { key: 'fit', label: t('home.chipFit'), value: fitLabel, },
    { key: 'gender', label: t('home.chipFor'), value: genderLabel },
    {
      key: 'size',
      label: t('home.chipSize'),
      value: user?.upper_body_size || user?.lower_body_size
        ? `${user?.upper_body_size || '—'} / ${user?.lower_body_size || '—'}`
        : null,
    },
  ];
  const picksAction = (
    <div className="flex flex-wrap items-center gap-2">
      {profileChips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full bg-hiraya-surface px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-charcoal-500 shadow-neu-sm ring-1 ring-cream-50/80"
        >
          {chip.label}
          <span className={chip.value ? 'text-navy-900' : 'text-red-700'}>{chip.value || t('common.notSet')}</span>
        </span>
      ))}
      {!genderWord && (
        <button type="button" onClick={() => navigate('/settings#account-measurements')} className="btn-quiet cursor-pointer">
          {t('home.setGender')} <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
  const picksSubtitle = recError
    ? 'Your personalized feed could not be loaded just now.'
    : !hasSizes
    ? 'Set your sizes to unlock personalized picks.'
    : recommendations.length > 0
      ? fitStyleWord
        ? `${recommendations.length} piece${recommendations.length !== 1 ? 's' : ''} cut for ${fitStyleWord} fits${genderWord ? ` for ${genderWord.toLowerCase()}` : ''}, in your size.`
        : `${recommendations.length} match${recommendations.length !== 1 ? 'es' : ''} for your measurements.`
      : fitStyleWord
        ? `We have nothing in your size cut for ${fitStyleWord} fits yet — the newest arrivals are below.`
        : 'We have no size match for your measurements yet — the newest arrivals are below.';

  let picksFallback = null;
  if (recError) {
    picksFallback = (
      <p className="rounded-[22px] bg-cream-200/45 px-6 py-10 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-charcoal-500 shadow-neu-inset">
        Recommendations are resting for a moment — the newest arrivals are below.
      </p>
    );
  } else if (!recLoading && !hasSizes) {
    picksFallback = (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="flex flex-col items-start justify-between gap-6 rounded-[24px] bg-hiraya-surface p-6 shadow-neu ring-1 ring-cream-50/80 md:flex-row md:items-center md:p-8"
      >
        <div className="flex items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-navy-900 text-cream-100 shadow-neu-sm">
            <Ruler size={20} />
          </div>
          <div>
            <h3 className="font-serif text-[1rem] uppercase tracking-[0.06em] text-navy-900">
              Unlock personalized recommendations
            </h3>
            <p className="mt-1.5 max-w-2xl text-[0.8rem] leading-relaxed text-charcoal-600">
              Add your upper and lower body size plus the fit you like — that is all Hiraya needs — and this rail fills with pieces cut for your body, in your size.
            </p>
          </div>
        </div>
        <button onClick={() => navigate('/settings')} className="btn-primary shrink-0 cursor-pointer rounded-full">
          Set My Measurements <ArrowRight size={14} />
        </button>
      </motion.div>
    );
  } else if (!recLoading && recommendations.length === 0) {
    picksFallback = (
      <p className="flex items-center justify-center gap-2 rounded-[22px] bg-cream-200/45 px-6 py-10 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-charcoal-500 shadow-neu-inset">
        <Sparkles size={14} /> No pieces in your size yet — try the full shop or update your measurements.
      </p>
    );
  }

  return (
    /*
     * `overflow-x-clip`, not `overflow-hidden`: it stops decorative layers
     * from causing a sideways scrollbar without turning this wrapper into a
     * scroll container (which would disable `position: sticky` inside it).
     */
    <div className="min-h-screen overflow-x-clip text-hiraya-ink">
      <HeroSection bagCount={cartCount} fitStyleWord={fitLabel} genderWord={genderLabel} />

      <ShortcutDeck bagCount={cartCount} />

      <div className="relative isolate space-y-20 py-20 sm:space-y-24 sm:py-24">
        {/* A soft lamp-light band behind the rails. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-10 -z-10 h-[70%] bg-[radial-gradient(60%_50%_at_50%_30%,rgba(252,250,245,0.9),transparent_70%)]" />

        <ProductRail
          tourId="rail-picks"
          kicker={t('home.picksKicker')}
          title={picksTitle}
          subtitle={picksSubtitle}
          products={recommendations}
          loading={recLoading}
          action={picksAction}
          isRecommended={() => true}
          renderBadge={(product) => (
            <FitMatchBadge
              score={product.fit_score}
              recommendedSize={product.recommended_size}
              customerFit={product.customer_fit}
              garmentFit={product.garment_fit}
            />
          )}
        >
          {picksFallback}
        </ProductRail>

        {(isLoading || newArrivals.length > 0) && (
          <ProductRail
            tourId="rail-new"
            kicker={t('home.newKicker')}
            title={t('home.newTitle')}
            subtitle={t('home.newSubtitle')}
            products={newArrivals}
            loading={isLoading}
            action={
              <Link to="/shop" className="btn-quiet group">
                {t('home.viewShop')} <PlusCircle size={15} className="transition-transform group-hover:rotate-90" />
              </Link>
            }
          />
        )}
      </div>

      {/* HOW IT WORKS / AI FITTING FEATURES */}
      <div data-tour="how-it-works">
        <HowItWorksSection />
      </div>

      <FooterCtaBanner />
    </div>
  );
};

export default Home;
