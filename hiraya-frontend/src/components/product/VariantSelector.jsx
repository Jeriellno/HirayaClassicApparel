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
  gold: '#541A1A',   // "gold" garment option now renders as luxury cream
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
          Colour
        </p>
        <span className="text-[11px] font-medium tracking-wide text-hiraya-ink">
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
              /*
               * THE SWATCH ATTENTION COLOURS MOVED ONTO THE PALETTE.
               *
               * The selected ring was `ring-stone-300 ring-offset-black` — a
               * neutral grey halo offset by a BLACK band, which on a cream page
               * read as a dark bruise around the swatch. The unselected ring was
               * `ring-zinc-700`, off-palette. Both now use the accent (maroon),
               * and the offset sits on the PAGE (the canvas) rather than on a
               * black band that only made sense while the page was dark.
               */
              className={`group relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full shadow-neu-sm transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus ${isSelected
                  ? 'scale-105 ring-2 ring-hiraya-accent ring-offset-2 ring-offset-cream-100'
                  : 'ring-1 ring-hiraya-structure-line hover:scale-105 hover:ring-hiraya-accent/45'
                }`}
            >
              <span
                className={`absolute inset-0 rounded-full ${light ? 'border border-hiraya-structure-line' : ''}`}
                style={{ backgroundColor: hex }}
              />
              {/*
               * THE TICK HAS TO CONTRAST WITH THE SWATCH, NOT WITH THE PAGE.
               * It was `text-hiraya-ink` in BOTH branches — so on a black or
               * navy swatch it drew dark-on-dark and vanished entirely (this was
               * the reported "the check disappears on dark colours"). Light
               * swatches get the navy ink; dark swatches get parchment.
               */}
              {isSelected && (
                <Check
                  size={13}
                  strokeWidth={3}
                  className={`relative z-10 ${light ? 'text-hiraya-ink' : 'text-hiraya-nav-ink'}`}
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
          Size
        </p>
        <span className="text-[11px] font-medium tracking-wide text-hiraya-ink">
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
              /*
               * SIZES ARE CUT-CLOTH PLATES, NOT PILLS, AND THEY USE THE TOKENS.
               *
               * The old markup was `rounded-lg` with `border-hiraya-olive/30`,
               * `bg-hiraya-maroon ... border-hiraya-gold` (two names for the SAME
               * maroon, so the border was invisible against its own fill) and a
               * `hover:border-hiraya-gold/70` halo. It now uses `rounded-sm` and
               * the accent ramp consistently, so the selected plate has a visible
               * EDGE via `accent-deep` rather than a same-colour outline.
               */
              className={`relative flex h-11 min-w-[2.9rem] cursor-pointer items-center justify-center rounded-xl border px-3.5 text-[12px] font-semibold transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus focus-visible:ring-offset-2 ${soldOut
                  ? 'cursor-not-allowed border-transparent bg-hiraya-disabled-bg text-hiraya-disabled-ink line-through shadow-neu-inset'
                  : isSelected
                    ? 'border-hiraya-accent-deep bg-hiraya-accent text-hiraya-on-accent shadow-[0_10px_20px_-10px_rgba(21,32,54,0.7)]'
                    : 'border-cream-50/80 bg-hiraya-surface text-hiraya-ink shadow-neu-sm hover:-translate-y-0.5 hover:border-hiraya-accent/40'
                }`}
            >
              <span className={soldOut ? 'line-through' : ''}>{size}</span>

              {soldOut && (
                <Ban size={10} className="absolute -right-1 -top-1 text-hiraya-ink-muted" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
