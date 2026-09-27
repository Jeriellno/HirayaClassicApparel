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
      <div className="flex justify-between items-center mb-8 border-l-[3px] border-[#CB997E] pl-6">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.25em] text-hiraya-ink">
            {title}
          </h2>
          <span className="text-[10px] text-hiraya-sand uppercase tracking-widest mt-1 block">
            Showing {filtered.length} piece(s)
          </span>
        </div>
        <button
          type="button"
          onClick={handleExplore}
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-hiraya-sand hover:text-hiraya-ink transition-all group"
        >
          Explore More <PlusCircle size={15} className="group-hover:rotate-90 transition-transform" />
        </button>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8"
      >
        {filtered.map((product) => (
          <motion.div key={product.id} variants={cardVariants} whileHover={{ y: -6, transition: { duration: 0.2 } }}>
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