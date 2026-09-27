import React, { useState, useEffect } from 'react';
import { Ruler, Sparkles, Check, RefreshCw } from 'lucide-react';
import { DEFAULT_MEASUREMENTS } from './MeasurementFields';

/*
 * The per-size baselines come from MeasurementFields, which already owns the
 * garment baselines per category and gender. They used to be copied here as a
 * second `SIZE_BASELINES` table holding exactly the same six rows — the same
 * duplication that let the size chart drift in the first place.
 *
 * NOTE: these are GARMENT measurements (what the fabric measures), not the
 * body-measurement size chart served by /api/size-chart. The two are different
 * concerns and deliberately different numbers.
 */
const SIZE_BASELINES = DEFAULT_MEASUREMENTS;

export default function GarmentSizingForm({ initialData, onChange }) {
  const [selectedBase, setSelectedBase] = useState('XS');
  const [measurements, setMeasurements] = useState(
    initialData || SIZE_BASELINES.XS || {}
  );

  useEffect(() => {
    if (initialData) {
      setMeasurements(initialData);
    }
  }, [initialData]);

  // Load baseline values when selecting XS, S, M, L, XL, 2XL
  const handleSelectBaseline = (sizeKey) => {
    setSelectedBase(sizeKey);
    const updated = { ...(SIZE_BASELINES[sizeKey] || {}) };
    setMeasurements(updated);
    if (onChange) onChange(updated);
  };

  // Adjust individual core measurement values
  const handleValueChange = (field, value) => {
    const updated = { ...measurements, [field]: value === '' ? '' : Number(value) };
    setMeasurements(updated);
    if (onChange) onChange(updated);
  };

  const coreFields = [
    { key: 'chest_bust', label: 'Chest / Bust' },
    { key: 'waist', label: 'Waist' },
    { key: 'hips', label: 'Hips' },
    { key: 'shoulder_width', label: 'Shoulder Width' },
    { key: 'sleeve_length', label: 'Sleeve Length' },
  ];

  return (
    <div className="bg-[#121621] border border-hiraya-olive/15 rounded-xl p-5 text-hiraya-ink font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-hiraya-olive/15">
        <div className="flex items-center gap-2 text-hiraya-ink font-bold">
          <Ruler size={16} />
          <span className="uppercase tracking-wider">Garment Core Measurements (cm)</span>
        </div>
        <span className="text-[10px] bg-[#CB997E]/10 text-hiraya-ink px-2.5 py-0.5 rounded border border-[#CB997E]/30 font-bold">
          5 Core Base Specs
        </span>
      </div>

      {/* Step 1: Select Baseline Size */}
      <div className="mb-4">
        <label className="block text-hiraya-ink font-bold mb-2 text-[10px] uppercase tracking-wider">
          1. Select Base Size Reference:
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.keys(SIZE_BASELINES).map((sizeKey) => (
            <button
              key={sizeKey}
              type="button"
              onClick={() => handleSelectBaseline(sizeKey)}
              className={`py-2 rounded-lg text-xs font-bold transition border flex items-center justify-center gap-1 ${
                selectedBase === sizeKey
                  ? 'bg-[#CB997E] text-hiraya-olive border-[#CB997E] shadow-md'
                  : 'bg-hiraya-cream/60 border-hiraya-olive/15 text-hiraya-ink hover:bg-hiraya-cream/60'
              }`}
            >
              {sizeKey}
              {selectedBase === sizeKey && <Check size={12} />}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Set/Fine-Tune Core Measurements */}
      <div className="mb-2">
        <label className="block text-hiraya-ink font-bold mb-2 text-[10px] uppercase tracking-wider">
          2. Core Measurement Values (cm):
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {coreFields.map((field) => (
            <div key={field.key} className="bg-hiraya-cream/30 border border-hiraya-olive/15 p-3 rounded-lg">
              <label className="block text-[11px] font-bold text-hiraya-ink mb-1.5">
                {field.label}
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="0.0"
                  value={measurements[field.key] ?? ''}
                  onChange={(e) => handleValueChange(field.key, e.target.value)}
                  className="w-full bg-hiraya-cream/60 border border-hiraya-olive/15 rounded px-2.5 py-1.5 text-xs text-hiraya-ink font-bold focus:outline-none focus:border-[#CB997E] transition pr-8"
                  required
                />
                <span className="absolute right-2.5 text-[10px] font-bold text-hiraya-sand pointer-events-none">
                  cm
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}