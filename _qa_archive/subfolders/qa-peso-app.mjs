export default async function run(page, ui) {
  // The real app bundle must be loaded so Cinzel / Plus Jakarta Sans are
  // actually fetched. Then check whether U+20B1 has a glyph in each family the
  // app uses, and whether any rendered price shows a fallback box.
  await page.waitForTimeout(3000);

  const result = await page.evaluate(async () => {
    const out = { fontsLoaded: document.fonts ? document.fonts.size : 0 };

    try {
      // Force-load the exact webfonts the app requests.
      await Promise.all([
        document.fonts.load("16px 'Cinzel'"),
        document.fonts.load("16px 'Plus Jakarta Sans'"),
      ]);
      await document.fonts.ready;
    } catch (e) {
      out.fontError = String(e);
    }

    out.cinzelLoaded = document.fonts.check("16px 'Cinzel'");
    out.pjsLoaded = document.fonts.check("16px 'Plus Jakarta Sans'");

    // Is U+20B1 inside each loaded font's unicode-range coverage?
    const checkGlyph = (family) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const widthOf = (ch) => {
        ctx.font = `40px ${family}`;
        return Math.round(ctx.measureText(ch).width * 100) / 100;
      };

      const pesoW = widthOf('\u20B1');
      const missingW = widthOf('\uFFFE'); // guaranteed no glyph -> fallback box
      return { pesoW, missingW, differs: pesoW !== missingW };
    };

    out.cinzel = checkGlyph("'Cinzel', serif");
    out.pjs = checkGlyph("'Plus Jakarta Sans', sans-serif");

    // What does the browser ACTUALLY paint for a price inside an <h2>?
    const h2 = document.createElement('h2');
    h2.textContent = '\u20B11,234';
    h2.style.cssText = 'position:absolute;left:-9999px;font-size:32px';
    document.body.appendChild(h2);
    out.h2ComputedFont = getComputedStyle(h2).fontFamily;
    out.h2TextWidth = Math.round(h2.getBoundingClientRect().width);
    h2.remove();

    return out;
  });

  return result;
}
