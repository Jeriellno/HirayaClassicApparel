export default async function run(page, ui) {
  // Build a page that exercises the EXACT font stacks the app uses and reports
  // whether U+20B1 actually has a glyph in each, vs. falling back to a box.
  const result = await page.evaluate(async () => {
    const out = {};

    // Make sure the app's webfonts are loaded first (Cinzel + Plus Jakarta Sans).
    try {
      await document.fonts.ready;
    } catch { }

    const peso = '\u20B1';
    const measure = (family) => {
      const el = document.createElement('span');
      el.style.cssText = `position:absolute;left:-9999px;font-family:${family};font-size:40px;`;
      el.textContent = peso;
      document.body.appendChild(el);

      // Compare the peso's width against a known-missing-glyph probe. When a
      // glyph is absent the browser draws the same fallback box for both, so
      // identical widths mean the symbol is NOT available in this family.
      const pesoWidth = el.getBoundingClientRect().width;

      el.textContent = '\uFFFF'; // permanently-unassigned code point -> always a box
      const missingWidth = el.getBoundingClientRect().width;

      el.remove();
      return { pesoWidth: Math.round(pesoWidth), missingWidth: Math.round(missingWidth) };
    };

    out.cinzel = measure("'Cinzel', serif");
    out.plusJakarta = measure("'Plus Jakarta Sans', sans-serif");
    out.appSerifStack = measure("'Cinzel', 'Segoe UI', 'Noto Sans', serif");
    out.appSansStack = measure("'Plus Jakarta Sans', system-ui, 'Segoe UI', 'Noto Sans', sans-serif");

    for (const [k, v] of Object.entries(out)) {
      v.glyphPresent = v.pesoWidth !== v.missingWidth;
    }
    return out;
  });

  return result;
}
