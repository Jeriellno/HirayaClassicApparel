import { Sparkles } from 'lucide-react';
import { Field } from './Field';

// 5 Core Standardized Body Measurements (identical for Men & Women)
export const CORE_MEASUREMENT_FIELDS = [
    { key: 'chest_bust',     label: 'Chest / Bust' },
    { key: 'waist',          label: 'Waist' },
    { key: 'hips',           label: 'Hips' },
    { key: 'shoulder_width', label: 'Shoulder Width' },
    { key: 'sleeve_length',  label: 'Sleeve Length' },
];

export const VirtualTryOnSection = ({ formData, handleChange }) => (
  <section className="space-y-4 rounded-2xl border border-hiraya-olive/15 bg-[#121620] p-6 shadow-xl">
    <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-hiraya-ink">
      <Sparkles size={16} /> 5 Core Body Measurements
    </h2>
    <p className="text-[10px] text-hiraya-ink">
      All measurements in centimeters. These five fields are the standardized
      profile used by the AI Virtual Try-On engine.
    </p>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {CORE_MEASUREMENT_FIELDS.map(({ key, label }) => (
        <Field key={key} label={`${label} (cm)`}>
          <input
            type="number"
            step="0.1"
            name={key}
            value={formData[key] ?? ''}
            onChange={handleChange}
            placeholder="0"
            className="w-full rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/60 px-4 py-2.5 text-xs text-hiraya-ink focus:border-[#CB997E] focus:outline-none transition"
          />
        </Field>
      ))}
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 pt-2 border-t border-hiraya-olive/15">
      <Field label="Top Size">
        <select
          name="topSize"
          value={formData.topSize}
          onChange={handleChange}
          className="w-full rounded-xl border border-hiraya-olive/15 bg-[#181D2A] px-3 py-2.5 text-xs text-hiraya-ink focus:border-[#CB997E] focus:outline-none transition"
        >
          <option value="XS">Extra Small (XS)</option>
          <option value="S">Small (S)</option>
          <option value="M">Medium (M)</option>
          <option value="L">Large (L)</option>
          <option value="XL">Extra Large (XL)</option>
        </select>
      </Field>

      <Field label="Waist Size (Inches)">
        <input
          type="number"
          name="bottomSize"
          value={formData.bottomSize}
          onChange={handleChange}
          className="w-full rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/60 px-4 py-2.5 text-xs text-hiraya-ink focus:border-[#CB997E] focus:outline-none transition"
        />
      </Field>

      <Field label="Fit Style">
        <select
          name="preferredFit"
          value={formData.preferredFit}
          onChange={handleChange}
          className="w-full rounded-xl border border-hiraya-olive/15 bg-[#181D2A] px-3 py-2.5 text-xs text-hiraya-ink focus:border-[#CB997E] focus:outline-none transition"
        >
          <option value="slim">Slim / Fitted</option>
          <option value="regular">Regular</option>
          <option value="oversized">Oversized / Loose</option>
        </select>
      </Field>
    </div>
  </section>
);
