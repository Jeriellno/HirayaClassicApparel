w/** Map the per-row foreground coverage profile so I can pin the seam reliably. */
export default async function run(page) {
  return await page.evaluate(async () => {
    const mod = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const load = (src) => new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.onerror = () => r(null);
      i.src = src;
    });

    const profile = async (url, label) => {
      const img = await load(await mod.toReadableSource(url));
      const SCAN = 400;
      const w = SCAN;
      const h = Math.round(SCAN * (img.naturalHeight / img.naturalWidth));

      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      const data = cx.getImageData(0, 0, w, h).data;

      // per-row backdrop + foreground
      const cov = [];
      for (let y = 0; y < h; y++) {
        const INSET = 3, WIN = 4;
        let br = 0, bg = 0, bb = 0, bn = 0;
        for (let k = 0; k < WIN; k++) {
          for (const x of [INSET + k, w - 1 - INSET - k]) {
            const i = (y * w + x) * 4;
            br += data[i]; bg += data[i + 1]; bb += data[i + 2]; bn++;
          }
        }
        const r = br / bn, g = bg / bn, b = bb / bn;
        const bgLuma = 0.299 * r + 0.587 * g + 0.114 * b;
        let fg = 0;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const dl = Math.abs(luma - bgLuma);
          const dr = Math.abs(data[i] - r), dg = Math.abs(data[i + 1] - g), db = Math.abs(data[i + 2] - b);
          const cd = Math.sqrt(dr * dr + dg * dg + db * db);
          if (dl >= 26 || cd >= 42) fg++;
        }
        cov.push({ y, pct: Math.round((y / h) * 100), fgPct: Math.round((fg / w) * 100) });
      }

      // A compact string: one character per 1% of height, where the digit is
      // the foreground coverage in tens of percent (0-9).
      const bar = [];
      for (let p = 0; p <= 100; p++) {
        const row = cov[Math.min(h - 1, Math.round((p / 100) * (h - 1)))];
        bar.push(String(Math.min(9, Math.round(row.fgPct / 10))));
      }

      return { label, h, coverageBar: bar.join('') };
    };

    return [
      await profile(`${SUP}/products/catalog/1789529378546-vq9blwc.jpg`, 'EMERALD'),
      await profile(`${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`, 'BEIGE'),
    ];
  });
}
