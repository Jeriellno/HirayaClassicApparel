import React from 'react';
import { TrendingUp } from 'lucide-react';
// Resolved centrally so a legacy absolute Supabase URL is rewritten onto the
// same-origin `/supabase-storage` proxy and is not blocked by COEP.
import { getProductImageUrl } from '../../../../utils/imageHelper';

const TrendingGarmentsList = ({ trendingGarments }) => {
  return (
    <div className="bg-[#0A0D14] border border-white/10 rounded-xl p-6 space-y-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-[#E9C46A]" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-[#E9C46A] font-bold">
              Trending Garments & Highlights
            </h3>
          </div>
          <span className="text-[10px] font-mono text-gray-400">Top Inventory Activity</span>
        </div>
        <p className="text-xs font-mono text-gray-400 mt-2">
          Ranked by real customer engagement (canvas drags + AI try-ons), not catalog order.
        </p>
      </div>

      <div className="space-y-3 py-2">
        {trendingGarments.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-gray-500">
            No catalog items available for trending reports.
          </div>
        ) : (
          trendingGarments.map((item, index) => (
            <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:border-[#E9C46A]/30 transition-all">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-bold text-[#E9C46A] w-4">#{index + 1}</span>
                <img
                  src={getProductImageUrl(item.display_image_url || item.image_url) || '/images/placeholder.svg'}
                  alt={item.name}
                  className="w-10 h-10 rounded-lg object-cover border border-white/10"
                />
                <div>
                  <h4 className="text-xs font-semibold text-white line-clamp-1">{item.name || 'Unnamed Garment'}</h4>
                  <p className="text-[10px] font-mono text-gray-400">₱{Number(item.price || 0).toFixed(2)} • {item.category || 'General'}</p>
                </div>
              </div>
              <div className="text-right space-y-0.5">
                {/* Real engagement signal — this is WHY the item is trending. */}
                <span className="block text-[10px] font-mono px-2 py-0.5 rounded bg-[#E9C46A]/15 text-[#E9C46A] border-[#E9C46A]/30">
                  {Number(item.canvas_drag_count || 0) + Number(item.try_on_count || 0)} interactions
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Stock: {item.stock ?? 0}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-white/5 border border-white/5 rounded-lg p-3 text-[11px] font-mono text-gray-300">
        <span className="text-[#E9C46A] font-bold">Performance Note:</span> Trending items maintain steady inventory levels to support customer demand and virtual try-on features.
      </div>
    </div>
  );
};

export default TrendingGarmentsList;