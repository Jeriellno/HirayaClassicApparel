import React from 'react';
import { Check, Ban } from 'lucide-react';

/**
 * Maps a colour name to a real CSS colour so the swatch reads as an actual
 * swatch. Falls back to a neutral tone for unknown/unexpected labels.
 */
const COLOR_MAP = {
  black: '#1A1A1A',
  white: '#FFFFFF',
  cream: '#F5F0EB',
  ivory: '#FFFFF0',
  beige: '#E8DCC8',
  brown: '#6B4F3A',
  tan: '#C8A165',
  camel: '#C19A6B',
  khaki: '#BDB28A',
  gray: '#8A8A8A',
  grey: '#8A8A8A',
  charcoal: '#2D2D2D',
  navy: '#1F2A44',
  blue: '#3B5B8C',
  'sky blue': '#87CEEB',
  denim: '#4A6785',
  green: '#4B6E4F',
  olive: '#6B7250',
  sage: '#A8B5A0',
  mint: '#B7E4D0',
  red: '#A63A3A',
  maroon: '#6E2A2A',
  burgundy: '#6D1F35',
  pink: '#E5A8B8',
  blush: '#EFC9C9',
  rose: '#D8A0A6',
  purple: '#6B4C8A',
  lavender: '#C3B4D9',
  yellow: '#E0C060',
  mustard: '#D4A72C',
  orange: '#D2793E',
  rust: '#9C4A1F',
  gold: '#E9C46A',   // "gold" garment option now renders as luxury cream
  silver: '#C0C0C0',
};

/** Resolve a colour label to a CSS value we can actually paint. */
const resolveSwatchColor = (color) => {
  const key = String(color || '').trim().toLowerCase();
  if (COLOR_MAP[key]) return COLOR_MAP[key];
  // Also accept"Navy Blue" style labels by matching the first known token.
  const token = Object.keys(COLOR_MAP).find((name) => key.includes(name));
  return token ? COLOR_MAP[token] : '#D9D9D9';
};

/** True for very light colours, so we can draw a visible border + dark tick. */
const isLightColor = (hex) => {
  const value = hex.replace('#', '');
  if (value.length !== 6) return false;
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  // Perceived luminance (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 200;
};

/**
 * Colour selector rendered as clickable visual swatches.
 */
export const ColorSelector = ({ colors = [], selectedColor, onSelectColor }) => {
  if (!colors.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-zinc-400">
          Colour
        </p>
        <span className="text-[11px] font-medium text-stone-200 tracking-wide">
          {selectedColor || 'Select one'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {colors.map((color) => {
          const hex = resolveSwatchColor(color);
          const isSelected = selectedColor === color;
          const light = isLightColor(hex);

          return (
            <button
              key={color}
              type="button"
              onClick={() => onSelectColor(color)}
              title={color}
              aria-label={`Select colour ${color}`}
              aria-pressed={isSelected}
              className={`group relative h-8 w-8 rounded-full transition-all duration-300 flex items-center justify-center ${isSelected
                  ? 'ring-2 ring-stone-300 ring-offset-2 ring-offset-black scale-105'
                  : 'ring-1 ring-zinc-700 hover:ring-stone-300/60 hover:scale-105'
                }`}
            >
              <span
                className={`absolute inset-0 rounded-full ${light ? 'border border-zinc-600' : ''}`}
                style={{ backgroundColor: hex }}
              />
              {isSelected && (
                <Check
                  size={13}
                  strokeWidth={3}
                  className={`relative z-10 ${light ? 'text-zinc-950' : 'text-white'}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Size selector rendered as distinct buttons.
 *
 * `sizeStocks` maps a size to its available units; any size mapped to 0 (or
 * explicitly marked unavailable) is disabled and struck through so the
 * customer cannot select something we cannot ship.
 */
export const SizeSelector = ({ sizes = [], selectedSize, onSelectSize, sizeStocks = {} }) => {
  if (!sizes.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-zinc-400">
          Size
        </p>
        <span className="text-[11px] font-medium text-stone-200 tracking-wide">
          {selectedSize || 'Select one'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {sizes.map((size) => {
          const isSelected = selectedSize === size;
          const hasStockInfo = Object.prototype.hasOwnProperty.call(sizeStocks, size);
          // Only treat a size as sold out when we actually have stock data for it.
          const available = hasStockInfo ? Number(sizeStocks[size]) || 0 : null;
          const soldOut = available === 0;

          return (
            <button
              key={size}
              type="button"
              disabled={soldOut}
              onClick={() => !soldOut && onSelectSize(size)}
              aria-label={soldOut ? `Size ${size} is out of stock` : `Select size ${size}`}
              aria-pressed={isSelected}
              title={soldOut ? `${size} — Out of stock` : `Size ${size}`}
              className={`relative min-w-[2.75rem] h-11 px-3 rounded-lg flex items-center justify-center text-[12px] font-semibold transition-all duration-300 border ${soldOut
                  ? 'border-zinc-900 bg-zinc-950 text-zinc-700 cursor-not-allowed'
                  : isSelected
                    ? 'bg-[#E9C46A] text-black border-stone-300'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-stone-300/70 hover:text-stone-200'
                }`}
            >
              <span className={soldOut ? 'line-through' : ''}>{size}</span>

              {soldOut && (
                <Ban size={10} className="absolute -top-1 -right-1 text-zinc-600" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
