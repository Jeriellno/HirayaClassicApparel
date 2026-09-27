import React from 'react';
import { TrendingUp } from 'lucide-react';
// Resolved centrally so a legacy absolute Supabase URL is rewritten onto the
// same-origin `/supabase-storage` proxy and is not blocked by COEP.
import { getProductImageUrl } from '../../../../utils/imageHelper';

const TrendingGarmentsList = ({ trendingGarments }) => {
  return (
    <div className="bg-[#0A0D14] border border-hiraya-olive/15 rounded-xl p-6 space-y-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between border-b border-hiraya-olive/15 pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-hiraya-ink" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink font-bold">
              Trending Garments & Highlights
            </h3>
          </div>
          <span className="text-[10px] font-mono text-hiraya-ink">Top Inventory Activity</span>
        </div>
        <p className="text-xs font-mono text-hiraya-ink mt-2">
          Ranked by real customer engagement (canvas drags + AI try-ons), not catalog order.
        </p>
      </div>

      <div className="space-y-3 py-2">
        {trendingGarments.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-hiraya-sand">
            No catalog items available for trending reports.
          </div>
        ) : (
          trendingGarments.map((item, index) => (
            <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-hiraya-cream/60 border border-hiraya-olive/15 hover:border-[#CB997E]/30 transition-all">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-bold text-hiraya-ink w-4">#{index + 1}</span>
                <img
                  src={getProductImageUrl(item.display_image_url || item.image_url) || '/images/placeholder.svg'}
                  alt={item.name}
                  className="w-10 h-10 rounded-lg object-cover border border-hiraya-olive/15"
                />
                <div>
                  <h4 className="text-xs font-semibold text-hiraya-ink line-clamp-1">{item.name || 'Unnamed Garment'}</h4>
                  <p className="text-[10px] font-mono text-hiraya-ink">₱{Number(item.price || 0).toFixed(2)} • {item.category || 'General'}</p>
                </div>
              </div>
              <div className="text-right space-y-0.5">
                {/* Real engagement signal — this is WHY the item is trending. */}
                <span className="block text-[10px] font-mono px-2 py-0.5 rounded bg-[#CB997E]/15 text-hiraya-ink border-[#CB997E]/30">
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

      <div className="bg-hiraya-cream/60 border border-hiraya-olive/15 rounded-lg p-3 text-[11px] font-mono text-hiraya-ink">
        <span className="text-hiraya-ink font-bold">Performance Note:</span> Trending items maintain steady inventory levels to support customer demand and virtual try-on features.
      </div>
    </div>
  );
};

export default TrendingGarmentsList;