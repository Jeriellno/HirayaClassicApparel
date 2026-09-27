import React from 'react';

export const GARMENT_CATEGORIES = {
  TOPS: ['chest_bust', 'shoulder_width', 'sleeve_length', 'top_length'],
  BOTTOMS: ['waist', 'hips'],
  DRESSES: ['chest_bust', 'waist', 'hips', 'shoulder_width', 'top_length'],
  OUTERWEAR: ['chest_bust', 'shoulder_width', 'sleeve_length', 'top_length'],
  FORMAL_MEN: ['chest_bust', 'waist', 'shoulder_width', 'sleeve_length', 'top_length'],
  FORMAL_WOMEN: ['chest_bust', 'waist', 'hips', 'shoulder_width', 'top_length'],
  FULL_BODY: ['chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length', 'top_length'],
};

const MEN_TOPS = {
  XS: { chest_bust: 88, waist: 76, hips: 88, shoulder_width: 41, sleeve_length: 59, top_length: 66 },
  S: { chest_bust: 94, waist: 82, hips: 94, shoulder_width: 43, sleeve_length: 61, top_length: 68 },
  M: { chest_bust: 100, waist: 88, hips: 100, shoulder_width: 45, sleeve_length: 63, top_length: 70 },
  L: { chest_bust: 108, waist: 96, hips: 108, shoulder_width: 47, sleeve_length: 65, top_length: 72 },
  XL: { chest_bust: 116, waist: 104, hips: 116, shoulder_width: 49, sleeve_length: 67, top_length: 74 },
  '2XL': { chest_bust: 124, waist: 112, hips: 124, shoulder_width: 51, sleeve_length: 69, top_length: 76 },
};

const WOMEN_TOPS = {
  XS: { chest_bust: 82, waist: 64, hips: 88, shoulder_width: 37, sleeve_length: 57, top_length: 61 },
  S: { chest_bust: 88, waist: 70, hips: 94, shoulder_width: 39, sleeve_length: 59, top_length: 63 },
  M: { chest_bust: 94, waist: 76, hips: 100, shoulder_width: 41, sleeve_length: 61, top_length: 65 },
  L: { chest_bust: 102, waist: 84, hips: 108, shoulder_width: 43, sleeve_length: 63, top_length: 67 },
  XL: { chest_bust: 110, waist: 92, hips: 116, shoulder_width: 45, sleeve_length: 65, top_length: 69 },
  '2XL': { chest_bust: 118, waist: 100, hips: 124, shoulder_width: 47, sleeve_length: 67, top_length: 71 },
};

const UNISEX_TOPS = {
  XS: { chest_bust: 84, waist: 68, hips: 90, shoulder_width: 40, sleeve_length: 58, top_length: 65 },
  S: { chest_bust: 90, waist: 74, hips: 96, shoulder_width: 42, sleeve_length: 60, top_length: 67 },
  M: { chest_bust: 96, waist: 80, hips: 102, shoulder_width: 44, sleeve_length: 62, top_length: 69 },
  L: { chest_bust: 104, waist: 88, hips: 110, shoulder_width: 46, sleeve_length: 64, top_length: 71 },
  XL: { chest_bust: 112, waist: 96, hips: 118, shoulder_width: 48, sleeve_length: 66, top_length: 73 },
  '2XL': { chest_bust: 120, waist: 104, hips: 126, shoulder_width: 50, sleeve_length: 68, top_length: 75 },
};

const MEN_BOTTOMS = {
  XS: { waist: 70, hips: 86 }, S: { waist: 76, hips: 92 }, M: { waist: 82, hips: 98 },
  L: { waist: 90, hips: 106 }, XL: { waist: 98, hips: 114 }, '2XL': { waist: 106, hips: 122 },
};

const WOMEN_BOTTOMS = {
  XS: { waist: 62, hips: 88 }, S: { waist: 68, hips: 94 }, M: { waist: 74, hips: 100 },
  L: { waist: 82, hips: 108 }, XL: { waist: 90, hips: 116 }, '2XL': { waist: 98, hips: 124 },
};

const DRESSES = {
  XS: { chest_bust: 82, waist: 64, hips: 88, shoulder_width: 37, top_length: 90 },
  S: { chest_bust: 88, waist: 70, hips: 94, shoulder_width: 39, top_length: 92 },
  M: { chest_bust: 94, waist: 76, hips: 100, shoulder_width: 41, top_length: 94 },
  L: { chest_bust: 102, waist: 84, hips: 108, shoulder_width: 43, top_length: 96 },
  XL: { chest_bust: 110, waist: 92, hips: 116, shoulder_width: 45, top_length: 98 },
  '2XL': { chest_bust: 118, waist: 100, hips: 124, shoulder_width: 47, top_length: 100 },
};

export const DEFAULT_MEASUREMENTS = UNISEX_TOPS;

export const getDefaultMeasurements = (category = 'TOPS', gender = 'Unisex', sizeKey) => {
  const normalizedGender = String(gender).toLowerCase();
  let chart = UNISEX_TOPS;

  if (category === 'BOTTOMS') {
    chart = normalizedGender === 'women' ? WOMEN_BOTTOMS : MEN_BOTTOMS;
  } else if (category === 'DRESSES' || category === 'FORMAL_WOMEN') {
    chart = DRESSES;
  } else if (normalizedGender === 'women') {
    chart = WOMEN_TOPS;
  } else if (normalizedGender === 'men') {
    chart = MEN_TOPS;
  }

  return { ...(chart[sizeKey] || {}) };
};

const FIELD_LABELS = {
  chest_bust: 'Chest / Bust',
  waist: 'Waist',
  hips: 'Hips',
  shoulder_width: 'Shoulder Width',
  sleeve_length: 'Sleeve Length',
  top_length: 'Total Length',
};

export const SizeMeasurementPanel = ({ sizeKey, sizeData, category = 'TOPS', onChange }) => {
  const fieldsToRender = GARMENT_CATEGORIES[category] || GARMENT_CATEGORIES.TOPS;
  const measurements = sizeData?.measurements || {};

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2 border-t border-hiraya-olive/15">
      {fieldsToRender.map((field) => (
        <div key={field} className="flex flex-col gap-1">
          <label className="text-[9px] font-mono uppercase text-hiraya-ink">
            {FIELD_LABELS[field] || field.replace(/_/g, ' ')}
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="0.0"
            value={measurements[field] ?? ''}
            onChange={(e) => onChange(sizeKey, field, e.target.value)}
            className="w-full px-2 py-1 bg-hiraya-cream/30 border border-hiraya-olive/15 rounded text-xs font-mono text-hiraya-ink focus:outline-none focus:border-[#CB997E]"
          />
        </div>
      ))}
    </div>
  );
};