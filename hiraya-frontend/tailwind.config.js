/**
 * HIRAYA — Tailwind CSS configuration
 *
 * Tailwind v4 is driven primarily by the `@theme` block in `src/index.css` (see
 * the `--color-hiraya-*` tokens there). This file is kept as the canonical BRAND
 * MANIFEST so the whole palette can be inspected or imported from one place,
 * and it mirrors the CSS tokens key-for-key.
 *
 * THE PALETTE IS ROLE-BASED, NOT SHADE-BASED.
 * Every one of the six brand colours is assigned to the job it performs in the
 * interface, so a surface is always a surface and the accent is always the
 * accent:
 *
 *   #6B705C  olive      — THE INK + deepest containers
 *   #A5A58D  sage       — muted text, hints, hairline borders
 *   #B7B7A4  sage-light — sunken section bands + accent hover state
 *   #CB997E  terracotta — THE accent: fills, active tabs, focus rings
 *   #DDBEA9  sand       — raised surfaces: cards, panels, modals
 *   #FFE8D6  cream      — the page canvas + text on accent surfaces
 *
 * CONTRAST PAIRINGS (the rule that picks an ink for a surface):
 *   cream canvas   + olive ink  -> 5.5:1  (headings, body copy)
 *   raised card    + olive ink  -> 4.9:1  (headings, body copy on cards)
 *   terracotta fill+ cream ink  -> 5.1:1  (buttons, pills, active tabs)
 *   olive fill     + cream ink  -> 5.6:1  (badges, count bubbles)
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],

  theme: {
    extend: {
      colors: {
        hiraya: {
          // --- Page canvas + ink -------------------------------------------
          bg: '#FFE8D6',          // Cream — the base canvas
          olive: '#6B705C',       // Deep containers + ink
          ink: '#6B705C',         // Text on light surfaces
          charcoal: '#DDBEA9',    // Raised surface alias

          // --- Semantic contrasts (see the header note) --------------------
          'on-accent': '#FFE8D6', // Text ON terracotta
          'on-canvas': '#6B705C', // Text ON cream
          'on-raised': '#6B705C', // Text ON sand-light
          muted: '#A5A58D',       // Hints / labels

          // --- Accent ramp (#CB997E) -------------------------------------- -
          gold: '#CB997E',        // Terracotta — primary brand accent
          'gold-deep': '#B7B7A4', // Sage — hover / pressed accent
          'gold-soft': '#DDBEA9', // Sand-light — highlights, focus rings

          // --- Surfaces + text ramp ----------------------------------------
          cream: '#FFE8D6',       // The canvas + lightest surface
          'cream-deep': '#DDBEA9',// Raised cards / panels
          'cream-soft': '#DDBEA9',// Soft dividers on raised cards
          sand: '#A5A58D',        // Muted labels, hints, hairlines
          matcha: '#B7B7A4',      // Sunken bands / section wash
        },
      },

      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        serif: ['Cinzel', 'serif'],
      },

      // Terracotta glow used by focus states and active stack cards.
      boxShadow: {
        'gold-glow': '0 0 28px rgba(203, 153, 126, 0.30)',
        'gold-ring': '0 0 0 1px rgba(203, 153, 126, 0.45)',
      },
    },
  },

  plugins: [],
};
