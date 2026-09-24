/**
 * MASK ART — print the portrait's silhouette as ASCII so the SHAPE is visible.
 *
 * WHY THIS EXISTS
 * ---------------
 * The figure-shape classifier in bodyGeometry decides whether a portrait is a
 * full figure (legs) or a bust crop by looking at the silhouette's per-row
 * envelope. When it disagrees with what the eye sees, the numbers alone do not
 * tell you WHY — you need to look at the shape.
 *
 * This renders the alpha mask as a character grid so a human (or a reviewer)
 * can see immediately whether the wide part is a torso, and whether what runs
 * below it is a leg pair or a stand.
 *
 * A DIAGNOSTIC, deliberately: no `kind`, so the launcher reports NO VERDICT.
 */
export default async function run(page, ui = {}) {
  const out = await page.evaluate(async (portraitDataUri) => {
    const load = (src) =>
      new Promise((r) => {
        const i = new Image();
        if (typeof src === 'string' && !src.startsWith('data:')) i.crossOrigin = 'anonymous';
        i.onload = () => r(i);
        i.onerror = () => r(null);
        i.src = src;
      });

    const img = await load(portraitDataUri);
    if (!img) return { fatal: 'could not load portrait' };

    const W = 64;
    const H = 64;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    // Row of characters: '#' opaque core, '.' partial alpha, ' transparent.
    const lines = [];
    for (let y = 0; y < H; y++) {
      let line = '';
      for (let x = 0; x < W; x++) {
        const a = data[(y * W + x) * 4 + 3];
        line += a > 200 ? '#' : a > 40 ? '+' : ' ';
      }
      const left = line.replace(/\s+$/, '');
      lines.push(String(y).padStart(2, '0') + '|' + left);
    }

    return { fatal: null, w: img.width, h: img.height, lines };
  }, ui.portraitDataUri || null);

  if (out.fatal) {
    console.log('\n  MASK ART — could not run: ' + out.fatal + '\n');
    return { ok: false, fatal: out.fatal };
  }

  console.log('\n  SILHOUETTE MASK ART — ' + out.w + 'x' + out.h + ' rendered at 64x64\n');
  out.lines.forEach((l) => console.log('  ' + l));
  console.log('');

  return { ok: true, lines: out.lines };
}
