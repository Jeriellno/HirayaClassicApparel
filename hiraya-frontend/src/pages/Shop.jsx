import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useShopData } from '../hooks/useShopData';

// Sub-components
import UserWelcomeBanner from '../components/home/UserWelcomeBanner';
import ShopHeader from '../components/shop/ShopHeader';
import CategoryRow from '../components/shop/CategoryRow';
import QuickViewModal from '../components/shop/QuickViewModal';
import ShopStage from '../components/shop/ShopStage';
import { SkeletonProductGrid } from '../components/common/SkeletonLoader';

const Shop = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    searchKeyword,
    activeSubCat,
    setActiveSubCat,
    selectedProductModal,
    setSelectedProductModal,
    addedSuccess,
    bagIds,
    filteredProducts,
    availableCategories,
    isLoading,
    isError,
    handleAddToBag,
    handleToggleBag,
    handleTryOn,
  } = useShopData();

  // Defensive: a hook can legitimately hand back undefined before the first
  // render settles. Coercing to empty arrays guarantees `.map`/`.length` below
  // can never throw and white-screen the page.
  const safeProducts = Array.isArray(filteredProducts) ? filteredProducts : [];
  const safeCategories = Array.isArray(availableCategories) ? availableCategories : [];
  const safeBagIds = Array.isArray(bagIds) ? bagIds : [];

  const clearSearch = () => {
    searchParams.delete('search');
    setSearchParams(searchParams);
  };

  if (isLoading) {
    /*
     * SKELETON, NOT A SPINNER.
     *
     * The collection is a fixed 4-up grid, so the wait can hold the EXACT shape
     * the products will occupy — the page does not reflow when the data lands,
     * and the customer can read the layout before the images arrive.
     */
    return (
      <div className="container-page min-h-screen pb-20 pt-32">
        {/* Header placeholders, in the cream ramp so they read on the canvas. */}
        <div className="mb-12 space-y-3">
          <div className="h-3 w-40 animate-pulse rounded-full bg-cream-300" />
          <div className="h-9 w-72 animate-pulse rounded-full bg-cream-300/80" />
        </div>

        <div className="mb-16 h-[340px] animate-pulse rounded-[32px] bg-navy-950/90 sm:h-[420px] lg:h-[540px]" />

        <SkeletonProductGrid count={4} />

        <div className="mt-20">
          <SkeletonProductGrid count={4} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container-page min-h-screen pb-20 pt-32 text-hiraya-ink">
        <div className="card-raised mx-auto max-w-3xl px-8 py-20 text-center">
          <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-cream-100 shadow-neu-sm">
            <AlertCircle className="h-5 w-5" />
          </span>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-hiraya-ink">
            We could not load the collection
          </p>
          <p className="mt-2 text-[11px] text-hiraya-ink-muted">
            Please refresh the page, or try again in a moment.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary mt-8 cursor-pointer rounded-full"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page min-h-screen pb-24 pt-32 text-hiraya-ink">
      {/* MEMBER BANNER */}
      <UserWelcomeBanner user={user} />

      {/* ACTIVE SEARCH INDICATOR BADGE */}
      {searchKeyword && (
        <div className="mb-8 flex items-center justify-between gap-4 rounded-full bg-cream-200/70 py-2 pl-6 pr-3 shadow-neu-inset">
          <p className="text-xs uppercase tracking-[0.16em] font-medium text-hiraya-ink">
            Showing results for: <span className="font-semibold text-hiraya-accent">&ldquo;{searchKeyword}&rdquo;</span>
          </p>
          <button
            onClick={clearSearch}
            className="btn-quiet cursor-pointer"
          >
            <X size={14} /> Clear Filter
          </button>
        </div>
      )}

      {/* HEADER & FILTER TABS */}
      <ShopHeader activeSubCat={activeSubCat} onSelectSubCat={setActiveSubCat} />

      {/* FEATURED STAGE — read-only carousel over the pieces already loaded
          (and already filtered) above; it links to the existing product page. */}
      <ShopStage products={safeProducts} />

      {/* CATEGORY ROWS */}
      {safeCategories.length > 0 ? (
        /*
         * `data-tour="shop-grid"` wraps EVERY category row, not just the first.
         *
         * The Spotlight tour step is "act on any card", and the cards repeat once
         * per category — so the honest target is the whole grid region. Anchoring
         * it inside CategoryRow instead would highlight whichever single row
         * happened to mount first, implying the other categories behave
         * differently when they do not.
         */
        <div data-tour="shop-grid">
          {safeCategories.map((cat) => (
            <CategoryRow
              key={cat}
              title={cat}
              dbCategory={cat}
              products={safeProducts}
              activeSubCat={activeSubCat}
              bagIds={safeBagIds}
              // The heart is a true toggle over bag membership — save OR remove.
              onSaveToBag={handleToggleBag || handleAddToBag}
              onTryOn={handleTryOn}
              onQuickView={setSelectedProductModal}
              onExplore={setActiveSubCat}
            />
          ))}
        </div>
      ) : (
        <div className="card-raised py-20 text-center text-xs uppercase tracking-[0.16em] text-hiraya-ink-muted">
          {searchKeyword
            ? `No pieces match your search “${searchKeyword}”`
            : 'No garments available in this collection yet.'}
        </div>
      )}

      {/* QUICK-VIEW MODAL */}
      <QuickViewModal
        product={selectedProductModal}
        onClose={() => setSelectedProductModal(null)}
        onTryOn={handleTryOn}
      />
    </div>
  );
};

export default Shop;