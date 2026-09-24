import { writeFileSync } from 'node:fs';

/** Visualise the segmentation stages so I can see where it goes wrong. */
export default async function run(page) {
  const dataUrl = await page.evaluate(async () => {
    const mod = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const load = (src) => new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.onerror = () => r(null);
      i.src = src;
    });

    const url = `${SUP}/products/catalog/1789529378546-vq9blwc.jpg`;
    const urlBeige = `${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`;
    const readable = await mod.toReadableSource(url);
    const img = await load(readable);

    const SCAN = 400;
    const w = SCAN;
    const h = Math.round(SCAN * (img.naturalHeight / img.naturalWidth));

    const sc = document.createElement('canvas');
    sc.width = w; sc.height = h;
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, w, h);
    const data = sctx.getImageData(0, 0, w, h).data;

    // Re-derive the stages here so I can render each one.
    const dist2 = (a, b) => {
      const dr = data[a] - data[b], dg = data[a + 1] - data[b + 1], db = data[a + 2] - data[b + 2];
      return dr * dr + dg * dg + db * db;
    };

    // --- Stage A: mirror seam ---
    const findMirrorSeam = () => {
      const from = Math.round(h * 0.40), to = Math.round(h * 0.92);
      const BAND = Math.max(6, Math.round(h * 0.045));
      let bestRow = -1, bestScore = Infinity;
      const scores = [];
      for (let s = from; s <= to; s++) {
        if (s - BAND < 0 || s + BAND >= h) continue;
        let diff = 0, n = 0;
        for (let k = 1; k <= BAND; k++) {
          const ay = s - k, by = s + k;
          for (let x = 0; x < w; x += 4) {
            const ia = (ay * w + x) * 4, ib = (by * w + x) * 4;
            const da = 0.299 * data[ia] + 0.587 * data[ia + 1] + 0.114 * data[ia + 2];
            const db = 0.299 * data[ib] + 0.587 * data[ib + 1] + 0.114 * data[ib + 2];
            diff += Math.abs(da - db); n++;
          }
        }
        const score = diff / n;
        scores.push({ s, score });
        if (score < bestScore) { bestScore = score; bestRow = s; }
      }
      return { bestRow, bestScore, scores };
    };

    // --- Stage B: border flood at a given tolerance ---
    const flood = (tol) => {
      const T2 = tol * tol;
      const mask = new Uint8Array(w * h);
      const stack = [];
      const seed = (x, y) => { const p = y * w + x; if (mask[p]) return; mask[p] = 1; stack.push(p); };
      for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
      for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
      while (stack.length) {
        const p = stack.pop(); const x = p % w; const y = (p - x) / w; const i = p * 4;
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (mask[n]) continue;
          if (dist2(n * 4, i) <= T2) { mask[n] = 1; stack.push(n); }
        }
      }
      let bg = 0;
      for (let p = 0; p < w * h; p++) if (mask[p]) bg++;
      return { mask, bgPct: Math.round((bg / (w * h)) * 1000) / 10 };
    };

    const seamInfo = findMirrorSeam();

    /*
     * Re-implement the NEW per-row segmenter here so the visualisation exercises
     * the same maths the module uses.
     */
    const scanBottom = seamInfo.bestRow > 0 ? seamInfo.bestRow - 1 : h;
    const perRowMask = new Uint8Array(w * h);
    for (let y = scanBottom; y < h; y++) for (let x = 0; x < w; x++) perRowMask[y * w + x] = 1;

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
        if (perRowMask[p]) continue;
        const i = p * 4;
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const dl = Math.abs(luma - bgLuma);
        const dr = Math.abs(data[i] - r), dg = Math.abs(data[i + 1] - g), db = Math.abs(data[i + 2] - b);
        const cd = Math.sqrt(dr * dr + dg * dg + db * db);
        if (!(dl >= 26 || cd >= 42)) perRowMask[p] = 1;
      }
    }

    let perRowBg = 0;
    for (let p = 0; p < w * h; p++) if (perRowMask[p]) perRowBg++;

    const floods = [{ tol: 'perRow', bgPct: Math.round((perRowBg / (w * h)) * 1000) / 10 }];

    // Render the chosen flood mask as an overlay.
    const overlay = (tol, color) => {
      const { mask } = flood(tol);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      const im = cx.getImageData(0, 0, w, h);
      for (let p = 0; p < w * h; p++) {
        if (mask[p]) {
          im.data[p * 4] = color[0];
          im.data[p * 4 + 1] = color[1];
          im.data[p * 4 + 2] = color[2];
        }
      }
      cx.putImageData(im, 0, 0);
      return cv;
    };

    // Render the per-row mask as an overlay: red = classified background.
    const perRowOverlay = (() => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      const im = cx.getImageData(0, 0, w, h);
      for (let p = 0; p < w * h; p++) {
        if (perRowMask[p]) { im.data[p * 4] = 255; im.data[p * 4 + 1] = 0; im.data[p * 4 + 2] = 0; }
      }
      cx.putImageData(im, 0, 0);
      return cv;
    })();

    const H = 520;
    const sw = Math.round(H * (img.naturalWidth / img.naturalHeight));
    const panels = [
      { title: 'source', cv: (() => { const c = document.createElement('canvas'); c.width = sw; c.height = H; c.getContext('2d').drawImage(img, 0, 0, sw, H); return c; })() },
      { title: 'PER-ROW segment (red=bg)', cv: perRowOverlay },
    ];

    const totalW = (sw + 8) * panels.length + 8;
    const out = document.createElement('canvas');
    out.width = totalW; out.height = H + 24;
    const octx = out.getContext('2d');
    octx.fillStyle = '#222'; octx.fillRect(0, 0, out.width, out.height);
    octx.fillStyle = '#fff'; octx.font = 'bold 11px sans-serif';

    let ox = 8;
    for (const p of panels) {
      octx.fillText(`${p.title}  bg=${floods[0].bgPct}%`, ox, 14);
      octx.drawImage(p.cv, ox, 20, sw, H);
      ox += sw + 8;
    }

    // Mark the seam row on the source panel.
    if (seamInfo.bestRow > 0) {
      const seamY = 20 + (seamInfo.bestRow / h) * H;
      octx.strokeStyle = '#00ff00'; octx.lineWidth = 2;
      octx.beginPath(); octx.moveTo(8, seamY); octx.lineTo(8 + sw, seamY); octx.stroke();
    }

    return {
      dataUrl: out.toDataURL('image/png'),
      seam: { row: seamInfo.bestRow, score: Math.round(seamInfo.bestScore * 100) / 100, ofH: Math.round((seamInfo.bestRow / h) * 100) },
      floods,
      scanSize: { w, h },
    };
  });

  const base64 = dataUrl.dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync('C:/hiraya/segmentation_debug.png', Buffer.from(base64, 'base64'));

  return { wrote: 'C:/hiraya/segmentation_debug.png', seam: dataUrl.seam, floods: dataUrl.floods, scanSize: dataUrl.scanSize };
}
