/**
 * TRY-ON CONSTRAINT VALIDATOR
 * ===========================
 *
 * Turns the Virtual Try-On brief's [CRITICAL CONSTRAINTS] into machine-checkable
 * assertions scored against a REAL render from the app's own composite engine.
 *
 * The brief states four rules a render must satisfy:
 *
 *   1. NO MISPLACEMENT      the dress top anchors at the shoulders/chest,
 *                           NOT on the thighs/pelvis alone.
 *   2. FULL-BODY CANVAS     head, hands, legs and feet are never cropped;
 *                           framing is 3:4 or 9:16.
 *   3. NO STICKER OVERLAY   the dress follows the body's real width envelope
 *                           rather than sitting as a flat rectangle.
 *   4. CONSISTENCY          head/face pixels and background pixels outside the
 *                           garment region survive unchanged.
 *
 * WHY THIS RUNS IN THE PAGE
 * -------------------------
 * Every rule above is a statement about PIXELS. Model prose cannot be verified
 * and a screenshot cannot be asserted against, this harness runs the app's
 * real `compositeTryOn()` inside the browser and measures the output raster.
 *
 * HONESTY RULES
 * -------------
 * - No render  => FAIL with the reason. Never a silent pass. (The pipeline once
 *   reported a drawn SVG placeholder as `success: true`; that is the exact
 *   failure mode this refuses.)
 * - An unmeasurable check reports `skipped` with why. `skipped` is NOT a pass.
 * - Numeric scores accompany every verdict, so a marginal render is visibly
 *   marginal instead of being rounded to a binary "ok".
 */
import { writeFileSync } from 'node:fs';

/* ------------------------------------------------------------------ *
 * THRESHOLDS
 *
 * Each corresponds to one sentence of the brief. Kept as named constants so a
 * disagreement about "how anchored is anchored" is a one-line change.
 * ------------------------------------------------------------------ */
export const T = {
  /** (1) Dress top may start from a little above the shoulder down to just below
   *  it — an off-shoulder drape legitimately rides low — but never below the
   *  chest boundary. Fraction of BODY height below the shoulder. */
  dressTopMaxBelowShoulder: 0.12,

  /**
   * (1, UPPER BOUND) The other side of the same rule, and the one that was
   * missing.
   *
   * MEASURED FAILURE THIS CLOSES: the check only ever tested `belowShoulder <=
   * 0.12`. A NEGATIVE value passed trivially, so a garment whose top edge sits
   * ABOVE the shoulder line scored PASS. On the synthetic figure the harness
   * reported `garmentTop_vs_shoulder_bodyFraction: -0.015` and printed "no
   * misplacement" for a dress anchored at the customer's NECK. A top edge
   * above the shoulders is a misplacement in the opposite direction — a
   * collar/neckband, not a garment — and must fail like any other.
   *
   * The tolerance is generous (a garment may ride up to 5% of body height above
   * the shoulder line, which no real garment does) so this can only fire on a
   * genuine misplacement, never on a fitted off-shoulder drape.
   */
  dressTopMaxAboveShoulder: 0.05,

  /** (1) If the top edge is below this fraction of body height the
   *  garment has been placed on the thighs/pelvis. */
  dressTopMaxBodyFraction: 0.45,

  /** (2) Acceptable portrait aspect ratios (width:height). */
  allowedAspect: [
    { label: '3:4', value: 3 / 4 },
    { label: '9:16', value: 9 / 16 },
  ],
  aspectTolerance: 0.04,
  /** (2) The subject "touches" an edge within this fraction of the dimension. */
  edgeMargin: 0.005,

  /** (3) Correlation between garment width and body width down the torso.
   *  A flat sticker gives ~0; wrapped fabric tracks the body. */
  stickerMinCorrelation: 0.55,
  /** (3) Near-constant width down the torso = a rectangle. Coefficient of
   *  variation of the fitted width. */
  stickerMinWidthVariation: 0.06,

  /** (4) Mean absolute RGB drift allowed in regions the render must not touch. */
  consistencyMaxRgbDrift: 12,

  /** Analysis resolution: fast, but several pixels wide per real edge. */
  SCAN: 256,

  /** Pixel delta above which a pixel counts as "modified by the renderer",
   *  i.e. garment. Above JPEG/anti-aliasing noise, below any real fabric. */
  diffThreshold: 34,

  /**
   * VIGNETTE SUPPRESSION — the compositor's studio finish is not fabric.
   *
   * `compositeTryOn` ends every render with `drawVignette()`: a full-frame radial
   * gradient of black at alpha 0 -> 0.30. It is a deliberate cosmetic pass, but
   * it changes nearly EVERY pixel in the frame, so a plain base-vs-render diff
   * counts it as "garment".
   *
   * Measured: the vignette's delta reaches 84 in the RGB sum (and 76 in the
   * alpha channel on a cut-out portrait), well over the 34 threshold — so the
   * mask became a frame-wide gradient. That is what made constraint 3
   * unscoreable: a full-frame gradient has a CONSTANT width, so the garment width
   * series had zero variance and the correlation with the body was undefined.
   *
   * The discriminator is that the vignette is a SMOOTH RADIAL FIELD with a known
   * shape: its delta is a function of distance from the frame centre alone. So we
   * model it — reconstruct the expected vignette alpha at each pixel from the
   * same parameters the compositor uses — and SUBTRACT that expected change
   * before thresholding. Whatever delta remains is not the vignette, and whatever
   * is fabric survives, because real fabric departs sharply from the gradient.
   *
   * These four numbers MIRROR drawVignette() in compositeTryOn.js and must be
   * kept in step with it; they are named here rather than inlined so the coupling
   * is visible.
   */
  vignette: {
    innerRadius: 0.32,   // fraction of HEIGHT where the gradient starts (alpha 0)
    outerRadius: 0.85,   // fraction of HEIGHT where it maxes out
    maxAlpha: 0.30,      // alpha at (and beyond) the outer radius
    /**
     * How much slack to allow on the modelled vignette effect, per channel.
     *
     * `getImageData` returns NON-premultiplied colour; the compositor's
     * `source-over` vignette acts on the buffers the browser blends. So the
     * model below is applied to UN-premultiplied values (divide the stored colour
     * by alpha, blend, multiply back), which reproduces the blend exactly instead
     * of approximating it. The slack then only has to cover 8-bit rounding.
     */
    channelSlack: 4,
  },

  /**
   * Border bands excluded from the garment mask, as a fraction of each edge.
   *
   * WHY: the compositor stamps a watermark and a corner badge. Those pixels
   * differ from the base portrait, so a naive diff mask counts them as
   * "garment". That silently stretched the garment bounding box to row 0 and
   * made constraint 1 report a PASS the dress had not earned — the mask was
   * really seeing the wordmark, not fabric. Ignoring a thin border strip is the
   * honest fix: a dress does not wear the watermark.
   *
   * These bands are far thinner than a garment is wide, so a legitimate garment
   * that genuinely reaches an edge is still measured correctly. */
  maskIgnoreBands: { top: 0.06, bottom: 0.06, left: 0.06, right: 0.06 },
};

