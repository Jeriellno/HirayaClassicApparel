/**
 * CUT-OUT PURITY QA
 * =================
 *
 * The admin's complaint: after a garment is uploaded and auto-filled, the
 * catalog card still shows things that are NOT the garment — the product-name
 * caption, a brand mark, and leftover patches of the original backdrop.
 *
 * `cleanCutoutMatte` in `utils/garmentCompositor.js` is the pass responsible for
 * deleting them. This script feeds it a SYNTHETIC admin upload built to contain
 * exactly the three failure modes, then measures whether each one survived.
 *
 * WHY SYNTHETIC AND NOT A REAL PHOTO
 * ----------------------------------
 * A real photo cannot tell you WHY something survived. Ground truth here is
 * exact: we know the caption's bounding box, the logo's bounding box and the
 * backdrop patch's bounding box, so "did it survive" is a pixel comparison
 * rather than a judgement call, and the result is stable across machines.
 *
 * The test runs the REAL pipeline end-to-end — `composeGarmentOnFrame`, which
 * does removal -> `cleanCutoutMatte` -> frame composite — so it verifies the
 * shipped behaviour, not a copy of the algorithm.
 *
 * REPORTED METRICS
 * ----------------
 *   matteBox        the bounding box of what survived on the bare try-on matte.
 *                   If a caption or a logo survived, the box is far larger than
 *                   the garment itself.
 *   residue.*       per-artefact: how many of its pixels are still opaque.
 *                   0 is required.
 *   garmentKept     how much of the real garment survived. Must stay high — a
 *                   cleaner that deletes the artefact by deleting everything is
 *                   not a fix.
 *
 * Run:  node run_tryon_qa.mjs qa_cutout_purity.mjs
 */
