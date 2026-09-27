// hiraya-frontend/src/components/admin/tabs/inventory/BulkStockMatrixEditor.jsx
import React, { useState, useMemo } from 'react';
import { Search, Zap, Save } from 'lucide-react';

const BulkStockMatrixEditor = ({ products = [], onBulkUpdate, defaultImageUrl }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [globalStockInput, setGlobalStockInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [localChanges, setLocalChanges] = useState({});

  const sizes = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products;
    return products.filter(p => 
      p.name?.toLowerCase().includes(query) ||
      p.category?.toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  const getProductStocks = (productId) => {
    if (localChanges[productId]) {
      return localChanges[productId];
    }
    const product = products.find(p => p.id === productId);
    if (!product) return {};

    const rawSizes = product.sizes || product.size_stocks;
    if (!rawSizes) return {};

    let parsed = rawSizes;
    if (typeof rawSizes === 'string') {
      try {
        parsed = JSON.parse(rawSizes);
      } catch {
        return {};
      }
    }

    // Normalize to simple stock number mapping {S: 5, M: 10}
    const normalized = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      sizes.forEach(sz => {
        if (Object.prototype.hasOwnProperty.call(parsed, sz)) {
          const val = parsed[sz];
          normalized[sz] = typeof val === 'object' && val !== null ? (val.stock || 0) : (Number(val) || 0);
        }
      });
    }
    return normalized;
  };

  const handleSizeChange = (productId, size, value) => {
    const num = Math.max(0, parseInt(value) || 0);
    const currentStocks = getProductStocks(productId);
    
    setLocalChanges(prev => ({
      ...prev,
      [productId]: {
        ...currentStocks,
        [size]: num
      }
    }));
  };

  const handleQuickApplyRow = (productId, count) => {
    const num = Math.max(0, parseInt(count) || 0);
    const newSizeStocks = {};
    sizes.forEach(sz => {
      newSizeStocks[sz] = num;
    });
    
    setLocalChanges(prev => ({
      ...prev,
      [productId]: newSizeStocks
    }));
  };

  const handleGlobalApply = () => {
    if (globalStockInput === '') return;
    const num = Math.max(0, parseInt(globalStockInput) || 0);
    
    const updates = {};
    filteredProducts.forEach(product => {
      const newStocks = {};
      sizes.forEach(sz => {
        newStocks[sz] = num;
      });
      updates[product.id] = newStocks;
    });
    
    setLocalChanges(prev => ({
      ...prev,
      ...updates
    }));
    
    setGlobalStockInput('');
  };

  const handleSaveChanges = async () => {
    if (Object.keys(localChanges).length === 0) return;
    
    setSaving(true);
    try {
      for (const [productId, sizesData] of Object.entries(localChanges)) {
        if (onBulkUpdate) {
          await onBulkUpdate(productId, sizesData);
        }
      }
      setLocalChanges({});
      console.log('Bulk stock updates saved successfully!');
    } catch (error) {
      console.error('Error saving bulk updates:', error);
    } finally {
      setSaving(false);
    }
  };

  const totalChanges = Object.keys(localChanges).length;

  return (
    <div className="space-y-4 bg-hiraya-cream border border-hiraya-olive/15 p-6 rounded-3xl text-hiraya-ink">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink">Bulk Stock Matrix</h2>
          {totalChanges > 0 && (
            <span className="px-2 py-0.5 bg-[#CB997E]/20 text-hiraya-ink text-[9px] font-mono rounded border border-[#CB997E]/30">
              {totalChanges} pending change{totalChanges !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-ink" size={14} />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-hiraya-cream/40 border border-hiraya-olive/15 rounded-lg pl-9 pr-3 py-1.5 text-xs font-mono text-hiraya-ink focus:outline-none focus:border-[#CB997E]"
            />
          </div>
          
          <input
            type="number"
            min="0"
            placeholder="Qty"
            value={globalStockInput}
            onChange={(e) => setGlobalStockInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleGlobalApply();
              }
            }}
            className="w-20 bg-hiraya-cream/40 border border-hiraya-olive/15 rounded-lg px-2 py-1.5 text-xs font-mono text-hiraya-ink focus:outline-none focus:border-[#CB997E]"
          />
          <button
            type="button"
            onClick={handleGlobalApply}
            className="px-3 py-1.5 bg-[#CB997E] hover:bg-hiraya-cream-deep text-hiraya-olive text-[10px] font-mono font-bold uppercase rounded-lg transition flex items-center gap-1 whitespace-nowrap"
          >
            <Zap size={12} /> Apply All
          </button>
          
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={totalChanges === 0 || saving}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase transition flex items-center gap-1 whitespace-nowrap ${
              totalChanges > 0 && !saving
                ? 'bg-emerald-500 hover:bg-emerald-400 text-hiraya-olive'
                : 'bg-hiraya-sand/80 text-hiraya-ink cursor-not-allowed'
            }`}
          >
            <Save size={12} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-hiraya-olive/15 rounded-2xl max-h-[65vh] overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-hiraya-cream z-10">
            <tr className="border-b border-hiraya-olive/15 bg-hiraya-cream/60 text-[10px] font-mono uppercase tracking-widest text-hiraya-ink">
              <th className="p-3 min-w-[180px]">Product</th>
              {sizes.map(sz => (
                <th key={sz} className="p-2 text-center min-w-[60px]">{sz}</th>
              ))}
              <th className="p-2 text-center min-w-[100px]">Quick Fill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-xs font-mono">
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={sizes.length + 2} className="p-8 text-center text-hiraya-sand">No products found.</td>
              </tr>
            ) : (
              filteredProducts.map(product => {
                const currentStocks = getProductStocks(product.id);
                const hasChanges = !!localChanges[product.id];

                return (
                  <tr 
                    key={product.id} 
                    className={`transition ${
                      hasChanges ? 'bg-[#CB997E]/5' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <td className="p-3 flex items-center gap-3 min-w-[180px]">
                      <img 
                        /*
                         * `via.placeholder.com` is a DEAD service, and BOTH the src
                         * fallback and the onError target used to point at it — so a
                         * garment with no image showed a broken-icon glyph here no
                         * matter which branch ran. The local SVG is the only one of
                         * the two that actually renders.
                         *
                         * `defaultImageUrl` stays as the caller's override; the local
                         * path is the last resort.
                         */
                        src={product.display_image_url || product.image_url || defaultImageUrl || '/images/placeholder.svg'}
                        alt={product.name}
                        className="w-10 h-10 rounded-lg object-cover border border-hiraya-olive/15 flex-shrink-0"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = defaultImageUrl || '/images/placeholder.svg';
                        }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-hiraya-ink truncate">{product.name}</div>
                        <div className="text-[10px] text-hiraya-ink uppercase">{product.category}</div>
                        {hasChanges && (
                          <span className="text-[8px] text-hiraya-ink">* unsaved</span>
                        )}
                      </div>
                    </td>

                    {sizes.map(sz => (
                      <td key={sz} className="p-2 text-center">
                        <input
                          type="number"
                          min="0"
                          value={currentStocks[sz] ?? 0}
                          onChange={(e) => handleSizeChange(product.id, sz, e.target.value)}
                          className={`w-14 bg-hiraya-cream/30 border rounded-lg py-1 text-center text-xs text-hiraya-ink focus:outline-none focus:border-[#CB997E] ${
                            hasChanges ? 'border-[#CB997E]/50' : 'border-hiraya-olive/15'
                          }`}
                        />
                      </td>
                    ))}

                    <td className="p-2 text-center space-x-1">
                      <button
                        type="button"
                        onClick={() => handleQuickApplyRow(product.id, 10)}
                        className="px-2 py-0.5 bg-hiraya-cream/60 hover:bg-[#CB997E]/20 border border-hiraya-olive/15 rounded text-[9px] text-hiraya-ink transition"
                      >
                        10
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickApplyRow(product.id, 20)}
                        className="px-2 py-0.5 bg-hiraya-cream/60 hover:bg-[#CB997E]/20 border border-hiraya-olive/15 rounded text-[9px] text-hiraya-ink transition"
                      >
                        20
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickApplyRow(product.id, 50)}
                        className="px-2 py-0.5 bg-hiraya-cream/60 hover:bg-[#CB997E]/20 border border-hiraya-olive/15 rounded text-[9px] text-hiraya-ink transition"
                      >
                        50
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center text-[10px] font-mono text-hiraya-ink border-t border-hiraya-olive/15 pt-4">
        <span>Showing {filteredProducts.length} of {products.length} products</span>
        <span>{totalChanges} pending change{totalChanges !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
};

export default BulkStockMatrixEditor;