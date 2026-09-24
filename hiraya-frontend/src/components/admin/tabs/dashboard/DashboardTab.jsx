import React, { useMemo, useEffect, useState } from 'react';
import api from '../../../../api/axios';
import DashboardMetrics from './DashboardMetrics';
import CategoryDistributionChart from './CategoryDistributionChart';
import TrendingGarmentsList from './TrendingGarmentsList';

const DashboardTab = ({ products = [] }) => {
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
    api
      .get('/admin/analytics/dashboard')
      .then((res) => {
        if (isMounted) setMetrics(res.data || null);
      })
      .catch((err) => {
        console.warn('Admin: dashboard metrics unavailable, using local product list.', err);
        if (isMounted) setMetrics(null);
      });
    return () => {
      isMounted = false;
    };
  }, []);

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
    const colors = ['#E9C46A', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F2D89B'];

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