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
      <div className="bg-hiraya-bg pt-36 pb-20 px-8 md:px-20 min-h-screen">
        {/* Header placeholders — cream-tinted, because this sits on the canvas. */}
        <div className="mb-12 space-y-3">
          <div className="h-6 w-64 animate-pulse rounded-md bg-hiraya-cream/30" />
          <div className="h-3 w-40 animate-pulse rounded-md bg-hiraya-cream/20" />
        </div>

        <SkeletonProductGrid count={4} />

        <div className="mt-20">
          <SkeletonProductGrid count={4} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="pt-36 pb-20 px-8 md:px-20 bg-hiraya-bg min-h-screen text-hiraya-ink">
        <div className="max-w-5xl mx-auto text-center py-24 border-hiraya-sand rounded-2xl bg-hiraya-olive/60">
          <AlertCircle className="w-8 h-8 text-hiraya-ink mx-auto mb-4" />
          <p className="text-xs uppercase tracking-[0.25em] text-hiraya-sand font-semibold">
            We could not load the collection
          </p>
          <p className="text-[11px] text-hiraya-sand mt-2">
            Please refresh the page, or try again in a moment.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 px-8 py-3 bg-[#CB997E] text-hiraya-ink text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-hiraya-cream-deep transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-36 pb-20 px-8 md:px-20 bg-hiraya-bg min-h-screen text-hiraya-ink">
      {/* MEMBER BANNER */}
      <UserWelcomeBanner user={user} />

      {/* ACTIVE SEARCH INDICATOR BADGE */}
      {searchKeyword && (
        <div className="mb-6 flex items-center justify-between bg-hiraya-cream/10 border border-hiraya-olive/20 px-6 py-3 rounded-2xl">
          <p className="text-xs uppercase tracking-[0.2em] font-medium text-hiraya-ink">
            Showing results for: <span className="text-hiraya-ink font-bold">"{searchKeyword}"</span>
          </p>
          <button
            onClick={clearSearch}
            className="flex items-center gap-2 text-xs uppercase tracking-widest text-hiraya-ink hover:text-hiraya-ink transition"
          >
            <X size={14} /> Clear Filter
          </button>
        </div>
      )}

      {/* HEADER & FILTER TABS */}
      <ShopHeader activeSubCat={activeSubCat} onSelectSubCat={setActiveSubCat} />

      {/* CATEGORY ROWS */}
      {safeCategories.length > 0 ? (
        safeCategories.map((cat) => (
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
        ))
      ) : (
        <div className="text-center py-20 text-hiraya-ink uppercase tracking-[0.2em] text-xs">
          {searchKeyword ? (
            `No pieces match your search"${searchKeyword}"`
          ) : (
"No garments available in this collection yet."
          )}
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