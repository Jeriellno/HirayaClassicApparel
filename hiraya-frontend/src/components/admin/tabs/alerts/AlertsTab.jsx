// hiraya-frontend/src/components/admin/tabs/alerts/AlertsTab.jsx
import React, { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import api from '../../../../api/axios';
import AlertItem from './AlertItem';
import { getLowStockVariants } from './stockAlerts';

const AlertsTab = ({ products = [], defaultImageUrl, threshold, onThresholdChange, onOpenProduct }) => {
  const [movements, setMovements] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    let isMounted = true;
    api.get('/admin/stock-adjustments', { params: { limit: 20 } })
      .then((response) => {
        if (isMounted) setMovements(response.data?.data || []);
      })
      .catch((error) => {
        if (isMounted) setHistoryError(error.response?.data?.message || 'Unable to load stock adjustment history.');
      })
      .finally(() => {
        if (isMounted) setHistoryLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const lowStockVariants = getLowStockVariants(products, threshold)
    .sort((a, b) => a.stock - b.stock || String(a.product.name || '').localeCompare(String(b.product.name || '')));
  const totalAlerts = lowStockVariants.length;

  return (
    <div className="bg-hiraya-cream p-6 rounded-lg border border-hiraya-sand/30">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-hiraya-sand/30">
        <div>
          <h3 className="text-sm font-semibold text-hiraya-ink">Stock Alerts</h3>
          <p className="text-xs text-hiraya-ink mt-1">
            {totalAlerts > 0
              ? `${totalAlerts} size variants need attention`
              : 'All stock levels are healthy'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-hiraya-olive">
          Alert at or below
          <input
            type="number"
            min="0"
            max="9999"
            step="1"
            value={threshold}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (event.target.value !== '' && Number.isInteger(value) && value >= 0 && value <= 9999) {
                onThresholdChange(value);
              }
            }}
            aria-label="Low stock threshold"
            className="w-20 rounded-lg border border-hiraya-olive/20 bg-[#07090D] px-2 py-2 text-xs text-hiraya-ink outline-none focus:border-[#CB997E]"
          />
        </label>
        {totalAlerts > 0 && (
          <span className="px-3 py-1 bg-red-500/20 text-red-400 text-xs font-medium rounded-full border border-red-500/30">
            {totalAlerts} Alert{totalAlerts !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Alert List */}
      {totalAlerts === 0 ? (
        <div className="py-12 text-center">
          <div className="w-12 h-12 mx-auto mb-4 bg-green-500/10 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-hiraya-sand">All inventory levels are healthy</p>
          <p className="text-xs text-hiraya-olive/70 mt-1">No size variants at or below {threshold} units</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lowStockVariants.map(({ product, size, stock }) => (
            <AlertItem
              key={`${product.id}-${size}`}
              product={product}
              size={size}
              stock={stock}
              defaultImageUrl={defaultImageUrl}
              onOpenProduct={onOpenProduct}
            />
          ))}
        </div>
      )}

      <section className="mt-8 border-t border-hiraya-sand/30 pt-6">
        <div className="mb-4 flex items-center gap-2">
          <History size={15} className="text-hiraya-olive" />
          <div>
            <h4 className="text-sm font-semibold text-hiraya-ink">Recent Stock Adjustments</h4>
            <p className="mt-1 text-[10px] text-hiraya-olive">Latest 20 stock changes, including initial stock and checkout reservations.</p>
          </div>
        </div>

        {historyError && <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{historyError}</p>}
        {historyLoading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-hiraya-olive"><Loader2 size={14} className="animate-spin" /> Loading stock history...</div>
        ) : movements.length === 0 ? (
          <p className="rounded-lg border border-dashed border-hiraya-olive/20 px-4 py-6 text-center text-xs text-hiraya-olive">No stock changes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {movements.map((movement) => {
              const previousSizes = movement.before_size_stocks || {};
              const nextSizes = movement.after_size_stocks || {};
              const sizeLabels = [...new Set([...Object.keys(previousSizes), ...Object.keys(nextSizes)])];
              const sizeChanges = sizeLabels
                .filter((size) => Number(previousSizes[size]?.stock ?? previousSizes[size] ?? 0) !== Number(nextSizes[size]?.stock ?? nextSizes[size] ?? 0))
                .map((size) => `${size} ${Number(previousSizes[size]?.stock ?? previousSizes[size] ?? 0)} → ${Number(nextSizes[size]?.stock ?? nextSizes[size] ?? 0)}`);

              return (
                <div key={movement.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hiraya-olive/15 bg-black/5 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-hiraya-ink">{movement.product_name}</p>
                    <p className="mt-1 text-[10px] text-hiraya-olive">
                      {movement.source} · {movement.user?.full_name || 'System'} · {new Date(movement.created_at).toLocaleString()}
                    </p>
                    {sizeChanges.length > 0 && <p className="mt-1 text-[10px] text-hiraya-ink">{sizeChanges.join(' · ')}</p>}
                  </div>
                  <span className="whitespace-nowrap text-[10px] font-mono text-hiraya-olive">
                    Total {movement.before_stock ?? '—'} → {movement.after_stock}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default AlertsTab;