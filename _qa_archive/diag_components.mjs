/** Measure component sizes/densities so the thresholds come from data. */
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

    // Rebuild the pipeline stages here and report every component.
    const analyse = async (url, label) => {
      const img = await load(await mod.toReadableSource(url));
      const SCAN = 400;
      const w = SCAN;
      const h = Math.round(SCAN * (img.naturalHeight / img.naturalWidth));

      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      const data = cx.getImageData(0, 0, w, h).data;

      // --- seam ---
      const from = Math.round(h * 0.40), to = Math.round(h * 0.92);
      const BAND = Math.max(6, Math.round(h * 0.045));
      let bestRow = -1, bestScore = Infinity;
      for (let s = from; s <= to; s++) {
        if (s - BAND < 0 || s + BAND >= h) continue;
        let diff = 0, n = 0;
        for (let k = 1; k <= BAND; k++) {
          for (let x = 0; x < w; x += 4) {
            const ia = ((s - k) * w + x) * 4, ib = ((s + k) * w + x) * 4;
            const da = 0.299 * data[ia] + 0.587 * data[ia + 1] + 0.114 * data[ia + 2];
            const db = 0.299 * data[ib] + 0.587 * data[ib + 1] + 0.114 * data[ib + 2];
            diff += Math.abs(da - db); n++;
          }
        }
        const sc = diff / n;
        if (sc < bestScore) { bestScore = sc; bestRow = s; }
      }
      const scanBottom = bestRow > 0 ? bestRow - 1 : h;

      // --- per-row segment ---
      const mask = new Uint8Array(w * h);
      for (let y = scanBottom; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = 1;

      for (let y = 0; y < scanBottom; y++) {
        const INSET = 3, WIN = 4;
        let br = 0, bg = 0, bb = 0, bn = 0;
        for (let k = 0; k < WIN; k++) {
          for (const x of [INSET + k, w - 1 - INSET - k]) {
            const i = (y * w + x) * 4;
            br += data[i]; bg += data[i + 1]; bb += data[i + 2]; bn++;
          }
        }
        if (!bn) continue;
        const r = br / bn, g = bg / bn, b = bb / bn;
        const bgLuma = 0.299 * r + 0.587 * g + 0.114 * b;
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (mask[p]) continue;
          const i = p * 4;
          const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const dl = Math.abs(luma - bgLuma);
          const dr = Math.abs(data[i] - r), dg = Math.abs(data[i + 1] - g), db = Math.abs(data[i + 2] - b);
          const cd = Math.sqrt(dr * dr + dg * dg + db * db);
          if (!(dl >= 26 || cd >= 42)) mask[p] = 1;
        }
      }

      // garment = NOT background, above seam
      const gm = new Uint8Array(w * h);
      for (let y = 0; y < scanBottom; y++)
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (!mask[p] && data[p * 4 + 3] >= 16) gm[p] = 1;
        }

      // --- components ---
      const NB = [];
      for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) if (dx || dy) NB.push([dx, dy]);
      const NB2 = [];
      for (let dy = -4; dy <= 4; dy += 4) for (let dx = -4; dx <= 4; dx += 4) if (dx || dy) NB2.push([dx, dy]);
      const ALL = NB.concat(NB2);

      const seen = new Uint8Array(w * h);
      const comps = [];
      for (let start = 0; start < w * h; start++) {
        if (!gm[start] || seen[start]) continue;
        const st = [start]; seen[start] = 1;
        let size = 0, minX = w, minY = h, maxX = -1, maxY = -1;
        while (st.length) {
          const p = st.pop(); const x = p % w; const y = (p - x) / w;
          size++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          for (const [dx, dy] of ALL) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (gm[n] && !seen[n]) { seen[n] = 1; st.push(n); }
          }
        }
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        comps.push({
          size,
          pctOfLargest: 0,
          box: `${bw}x${bh}`,
          density: Math.round((size / (bw * bh)) * 100) / 100,
          topPct: Math.round((minY / h) * 100),
          bottomPct: Math.round((maxY / h) * 100),
          heightPctOfFrame: Math.round((bh / h) * 100),
        });
      }
      comps.sort((a, b) => b.size - a.size);
      const L = comps[0] ? comps[0].size : 1;
      comps.forEach((c) => { c.pctOfLargest = Math.round((c.size / L) * 1000) / 10; });

      return { label, scanSize: `${w}x${h}`, seamRow: bestRow, seamPctOfH: Math.round((bestRow / h) * 100), components: comps.slice(0, 12) };
    };

    return [
      await analyse(`${SUP}/products/catalog/1789529378546-vq9blwc.jpg`, 'EMERALD'),
      await analyse(`${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`, 'BEIGE'),
    ];
  });
}