export default async function run(page) {
  return await page.evaluate(async () => {
    const mod = await import('/src/utils/garmentCompositor.js');
    const bg = await import('/src/utils/removeBackground.js');

    /*
     * DIAGNOSTIC: does the neural removal engine actually run in this harness?
     *
     * If `@imgly/background-removal` cannot load its model, `removeImageBackground`
     * silently returns `{ blob: null }` and keeps the ORIGINAL. That is the
     * environment the real product also degrades to when the model is
     * unavailable or the upload is already a transparent PNG.
     *
     * The probe deliberately uses a PNG — an SVG is rejected by the engine with
     * "Invalid format: image/svg+xml", which would report a missing engine even
     * when the engine is perfectly healthy.
     */
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 64;
    probeCanvas.height = 64;
    const pctx = probeCanvas.getContext('2d');
    pctx.fillStyle = '#ded9cd';
    pctx.fillRect(0, 0, 64, 64);
    pctx.fillStyle = '#0b3d2e';
    pctx.fillRect(16, 16, 32, 32);
    const probeBlob = await new Promise((res) => probeCanvas.toBlob(res, 'image/png'));

    let engineAvailable = false;
    try {
      const probe = await bg.removeImageBackground(URL.createObjectURL(probeBlob));
      engineAvailable = !!probe.blob;
    } catch {
      engineAvailable = false;
    }

    /*
     * Build a canvas with labelled regions. Every coordinate is returned so the
     * assertions below can ask "how many pixels INSIDE this box are opaque".
     */
    const buildFixture = () => {
      const cv = document.createElement('canvas');
      cv.width = 900;
      cv.height = 1100;
      const g = cv.getContext('2d');

      // 1. The original backdrop — light, neutral, nothing like the garment.
      g.fillStyle = '#ded9cd';
      g.fillRect(0, 0, 900, 1100);

      /*
       * 2. A leftover BACKDROP PATCH: a darker strip running down the right
       *    edge, disconnected from the garment. The matting model often keeps
       *    something like this (a wall edge, a shadow), and it must not reach
       *    the frame.
       */
      g.fillStyle = '#9a9384';
      g.fillRect(860, 120, 40, 860);

      // 3. A LOGO / watermark block floating clear of the garment.
      g.fillStyle = '#4a4a4a';
      g.fillRect(70, 560, 120, 120);

      /*
       * 4. The GARMENT — a dark green A-line dress, the thing that MUST survive.
       *    Kept well clear of every artefact above.
       */
      g.fillStyle = '#0b3d2e';
      g.beginPath();
      g.moveTo(450, 230);
      g.lineTo(330, 320);
      g.lineTo(370, 560);
      g.lineTo(300, 940);
      g.lineTo(600, 940);
      g.lineTo(530, 560);
      g.lineTo(570, 320);
      g.closePath();
      g.fill();

      // 5. A CAPTION across the top, in a wide banner layout — the exact shape
      //    the old top-band size gate failed to reject.
      g.fillStyle = '#f4f0e6';
      g.font = 'bold 62px sans-serif';
      g.fillText('CULTURE MEETS STYLE', 60, 130);

      return cv;
    };

    const fixture = buildFixture();
    const file = await new Promise((res) => fixture.toBlob(res, 'image/png'));

    /*
     * RUN THE PIPELINE TWICE — once with a File (the admin's real upload path)
     * and once with a data URI. These take DIFFERENT branches inside
     * `removeImageBackground`, and only one of them is the shipping path.
     */
    const result = await mod.composeGarmentOnFrame({ garmentSource: file });
    const resultViaUrl = await mod.composeGarmentOnFrame({
      garmentSource: fixture.toDataURL('image/png'),
    });

    /**
     * Count opaque pixels inside a box on a blob, and report the total opaque
     * bounding box of the whole image.
     */
    const measure = async (blob, regions) => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      const img = await new Promise((r) => {
        const i = new Image();
        i.onload = () => r(i);
        i.onerror = () => r(null);
        i.src = url;
      });
      if (!img) { URL.revokeObjectURL(url); return null; }

      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;

      // The fixture is 900x1100; the matte is trimmed, so scale every region
      // into the matte's own coordinate space.
      const sx = c.width / 900;
      const sy = c.height / 1100;

      const inBox = (bx, by, bw, bh) => {
        const x0 = Math.max(0, Math.floor(bx * sx));
        const y0 = Math.max(0, Math.floor(by * sy));
        const x1 = Math.min(c.width, Math.ceil((bx + bw) * sx));
        const y1 = Math.min(c.height, Math.ceil((by + bh) * sy));
        let opaque = 0;
        let total = 0;
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            total++;
            if (d[(py * c.width + px) * 4 + 3] >= 24) opaque++;
          }
        }
        return total === 0 ? 0 : opaque / total;
      };

      let minX = c.width, minY = c.height, maxX = -1, maxY = -1, opaqueTotal = 0;
      for (let py = 0; py < c.height; py++) {
        for (let px = 0; px < c.width; px++) {
          if (d[(py * c.width + px) * 4 + 3] >= 24) {
            opaqueTotal++;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
          }
        }
      }

      const out = {
        size: `${c.width}x${c.height}`,
        opaquePct: Math.round((opaqueTotal / (c.width * c.height)) * 100),
        contentBox: maxX < 0 ? null : `${minX},${minY} ${maxX - minX + 1}x${maxY - minY + 1}`,
        residue: {},
      };
      for (const [name, box] of Object.entries(regions)) {
        out.residue[name] = Math.round(inBox(...box) * 100); // % of the box still opaque
      }
      URL.revokeObjectURL(url);
      return out;
    };

    // Ground-truth boxes in fixture coordinates.
    const REGIONS = {
      caption: [60, 88, 620, 52],    // "CULTURE MEETS STYLE"
      logo: [70, 560, 120, 120],  // floating brand mark
      backdrop: [860, 120, 40, 860],  // strip down the right edge
      garment: [330, 260, 240, 640], // the dress
    };

    // The matte is the bare cut-out the try-on consumes, and is the strictest
    // view of "is anything left that is not the garment".
    const matte = result.matte ? await measure(result.matte, REGIONS) : { residue: {}, contentBox: null, opaquePct: 0, size: 'n/a' };
    const matteViaUrl = resultViaUrl.matte
      ? await measure(resultViaUrl.matte, REGIONS)
      : { residue: {}, contentBox: null, opaquePct: 0, size: 'n/a' };

    /*
     * Reference: what the UNCLEANED engine output looks like. WE DO NOT have a
     * separate handle on it from the public API, so the framed card is used to
     * confirm the pipeline at least ran and produced a garment.
     */
    const framed = await measure(result.blob, REGIONS);

    return {
      engineAvailable,
      hasMatte: !!result.matte,
      hasFramedCard: !!result.blob,
      matte,
      matteViaUrl,
      framedCard: framed,
      /*
       * PASS rules, stated here so the launcher's assertion matches the
       * comments above:
       *   - the matte exists at all,
       *   - the caption, logo and backdrop strip are gone (< 1% of their box),
       *   - the garment is still there (> 75% of its box).
       */
      pass:
        !!result.matte &&
        matte.residue.caption < 1 &&
        matte.residue.logo < 1 &&
        matte.residue.backdrop < 1 &&
        matte.residue.garment > 75,
      /*
       * `verdict` names WHY a run failed, so a broken test environment is never
       * mistaken for a broken clean-up.
       */
      verdict: !result.matte
        ? 'NO_CUTOUT — the removal engine never produced one; this measures the fallback, not the cleaner'
        : 'MEASURED — the cut-out is real, so these residue numbers describe the cleaner',
    };
  });
}