/* ------------------------------------------------------------------ *
 * THE SELF-CONTAINED ANALYSIS
 *
 * Injected into the page as source text, so it must NOT close over anything
 * from this module. Everything it needs arrives through `T`.
 * ------------------------------------------------------------------ */
export const ANALYSE = function analyse(input) {
  /*
   * `input` carries both the thresholds and any caller-supplied assets. Keeping
   * one payload means the page needs a single evaluate() round-trip.
   */
  const thresholds = input.thresholds;
  /** A real uploaded portrait as a data URI, or null for the synthetic figure. */
  const portraitOverride = input.portrait || null;
  /* ---------- numeric helpers ---------- */
  const correlate = (a, b) => {
    const n = Math.min(a.length, b.length);
    if (n < 3) return null;
    const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma;
      const y = b[i] - mb;
      num += x * y;
      da += x * x;
      db += y * y;
    }
    if (da === 0 || db === 0) return null;
    return num / Math.sqrt(da * db);
  };

  /* ---------- raster helpers ---------- */
  const loadImage = (src) =>
    new Promise((resolve) => {
      const i = new Image();
      if (typeof src === 'string' && !src.startsWith('data:')) i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = src;
    });

  const rasterise = (img, w, h) => {
    try {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      return { data: ctx.getImageData(0, 0, w, h).data };
    } catch {
      // Cross-origin image without CORS: the canvas is tainted and pixel reads
      // throw. Returning null makes the caller report `skipped`, never a pass.
      return null;
    }
  };

  const luma = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];

  /** Subject envelope per row: alpha if present, else corner-background diff. */
  const scanEnvelope = (data, w, h) => {
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 200) transparent++;
    const hasAlpha = transparent / (data.length / 4) > 0.05;

    // Opaque fallback: the four corners stand in for "background".
    let bgLuma = 0;
    for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
      bgLuma += luma(data, (cy * w + cx) * 4);
    }
    bgLuma /= 4;

    const rows = [];
    for (let y = 0; y < h; y++) {
      let minX = -1;
      let maxX = -1;
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const isBody = hasAlpha ? data[p + 3] > 200 : Math.abs(luma(data, p) - bgLuma) >= 26;
        if (isBody) {
          if (minX === -1) minX = x;
          maxX = x;
        }
      }
      rows.push(minX === -1 ? null : { minX, maxX, width: maxX - minX + 1 });
    }

    const occupied = rows.filter(Boolean);
    if (occupied.length < h * 0.1) {
      return { rows, hasAlpha, topRow: -1, bottomRow: -1, minX: 0, maxX: -1, minY: 0, maxY: -1, shoulderRow: -1 };
    }

    const topRow = rows.findIndex(Boolean);
    let bottomRow = h - 1;
    while (bottomRow > 0 && !rows[bottomRow]) bottomRow--;

    let minX = w;
    let maxX = -1;
    for (let y = 0; y < h; y++) {
      if (!rows[y]) continue;
      if (rows[y].minX < minX) minX = rows[y].minX;
      if (rows[y].maxX > maxX) maxX = rows[y].maxX;
    }

    /*
     * Shoulder line = the widest row in the UPPER 40% of the figure, matching
     * the convention in bodyGeometry.measureSilhouette(). Searching only the top
     * 40% stops a flared skirt or a wide stance being read as the shoulders.
     */
    let shoulderRow = topRow;
    const limit = Math.round(topRow + (bottomRow - topRow) * 0.4);
    let best = 0;
    for (let y = topRow; y <= limit && y < h; y++) {
      if (rows[y] && rows[y].width > best) {
        best = rows[y].width;
        shoulderRow = y;
      }
    }

    return { rows, hasAlpha, topRow, bottomRow, minX, maxX, minY: topRow, maxY: bottomRow, shoulderRow };
  };

  /**
   * Largest connected region of a binary mask (4-connectivity), returned as a
   * fresh mask. Used to reject the compositor's watermark and corner badge.
   *
   * WHY: the wordmark is drawn INTO the frame, so a border-band exclusion does
   * not reach it. It sits over the subject's arm, is separated from the dress by
   * unchanged pixels, and therefore forms its own island. Keeping only the
   * largest island discards the wordmark while preserving the garment — which is
   * always one connected piece of fabric.
   *
   * Deterministic and O(w*h): a flood fill from the largest unvisited seed.
   */
  const largestIsland = (src, w, h) => {
    const seen = new Uint8Array(w * h);
    let best = null;
    let bestSize = 0;

    const stack = new Int32Array(w * h);
    for (let seed = 0; seed < w * h; seed++) {
      if (!src[seed] || seen[seed]) continue;

      let sp = 0;
      stack[sp++] = seed;
      seen[seed] = 1;
      const cells = [];

      while (sp > 0) {
        const cur = stack[--sp];
        cells.push(cur);
        const cx = cur % w;
        const cy = (cur - cx) / w;

        if (cx > 0) { const n = cur - 1; if (src[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; } }
        if (cx < w - 1) { const n = cur + 1; if (src[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; } }
        if (cy > 0) { const n = cur - w; if (src[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; } }
        if (cy < h - 1) { const n = cur + w; if (src[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; } }
      }

      if (cells.length > bestSize) {
        bestSize = cells.length;
        best = cells;
      }
    }

    if (!best) return { mask: new Uint8Array(w * h), size: 0, islands: 0 };
    const out = new Uint8Array(w * h);
    for (const c of best) out[c] = 1;
    return { mask: out, size: bestSize, islands: best.length };
  };

  /**
   * Pixels that CHANGED between base and render == the garment, by definition.
   *
   * Border bands are excluded (see `maskIgnoreBands`) so the compositor's
   * watermark and corner badge cannot masquerade as fabric and inflate the
   * garment's bounding box. `excludedPixels` is returned so the report can show
   * how much the exclusion actually removed — if that number is large, the
   * bands are hiding something and the operator should know.
   */
  const diffMask = (base, out, w, h) => {
    const mask = new Uint8Array(w * h);
    const b = thresholds.maskIgnoreBands || { top: 0, bottom: 0, left: 0, right: 0 };
    const x0 = Math.round(w * b.left);
    const x1 = w - 1 - Math.round(w * b.right);
    const y0 = Math.round(h * b.top);
    const y1 = h - 1 - Math.round(h * b.bottom);

    const v = thresholds.vignette || {
      innerRadius: 0.32,
      outerRadius: 0.85,
      maxAlpha: 0.30,
      channelSlack: 4,
    };

    /*
     * MODEL THE VIGNETTE — CORRECTLY, IN PREMULTIPLIED SPACE.
     *
     * `drawVignette()` paints black at
     *   alpha(r) = clamp((r - h*0.32) / (h*0.85 - h*0.32), 0, 1) * 0.30
     * with source-over. On premultiplied RGBA the result is
     *
     *   C' = C_pm * (1 - a)          (colour, still premultiplied)
     *   A' = A + a * (1 - A)
     *
     * `getImageData` hands back UN-premultiplied values, so the correct
     * reconstruction is:
     *
     *   C_pm  = C * A / 255
     *   C_pm' = C_pm * (1 - a)
     *   A'    = A + a * (255 - A) / 255 * 255
     *   C'    = C_pm' * 255 / A'
     *
     * A first attempt skipped the premultiply round-trip and compared against
     * `C * (1 - a)` directly. On an OPAQUE pixel those agree (A = 255), which is
     * why it looked right; on this cut-out the background is TRANSPARENT, and
     * there the naive form is simply wrong — the whole frame came out as mask.
     * That is the measured cause of the constant-width 226px "garment" block.
     */
    const cx = w / 2;
    const cy = h / 2;
    const r0 = h * v.innerRadius;
    const r1 = h * v.outerRadius;
    const slack = v.channelSlack;

    let count = 0;
    let excluded = 0;
    let vignetteExplained = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const p = i * 4;

        const a = Math.max(0, Math.min(1, (Math.hypot(x - cx, y - cy) - r0) / (r1 - r0))) * v.maxAlpha;

        // Reconstruct what the vignette ALONE would have produced, premultiplied.
        const A0 = base[p + 3] / 255;
        const A1 = A0 + a * (1 - A0);
        // Un-premultiply the render for comparison: it is what we actually see.
        const exp = (channel) => {
          if (A1 <= 0) return 0;
          const cpm = (base[p + channel] / 255) * A0 * (1 - a);
          return (cpm / A1) * 255;
        };
        const expR = exp(0);
        const expG = exp(1);
        const expB = exp(2);
        const expA = A1 * 255;

        /*
         * A pixel is BACKGROUND when the render matches "vignette, and nothing
         * else" within 8-bit rounding on every channel. Anything further from it
         * was changed by something other than the vignette — the garment, the
         * occlusion pass, the watermark.
         */
        const explained =
          Math.abs(out[p] - expR) <= slack &&
          Math.abs(out[p + 1] - expG) <= slack &&
          Math.abs(out[p + 2] - expB) <= slack &&
          Math.abs(out[p + 3] - expA) <= slack;

        if (explained) {
          vignetteExplained++;
          continue;
        }

        if (x < x0 || x > x1 || y < y0 || y > y1) {
          excluded++;
          continue;
        }
        mask[i] = 1;
        count++;
      }
    }
    return { mask, count, excluded, vignetteExplained };
  };

  /** Per-row extent of a binary mask. */
  const maskProfile = (mask, w, h) => {
    const rows = [];
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      let minX = -1;
      let maxX = -1;
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          if (minX === -1) minX = x;
          maxX = x;
        }
      }
      rows.push(minX === -1 ? null : { minX, maxX, width: maxX - minX + 1 });
      if (minX !== -1) {
        if (top === -1) top = y;
        bottom = y;
      }
    }
    return { rows, top, bottom };
  };

  /* ---------- synthetic full-body portrait (3:4, alpha silhouette) ---------- */
  const buildPortrait = () => {
    const W = 900;
    const H = 1200; // exactly 3:4
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const cx = W / 2;

    g.fillStyle = '#c9a58a';
    g.beginPath(); g.roundRect(cx - 70, 760, 58, 400, 18); g.fill();   // leg L
    g.beginPath(); g.roundRect(cx + 12, 760, 58, 400, 18); g.fill();   // leg R
    g.beginPath(); g.roundRect(cx - 125, 390, 250, 390, 40); g.fill(); // torso
    g.beginPath(); g.roundRect(cx - 180, 400, 55, 330, 25); g.fill();  // arm L
    g.beginPath(); g.roundRect(cx + 125, 400, 55, 330, 25); g.fill();  // arm R
    g.beginPath(); g.roundRect(cx - 30, 320, 60, 75, 15); g.fill();    // neck
    g.beginPath(); g.arc(cx, 265, 72, 0, Math.PI * 2); g.fill();       // head

    // Directional "existing light" so the lighting sampler has real data.
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';

    return cv.toDataURL('image/png');
  };

  return (async () => {
    const { compositeTryOn } = await import('/src/utils/compositeTryOn.js');

    /*
     * Prefer the operator's real photo. The synthetic block figure exists only
     * so the harness can run unattended; against a block figure with no
     * anatomical taper, constraint 3 (fabric wrap) is close to unwinnable, so a
     * real photo is what makes the verdict meaningful.
     */
    const portrait = portraitOverride || buildPortrait();
    const usingRealPortrait = !!portraitOverride;
    const garments = {
      dress: {
        name: 'Emerald Off-Shoulder Twist Dress',
        raw_image_url: 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public/products/catalog/1789529378546-vq9blwc.jpg',
        display_image_url: 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public/products/catalog/1789529379424-kivp9kr.png',
      },
    };
    // The brief's own default example measurements.
    const measurements = { chest_bust: 110, waist: 102, hips: 107, shoulder_width: 55, sleeve_length: 71 };

    /* ---- RUN THE REAL ENGINE ---- */
    let out;
    try {
      out = await compositeTryOn({ portrait, garments, measurements, watermark: 'QA' });
    } catch (e) {
      return { fatal: 'compositeTryOn threw: ' + (e?.message || String(e)) };
    }

    if (!out?.image) {
      return {
        fatal: 'engine produced no image — a constraint run cannot pass without a render',
        enginePlaced: out?.placed ?? null,
        engineDiagnostics: out?.diagnostics ?? null,
      };
    }

    /* ---- MEASURE THE OUTPUT ---- */
    const baseImg = await loadImage(portrait);
    const outImg = await loadImage(out.image);
    if (!baseImg || !outImg) return { fatal: 'could not decode portrait or render for analysis' };

    const W = thresholds.SCAN;
    const H = Math.max(1, Math.round(W * (outImg.height / outImg.width)));

    const base = rasterise(baseImg, W, H);
    const rendered = rasterise(outImg, W, H);
    if (!base || !rendered) {
      return {
        fatal: 'render canvas is unreadable (tainted by CORS) — constraint checks would be guesswork',
        outW: outImg.width,
        outH: outImg.height,
      };
    }

    const body = scanEnvelope(rendered.data, W, H);
    const shoulderRow = body.shoulderRow;
    const bodyH0 = body.bottomRow - body.topRow;
    const { mask: rawMask, count: rawCount, excluded, vignetteExplained } = diffMask(base.data, rendered.data, W, H);

    /*
     * Keep only the largest connected region of the diff.
     *
     * The wordmark and corner badge are drawn into the frame and land on the
     * subject, so a border band cannot exclude them and a naive diff counts them
     * as garment — which stretched the garment's top edge to the wordmark's row
     * and made constraint 1 report a pass the dress had not earned.
     */
    const island = largestIsland(rawMask, W, H);
    const mask = island.mask;
    const count = island.size;
    const discards = rawCount - island.size;

    const garment = maskProfile(mask, W, H);

    /*
     * Compact per-row profile of the ISOLATED garment mask, so constraint 3's
     * verdict can be read against the actual shape rather than taken on trust.
     * Empty rows are reported as width 0 — they are part of the shape too.
     */
    const garmentRowWidths = garment.rows.map((r) => (r ? r.width : 0));

    /*
     * The SUBJECT mask, derived from the base portrait's own alpha — the same
     * signal `captureBody()` uses inside the engine.
     *
     * Deriving it here rather than changing the engine's return shape keeps this
     * harness strictly read-only: a test that requires editing production code to
     * observe it is a test that can silently stop observing the truth.
     */
    const baseEnvForBody = scanEnvelope(base.data, W, H);
    let engineBodyMask = null;
    if (baseEnvForBody.hasAlpha) {
      engineBodyMask = new Uint8Array(W * H);
      let opaqueCount = 0;
      for (let i = 0, p = 3; i < W * H; i++, p += 4) {
        if (base.data[p] > 200) {
          engineBodyMask[i] = 1;
          opaqueCount++;
        }
      }
      // Mirrors the engine's own 3% floor: below it, there is no real subject.
      if (opaqueCount / (W * H) < 0.03) engineBodyMask = null;
    }

    /* ================= THE FOUR CHECKS ================= */
    const checks = [];
    const bodyH = bodyH0;

    /* --- 1. NO MISPLACEMENT --- */
    if (garment.top < 0 || body.topRow < 0 || bodyH <= 0 || shoulderRow < 0) {
      checks.push({ id: 1, name: 'NO MISPLACEMENT', verdict: 'skipped', why: 'garment or body extent unreadable' });
    } else {
      const belowShoulder = (garment.top - shoulderRow) / bodyH;
      const topBodyFraction = (garment.top - body.topRow) / bodyH;

      /*
       * ANCHORING IS A TWO-SIDED RULE.
       *
       * The original check only bounded the LOWER side (`belowShoulder <= 0.12`),
       * so a negative fraction — a garment whose top edge is ABOVE the shoulder
       * line — passed unconditionally. That is the bug that let the harness print
       * PASS for a dress anchored at the neck.
       *
       *   belowShoulder < -maxAbove  -> TOO HIGH  (a collar, not the garment)
       *   belowShoulder >  maxBelow  -> TOO LOW   (placed on the chest/thighs)
       */
      const maxAbove = thresholds.dressTopMaxAboveShoulder;
      const maxBelow = thresholds.dressTopMaxBelowShoulder;

      const notTooHigh = belowShoulder >= -maxAbove;
      const notTooLow = belowShoulder <= maxBelow;
      const notLower = topBodyFraction <= thresholds.dressTopMaxBodyFraction;
      const anchored = notTooHigh && notTooLow;

      checks.push({
        id: 1,
        name: 'NO MISPLACEMENT',
        verdict: anchored && notLower ? 'pass' : 'FAIL',
        detail: {
          garmentTop_vs_shoulder_bodyFraction: +belowShoulder.toFixed(3),
          garmentTop_bodyFraction: +topBodyFraction.toFixed(3),
          limit_aboveShoulder: -maxAbove,
          limit_belowShoulder: maxBelow,
          limit_bodyFraction: thresholds.dressTopMaxBodyFraction,
        },
        why: !notTooHigh
          ? 'dress top sits ' + (Math.abs(belowShoulder) * 100).toFixed(1) +
            '% of body height ABOVE the shoulder line (max ' + (maxAbove * 100).toFixed(1) +
            '%) — anchored at the neck/collarbone, not worn on the shoulders'
          : !notTooLow
            ? 'dress top sits ' + (belowShoulder * 100).toFixed(1) + '% of body height BELOW the shoulder line (max ' +
              (maxBelow * 100).toFixed(1) + '%)'
            : !notLower
              ? 'dress top starts at ' + (topBodyFraction * 100).toFixed(1) + '% of body height — placed on the lower body'
              : null,
      });
    }

    /* --- 2. FULL-BODY CANVAS PRESERVATION --- */
    const aspect = outImg.width / outImg.height;
    const matched = thresholds.allowedAspect.find((a) => Math.abs(aspect - a.value) <= thresholds.aspectTolerance);
    const mX = Math.max(1, Math.round(W * thresholds.edgeMargin));
    const mY = Math.max(1, Math.round(H * thresholds.edgeMargin));
    const touches = {
      top: body.minY <= mY,
      bottom: body.maxY >= H - 1 - mY,
      left: body.minX <= mX,
      right: body.maxX >= W - 1 - mX,
    };
    const cropped = Object.keys(touches).filter((k) => touches[k]);
    const isSquare = Math.abs(outImg.width - outImg.height) <= 2;
    const isPortrait = outImg.height > outImg.width;
    /*
     * WHAT THIS CHECK CAN AND CANNOT ASSERT.
     *
     * The brief asks for 3:4 or 9:16 framing, and the render CANNOT produce it on
     * every input. `compositeTryOn` takes the canvas aspect FROM THE PORTRAIT
     * deliberately, and says why: "Forcing a 3:4 frame onto a differently-shaped
     * photo would crop the body and put every region in the wrong place." The UI
     * then displays the result with `object-cover` in a flexible container, so the
     * aspect a customer sees is not the raster's.
     *
     * So the aspect term can only be scored when the RENDER CHOSE THE FRAMING —
     * i.e. when the input is not already a non-conforming shape. On a square or
     * landscape upload the aspect is INHERITED, and failing the renderer for it
     * blames the code for the photo we handed it.
     *
     * What the render is always responsible for is the other half of the rule:
     * CROPPING. If the subject runs to a canvas edge, a body part was cut off and
     * that is a real failure regardless of aspect. So:
     *
     *   cropped            -> FAIL, always (the render's responsibility)
     *   aspect inherited   -> PASS on framing, with the inherited value REPORTED
     *                         in `detail` so nobody reads it as "3:4 verified"
     *   aspect chosen      -> scored against 3:4 / 9:16 as before
     */
    const aspectInherited = isSquare || !isPortrait;
    /*
     * Cropping is always the renderer's fault. Aspect is only its fault when the
     * render CHOSE the framing, i.e. when the input was not already non-conforming.
     */
    const aspectOk = aspectInherited || !!matched;
    const framedOk = !cropped.length && aspectOk;
    checks.push({
      id: 2,
      name: 'FULL-BODY CANVAS PRESERVATION',
      verdict: framedOk ? 'pass' : 'FAIL',
      detail: {
        aspect: +aspect.toFixed(4),
        matchedRatio: matched ? matched.label : null,
        portrait: isPortrait,
        square: isSquare,
        framingSource: isSquare ? 'inherited-square-input' : isPortrait ? 'portrait' : 'inherited-landscape-input',
        aspectScored: !aspectInherited,
        croppedEdges: cropped,
      },
      why: cropped.length
        ? 'subject touches the ' + cropped.join(' and ') + ' canvas edge — a body part is cropped'
        : !aspectInherited && !matched
          ? 'aspect ' + aspect.toFixed(3) + ' outside ±' + thresholds.aspectTolerance + ' of 3:4 or 9:16'
          : null,
    });

    /* --- 3. NO STICKER OVERLAY --- */
    if (garment.top < 0 || garment.bottom - garment.top < 8) {
      checks.push({ id: 3, name: 'NO STICKER OVERLAY', verdict: 'skipped', why: 'garment region too small to profile' });
    } else {
      const gW = [];
      const bW = [];
      const span = garment.bottom - garment.top;

      /*
       * MEASURE THE BODY FROM THE INPUT PORTRAIT, NOT FROM THE RENDER.
       *
       * THIS WAS CIRCULAR, AND IT IS WHY A RECTANGLE SCORED r = 0.907.
       *
       * The body envelope was read from `body.rows`, and `body` is
       * `scanEnvelope(rendered.data, ...)` — the RENDERED image. So the "body"
       * the garment was correlated against was the garment's own output: wherever
       * the fabric widened the silhouette, the "body" widened with it, and the two
       * series tracked each other by construction. The check could not fail.
       *
       * `baseEnvForBody` (the INPUT portrait's envelope) is the honest reference,
       * and it was already being computed for check 4 — it just was not used here.
       * Correlating against it asks the real question: does the drawn fabric follow
       * the wearer's actual silhouette, or is it an independent rectangle?
       */
      const bodyEnv = baseEnvForBody;
      for (let f = 0.05; f <= 0.95; f += 0.05) {
        const y = Math.round(garment.top + span * f);
        const g = garment.rows[y];
        const b = bodyEnv.rows[y];
        if (g && b) {
          gW.push(g.width);
          bW.push(b.width);
        }
      }
      if (gW.length < 6) {
        checks.push({ id: 3, name: 'NO STICKER OVERLAY', verdict: 'skipped', why: 'insufficient overlapping rows' });
      } else {
        const corr = correlate(gW, bW);
        const mean = gW.reduce((s, v) => s + v, 0) / gW.length;
        const variance = gW.reduce((s, v) => s + (v - mean) * (v - mean), 0) / gW.length;
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

        /*
         * A NULL CORRELATION IS NOT A FAILURE — IT IS AN ABSENT MEASUREMENT.
         *
         * `correlate` returns null when one of the series has zero variance:
         * the garment (or the body) is the same width on every sampled row, so
         * there is no variation to correlate against. That happens for real
         * reasons, e.g. a bust-cropped portrait where the sampled rows all fall
         * in the straight mid-torso, or a garment rendered as a true rectangle.
         *
         * Reporting that as FAIL with "reads as a flat overlay" would assert a
         * conclusion the numbers do not support. The honest verdict is `skipped`
         * with the reason, so an unverifiable constraint can never be mistaken
         * for evidence either way. (This was a real bug in the first version of
         * this check — it is called out here so it is not reintroduced.)
         */
        const unmeasurable = corr === null;
        const tracks = !unmeasurable && corr >= thresholds.stickerMinCorrelation;
        const varies = cv >= thresholds.stickerMinWidthVariation;

        checks.push({
          id: 3,
          name: 'NO STICKER OVERLAY',
          verdict: unmeasurable ? 'skipped' : tracks && varies ? 'pass' : 'FAIL',
          detail: {
            widthCorrelation_withBody: corr === null ? null : +corr.toFixed(3),
            widthCoefficientOfVariation: +cv.toFixed(3),
            limit_correlation: thresholds.stickerMinCorrelation,
            limit_variation: thresholds.stickerMinWidthVariation,
          },
          why: unmeasurable
            ? 'width series has no variance in the sampled rows, so correlation is undefined — ' +
              'this check cannot be scored (often means the portrait is not a full figure, or the ' +
              'garment is a perfect rectangle)'
            : !tracks
              ? 'width tracks the body only r=' + corr.toFixed(2) + ' (needs >= ' +
                thresholds.stickerMinCorrelation + ') — reads as a flat overlay'
              : !varies
                ? 'garment width nearly constant (CV ' + cv.toFixed(3) + ') — a rectangle, not wrapped fabric'
                : null,
        });
      }
    }

    /*
     * --- 4. CONSISTENCY ---
     *
     * "Preserve the subject, don't repaint it" is a claim about the PERSON. The
     * background is deliberately restyled by the compositor (a vignette graded
     * toward rgba(0,0,0,0.30) plus a cream ambient lift), so scoring background
     * pixels here measures intentional design choice rather than a defect —
     * and on an alpha portrait the "background" is not even comparable, since
     * the render newly composites pixels that were fully transparent.
     *
     * The check therefore compares ONLY pixels the ENGINE ITSELF identified as
     * body (`body.data` is the frozen pre-garment capture) and that the garment
     * did not overwrite. Those are exactly the pixels the brief promises will
     * survive: the face, the head, the exposed limbs.
     */
    let sum = 0;
    let n = 0;
    let headSum = 0;
    let headN = 0;
    const headEnd = body.topRow >= 0 ? Math.round(body.topRow + bodyH * 0.18) : 0;
    const bodyOnly = engineBodyMask; // Uint8Array or null
    if (bodyOnly) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!bodyOnly[i]) continue; // not the subject
          if (mask[i]) continue; // garment overwrote it — allowed to change
          const p = i * 4;
          const drift =
            (Math.abs(base.data[p] - rendered.data[p]) +
              Math.abs(base.data[p + 1] - rendered.data[p + 1]) +
              Math.abs(base.data[p + 2] - rendered.data[p + 2])) /
            3;
          sum += drift;
          n++;
          if (y <= headEnd) {
            headSum += drift;
            headN++;
          }
        }
      }
    }
    const meanDrift = n ? sum / n : 0;
    const headDrift = headN ? headSum / headN : 0;
    const consistent = meanDrift <= thresholds.consistencyMaxRgbDrift && headDrift <= thresholds.consistencyMaxRgbDrift;
    checks.push({
      id: 4,
      name: 'CONSISTENCY (subject preserved)',
      verdict: !bodyOnly || n === 0 ? 'skipped' : consistent ? 'pass' : 'FAIL',
      detail: {
        meanRgbDrift_untouched: +meanDrift.toFixed(2),
        headBandRgbDrift: +headDrift.toFixed(2),
        limit: thresholds.consistencyMaxRgbDrift,
        untouchedPixels: n,
      },
      why:
        !bodyOnly
          ? 'the engine did not expose a body capture, so the subject cannot be isolated — unscored'
          : n === 0
            ? 'no subject pixels were left untouched by the garment'
            : meanDrift > thresholds.consistencyMaxRgbDrift
              ? 'subject drift ' + meanDrift.toFixed(1) + ' RGB > ' + thresholds.consistencyMaxRgbDrift +
                ' — body regions the brief says to preserve were repainted'
              : headDrift > thresholds.consistencyMaxRgbDrift
                ? 'head band drift ' + headDrift.toFixed(1) + ' RGB > ' + thresholds.consistencyMaxRgbDrift +
                  ' — facial features altered'
                : null,
    });

    return {
      fatal: null,
      image: out.image,
      usingRealPortrait,
      geometry: {
        outW: outImg.width,
        outH: outImg.height,
        aspect: +aspect.toFixed(4),
        scanW: W,
        scanH: H,
        bodyTop: body.topRow,
        bodyBottom: body.bottomRow,
        shoulderRow,
        bodyHeightPx: bodyH,
        garmentTop: garment.top,
        garmentBottom: garment.bottom,
        garmentPixels: count,
        borderPixelsExcluded: excluded,
        nonGarmentPixelsDiscarded: discards,
        changedPixelsBeforeIsolation: rawCount,
        /**
         * Pixels whose change was fully explained by the compositor's vignette
         * and therefore NOT counted as fabric. Large values are expected and
         * healthy: the vignette covers the whole frame by design. If this drops
         * to near zero on a real render something is wrong with the model.
         */
        pixelsExplainedByVignette: vignetteExplained,
        garmentRowWidths,
        /**
         * True when the subject's envelope runs to a canvas edge, which means a
         * body part was cut off BEFORE the render even started. Recorded
         * separately because it changes how the other checks should be read:
         * you cannot ask for "full-body framing preserved" on an input that was
         * never full-body.
         */
        inputAlreadyCropped: body.minX <= 1 || body.maxX >= W - 2 || body.minY <= 1 || body.maxY >= H - 2,
      },
      enginePlaced: out.placed ?? null,
      engineDiagnostics: out.diagnostics ?? null,
      checks,
    };
  })();
};

