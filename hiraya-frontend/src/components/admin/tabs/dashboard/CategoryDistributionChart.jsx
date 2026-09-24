import React from 'react';
import { PieChart as PieIcon } from 'lucide-react';

const CategoryDistributionChart = ({ categoryStats, totalProducts, conicGradientString }) => {
  return (
    <div className="bg-[#0A0D14] border border-white/10 rounded-xl p-6 space-y-6 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <PieIcon size={16} className="text-[#E9C46A]" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-[#E9C46A] font-bold">
              Category Distribution Analysis
            </h3>
          </div>
          <span className="text-[10px] font-mono text-gray-400">Pie Graph Report</span>
        </div>
        <p className="text-xs font-mono text-gray-400 mt-2">
          Visual breakdown representing the percentage allocation of garments per apparel category.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-8 py-4">
        {/* CSS Conic Pie Chart */}
        <div 
          className="w-40 h-40 rounded-full border-4 border-white/10 shadow-2xl relative flex-shrink-0"
          style={{ background: conicGradientString }}
        >
          <div className="absolute inset-6 bg-[#0A0D14] rounded-full flex flex-col items-center justify-center text-center">
            <span className="text-[10px] font-mono text-gray-400 uppercase">Total</span>
            <span className="text-lg font-mono font-bold text-white">{totalProducts}</span>
          </div>
        </div>

        {/* Legend / Breakdown */}
        <div className="space-y-2 flex-1 w-full max-w-xs">
          {categoryStats.map((item) => (
            <div key={item.category} className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-gray-300 truncate max-w-[120px]">{item.category}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400">
                <span>{item.count} items</span>
                <span className="font-bold text-white">({item.percentage}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Admin Analytical Explanation */}
      <div className="bg-white/5 border border-white/5 rounded-lg p-3 text-[11px] font-mono text-gray-300">
        <span className="text-[#E9C46A] font-bold">Admin Report Insight:</span> The distribution indicates heavy concentration in primary wear classifications. Monitor category balance to ensure diversified stock options for users.
      </div>
    </div>
  );
};

export default CategoryDistributionChart;