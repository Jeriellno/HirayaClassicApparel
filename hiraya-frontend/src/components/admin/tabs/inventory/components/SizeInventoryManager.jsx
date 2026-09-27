import React from 'react';
import { Check, Layers } from 'lucide-react';
import { SizeMeasurementPanel } from '../modal/forms/MeasurementFields';

const SizeInventoryManager = ({
  AVAILABLE_SIZES = [],
  currentSizesObj = {},
  calculatedStock = 0,
  configuredSizeCount = 0,
  allSizesSelected = false,
  bulkStock = '',
  setBulkStock,
  handleToggleSize,
  handleSizeStockChange,
  handleMeasurementChange,
  handleApplyBulkStock,
  handleToggleAllSizes,
  handleClearBulkStock,
}) => {
  return (
    <div className="p-4 bg-white/[0.03] border border-hiraya-olive/15 rounded-xl space-y-4">
      {/* Header & Select All Option */}
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-hiraya-ink uppercase tracking-wider font-semibold">
            <Layers size={15} />
            Size-Specific Inventory Stock
          </div>
          <p className="text-[11px] text-hiraya-ink mt-0.5">Piliin ang mga sukat (sizes) kung saan available ang damit na ito.</p>
        </div>
        <button
          type="button"
          onClick={handleToggleAllSizes}
          className="text-[11px] font-mono text-hiraya-ink bg-hiraya-cream/60 px-2.5 py-1.5 rounded-md hover:bg-white/20 transition whitespace-nowrap cursor-pointer font-medium"
        >
          {allSizesSelected ? 'Unselect All' : 'Select All'}
        </button>
      </div>

      {/* Bulk Stock Quick Updater */}
      <div className="p-3.5 bg-hiraya-cream/30 border border-[#CB997E]/20 rounded-lg space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-hiraya-ink mb-1 font-medium">
              Quick Stock Assignment
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={bulkStock}
              onChange={(e) => setBulkStock(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleApplyBulkStock();
                }
              }}
              placeholder="Ilagay ang dami ng stock (e.g. 50)"
              className="w-full px-3 py-2 bg-hiraya-cream/40 border border-hiraya-olive/20 rounded-lg text-xs font-mono text-hiraya-ink placeholder-gray-500 focus:outline-none focus:border-[#CB997E]"
            />
          </div>
          <button
            type="button"
            onClick={handleApplyBulkStock}
            disabled={
              bulkStock === '' ||
              Number.isNaN(Number(bulkStock)) ||
              Number(bulkStock) < 0
            }
            className="px-4 py-2 bg-[#CB997E] hover:bg-hiraya-cream-deep disabled:bg-hiraya-cream/60 disabled:text-hiraya-sand disabled:cursor-not-allowed text-hiraya-olive text-[10px] font-mono font-bold uppercase rounded-lg transition whitespace-nowrap cursor-pointer shadow-sm"
          >
            Apply to Checked Sizes
          </button>
          {bulkStock !== '' && (
            <button
              type="button"
              onClick={handleClearBulkStock}
              className="px-3 py-2 bg-hiraya-cream/60 hover:bg-hiraya-cream/60 border border-hiraya-olive/15 text-hiraya-ink hover:text-hiraya-ink text-[10px] font-mono uppercase rounded-lg transition cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-[10px] font-mono text-hiraya-ink">
          Ilalapat ang dami sa mga napiling sukat (o sa lahat ng sukat kung walang naka-check).
        </p>

        {bulkStock !== '' && configuredSizeCount === 0 && (
          <p className="text-[10px] font-mono text-red-400 font-medium">⚠️ Pumili muna ng kahit isang sukat sa ibaba.</p>
        )}
      </div>

      {/* Sizes Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {AVAILABLE_SIZES.map((size) => {
          const isConfigured = Object.prototype.hasOwnProperty.call(currentSizesObj, size);
          const szData = isConfigured ? currentSizesObj[size] : { stock: 0, measurements: {} };
          const stockQty = typeof szData === 'object' ? (szData.stock || 0) : (szData || 0);
          const isOutOfStock = isConfigured && Number(stockQty) === 0;

          return (
            <div
              key={size}
              className={`rounded-lg border transition-all ${
                isConfigured
                  ? isOutOfStock
                    ? 'bg-red-500/5 border-red-500/40 shadow-sm'
                    : 'bg-[#CB997E]/10 border-[#CB997E] shadow-sm'
                  : 'bg-hiraya-cream/30 border-hiraya-olive/15 opacity-75 hover:opacity-100'
              }`}
            >
              <button
                type="button"
                onClick={() => handleToggleSize(size)}
                className="w-full p-2.5 flex items-center justify-between gap-2 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                      isConfigured
                        ? 'bg-[#CB997E] border-[#CB997E]'
                        : 'bg-hiraya-cream/40 border-hiraya-olive/30'
                    }`}
                  >
                    {isConfigured && <Check size={11} className="text-hiraya-olive" strokeWidth={3} />}
                  </span>
                  <span className="text-xs font-mono font-bold text-hiraya-ink">{size}</span>
                </div>
                <span
                  className={`text-[9px] font-mono uppercase tracking-wider font-medium ${
                    isConfigured
                      ? isOutOfStock
                        ? 'text-red-400'
                        : 'text-hiraya-ink'
                      : 'text-hiraya-sand'
                  }`}
                >
                  {isConfigured ? (isOutOfStock ? 'Out of Stock' : 'Active') : 'Disabled'}
                </span>
              </button>

              {isConfigured && (
                <div className="px-3 pb-3 pt-1 border-t border-hiraya-olive/15 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-hiraya-ink">Stock Qty:</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={stockQty}
                      onChange={(e) => handleSizeStockChange(size, e.target.value)}
                      className="w-full px-2.5 py-1 bg-hiraya-cream/50 border border-hiraya-olive/20 rounded text-xs font-mono text-hiraya-ink focus:outline-none focus:border-[#CB997E]"
                    />
                  </div>
                  <SizeMeasurementPanel
                    sizeKey={size}
                    sizeData={szData}
                    onChange={handleMeasurementChange}
                  />
                  {isOutOfStock && (
                    <span className="block text-[9px] font-mono uppercase text-red-400 font-semibold">⚠️ Walang stock sa sukat na ito</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary Footer */}
      <div className="flex justify-between items-center pt-3 border-t border-hiraya-olive/15 px-1">
        <div>
          <span className="block text-[10px] font-mono uppercase tracking-wider text-hiraya-ink">Selected Sizes</span>
          <span className="text-xs font-mono text-hiraya-ink font-medium">{configuredSizeCount} of {AVAILABLE_SIZES.length} Active</span>
        </div>
        <div className="text-right">
          <span className="block text-[10px] font-mono uppercase tracking-wider text-hiraya-ink">Total Combined Stock</span>
          <span className="text-sm font-mono font-bold text-hiraya-ink">{calculatedStock} pcs</span>
        </div>
      </div>
    </div>
  );
};

export default SizeInventoryManager;