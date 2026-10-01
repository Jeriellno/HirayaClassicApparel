import React from 'react';
import { Lock } from 'lucide-react';

/*
 * THE AI STYLIST NOTE.
 *
 * WHAT WAS WRONG
 * --------------
 * This box was `bg-hiraya-olive border-hiraya-olive/25 rounded-xl`.
 *
 *   - `olive` is now INDIGO, so the panel painted a full-strength dark slab in
 *     the middle of the light product page — it read as a selected state or an
 *     error announcement, not as a quiet editorial aside.
 *   - The border used the SAME token as the fill at 25%, so the edge was an
 *     invisible band around a dark block instead of a rule.
 *   - `rounded-xl` (12px) belonged to the previous design language; this system
 *     uses near-square `rounded-sm` plates.
 *
 * It is now a ruled vintage-white panel with a maroon rule down its left side —
 * the same "quoted passage" device a lookbook uses, which is exactly what this
 * box is: a short piece of authored copy attributed to the house.
 *
 * The pulse dot and the watermark glyph are kept; both are structural, and the
 * watermark is decorative, so it is marked aria-hidden.
 */
const StylistBox = ({ recommendation }) => {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-cream-50/80 bg-hiraya-surface-raised p-5 pl-6 shadow-neu-sm before:absolute before:inset-y-4 before:left-0 before:w-[3px] before:rounded-full before:bg-hiraya-accent">
      <div className="absolute right-0 top-0 p-3 opacity-[0.06] transition-transform group-hover:rotate-12">
        <Lock size={48} className="text-hiraya-ink" aria-hidden="true" />
      </div>

      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-hiraya-accent" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-accent">
          Hiraya AI Stylist
        </span>
      </div>

      <p className="relative z-10 text-[12.5px] font-normal italic leading-relaxed text-hiraya-ink">
        &ldquo;{recommendation}&rdquo;
      </p>
    </div>
  );
};

export default StylistBox;
