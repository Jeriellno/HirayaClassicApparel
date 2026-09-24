/** Find the discriminating statistic between garment and backdrop. */
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

    const analyse = async (url, label) => {
      const img = await load(await mod.toReadableSource(url));
      const S = 300;
      const w = S;
      const h = Math.round(S * (img.naturalHeight / img.naturalWidth));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h).data;

      // Sample known BACKGROUND: the border ring, and a strip in the reflection area.
      const bgSamples = [];
      for (let x = 0; x < w; x += 3) { bgSamples.push([x, 2]); bgSamples.push([x, h - 3]); }
      for (let y = 0; y < h; y += 3) { bgSamples.push([2, y]); bgSamples.push([w - 3, y]); }

      const lumaAt = (x, y) => {
        const i = (y * w + x) * 4;
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      };

      const bgLumas = bgSamples.map(([x, y]) => lumaAt(x, y)).sort((a, b) => a - b);
      const bgMin = bgLumas[0];
      const bgMed = bgLumas[Math.floor(bgLumas.length / 2)];

      // Full histogram to see the two modes.
      const hist = new Array(16).fill(0);
      for (let p = 0; p < w * h; p++) {
        const i = p * 4;
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        hist[Math.min(15, Math.floor(l / 16))]++;
      }

      // The garment's centre column: what luma does the dress body actually have?
      const cxCol = Math.floor(w / 2);
      const colProfile = [];
      for (let y = 0; y < h; y += Math.round(h / 25)) {
        colProfile.push({ yPct: Math.round((y / h) * 100), luma: Math.round(lumaAt(cxCol, y)) });
      }

      // How many pixels fall below various absolute luma cutoffs?
      const cutoffs = [60, 80, 100, 110, 120, 130, 140].map((c) => {
        let n = 0;
        for (let p = 0; p < w * h; p++) {
          const i = p * 4;
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (l < c) n++;
        }
        return { cutoff: c, pct: Math.round((n / (w * h)) * 1000) / 10 };
      });

      return {
        label,
        size: `${img.naturalWidth}x${img.naturalHeight}`,
        backgroundLuma: { min: Math.round(bgMin), median: Math.round(bgMed) },
        histogram16: hist,
        centreColumn: colProfile,
        belowCutoff: cutoffs,
      };
    };

    return [
      await analyse(`${SUP}/products/catalog/1789529378546-vq9blwc.jpg`, 'EMERALD raw'),
      await analyse(`${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`, 'BEIGE raw'),
    ];
  });
}