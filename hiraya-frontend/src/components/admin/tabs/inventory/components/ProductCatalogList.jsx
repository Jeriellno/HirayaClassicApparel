import React, { useState, useMemo } from 'react';
import { Search, Layers, Package, Tag, AlertTriangle, CheckCircle2 } from 'lucide-react';

const ProductCatalogList = ({
  products = [],
  editingId,
  onEditClick,
  onReset,
  defaultImageUrl,
  getParsedSizesObject,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Bulletproof parser para sa sizes at size_stocks
  const parseSizesSafely = (rawSizes) => {
    if (!rawSizes) return {};
    if (typeof rawSizes === 'object' && rawSizes !== null) return rawSizes;
    if (typeof rawSizes === 'string') {
      try {
        const parsed = JSON.parse(rawSizes);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
      } catch {
        return {};
      }
    }
    return {};
  };

  // Kunin ang mga unique categories para sa filter pills
  const categories = useMemo(() => {
    const cats = products.map((item) => item.category).filter(Boolean);
    return ['ALL', ...new Set(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return products.filter((item) => {
      const name = item.name?.toLowerCase() || '';
      const category = item.category?.toLowerCase() || '';
      const matchesSearch = name.includes(query) || category.includes(query);
      const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  return (
    <div className="bg-[#0D1017] border border-[#E9C46A]/20 rounded-2xl p-5 space-y-4 shadow-xl h-fit sticky top-6">
      {/* Header section */}
      <div className="flex justify-between items-center pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-[#E9C46A]/10 rounded-lg border border-[#E9C46A]/30 text-[#E9C46A]">
            <Layers size={16} />
          </div>
          <div>
            <h2 className="text-xs font-mono uppercase tracking-wider text-white font-bold">
              Garment Catalog
            </h2>
            <p className="text-[10px] text-gray-400 font-mono">
              Showing {filteredProducts.length} of {products.length} entries
            </p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#E9C46A]" size={14} />
        <input
          type="text"
          placeholder="Search garment name or category..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#161B22] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-[#E9C46A] focus:ring-1 focus:ring-[#E9C46A] transition-all"
        />
      </div>

      {/* Category Filter Pills */}
      {categories.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`text-[10px] font-mono px-3 py-1 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-[#E9C46A] text-black font-bold shadow-md'
                  : 'bg-[#161B22] text-gray-400 hover:text-white border border-white/5'
              }`}
            >
              {cat.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Products Feed / List */}
      <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
        {filteredProducts.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center justify-center space-y-2 bg-[#161B22]/50 rounded-xl border border-dashed border-white/10">
            <Package size={24} className="text-gray-500" />
            <p className="text-xs font-mono text-gray-400">No garments found in catalog.</p>
          </div>
        ) : (
          filteredProducts.map((item) => {
            const isSelected = editingId === item.id;
            
            const rawSizesInput = item.sizes || item.size_stocks;
            const itemSizesObj = getParsedSizesObject 
              ? getParsedSizesObject(rawSizesInput) 
              : parseSizesSafely(rawSizesInput);

            let computedTotalStock = 0;
            const availableSizes = [];

            Object.entries(itemSizesObj).forEach(([size, szData]) => {
              const qty = typeof szData === 'object' && szData !== null 
                ? Number(szData.stock ?? szData.quantity ?? 0) 
                : Number(szData || 0);

              computedTotalStock += qty;
              if (qty > 0) {
                availableSizes.push(size);
              }
            });

            const displayStock = Number(item.stock) > 0 ? Number(item.stock) : computedTotalStock;

            return (
              <div
                key={item.id}
                onClick={() => onEditClick(item)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer group relative overflow-hidden ${
                  isSelected
                    ? 'bg-gradient-to-r from-[#E9C46A]/15 via-[#161B22] to-[#161B22] border-[#E9C46A] shadow-lg shadow-[#E9C46A]/5'
                    : 'bg-[#161B22]/60 border-white/5 hover:border-white/20 hover:bg-[#161B22]'
                }`}
              >
                {isSelected && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#E9C46A]" />
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <img
                        src={item.display_image_url || item.image_url || defaultImageUrl}
                        alt={item.name || 'Garment'}
                        className="w-13 h-13 object-cover rounded-xl border border-white/10 flex-shrink-0 group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <h4 className="text-xs font-bold text-white line-clamp-1 group-hover:text-[#E9C46A] transition-colors">
                        {item.name || 'Unnamed Garment'}
                      </h4>
                      <p className="text-[11px] font-mono text-[#E9C46A] font-medium">
                        ₱{item.price ? Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono">
                        <Tag size={10} className="text-gray-500" />
                        <span className="truncate">{item.category?.replace(/_/g, ' ') || 'Uncategorized'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span
                      className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                        displayStock < 5
                          ? 'bg-red-500/10 border border-red-500/30 text-red-400 animate-pulse'
                          : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                      }`}
                    >
                      {displayStock < 5 ? <AlertTriangle size={10} /> : <CheckCircle2 size={10} />}
                      {displayStock} Stock
                    </span>
                  </div>
                </div>

                {/* AVAILABLE SIZES BADGES */}
                <div className="flex flex-wrap items-center gap-1 pt-2.5 mt-2.5 border-t border-white/5">
                  <span className="text-[9px] font-mono text-gray-500 mr-1 uppercase">Sizes:</span>
                  {availableSizes.length > 0 ? (
                    availableSizes.map((size) => (
                      <span
                        key={size}
                        className="text-[9px] font-mono px-2 py-0.5 bg-black/40 border border-white/10 rounded text-gray-300 group-hover:border-[#E9C46A]/30 transition-colors"
                      >
                        {size}
                      </span>
                    ))
                  ) : (
                    <span className="text-[9px] font-mono text-red-400/80 italic">
                      Out of stock across sizes
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ProductCatalogList;