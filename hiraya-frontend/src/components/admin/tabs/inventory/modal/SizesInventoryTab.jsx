import React from 'react';
import { RefreshCw } from 'lucide-react';
import { SizeMeasurementPanel } from './forms/MeasurementFields';

const SizesInventoryTab = ({
  category,
  gender,
  sizeVariants,
  selectedSizes,
  totalStock,
  onSizeToggle,
  onAutoFillDefaults,
  onResetSizeDefaults,
  onStockChange,
  onMeasurementChange,
}) => {
  const activeSizesCount = sizeVariants.filter((sz) => selectedSizes[sz] && selectedSizes[sz].active !== false).length;

  return (
    <div className="p-4 sm:p-5 bg-white/[0.04] border border-white/10 rounded-xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b border-white/10 pb-3">
        <div>
          <span className="block text-[10px] uppercase text-[#E9C46A] font-bold tracking-wider">
            Size Inventory & Measurements
          </span>
          <span className="text-[9px] text-gray-500 uppercase">
            {gender} {category.replace(/_/g, ' ').toLowerCase()} · body measurements in centimeters
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          {activeSizesCount > 0 && (
            <button
              type="button"
              onClick={() => onAutoFillDefaults()}
              title="Fill the checked sizes with the recommended measurements"
              className="px-2.5 py-1.5 rounded-md border border-[#E9C46A]/40 bg-[#E9C46A]/10 text-[9px] uppercase font-bold text-[#E9C46A] hover:bg-[#E9C46A]/20 hover:text-white flex items-center gap-1"
            >
              <RefreshCw size={10} /> Fill Checked Sizes
            </button>
          )}
          <span className="text-[10px] text-gray-400">
            {activeSizesCount} of {sizeVariants.length} sizes selected · Total Stock: <strong className="text-white">{totalStock}</strong>
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-300">Select available sizes</span>
          <span className="text-[9px] text-gray-500">Click a size to add or remove it</span>
        </div>
        <div className="flex flex-wrap gap-2.5">
        {sizeVariants.map((sz) => {
          const isConfigured = Boolean(selectedSizes[sz] && selectedSizes[sz].active !== false);
          return (
            <button
              key={sz}
              type="button"
              onClick={() => onSizeToggle(sz)}
              aria-pressed={isConfigured}
              className={`min-w-[4.5rem] px-3 py-2 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                isConfigured
                  ? 'bg-[#E9C46A] border-[#E9C46A] text-black shadow-sm'
                  : 'bg-black/40 border-white/15 text-gray-400 hover:border-white/40 hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${
                  isConfigured ? 'border-black/40 bg-black/10' : 'border-white/30'
                }`}>{isConfigured ? '✓' : ''}</span>
                {sz}
              </span>
            </button>
          );
        })}
        </div>
      </div>

      {activeSizesCount > 0 ? (
        <div className="space-y-3">
          {sizeVariants
            .filter((sz) => selectedSizes[sz] && selectedSizes[sz].active !== false)
            .map((sz) => (
              <div key={sz} className="border border-white/10 rounded-lg p-3 sm:p-4 bg-black/20">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                  <span className="text-[10px] font-mono uppercase text-[#E9C46A] font-bold">
                    Size {sz}
                  </span>
                  <div className="flex items-center justify-between sm:justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => onResetSizeDefaults(sz)}
                      title={`Reset ${sz} measurements to ${gender} ${category.toLowerCase()} defaults`}
                      className="text-[8px] text-gray-400 hover:text-[#E9C46A] uppercase underline flex items-center gap-1"
                    >
                      <RefreshCw size={9} /> Reset Measurements
                    </button>
                    <div className="flex items-center gap-2">
                      <label className="text-[8px] text-gray-500 uppercase">Stock Qty</label>
                      <input
                        type="number"
                        min="0"
                        value={selectedSizes[sz].stock > 0 ? selectedSizes[sz].stock : ''}
                        placeholder="0"
                        onChange={(e) => onStockChange(sz, e.target.value)}
                        className="w-20 px-2 py-1 bg-black/50 border border-white/10 rounded text-xs font-mono text-white text-center tabular-nums focus:outline-none focus:border-[#E9C46A]"
                      />
                    </div>
                  </div>
                </div>
                <SizeMeasurementPanel
                  sizeKey={sz}
                  sizeData={selectedSizes[sz]}
                  category={category}
                  onChange={onMeasurementChange}
                />
              </div>
            ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/15 bg-black/10 px-4 py-5 text-center">
          <p className="text-sm font-medium text-gray-300">No sizes selected yet</p>
          <p className="mt-1 text-[10px] text-gray-500">Choose one or more size buttons above to add stock and measurements.</p>
        </div>
      )}
    </div>
  );
};

export default SizesInventoryTab;