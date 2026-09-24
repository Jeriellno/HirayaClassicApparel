import React from 'react';
import { Package, AlertTriangle, Layers, ShieldCheck } from 'lucide-react';

const DashboardMetrics = ({ totalProducts, totalInventoryStock, categoryCount, lowStockItemsCount }) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[#E9C46A] font-bold">
          Catalog Countings & Inventory Health
        </h3>
        <span className="text-[10px] font-mono text-gray-400">Updated in real-time</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0A0D14] border border-white/10 p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-widest">Total Garments</span>
            <Package size={16} className="text-[#E9C46A]" />
          </div>
          <p className="text-3xl font-mono font-bold text-white">{totalProducts}</p>
          <span className="text-[10px] font-mono text-gray-500">Total registered styles in database</span>
        </div>

        <div className="bg-[#0A0D14] border border-white/10 p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-widest">Total Stock Units</span>
            <ShieldCheck size={16} className="text-emerald-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-white">{totalInventoryStock}</p>
          <span className="text-[10px] font-mono text-gray-500">Aggregated stock across all sizes</span>
        </div>

        <div className="bg-[#0A0D14] border border-white/10 p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-widest">Active Categories</span>
            <Layers size={16} className="text-blue-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-white">{categoryCount}</p>
          <span className="text-[10px] font-mono text-gray-500">Distinct apparel classifications</span>
        </div>

        <div className="bg-[#0A0D14] border border-red-500/20 p-5 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-widest text-red-400">Low Stock Warnings</span>
            <AlertTriangle size={16} className="text-red-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-red-400">{lowStockItemsCount}</p>
          <span className="text-[10px] font-mono text-red-400/80">Items requiring immediate restocking</span>
        </div>
      </div>
    </div>
  );
};

export default DashboardMetrics;