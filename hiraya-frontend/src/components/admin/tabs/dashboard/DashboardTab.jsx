import React, { useMemo, useEffect, useState } from 'react';
import api from '../../../../api/axios';
import DashboardMetrics from './DashboardMetrics';
import CategoryDistributionChart from './CategoryDistributionChart';
import TrendingGarmentsList from './TrendingGarmentsList';

const DashboardTab = ({ products = [] }) => {
  const [period, setPeriod] = useState('month');
  const [operations, setOperations] = useState(null);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationsError, setOperationsError] = useState('');
  /*
   * SERVER-AUTHORITATIVE METRICS.
   *
   * Totals and the category distribution used to be recomputed in the browser
   * from whatever slice of the catalog the current page held, which undercounts
   * the moment the list is paged or filtered. The backend already exposes
   * GET /admin/analytics/dashboard with authoritative counts, so we read it and
   * only fall back to the client-side computation if that call fails.
   */
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setOperationsLoading(true);
    setOperationsError('');
    api
      .get('/admin/analytics/dashboard', { params: { period } })
      .then((res) => {
        if (isMounted) {
          setMetrics(res.data || null);
          setOperations(res.data?.operations || null);
        }
      })
      .catch((err) => {
        console.warn('Admin: dashboard metrics unavailable, using local product list.', err);
        if (isMounted) {
          setMetrics(null);
          setOperations(null);
          setOperationsError(err.response?.data?.message || 'Unable to load order and sales metrics.');
        }
      })
      .finally(() => {
        if (isMounted) setOperationsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [period]);

  // Local fallbacks (used only until/unless the endpoint answers).
  const localStock = useMemo(
    () => products.reduce((acc, p) => acc + Number(p.stock || 0), 0),
    [products]
  );
  const localLowStock = useMemo(
    () => products.filter((p) => Number(p.stock || 0) < 5).length,
    [products]
  );

  const totalProducts = metrics?.total_products ?? products.length;
  const totalInventoryStock = metrics?.total_inventory ?? localStock;
  const lowStockItemsCount = metrics?.low_stock_count ?? localLowStock;

  const categoryStats = useMemo(() => {
    const colors = ['#CB997E', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#FFE8D6'];

    // Prefer the server's distribution; otherwise derive it from the list.
    const distribution = metrics?.category_distribution;
    let entries;
    if (distribution && typeof distribution === 'object') {
      entries = Object.entries(distribution);
    } else {
      const stats = {};
      products.forEach((p) => {
        const cat = p.category?.trim() || 'Uncategorized';
        stats[cat] = (stats[cat] || 0) + 1;
      });
      entries = Object.entries(stats);
    }

    const grandTotal = entries.reduce((sum, [, count]) => sum + count, 0) || 1;

    return entries.map(([category, count], index) => ({
      category,
      count,
      percentage: ((count / grandTotal) * 100).toFixed(1),
      color: colors[index % colors.length],
    }));
  }, [metrics, products]);

  const conicGradientString = useMemo(() => {
    if (categoryStats.length === 0) return '#1a1a1a';

    let currentDeg = 0;
    const total = categoryStats.reduce((sum, stat) => sum + stat.count, 0) || 1;
    const gradients = categoryStats.map((stat) => {
      const deg = (stat.count / total) * 360;
      const start = currentDeg;
      currentDeg += deg;
      return `${stat.color} ${start}deg ${currentDeg}deg`;
    });
    return `conic-gradient(${gradients.join(', ')})`;
  }, [categoryStats]);

  /*
   * REAL "TRENDING" — ranked by actual customer engagement
   * (canvas drags + try-on uses), not by the order the catalog happens to be in.
   * The counters come from the product rows; ties keep catalog order.
   */
  const trendingGarments = useMemo(() => {
    const score = (p) => Number(p.canvas_drag_count || 0) + Number(p.try_on_count || 0);
    return [...products].sort((a, b) => score(b) - score(a)).slice(0, 4);
  }, [products]);

  return (
    <div className="space-y-8 pb-12">
      <section className="space-y-4 rounded-2xl border border-[#CB997E]/20 bg-[#0A0D14] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-hiraya-ink">Operations Snapshot</h2>
            <p className="mt-1 text-[10px] text-hiraya-olive">Revenue follows verified payments; outstanding excludes rejected orders.</p>
          </div>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-hiraya-olive">
            Period
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="rounded-lg border border-hiraya-olive/20 bg-[#07090D] px-3 py-2 text-xs text-hiraya-ink outline-none focus:border-[#CB997E]"
            >
              <option value="day">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </label>
        </div>

        {operationsError && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{operationsError}</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { label: 'Verified Revenue', value: `₱${Number(operations?.revenue || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, note: `${operations?.period_order_count ?? 0} orders in period`, color: 'text-emerald-400' },
            { label: 'Outstanding Balance', value: `₱${Number(operations?.outstanding_balance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, note: 'Unpaid order amounts', color: 'text-hiraya-ink' },
            { label: 'Awaiting Down Payment', value: operations?.awaiting_dp_count ?? 0, note: 'Orders needing payment review', color: 'text-amber-300' },
            { label: 'Processing', value: operations?.processing_count ?? 0, note: 'Orders being prepared', color: 'text-blue-400' },
            { label: 'Ready / Shipped', value: operations?.shipping_count ?? 0, note: 'Orders in shipping stages', color: 'text-violet-400' },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-hiraya-olive/15 bg-black/20 p-4" aria-busy={operationsLoading}>
              <p className="text-[9px] font-mono uppercase tracking-widest text-hiraya-olive">{metric.label}</p>
              <p className={`mt-2 text-2xl font-mono font-bold ${metric.color}`}>
                {operationsLoading ? '—' : metric.value}
              </p>
              <p className="mt-1 text-[10px] text-hiraya-olive">{metric.note}</p>
            </div>
          ))}
        </div>
      </section>

      <DashboardMetrics
        totalProducts={totalProducts}
        totalInventoryStock={totalInventoryStock}
        categoryCount={categoryStats.length}
        lowStockItemsCount={lowStockItemsCount}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6">
          <CategoryDistributionChart 
            categoryStats={categoryStats}
            totalProducts={totalProducts}
            conicGradientString={conicGradientString}
          />
        </div>
        <div className="lg:col-span-6">
          <TrendingGarmentsList 
            trendingGarments={trendingGarments}
          />
        </div>
      </div>
    </div>
  );
};

export default DashboardTab;