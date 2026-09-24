import React from 'react';
import { motion } from 'framer-motion';
import { X, AlertCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useShopData } from '../hooks/useShopData';

// Sub-components
import UserWelcomeBanner from '../components/home/UserWelcomeBanner';
import ShopHeader from '../components/shop/ShopHeader';
import CategoryRow from '../components/shop/CategoryRow';
import QuickViewModal from '../components/shop/QuickViewModal';

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
    return (
      <div className="h-screen bg-[#0A0C10] flex items-center justify-center text-[#E9C46A] uppercase tracking-[0.6em] text-xs font-semibold">
        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5 }}>
          Curating Collection...
        </motion.div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="pt-36 pb-20 px-8 md:px-20 bg-[#0A0C10] min-h-screen text-gray-100">
        <div className="max-w-5xl mx-auto text-center py-24 border-zinc-900 rounded-2xl bg-zinc-950/60">
          <AlertCircle className="w-8 h-8 text-stone-200 mx-auto mb-4" />
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-400 font-semibold">
            We could not load the collection
          </p>
          <p className="text-[11px] text-zinc-500 mt-2">
            Please refresh the page, or try again in a moment.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 px-8 py-3 bg-[#E9C46A] text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-[#D4A94F] transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-36 pb-20 px-8 md:px-20 bg-[#0A0C10] min-h-screen text-gray-100">
      {/* MEMBER BANNER */}
      <UserWelcomeBanner user={user} />

      {/* ACTIVE SEARCH INDICATOR BADGE */}
      {searchKeyword && (
        <div className="mb-6 flex items-center justify-between bg-hiraya-cream/10 border border-stone-300/30 px-6 py-3 rounded-2xl">
          <p className="text-xs uppercase tracking-[0.2em] font-medium text-gray-300">
            Showing results for: <span className="text-[#E9C46A] font-bold">"{searchKeyword}"</span>
          </p>
          <button
            onClick={clearSearch}
            className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-400 hover:text-white transition"
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
        <div className="text-center py-20 text-gray-400 uppercase tracking-[0.2em] text-xs">
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