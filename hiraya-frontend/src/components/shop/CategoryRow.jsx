import { motion } from 'framer-motion';
import { PlusCircle } from 'lucide-react';
import ProductCard from '../product/ProductCard';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
};

const CategoryRow = ({
  title,
  dbCategory,
  products,
  bagIds = [],
  onSaveToBag,
  onTryOn,
  onQuickView,
  onExplore
}) => {
  // Defensive: never trust the incoming array shape. A null `products` prop
  // used to throw on `.filter` and take the whole Shop page down with it.
  const safeProducts = Array.isArray(products) ? products : [];
  const safeCategory = String(dbCategory || '');

  // Ultra-flexible matching: Kukunin ang items kung 'top' vs 'tops' or 'bottom' vs 'bottoms'
  const filtered = safeProducts.filter((p) => {
    if (!p || !p.category) return false;
    const prodCat = String(p.category).trim().toLowerCase();
    const targetCat = safeCategory.trim().toLowerCase();
    if (!prodCat || !targetCat) return false;

    return (
      prodCat === targetCat ||
      prodCat.startsWith(targetCat.slice(0, 3)) ||
      targetCat.startsWith(prodCat.slice(0, 3))
    );
  });

  if (filtered.length === 0) return null;

  // There is no /shop/category/:slug route in App.jsx, so"Explore More" used
  // to hit the wildcard redirect and silently bounce the shopper back to Home.
  // Instead we filter the collection in place via the shared sub-category state.
  const handleExplore = () => {
    if (typeof onExplore === 'function') {
      onExplore(safeCategory);
    }
  };

  return (
    <div className="mb-20">
      <div className="mb-8 flex items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          {/* A navy stamp carrying the row's piece count. */}
          <span className="flex h-12 min-w-12 items-center justify-center rounded-2xl bg-navy-900 px-3 font-serif text-lg text-cream-100 shadow-neu-sm">
            {String(filtered.length).padStart(2, '0')}
          </span>
          <div>
            <h2 className="font-serif text-[1.6rem] uppercase leading-none tracking-[0.06em] text-navy-900">
              {title}
            </h2>
            <span className="mt-2 block text-[10px] uppercase tracking-[0.2em] text-hiraya-ink-muted">
              Showing {filtered.length} piece(s)
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExplore}
          className="btn-quiet group shrink-0"
        >
          Explore More <PlusCircle size={15} className="group-hover:rotate-90 transition-transform" />
        </button>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7 xl:grid-cols-4"
      >
        {filtered.map((product) => (
          <motion.div key={product.id} variants={cardVariants}>
            <ProductCard
              product={product}
              isSaved={Array.isArray(bagIds) && bagIds.includes(Number(product.id))}
              onWishlistToggle={onSaveToBag}
              onTryOn={onTryOn}
              onQuickView={onQuickView}
              showStackIcon={true} // 👈 IPINASA NA PARA SA SHOP LANG LALABAS ANG STACK ICON!
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};

export default CategoryRow;