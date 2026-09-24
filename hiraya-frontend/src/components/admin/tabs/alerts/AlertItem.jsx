// hiraya-frontend/src/components/admin/tabs/alerts/AlertItem.jsx
import React from 'react';
import { AlertCircle } from 'lucide-react';
// Every image on this surface goes through the ONE resolver, so a legacy row that
// stores an absolute Supabase URL is rewritten onto the same-origin
// `/supabase-storage` proxy instead of being blocked by the document's COEP.
import { getProductImageUrl } from '../../../../utils/imageHelper';

const AlertItem = ({ product, defaultImageUrl }) => {
  const stockLevel = product.stock || 0;
  const isCritical = stockLevel === 0;
  const isWarning = stockLevel > 0 && stockLevel < 3;

  const getStockStatus = () => {
    if (isCritical) return { label: 'Out of Stock', color: 'red' };
    if (isWarning) return { label: 'Very Low', color: 'orange' };
    return { label: 'Low Stock', color: 'yellow' };
  };

  const status = getStockStatus();

  return (
    <div className={`
      p-4 rounded-lg border transition-all
      ${isCritical 
        ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/50' 
        : isWarning
        ? 'bg-orange-500/5 border-orange-500/30 hover:border-orange-500/50'
        : 'bg-yellow-500/5 border-yellow-500/30 hover:border-yellow-500/50'
      }
    `}>
      <div className="flex items-center gap-4">
        {/* Product Image */}
        <div className="w-14 h-14 rounded-lg bg-[#1A1D24] overflow-hidden flex-shrink-0 border border-gray-700">
          {/* Prefer the AI cut-out so admin lists match what customers see. */}
          <img
            src={getProductImageUrl(product.display_image_url || product.image_url || defaultImageUrl) || '/images/placeholder.svg'}
            alt={product.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.src = '/images/placeholder.svg';
            }}
          />
        </div>

        {/* Product Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-medium text-white truncate">
                {product.name}
              </h4>
              <p className="text-xs text-gray-400">{product.category}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-[#E9C46A]">
                  ₱{Number(product.price).toLocaleString()}
                </span>
                {product.gender && (
                  <span className="text-[10px] px-2 py-0.5 bg-[#1A1D24] text-gray-400 rounded">
                    {product.gender}
                  </span>
                )}
              </div>
            </div>
            
            {/* Stock Badge */}
            <div className="flex flex-col items-end gap-1">
              <span className={`
                text-xs font-mono font-bold px-3 py-1.5 rounded-lg border
                ${isCritical 
                  ? 'text-red-400 bg-red-500/10 border-red-500/30' 
                  : isWarning
                  ? 'text-orange-400 bg-orange-500/10 border-orange-500/30'
                  : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
                }
              `}>
                {stockLevel} Left
              </span>
              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {status.label}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertItem;