import React from 'react';
import Currency from './common/Currency';

/*
 * THE GENERIC GARMENT TILE.
 *
 * This is the pre-restyle card, kept because other surfaces still use it. It was
 * built entirely against the retired dark theme:
 *
 *   - `bg-[#121212]` / `bg-[#1a1a1a]` / `bg-[#141414]` — three near-blacks in no
 *     version of the palette — while the title and price were `text-hiraya-ink`,
 *     i.e. NAVY. Navy on near-black is ~1.1:1: the garment name and price were
 *     invisible on every tile.
 *   - The badge was `bg-hiraya-peach/60 text-hiraya-ink` — a pale chip with navy
 *     ink, fine on its own, but sitting on the black card it read as a hole.
 *   - `rounded-2xl` on the card, `rounded-full` on the badge and the two hover
 *     actions.
 *
 * It is now the same tile the shop uses: a light `.card` with the system
 * hairline, the catalog image on the obsidian well, and squared plates. The
 * `onTryOn` / `onWishlist` / `onClick` handlers and every prop are unchanged.
 */
export default function GarmentCard({
  image,
  title,
  category,
  price,
  badgeText = "GARMENT",
  onTryOn,
  onWishlist,
  onClick
}) {
  return (
    <div
      onClick={onClick}
      className="card group flex cursor-pointer flex-col overflow-hidden transition-all duration-300 hover:border-hiraya-accent/45"
    >
      {/* 1. Image Area & Top Badge */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-black">
        <img
          src={image || '/images/placeholder.svg'}
          alt={title}
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/images/placeholder.svg'; }}
          className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
        />

        {/* Category / Status Badge — a genuine tag, so it keeps the pill form. */}
        {badgeText && (
          <span className="absolute right-3 top-3 rounded-full border border-hiraya-nav-ink/20 bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-hiraya-nav-ink backdrop-blur-md">
            {badgeText}
          </span>
        )}

        {/* Hover Action Overlay Icons (Center) */}
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/55 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          {onTryOn && (
            <button
              onClick={(e) => { e.stopPropagation(); onTryOn(); }}
              className="cursor-pointer rounded-sm border border-hiraya-nav-ink/25 bg-hiraya-nav-ink/10 p-3 text-hiraya-nav-ink backdrop-blur-md transition-colors hover:border-hiraya-accent hover:bg-hiraya-accent hover:text-hiraya-on-accent"
              title="AI Try-On"
              aria-label="AI Try-On"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/>
              </svg>
            </button>
          )}
          {onWishlist && (
            <button
              onClick={(e) => { e.stopPropagation(); onWishlist(); }}
              className="cursor-pointer rounded-sm border border-hiraya-nav-ink/25 bg-hiraya-nav-ink/10 p-3 text-hiraya-nav-ink backdrop-blur-md transition-colors hover:border-hiraya-accent hover:bg-hiraya-accent hover:text-hiraya-on-accent"
              title="Add to Bag"
              aria-label="Add to Bag"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 2. Bottom Label / Details Section */}
      <div className="flex flex-1 flex-col justify-between border-t border-hiraya-structure-line bg-hiraya-surface p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
            {category || 'GARMENT'}
          </p>
          <h3 className="mt-1 line-clamp-1 text-sm font-semibold text-hiraya-ink transition-colors">
            {title}
          </h3>
        </div>

        {price !== undefined && (
          <div className="mt-3 flex items-center justify-between border-t border-hiraya-structure-line pt-3">
            <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">PRICE</span>
            {/* Currency pins a font stack that actually contains U+20B1, so the
                peso sign renders instead of falling back to a "?". */}
            <Currency
              amount={price}
              decimals={false}
              className="text-sm font-semibold tracking-wide text-hiraya-ink"
            />
          </div>
        )}
      </div>
    </div>
  );
}