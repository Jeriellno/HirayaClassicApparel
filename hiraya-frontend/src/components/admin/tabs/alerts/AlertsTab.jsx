// hiraya-frontend/src/components/admin/tabs/alerts/AlertsTab.jsx
import React from 'react';
import AlertItem from './AlertItem';

const AlertsTab = ({ products = [], defaultImageUrl }) => {
  // Filter and sort low stock products
  const lowStockProducts = products
    .filter((p) => (p.stock || 0) < 5)
    .sort((a, b) => (a.stock || 0) - (b.stock || 0));

  const totalAlerts = lowStockProducts.length;

  return (
    <div className="bg-[#0D1017] p-6 rounded-lg border border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Stock Alerts</h3>
          <p className="text-xs text-gray-400 mt-1">
            {totalAlerts > 0 
              ? `${totalAlerts} items need attention` 
              : 'All stock levels are healthy'}
          </p>
        </div>
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
          <p className="text-sm text-gray-500">All inventory levels are healthy</p>
          <p className="text-xs text-gray-600 mt-1">No products below threshold</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lowStockProducts.map((product) => (
            <AlertItem 
              key={product.id} 
              product={product} 
              defaultImageUrl={defaultImageUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AlertsTab;