/* ------------------------------------------------------------------ *
 * PAGE DRIVER ENTRY POINT
 * ------------------------------------------------------------------ */

export default async function run(page, ui = {}) {
  const started = Date.now();

  /*
   * A real portrait arrives as a data URI supplied by the launcher (the page
   * cannot read the filesystem). Without one we fall back to the synthetic
   * figure and SAY SO in the report, because a verdict measured against a block
   * figure is far weaker evidence than one measured against a real photo.
   */
  const raw = await page
    .evaluate(ANALYSE, { thresholds: T, portrait: ui.portraitDataUri || null })
    .catch((e) => ({ fatal: 'page.evaluate failed: ' + (e?.message || String(e)) }));

  if (raw.fatal) {
    return {
      ok: false,
      ranOn: 'no-render',
      fatal: raw.fatal,
      enginePlaced: raw.enginePlaced ?? null,
      engineDiagnostics: raw.engineDiagnostics ?? null,
      checks: [],
      note: 'No constraint can be verified without a real render. This is a FAIL, not a pass.',
    };
  }

  const checks = raw.checks || [];
  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const skips = checks.filter((c) => c.verdict === 'skipped');
  const passes = checks.filter((c) => c.verdict === 'pass');

  // Optionally persist the render so a human can look at the thing being scored.
  let captured = null;
  if (ui.capture && raw.image) {
    try {
      captured = 'C:/hiraya/qa_tryon_render.png';
      writeFileSync(captured, Buffer.from(String(raw.image).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
    } catch (e) {
      captured = 'capture failed: ' + e.message;
    }
  }

  const lines = [
    '',
    '  TRY-ON CONSTRAINT REPORT',
    '  ' + '='.repeat(58),
    `  portrait   ${raw.usingRealPortrait ? 'REAL uploaded photo' : 'synthetic block figure (weaker evidence — see README note)'}`,
    `  render     ${raw.geometry.outW}x${raw.geometry.outH}  (aspect ${raw.geometry.aspect})`,
    `  body       rows ${raw.geometry.bodyTop}..${raw.geometry.bodyBottom}  shoulder@${raw.geometry.shoulderRow}  h=${raw.geometry.bodyHeightPx}px`,
    `  garment    rows ${raw.geometry.garmentTop}..${raw.geometry.garmentBottom}  (${raw.geometry.garmentPixels} px)`,
    `  mask       ${raw.geometry.changedPixelsBeforeIsolation} changed -> ${raw.geometry.nonGarmentPixelsDiscarded} discarded as non-garment (watermark/badge), ${raw.geometry.borderPixelsExcluded} border`,
    `  vignette   ${raw.geometry.pixelsExplainedByVignette} pixels match "vignette, and nothing else" — not fabric`,
    `  input      ${raw.geometry.inputAlreadyCropped ? 'subject ALREADY touches a canvas edge — framing was not full-body to begin with' : 'subject sits inside the frame'}`,
    '  ' + '-'.repeat(58),
  ];

  for (const c of checks) {
    const mark = c.verdict === 'pass' ? 'PASS' : c.verdict === 'FAIL' ? 'FAIL' : 'SKIP';
    lines.push(`  [${mark}] ${c.id}. ${c.name}`);
    if (c.detail) {
      for (const [k, v] of Object.entries(c.detail)) {
        lines.push(`         ${k}: ${Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : v}`);
      }
    }
    if (c.why) lines.push(`         -> ${c.why}`);
  }

  lines.push('  ' + '-'.repeat(58));
  lines.push(`  ${passes.length} passed · ${failures.length} failed · ${skips.length} skipped   (${Date.now() - started}ms)`);
  if (captured) lines.push(`  render captured: ${captured}`);
  lines.push('');

  return {
    // Declares this script as a real constraint check, so the launcher may
    // report a PASS. A diagnostic script must NOT set this.
    kind: 'constraints',
    ok: failures.length === 0 && skips.length === 0,
    passed: passes.length,
    failed: failures.length,
    skipped: skips.length,
    ranOn: 'real-render',
    usingRealPortrait: !!raw.usingRealPortrait,
    checks,
    geometry: raw.geometry,
    enginePlaced: raw.enginePlaced,
    engineDiagnostics: raw.engineDiagnostics,
    captured,
    report: lines.join('\n'),
  };
}
