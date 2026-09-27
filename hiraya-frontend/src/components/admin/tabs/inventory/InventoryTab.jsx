import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Search, Package, Tag, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';

// Modals
import ProductModal from './modal/ProductModal';

const InventoryTab = ({
  products = [],
  loading = false,
  defaultImageUrl = '',
  onSubmit, // Callback para sa Create/Update API request
  onDelete, // Callback para sa Delete API request
  productToOpen = null,
  onProductOpened,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Modal Control States
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);

  useEffect(() => {
    if (!productToOpen) return;
    setSelectedProduct(productToOpen);
    setIsProductModalOpen(true);
    onProductOpened?.();
  }, [productToOpen, onProductOpened]);

  // Safe parser para sa sizes
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

  const categories = useMemo(() => {
    const cats = products.map((item) => item.category).filter(Boolean);
    return ['ALL', ...new Set(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return products.filter((item) => {
      const name = item.name?.toLowerCase() || '';
      const cat = item.category?.toLowerCase() || '';
      const matchesSearch = name.includes(query) || cat.includes(query);
      const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  // Handlers para sa Modal Actions
  const handleOpenAddModal = () => {
    setSelectedProduct(null);
    setIsProductModalOpen(true);
  };

  const handleOpenEditModal = (item) => {
    setSelectedProduct(item);
    setIsProductModalOpen(true);
  };

  /*
   * Deletion is OWNED BY THE PARENT.
   *
   * Previously this opened a LOCAL confirmation modal whose onConfirm then
   * called the parent's `onDelete`, which opened a SECOND, stacked modal at the
   * same z-index. The user's first "Delete Garment" click never reached the API
   * (nothing happened), and the real request only fired after a confusing second
   * confirmation. Now we close the product modal and hand the id straight to the
   * parent, so there is exactly ONE confirmation modal and ONE DELETE call.
   */
  const triggerDeleteModal = (id) => {
    setIsProductModalOpen(false);
    if (onDelete) onDelete(id);
  };

  /*
   * Delete directly from a CARD.
   *
   * The card itself opens the Edit modal on click, so the event MUST be stopped
   * here — otherwise clicking Delete also opens the editor behind the
   * confirmation. It reuses `triggerDeleteModal`, so there is still exactly ONE
   * confirmation modal and ONE DELETE call (the parent owns it).
   */
  const handleCardDelete = (event, id) => {
    event.preventDefault();
    event.stopPropagation();
    triggerDeleteModal(id);
  };

  // INAYOS DITO: Direktang ipasa ang payload at boolean flag para sa mode
  const handleSaveProduct = async (payload, isEdit) => {
    if (onSubmit) {
      return await onSubmit(payload, isEdit);
    }
  };

  return (
    <div className="space-y-6 pb-12 relative">
      {/* Header Banner with Add Button */}
      <div className="bg-gradient-to-r from-[#FFE8D6] via-[#DDBEA9] to-[#FFE8D6] border border-[#CB997E]/20 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-[#CB997E] animate-pulse"></span>
            <span className="text-xs font-mono uppercase tracking-widest text-hiraya-ink">
              Catalog & Stock Control
            </span>
          </div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-hiraya-ink">Inventory Management</h1>
          <p className="text-xs text-hiraya-ink mt-0.5">
            Manage garment specifications, matrix sizes, and stock levels in full view.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-2 bg-[#1A1F2C] border border-hiraya-olive/15 rounded-xl text-xs font-mono text-hiraya-ink">
            Total Products: <span className="text-hiraya-ink font-bold">{products.length}</span>
          </div>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="px-4 py-2.5 bg-[#CB997E] hover:bg-hiraya-cream-deep text-hiraya-olive text-xs font-mono font-bold uppercase rounded-xl flex items-center gap-2 transition cursor-pointer shadow-lg"
          >
            <Plus size={16} />
            Add New Garment
          </button>
        </div>
      </div>

      {/* Catalog Controls & Grid Section */}
      <div className="bg-hiraya-cream border border-[#CB997E]/20 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 pb-4 border-b border-hiraya-olive/15">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-hiraya-ink" size={14} />
            <input
              type="text"
              placeholder="Search catalog name or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#DDBEA9] border border-hiraya-olive/15 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono text-hiraya-ink placeholder-gray-500 focus:outline-none focus:border-[#CB997E]"
            />
          </div>

          {categories.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-[10px] font-mono px-3 py-1.5 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-[#CB997E] text-hiraya-ink font-bold shadow-md'
                      : 'bg-[#DDBEA9] text-hiraya-ink hover:text-hiraya-ink border border-hiraya-olive/15'
                  }`}
                >
                  {cat.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Garments Grid Layout */}
        {filteredProducts.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center justify-center space-y-3 bg-[#DDBEA9]/40 rounded-2xl border border-dashed border-hiraya-olive/15">
            <Package size={32} className="text-hiraya-sand" />
            <p className="text-xs font-mono text-hiraya-ink">No garments found in catalog matching your filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((item) => {
              const rawSizesInput = item.sizes || item.size_stocks;
              const itemSizesObj = parseSizesSafely(rawSizesInput);
              const itemMeasurements = parseSizesSafely(item.size_measurements);

              let computedTotalStock = 0;
              const availableSizes = [];

              if (Array.isArray(itemSizesObj)) {
                itemSizesObj.forEach((sz) => {
                  const qty = Number(sz.stock || 0);
                  computedTotalStock += qty;
                  if (qty > 0) availableSizes.push(sz.size_label || sz.size);
                });
              } else {
                Object.entries(itemSizesObj).forEach(([size, szData]) => {
                  const qty = typeof szData === 'object' && szData !== null
                    ? Number(szData.stock ?? szData.quantity ?? 0)
                    : Number(szData || 0);

                  computedTotalStock += qty;
                  if (qty > 0) availableSizes.push(size);
                });
              }

              const displayStock = Number(item.stock) > 0 ? Number(item.stock) : computedTotalStock;

              return (
                <div
                  key={item.id}
                  onClick={() => handleOpenEditModal(item)}
                  className="p-4 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden flex flex-col justify-between bg-[#DDBEA9]/60 border-hiraya-olive/15 hover:border-hiraya-olive/20 hover:bg-[#DDBEA9]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={item.display_image_url || item.image_url || defaultImageUrl}
                          alt={item.name || 'Garment'}
                          className="w-14 h-14 object-cover rounded-xl border border-hiraya-olive/15 shrink-0 group-hover:scale-105 transition-transform"
                        />
                        <div className="min-w-0 space-y-0.5">
                          <h4 className="text-xs font-bold text-hiraya-ink line-clamp-1 group-hover:text-hiraya-ink transition-colors">
                            {item.name || 'Unnamed Garment'}
                          </h4>
                          <p className="text-xs font-mono text-hiraya-ink font-bold">
                            ₱{item.price ? Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}
                          </p>
                          <div className="flex items-center gap-1 text-[10px] text-hiraya-ink font-mono">
                            <Tag size={10} className="text-hiraya-sand" />
                            <span className="truncate">{item.category?.replace(/_/g, ' ') || 'Uncategorized'}</span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shrink-0 ${
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

                  <div className="pt-3 border-t border-hiraya-olive/15 flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[9px] font-mono text-hiraya-sand uppercase mr-1">Sizes:</span>
                      {availableSizes.length > 0 ? (
                        availableSizes.map((size) => (
                          <span
                            key={size}
                            className="text-[9px] font-mono px-2 py-0.5 bg-hiraya-cream/30 border border-hiraya-olive/15 rounded text-hiraya-ink"
                          >
                            {size}
                          </span>
                        ))
                      ) : (
                        <span className="text-[9px] font-mono text-red-400 italic">Out of stock</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleCardDelete(e, item.id)}
                        title="Delete garment"
                        aria-label={'Delete ' + (item.name || 'garment')}
                        className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400 transition cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                      <span className="text-[10px] font-mono text-hiraya-ink group-hover:underline">
                        Edit Entry &rarr;
                      </span>
                    </div>
                  </div>
                    {Object.keys(itemMeasurements).length > 0 && (
                      <div className="mt-2 pt-2 border-t border-hiraya-olive/15 text-[9px] font-mono text-hiraya-sand grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                        {Object.entries(itemMeasurements).map(([size, measurements]) => {
                          const summary = [
                            measurements?.chest_bust,
                            measurements?.waist,
                            measurements?.hips,
                            measurements?.shoulder_width,
                            measurements?.top_length ?? measurements?.length,
                          ].filter((value) => value !== null && value !== undefined && value !== '');

                          return summary.length > 0 ? (
                            <div key={size} className="flex gap-1 leading-4 truncate">
                              <span className="text-hiraya-ink font-bold shrink-0">{size}</span>
                              <span className="truncate">{summary.join(' / ')} cm</span>
                            </div>
                          ) : null;
                        })}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Product Add/Edit Reusable Modal */}
      <ProductModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        productToEdit={selectedProduct}
        defaultImageUrl={defaultImageUrl}
        onSave={handleSaveProduct}
        onDelete={triggerDeleteModal}
      />

    </div>
  );
};

export default InventoryTab;