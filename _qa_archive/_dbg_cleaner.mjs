/**
 * CLEANER DEBUG — why does residue survive `cleanCutoutMatte`?
 *
 * The QA script reports WHAT survived; this reports WHY. It re-implements the
 * grouping/shape gates on the same fixture prints the block-by-block verdict
 * the cleaner is reaching (or failing to reach), so a threshold can be corrected
 * against evidence instead of guesswork.
 *
 * Run:  node run_tryon_qa.mjs _dbg_cleaner.mjs
 */
export default async function run(page) {
  return await page.evaluate(async () => {
    const { removeImageBackground } = await import('/src/utils/removeBackground.js');

    // The exact same fixture the purity test uses.
    const cv = document.createElement('canvas');
    cv.width = 900; cv.height = 1100;
    const g = cv.getContext('2d');
    g.fillStyle = '#ded9cd'; g.fillRect(0, 0, 900, 1100);
    g.fillStyle = '#9a9384'; g.fillRect(860, 120, 40, 860);      // backdrop strip
    g.fillStyle = '#4a4a4a'; g.fillRect(70, 560, 120, 120);      // logo
    g.fillStyle = '#0b3d2e';
    g.beginPath();
    g.moveTo(450, 230); g.lineTo(330, 320); g.lineTo(370, 560);
    g.lineTo(300, 940); g.lineTo(600, 940); g.lineTo(530, 560);
    g.lineTo(570, 320); g.closePath(); g.fill();
    g.fillStyle = '#f4f0e6';
    g.font = 'bold 62px sans-serif';
    g.fillText('CULTURE MEETS STYLE', 60, 130);

    const file = await new Promise((res) => cv.toBlob(res, 'image/png'));

    /*
     * SAVE THE FIXTURE ITSELF so the numbers below can be eyeballed against the
     * input that produced them. Without this, a mis-scaled region box looks
     * exactly like surviving residue.
     */
    const fixtureShot = cv.toDataURL('image/png');

    // Run the REAL removal engine, then analyse its raw output.
    const removed = await removeImageBackground(URL.createObjectURL(file));
    if (!removed.blob) return { error: 'engine produced no cut-out' };

    const img = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i);
      i.src = URL.createObjectURL(removed.blob);
    });

    const w = img.naturalWidth, h = img.naturalHeight;

    // Replicate the cleaner's front half at the same scan resolution.
    const SCAN_MAX = 512;
    const scale = Math.min(1, SCAN_MAX / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));

    const scan = document.createElement('canvas');
    scan.width = sw; scan.height = sh;
    const sctx = scan.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, sw, sh);
    const d = sctx.getImageData(0, 0, sw, sh).data;

    const ALPHA_MIN = 24;
    const N = sw * sh;
    const mask = new Uint8Array(N);
    let opaqueCount = 0;
    for (let p = 0; p < N; p++) {
      if (d[p * 4 + 3] >= ALPHA_MIN) { mask[p] = 1; opaqueCount++; }
    }

    // --- connected components ---
    const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    const seen = new Uint8Array(N);
    const stack = [];
    const comps = [];
    for (let start = 0; start < N; start++) {
      if (!mask[start] || seen[start]) continue;
      stack.length = 0; stack.push(start); seen[start] = 1;
      const members = [];
      let minX = sw, minY = sh, maxX = -1, maxY = -1;
      while (stack.length) {
        const p = stack.pop();
        const x = p % sw, y = (p - x) / sw;
        members.push(p);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let k = 0; k < 8; k++) {
          const nx = x + NB[k][0], ny = y + NB[k][1];
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          const n = ny * sw + nx;
          if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      comps.push({ members, size: members.length, minX, minY, maxX, maxY });
    }

    const largest = comps.reduce((a, b) => (b.size > a.size ? b : a), comps[0]);

    // Describe the fixture regions in SCAN coordinates so results are readable.
    const sx = sw / 900, sy = sh / 1100;
    const label = (c) => {
      const cx = ((c.minX + c.maxX) / 2) / sx;
      const cy = ((c.minY + c.maxY) / 2) / sy;
      if (cy < 180) return 'CAPTION-band';
      if (cx < 260 && cy > 480 && cy < 760) return 'LOGO-band';
      if (cx > 790) return 'BACKDROP-band';
      return 'GARMENT-band';
    };

    const top = comps
      .slice()
      .sort((a, b) => b.size - a.size)
      .slice(0, 25)
      .map((c) => {
        const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
        return {
          where: label(c),
          size: c.size,
          pctOfLargest: +(c.size / largest.size * 100).toFixed(2),
          box: `${c.minX},${c.minY} ${bw}x${bh}`,
          aspect: +(bw / bh).toFixed(2),
          fill: +(c.size / (bw * bh)).toFixed(3),
          inTopBand_old: c.maxY < sh * 0.16,
          oldWouldKeep: c.size >= largest.size * 0.04,
        };
      });

    // Region occupancy of the RAW engine cut-out, in the same boxes the QA uses.
    const occupancy = (bx, by, bw, bh) => {
      const x0 = Math.max(0, Math.floor(bx * sx)), y0 = Math.max(0, Math.floor(by * sy));
      const x1 = Math.min(sw, Math.ceil((bx + bw) * sx)), y1 = Math.min(sh, Math.ceil((by + bh) * sy));
      let o = 0, t = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; if (mask[y * sw + x]) o++; }
      return t ? Math.round(o / t * 100) : 0;
    };

    /*
     * Render the FINAL matte and the FINAL framed card as data URIs. The
     * numbers above say what the cleaner computed; these say what is actually
     * being shipped to the frame, which is what the shop displays.
     */
    const mod = await import('/src/utils/garmentCompositor.js');
    const composed = await mod.composeGarmentOnFrame({ garmentSource: file });

    /*
     * Compose the DIAGNOSTIC SHEET: the fixture, the bare matte and the framed
     * card side by side on one canvas. Returning three data URIs through the
     * CDP bridge invites truncation; one image is small and unambiguous.
     */
    const drawTo = (ctx, img, x, y, boxW, boxH) => {
      const s = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      // A mid-grey plate behind each panel so transparency is visible as grey
      // rather than reading as "nothing was drawn".
      ctx.fillStyle = '#556';
      ctx.fillRect(x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
      ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
    };

    const asImage = async (blobOrCanvas) => {
      if (!blobOrCanvas) return null;
      const src = blobOrCanvas instanceof HTMLCanvasElement
        ? blobOrCanvas.toDataURL('image/png')
        : URL.createObjectURL(blobOrCanvas);
      const im = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      if (typeof blobOrCanvas !== 'object' || !(blobOrCanvas instanceof HTMLCanvasElement)) URL.revokeObjectURL(src);
      return im;
    };

    const panels = [
      { name: 'FIXTURE (admin upload)', img: await asImage(cv) },
      { name: 'ENGINE CUT-OUT', img: await asImage((() => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0); return c;
      })()) },
      { name: 'MATTE (what try-on gets)', img: await asImage(composed.matte) },
      { name: 'FRAMED CARD (what shop gets)', img: await asImage(composed.blob) },
    ];

    const SHEET_W = 1600, PANEL_W = 390, PANEL_H = 520, GAP = 10;
    const PAD_TOP = 34;
    const sheet = document.createElement('canvas');
    sheet.width = SHEET_W;
    sheet.height = PAD_TOP + PANEL_H + 16;
    const sctx2 = sheet.getContext('2d');
    sctx2.fillStyle = '#111';
    sctx2.fillRect(0, 0, sheet.width, sheet.height);
    sctx2.font = 'bold 18px sans-serif';

    panels.forEach((panel, i) => {
      const x = GAP + i * (PANEL_W + GAP);
      sctx2.fillStyle = '#E9C46A';
      sctx2.fillText(panel.name, x + 4, 23);
      if (panel.img) drawTo(sctx2, panel.img, x, PAD_TOP, PANEL_W, PANEL_H);
    });

    return {
      sheet: sheet.toDataURL('image/png'),
      engineOutput: { size: `${w}x${h}`, scan: `${sw}x${sh}`, opaqueCount },
      rawResidue: {
        caption: occupancy(60, 88, 620, 52),
        logo: occupancy(70, 560, 120, 120),
        backdrop: occupancy(860, 120, 40, 860),
        garment: occupancy(330, 260, 240, 640),
      },
      largestBox: `${largest.minX},${largest.minY} ${largest.maxX - largest.minX + 1}x${largest.maxY - largest.minY + 1}`,
      largestBoxInFixtureCoords:
        `${Math.round(largest.minX / sx)},${Math.round(largest.minY / sy)} ` +
        `${Math.round((largest.maxX - largest.minX + 1) / sx)}x${Math.round((largest.maxY - largest.minY + 1) / sy)}`,
      componentCount: comps.length,
      biggestComponents: top,
    };
  });
}
