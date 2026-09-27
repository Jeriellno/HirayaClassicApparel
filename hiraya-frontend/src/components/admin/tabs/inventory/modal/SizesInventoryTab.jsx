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
    <div className="p-4 sm:p-5 bg-white/[0.04] border border-hiraya-olive/15 rounded-xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b border-hiraya-olive/15 pb-3">
        <div>
          <span className="block text-[10px] uppercase text-hiraya-ink font-bold tracking-wider">
            Size Inventory & Measurements
          </span>
          <span className="text-[9px] text-hiraya-sand uppercase">
            {gender} {category.replace(/_/g, ' ').toLowerCase()} · body measurements in centimeters
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          {activeSizesCount > 0 && (
            <button
              type="button"
              onClick={() => onAutoFillDefaults()}
              title="Fill the checked sizes with the recommended measurements"
              className="px-2.5 py-1.5 rounded-md border border-[#CB997E]/40 bg-[#CB997E]/10 text-[9px] uppercase font-bold text-hiraya-ink hover:bg-[#CB997E]/20 hover:text-hiraya-ink flex items-center gap-1"
            >
              <RefreshCw size={10} /> Fill Checked Sizes
            </button>
          )}
          <span className="text-[10px] text-hiraya-ink">
            {activeSizesCount} of {sizeVariants.length} sizes selected · Total Stock: <strong className="text-hiraya-ink">{totalStock}</strong>
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-hiraya-olive/15 bg-hiraya-cream/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-hiraya-ink">Select available sizes</span>
          <span className="text-[9px] text-hiraya-sand">Click a size to add or remove it</span>
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
                  ? 'bg-[#CB997E] border-[#CB997E] text-hiraya-olive shadow-sm'
                  : 'bg-hiraya-cream/30 border-hiraya-olive/20 text-hiraya-ink hover:border-hiraya-olive/60 hover:text-hiraya-ink'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${
                  isConfigured ? 'border-hiraya-olive/40 bg-hiraya-cream/60' : 'border-hiraya-olive/30'
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
              <div key={sz} className="border border-hiraya-olive/15 rounded-lg p-3 sm:p-4 bg-hiraya-cream/20">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                  <span className="text-[10px] font-mono uppercase text-hiraya-ink font-bold">
                    Size {sz}
                  </span>
                  <div className="flex items-center justify-between sm:justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => onResetSizeDefaults(sz)}
                      title={`Reset ${sz} measurements to ${gender} ${category.toLowerCase()} defaults`}
                      className="text-[8px] text-hiraya-ink hover:text-hiraya-ink uppercase underline flex items-center gap-1"
                    >
                      <RefreshCw size={9} /> Reset Measurements
                    </button>
                    <div className="flex items-center gap-2">
                      <label className="text-[8px] text-hiraya-sand uppercase">Stock Qty</label>
                      <input
                        type="number"
                        min="0"
                        value={selectedSizes[sz].stock > 0 ? selectedSizes[sz].stock : ''}
                        placeholder="0"
                        onChange={(e) => onStockChange(sz, e.target.value)}
                        className="w-20 px-2 py-1 bg-hiraya-cream/40 border border-hiraya-olive/15 rounded text-xs font-mono text-hiraya-ink text-center tabular-nums focus:outline-none focus:border-[#CB997E]"
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
        <div className="rounded-lg border border-dashed border-hiraya-olive/20 bg-hiraya-cream/60 px-4 py-5 text-center">
          <p className="text-sm font-medium text-hiraya-ink">No sizes selected yet</p>
          <p className="mt-1 text-[10px] text-hiraya-sand">Choose one or more size buttons above to add stock and measurements.</p>
        </div>
      )}
    </div>
  );
};

export default SizesInventoryTab;