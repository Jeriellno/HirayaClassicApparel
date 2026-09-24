/**
 * HIRAYA — Tailwind CSS configuration
 *
 * Tailwind v4 is driven primarily by the `@theme` block in `src/index.css`
 * (see the `--color-hiraya-*` design tokens there). This config file is kept as
 * the single, canonical BRAND MANIFEST so the palette can be inspected/imported
 * from one place, and it mirrors the CSS tokens key-for-key.
 *
 * BRAND STANDARD — `#E9C46A` is the official primary accent, and the warm
 * IVORY / CREAM system text ramp (`#F3EFE0`, `#EFE8D8`, `#E8D8C8`, `#D9C9B8`)
 * is restored as the original text colouring, so existing `*-hiraya-cream`
 * class usages resolve to ivory without touching every call site. Deep black /
 * zinc container contrast (`#000` / `#09090B`) is preserved.
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],

  theme: {
    extend: {
      colors: {
        hiraya: {
          // --- Core brand accent (#E9C46A) --------------------------------
          gold: '#E9C46A',        // Official primary brand accent
          'gold-deep': '#D4A94F', // Hover / pressed accent
          'gold-soft': '#F2D89B', // Highlights, glows, focus rings

          // --- System ivory / cream ramp (restored original values) -------
          cream: '#F3EFE0',
          'cream-deep': '#EFE8D8',
          'cream-soft': '#E8D8C8',
          sand: '#D9C9B8',

          // --- Deep black / zinc container contrast ----------------------
          bg: '#000',          // Obsidian base canvas
          ink: '#09090B',         // Text/ink sitting on gold surfaces
          charcoal: '#F5EBE0',    // Warm ink (primary text on black)
        },
      },

      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        serif: ['Cinzel', 'serif'],
      },

      // Gold glow used by focus states and active stack cards.
      boxShadow: {
        'gold-glow': '0 0 28px rgba(233, 196, 106, 0.30)',
        'gold-ring': '0 0 0 1px rgba(233, 196, 106, 0.45)',
      },
    },
  },

  plugins: [],
};
