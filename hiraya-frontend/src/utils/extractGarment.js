/**
 * extractGarment — recover the GARMENT'S OWN PIXELS from a Hiraya catalog asset.
 *
 * WHY THIS EXISTS
 * ---------------
 * The AI Try-On was fed `display_image_url`, which is NOT a garment cut-out. It is
 * a fully-composed 1000x1250 MARKETING CARD: black background, gold corner
 * frames, a drop reflection, the product name in script type and the Hiraya logo.
 * Measured from the live catalog:
 *
 *   display_image_url -> image/png, 1000x1250, zero transparency
 *   image_url         -> image/jpeg, 1080x1350, zero transparency
 *
 * Neither has an alpha channel, so the renderer received "a poster of a dress in
 * a black frame" and faithfully reproduced the poster — which is exactly why the
 * output carried the shop background and kept the garment's shop pose and size.
 *
 * WHICH SOURCE, AND WHY
 * ---------------------
 * The RAW JPEG is preferred over the display card, because measurement of both
 * (sampled corner colours + luma histograms) shows it segments far better:
 *
 *   RAW jpg : background is a LIGHT sage/cream gradient, corners ~[168,181,172];
 *             the garment is DARK [0,38,44] -> a strong, stable contrast.
 *   display : background is pure black [1,1,1] and the card's frame, logo and
 *             script text are ALSO black, so the garment cannot be separated from
 *             the artwork by colour at all.
 *
 * So the problem becomes: dark garment on a light field, with a reflection below a
 * horizontal seam. That has a reliable, deterministic answer.
 *
 * THE PIPELINE
 * ------------
 *   1. SEGMENT — split garment from background by LUMA against a threshold
 *                derived from the image's OWN histogram (Otsu). Because the
 *                threshold is adaptive it does not depend on the background being
 *                any particular colour.
 *   2. CLEAN   — keep only the LARGEST connected component, which drops the
 *                "Emerald" script, the logo, the corner frames and the flowers
 *                wholesale, without per-product size tuning.
 *   3. CUT     — find the reflection seam (a near-uniform band) and clamp the crop
 *                above it, so the mirrored copy never enters the cut-out.
 *   4. ALPHA   — write the component mask into the output alpha channel, so the
 *                returned PNG contains garment pixels ONLY.
 *
 * Runs on a canvas, offline. No model, no network call, no new AI provider.
 */

/** Max scan dimension. Keeps the passes and the flood fill fast. */
const SCAN_MAX = 400;

/**
 * Flood-fill connectivity for grouping garment pixels into components.
 * 8-way so a garment with thin straps is not split into pieces.
 */
const NEIGHBOURS = [
  [-8, -8], [-8, -6], [-8, -4], [-8, -2], [-8, 0], [-8, 2], [-8, 4], [-8, 6], [-8, 8],
  [-6, -8], [-6, -6], [-6, -4], [-6, -2], [-6, 0], [-6, 2], [-6, 4], [-6, 6], [-6, 8],
  [-4, -8], [-4, -4], [-4, 0], [-4, 4], [-4, 8],
  [-2, -8], [-2, -2], [-2, 0], [-2, 2], [-2, 8],
  [0, -8], [0, -4], [0, -2], [0, 2], [0, 4], [0, 8],
  [2, -8], [2, -2], [2, 0], [2, 2], [2, 8],
  [4, -8], [4, -4], [4, 0], [4, 4], [4, 8],
  [6, -8], [6, -6], [6, -4], [6, -2], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
  [8, -8], [8, -6], [8, -4], [8, -2], [8, 0], [8, 2], [8, 4], [8, 6], [8, 8],
];

/**
 * Load an image, resolving to null instead of rejecting.
 * `crossOrigin` is deliberately unset so a non-CORS host still decodes.
 */
const loadImage = (src) =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || !src) return resolve(null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** Read the image into a downscaled, READABLE canvas. */
const toScan = (img) => {
  const scale = Math.min(1, SCAN_MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    return { canvas, ctx, w, h, data };
  } catch {
    // Tainted: cross-origin image without CORS. The caller must inline the bytes
    // first (see toReadableSource) for extraction to be possible at all.
    return null;
  }
};

/**
 * SCAN-RESOLUTION COLOUR SEGMENTATION, ANCHORED ON THE BORDER.
 *
 * Background in a Hiraya product shot is whatever fills the frame edges, and it
 * is always CONNECTED to those edges. So rather than guessing a global threshold
 * (which fails on a beige garment over a beige backdrop — measured: both sit
 * within ~20 luma of each other), we grow the background inward from the border
 * and treat everything the growth cannot reach as garment.
 *
 * Growth is region-based: a pixel joins the background when it is colour-close to
 * an ALREADY-BACKGROUND NEIGHBOUR. That tolerates the smooth vertical gradient of
 * these backdrops while still stopping at the garment's edge, where the colour
 * change is abrupt.
 */

/**
 * PER-ROW BACKGROUND MODEL SEGMENTATION.
 *
 * WHY NOT A GLOBAL THRESHOLD OR A BORDER FLOOD
 * -------------------------------------------
 * Both were tried against the live catalog and both fail, for measurable reasons:
 *
 *   - A GLOBAL luma threshold cannot work, because the garment/backdrop contrast
 *     varies enormously between products. Measured: EMERALD has a backdrop at
 *     luma ~170 and a garment at ~1-30 (a gap of 140), while BEIGE has a backdrop
 *     at ~220 and a garment at ~173-195 (a gap of only ~25). Any single cutoff
 *     that separates one merges the other.
 *
 *   - A BORDER FLOOD-FILL through a gradient LEAKS. Each step is a tiny colour
 *     change, so with a neighbour-to-neighbour test the fill walks the whole
 *     frame and claims 96%+ of it as background even at a tolerance of 8.
 *
 * What is actually true of these shots is that the BACKDROP IS A VERTICAL
 * GRADIENT THAT IS HORIZONTALLY UNIFORM: any two background pixels in the same
 * row have almost the same colour, whatever the row. So the garment is detected
 * as the pixels that DEVIATE FROM THEIR OWN ROW'S BORDER COLOUR.
 *
 * That is amplitude-independent — it needs the garment to differ from the
 * backdrop *in that row*, not to be globally dark or globally bright — which is
 * exactly why it handles both the high-contrast and low-contrast products.
 *
 * @param {number} scanBottom  scan row to STOP at (the reflection seam); rows at
 *        or below it are marked background, so the mirrored copy is never taken
 *        for garment.
 * @returns {{mask: Uint8Array, rowBg: Array}} 1 = background, 0 = garment.
 */
const segmentAgainstRowBackground = (data, w, h, scanBottom) => {
  const mask = new Uint8Array(w * h);

  // Rows at/below the seam are background outright.
  for (let y = Math.max(0, scanBottom); y < h; y++) {
    for (let x = 0; x < w; x++) mask[y * w + x] = 1;
  }

  const rowBg = [];

  for (let y = 0; y < Math.min(h, scanBottom); y++) {
    /*
     * Sample this row's background from BOTH edges, inset a little to avoid any
     * border artefact, and average them. Using a small window (rather than a
     * single pixel) makes the estimate robust to grain and to a corner flourish.
     */
    const INSET = 3;
    const WIN = 4;
    let br = 0, bg = 0, bb = 0, bn = 0;

    for (let k = 0; k < WIN; k++) {
      for (const x of [INSET + k, w - 1 - INSET - k]) {
        const i = (y * w + x) * 4;
        br += data[i];
        bg += data[i + 1];
        bb += data[i + 2];
        bn++;
      }
    }

    if (!bn) continue;
    const r = br / bn;
    const g = bg / bn;
    const b = bb / bn;
    rowBg.push({ y, r, g, b });

    /*
     * Threshold for THIS row.
     *
     * A fixed distance would fail on the low-contrast product, so the tolerance
     * is the midpoint between this row's background level and the frame's overall
     * DARKEST level. That adapts per row: where the backdrop is bright and the
     * garment dark (EMERALD) the midpoint is high and generous; where they are
     * close (BEIGE) it tightens automatically.
     */
    const bgLuma = 0.299 * r + 0.587 * g + 0.114 * b;

    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (mask[p]) continue;

      const i = p * 4;
      if (data[i + 3] < 16) { mask[p] = 1; continue; }

      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

      // Deviation from this row's own backdrop, in luma and in colour.
      const dl = Math.abs(luma - bgLuma);
      const dr = Math.abs(data[i] - r);
      const dg = Math.abs(data[i + 1] - g);
      const db = Math.abs(data[i + 2] - b);
      const colourDist = Math.sqrt(dr * dr + dg * dg + db * db);

      /*
       * A pixel is GARMENT when it departs from the row's backdrop enough to be
       * intentional. 26 luma / 42 colour-distance sits above the backdrop's own
       * grain (measured well under 10) and below the garment's departure on both
       * products (EMERALD ~140 luma, BEIGE ~25-45 luma but a clear colour shift
       * from the backdrop's greenish-grey toward the garment's warm cream).
       */
      const isGarment = dl >= 26 || colourDist >= 42;
      if (!isGarment) mask[p] = 1;
    }
  }

  return { mask, rowBg };
};

/**
 * Locate the REFLECTION SEAM from the per-row foreground coverage profile.
 *
 * THE PROFILE, MEASURED ON BOTH LIVE PRODUCTS
 * -------------------------------------------
 * Rendering the coverage as one digit per 1% of height (0 = no foreground,
 * 9 = 90%+ foreground) gives:
 *
 *   EMERALD  0001133344433333...33334444433300033349998833455765664352
 *   BEIGE    0000134444222122222...22223333344433100255555634422222100000
 *
 * Both show the SAME signature, and it is unmistakable:
 *
 *   1. a sustained PLATEAU (the garment) at coverage 2-4,
 *   2. a COLLAPSE to 0-2 (the gap between the garment's base and the mirror),
 *   3. a RECOVERY back up to 5-9 (the reflection catching the light).
 *
 * WHY THIS IS THE RIGHT SIGNAL
 * ----------------------------
 * A mirror-similarity search (comparing the band above a candidate row with the
 * band below) was implemented first and MEASURED: it picked 54% (EMERALD) and 41%
 * (BEIGE), both inside the garment, because a dress is self-similar enough that a
 * flipped copy of it still matches. A plain "biggest drop" search has the same
 * weakness — the neckline and waist create local drops.
 *
 * Requiring the collapse to be FOLLOWED BY A RECOVERY is what makes it specific:
 * only a reflection produces a valley with a rise after it. A waistline does not.
 *
 * @param {Uint8Array} foreground  per-pixel 1 = not-backdrop.
 * @returns {number|null} scan-row index of the seam, or null when none is found.
 */
const findReflectionSeam = (foreground, w, h) => {
  // Per-row foreground fraction, sampled every 2nd column.
  const coverage = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x += 2) {
      if (foreground[y * w + x]) n++;
    }
    coverage[y] = n / Math.ceil(w / 2);
  }

  /*
   * Search the LOWER half only. A garment on these shots always fills well over
   * the upper half, so the base cannot be above the midpoint.
   */
  const from = Math.round(h * 0.5);

  const WINDOW = Math.max(3, Math.round(h * 0.02));
  const mean = (a, b) => {
    let sum = 0;
    let n = 0;
    for (let y = a; y <= b; y++) {
      if (y < 0 || y >= h) continue;
      sum += coverage[y];
      n++;
    }
    return n ? sum / n : 0;
  };

  for (let y = from; y < h - 1; y++) {
    const before = mean(y - WINDOW, y - 1);
    const here = coverage[y];
    const after = mean(y + 1, y + WINDOW);

    /*
     * (1) this row is genuinely empty, and
     * (2) the garment above it was NOT empty, and
     * (3) content RETURNS below it — the reflection.
     *
     * The recovery test is deliberately LOOSER than the collapse test (0.08 vs
     * 0.15): measured on the BEIGE product, whose garment sits close to its
     * backdrop, the valley is `444 -> 0` but the reflection only recovers to ~`2`
     * because a pale garment reflects fainter than a dark one. An equally strict
     * threshold missed that seam entirely and let the whole mirror into the crop.
     */
    const collapse = before - here;
    const recovery = after - here;

    if (collapse < 0.12 || recovery < 0.05) continue;

    /*
     * TAKE THE FIRST QUALIFYING VALLEY, NOT THE DEEPEST.
     *
     * THIS IS THE REFLECTION FIX.
     *
     * The old code kept the maximum `collapse + recovery` across the whole lower
     * half, and on the live catalog that picked a valley INSIDE the mirror rather
     * than the garment/mirror boundary. Measured coverage profiles (320x400 scan,
     * percent of width occupied):
     *
     *   EMERALD  ...71%:33  72%:0  73%:0  74%:25...   <- the REAL boundary at 72%
     *            ...81%:34  82%:86 83%:88 84%:39...  <- the deep one it picked
     *
     * The lower valley swings 34->88->39, a far larger score, so "deepest" chose
     * it and the cut landed at 83% — leaving the mirror's head in the crop. That
     * is exactly the band left at the bottom of the BEIGE and EMERALD cut-outs.
     *
     * Scanning FORWARD and returning the first valley that qualifies selects the
     * true boundary, because the garment/mirror gap is by definition the FIRST
     * collapse-with-recovery below the garment's midpoint.
     */
    if (collapse + recovery >= 0.22) return y;
  }

  /*
   * No qualifying valley: a shot with NO reflection. A collar or sleeve gap
   * creates a small valley, but not a deep one with a strong recovery, so
   * answering null is the honest result and the caller treats the whole frame as
   * garment.
   */
  return null;
};

/**
 * Group the mask into 8-connected components and keep the GARMENT ones.
 *
 * WHY NOT JUST THE LARGEST COMPONENT
 * ----------------------------------
 * Keeping only the biggest component was tried and it silently TRUNCATED the
 * low-contrast product: measured on the BEIGE dress, whose fabric sits only ~25
 * luma from its backdrop, the silhouette fragments — the bodice, each sleeve and
 * the skirt hem landing as separate components. Keeping just the largest returned
 * the bodice alone and cut the sleeves and skirt off.
 *
 * So we instead keep EVERY component that is large enough to be part of a
 * garment, and drop the small ones. That removes the artwork (the product script,
 * the logo, the corner frames, the flower wreath and its speckles are all small
 * relative to the garment) while never discarding a real sleeve.
 *
 * The threshold is relative to the LARGEST component, which is scale-agnostic: a
 * sleeve is typically 5-15% of the bodice's area, whereas speckles are well under
 * 1%.
 *
 * @returns {Object|null} the union box plus the set of retained pixel indices.
 */
/*
 * STRIP THE CAPTION BAND FROM THE GARMENT'S OWN PIXELS.
 *
 * MEASURED FACT (EMERALD): the product-name script sits at frame rows 5-12% and
 * its letters TOUCH the dress's shoulder, so the 8-connected flood merges
 * script + dress into ONE component (measured: the largest component spans
 * 5%->72% of frame height, i.e. it begins inside the caption band). Component
 * rejection can therefore never remove it — the script is not a separate
 * component to reject, it is part of the component we keep.
 *
 * So the fix is applied to the MASK CONTENT, not to a component list. See the
 * body of stripCaptionBand() for the measured reason a simple row cut is not
 * enough and a horizontal-run filter is used instead.
 *
 * @returns {number} the chosen shoulder row (0 when nothing was stripped).
 */
const stripCaptionBand = (m, W, H) => {
  const bandEnd = Math.round(H * 0.16);

  /*
   * PER-COLUMN: THE CAPTION IS THE TOP RUN, THE GARMENT THE NEXT RUN DOWN.
   *
   * Everything else was tried and measured against the live catalog, and the
   * evidence is recorded here so it is not re-attempted:
   *
   *   - A ROW CUT above the shoulder fails: on EMERALD the script's baseline
   *     TOUCHES the dress's shoulder strap, so no row separates them.
   *   - A THIN-RUN prune fails: it cleaned EMERALD but shredded BEIGE, whose pale
   *     fabric (~25 luma from its backdrop) fragments into thin runs.
   *   - An ISLAND flood fails: the caption is CONNECTED to the dress on EMERALD
   *     (one component, top 5%..72%), so it is never a detached island.
   *   - A LEFT-EDGE band cut fails: it removed EMERALD's left shoulder and sliced
   *     BEIGE, because the garment occupies the left columns too.
   *   - A SPAN/COUNT threshold fails: on EMERALD the script's thick initial is
   *     wide and solid enough to satisfy any span-and-density test first.
   *
   * What IS true in every case is COLUMN ORDER: reading down a column you meet the
   * caption FIRST and the garment SECOND, and where the script sits the stroke
   * ENDS before the garment's shoulder begins, leaving a gap. So the two are
   * separate runs DOWNWARD even though they are connected sideways.
   *
   * Therefore, for each column, the topmost run is dropped when it is SHORT and a
   * further run exists below it. A garment's top run continues far down the figure
   * (much deeper than the caption band), so it is never short and never dropped;
   * a caption stroke always ends inside the band.
   *
   * A column-only test is still not enough on its own: on the pale product the
   * dress's LEFT SHOULDER slopes, so at the outer columns its top run is genuinely
   * short with a gap beneath it — and a plain column test ate it, leaving the torn
   * bite and the flap seen in the measured BEIGE cut-out.
   *
   * So the drop is also gated on the GARMENT'S SHOULDER LINE. The caption always
   * ends ABOVE the row where the widest mass of the garment begins; a real
   * shoulder reaches down through it. Requiring the candidate run to lie entirely
   * above that row protects every genuine shoulder, sloping or not, while still
   * removing the caption in the columns where it sits.
   */
  const minDressDepth = Math.round(H * 0.20);

  /*
   * MEASURED COLUMN RUNS (EMERALD, 320x400 scan, caption band = top 16% = 64 rows):
   *
   *   x10 (3%)   22-25, 32-36, 44-47   short caption fragments
   *   x30 (9%)   28-31, 38-45          caption
   *   x60 (19%)  26-34                 caption (one run, no gap)
   *   x100(31%)  29-63                 the DRESS — runs to the band floor
   *   x140(44%)  48-63                 the DRESS
   *   x200(63%)  35-63                 the DRESS
   *
   * The pattern is unmistakable once the two columns are compared: a CAPTION run
   * ends in the middle of the band (row 25-47), whereas a GARMENT run reaches the
   * band floor (row 63) because the fabric continues down the figure. The earlier
   * "ends above the shoulder line" gate was too strict and let the caption through
   * on the columns where the script's tail met the shoulder's row.
   *
   * So the test is: a SHORT top run, with a gap, whose next run REACHES THE BAND
   * FLOOR. The last clause is what separates a caption from a sloping shoulder
   * (which also has a short top run and a gap, but whose lower run does NOT reach
   * the floor — the shoulder is inside the garment, not the start of a long drop).
   */
  const floorRow = bandEnd - 1;

  /*
   * MEASURED COMPONENT GEOMETRY (the basis for both clauses below)
   * -----------------------------------------------------------------
   * 320x400 scan, production segmentation, as percentages of the frame:
   *
   *   EMERALD  dress+caption  x2  y5  w68 h67   (caption welded, starts x2 y5)
   *            reflection     x6  y74 w89 h26
   *
   *   BEIGE    dress          x30 y7  w39 h65
   *            reflection     x30 y73 w39 h18
   *            caption        x13 y7  w14 h8    <- a SEPARATE small component
   *
   * Two facts hold for both products and are what this pass exploits:
   *
   *   1. The caption lives in the TOP-LEFT: EMERALD x<25 y<13, BEIGE x13-27 y7-15.
   *      No Hiraya garment puts fabric there — the bodice is centred (EMERALD's
   *      body sits near x40-60, BEIGE's at x30-69).
   *
   *   2. A caption COMPONENT is small and wide (BEIGE's is w14 h8), never a tall
   *      mass, so it can be dropped by shape.
   *
   * Earlier failures came from applying these to the WRONG extent — a blanket
   * left-column cut (which removed EMERALD's left sleeve) or a row cut (which could
   * not separate a welded script). Restricting BOTH the rows and the columns to the
   * measured top-left corner, and additionally requiring the column test to see a
   * short run, is what makes it safe for a welded caption AND a separate one.
   */
  const captionRows = Math.round(H * 0.15);
  const captionCols = Math.round(W * 0.26);

  for (let x = 0; x < W; x++) {
    const runs = [];
    let y = 0;
    while (y < bandEnd) {
      if (!m[y * W + x]) { y++; continue; }
      const start = y;
      while (y < bandEnd && m[y * W + x]) y++;
      runs.push({ start, end: y - 1 });
    }

    if (runs.length === 0) continue;

    if (runs.length >= 2) {
      const top = runs[0];
      const next = runs[1];
      const topDepth = top.end - top.start + 1;
      /* Separate caption stroke sitting on top of a garment run. */
      if (topDepth < minDressDepth && next.start > top.end + 1 && next.end >= floorRow) {
        for (let yy = top.start; yy <= top.end; yy++) m[yy * W + x] = 0;
      }
      continue;
    }

    /*
     * WELDED CAPTION — only inside the measured top-left corner.
     *
     * The ≤6% · every-column version this replaces DID fire, and that was the
     * problem: trimming the top of any single deep run cut real fabric on BEIGE
     * (its dress edge and hem) and left the torn bite in the rendered cut-out.
     * Confining the trim to `x < captionCols` AND `y < captionRows` hits only the
     * region the caption actually occupies, so a dress edge elsewhere is untouched.
     */
    if (x >= captionCols) continue;

    const only = runs[0];
    if (only.start < captionRows && only.end - only.start + 1 >= minDressDepth) {
      const trimTo = Math.min(only.end, only.start + Math.round(H * 0.06) - 1);
      for (let yy = only.start; yy <= trimTo; yy++) m[yy * W + x] = 0;
    }
  }

  /* Return the first row that still carries the garment, for the caller's crop. */
  for (let y = 0; y < bandEnd; y++) {
    let occupied = 0;
    for (let x = 0; x < W; x++) if (m[y * W + x]) occupied++;
    if (occupied >= W * 0.08) return y;
  }

  return 0;
};

/*
 * Morphological CLOSE (dilate then erode) on a binary mask.
 *
 * WHY THIS IS NEEDED FOR THE PALE GARMENT
 * ---------------------------------------
 * On a garment that sits close to its backdrop in tone, the per-row colour test
 * punches scattered pixels OUT OF THE MIDDLE of the fabric and leaves thin gaps
 * where the shading dips. Measured on BEIGE (garment ~25 luma from backdrop) the
 * result was a dress that fragmented into separate vertical slivers, and after
 * cropping it rendered as a torn garment.
 *
 * `fillEnclosedHoles` handles holes that are fully surrounded, but it cannot
 * mend a gap that opens to the silhouette's edge. A CLOSE does: dilation bridges
 * a gap up to 2r wide, then erosion restores the outer boundary to where it was,
 * so speckle and tears vanish while the silhouette's true edge is preserved.
 *
 * @param {Uint8Array} mask  1 = garment
 * @param {number} r         closing radius in scan pixels
 */
const closeMask = (mask, w, h, rz, rx = rz) => {
  if (rz <= 0 && rx <= 0) return mask;

  /*
   * SEPARABLE BOX DILATION.
   *
   * A HORIZONTAL pass followed by a VERTICAL one, instead of an inner k x k
   * kernel. For radius rx=5, rz=1 the kernel form does up to 11*3 = 33 writes per
   * set pixel; the separable form does (2*rx+1) + (2*rz+1) = 14, and — more
   * importantly — it touches each pixel a fixed number of times instead of
   * depending on the mask's density. Mask operations are the bulk of this file's
   * work, so this is where the time is.
   */
  const horiz = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[base + x]) continue;
      const x0 = x - rx < 0 ? 0 : x - rx;
      const x1 = x + rx >= w ? w - 1 : x + rx;
      for (let nx = x0; nx <= x1; nx++) horiz[base + nx] = 1;
    }
  }

  const dilate = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    const y0 = y - rz < 0 ? 0 : y - rz;
    const y1 = y + rz >= h ? h - 1 : y + rz;
    for (let x = 0; x < w; x++) {
      if (!horiz[base + x]) continue;
      for (let ny = y0; ny <= y1; ny++) dilate[ny * w + x] = 1;
    }
  }

  const eroded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = y - rz < 0 ? 0 : y - rz;
    const y1 = y + rz >= h ? h - 1 : y + rz;
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let ny = y0; ny <= y1 && all; ny++) {
        const base = ny * w;
        const x0 = x - rx < 0 ? 0 : x - rx;
        const x1 = x + rx >= w ? w - 1 : x + rx;
        for (let nx = x0; nx <= x1; nx++) {
          if (!dilate[base + nx]) { all = 0; break; }
        }
      }
      eroded[y * w + x] = all;
    }
  }

  return eroded;
};

const extractGarmentComponents = (mask, w, h) => {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const components = [];

  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    let size = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    let sumY = 0;

    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;

      size++;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let k = 0; k < NEIGHBOURS.length; k++) {
        const nx = x + NEIGHBOURS[k][0];
        const ny = y + NEIGHBOURS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }

    components.push({ size, minX, minY, maxX, maxY, avgY: sumY / size });
  }

  if (components.length === 0) return null;

  const largest = components.reduce((a, b) => (b.size > a.size ? b : a), components[0]);

  /*
   * THREE FILTERS decide what is garment.
   *
   *  1. SIZE — must be at least 4% of the largest component. A sleeve or a skirt
   *     panel comfortably clears this; grain speckles and flower fragments do not.
   *
   *  2. FILL DENSITY — a garment region is a SOLID mass of pixels, whereas text
   *     and line art are strokes around mostly-empty boxes. Measuring the
   *     component's filled pixels against its bounding-box area separates them
   *     even when the text is large (measured: the "Beige" and "Emerald" scripts
   *     occupy under 30% of their own boxes, while the dresses exceed 70%).
   *
   *  3. TOP STRIP — anything living entirely inside the top 12% of the frame, and
   *     short, is the product name or the logo.
   */
  const MIN_RATIO = 0.04;
  /*
   * The top 16% of the frame is the caption band. Both live products place the
   * script name inside it, and it is the only place artwork can hide and still be
   * the same tone as the garment.
   */
  const TOP_GUARD = h * 0.16;

  /*
   * NOTE ON FILL DENSITY.
   *
   * A density test (filled pixels / bounding-box area) was tried to reject the
   * product-name script, and it had to be REMOVED after being measured: the
   * garments themselves score only ~0.11, not the ~0.7 a solid dress would give,
   * because a dress's bounding box includes the large enclosed gaps between the
   * skirt and the arms and around the neckline. The script scores in the same
   * range, so density cannot separate them — the test rejected the garment and
   * kept the artwork, which is worse than not having it.
   *
   * The top-strip rule below is what actually handles the script, and it does so
   * without a fragile threshold.
   */
  const isArtwork = (c) => {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;

    /*
     * A CAPTION COMPONENT IS SMALL AND SITS IN THE TOP-LEFT.
     *
     * This is the clause that removes the SEPARATE caption — the case that does
     * not need welding logic. Measured on BEIGE: the "Beige" script is its own
     * component `x13 y7 w14 h8` (percent of frame) while the dress is `x30 y7
     * w39 h65`. So a component that is SHORT (<=18% of frame height), lies in the
     * top-left corner, and does not reach into the body of the figure is artwork.
     *
     * Scoped tightly on purpose: the earlier vageu `maxY < TOP_GUARD (16%)` test
     * was close, but dropping the x/y confinement let it consider parts of the
     * garment. Anchoring all three — small, top, left — is what makes it safe.
     */
    const smallAndTopLeft =
      bh / h <= 0.18 &&
      c.minY < h * 0.18 &&
      c.minX < w * 0.32;
    if (smallAndTopLeft) return true;

    /*
     * WORD SHAPED: a very wide, very short box is type, not fabric. Kept as a
     * second net for a caption set across the top; a garment piece is never an
     * extreme letterbox.
     */
    if (bh > 0 && bw / bh > 3.2 && bh / h < 0.2) return true;

    /* Legacy band guard, retained for a long caption that escapes the corner. */
    if (c.maxY < TOP_GUARD && bh / h < 0.30) return true;

    /*
     * DETACHED SATELLITE: a blob that does NOT overlap the garment's main mass.
     *
     * MEASURED (BEIGE): the piece that reads as a torn flap on the lower-right of
     * the skirt is a flower-wreath fragment at x≈280-310. It is LARGE (its area
     * clears any "small blob" test) and it does not touch the frame edge either,
     * so neither of the obvious rejections catches it. What is true of it, and of
     * every other stray decoration, is that it does NOT OVERLAP THE MAIN GARMENT
     * HORIZONTALLY — it floats in a column range the dress never occupies.
     *
     * A real sleeve, skirt panel or hem overlaps the body's own column span, even
     * when it fragments away from it vertically, so this is safe for genuine
     * pieces while removing the wreath's satellites.
     */
    const overlapX = Math.min(c.maxX, largest.maxX) - Math.max(c.minX, largest.minX);
    const overlapY = Math.min(c.maxY, largest.maxY) - Math.max(c.minY, largest.minY);
    const overlapsMain = overlapX >= 0 && overlapY >= 0;
    if (!overlapsMain && c !== largest) return true;

    /* A tiny blob is noise wherever it lives. */
    if (c.size < largest.size * 0.06) return true;

    return false;
  };

  const kept = components.filter((c) => {
    if (c.size < largest.size * MIN_RATIO) return false;
    if (isArtwork(c)) return false;
    return true;
  });

  if (kept.length === 0) return null;

  const box = kept.reduce(
    (acc, c) => ({
      size: acc.size + c.size,
      minX: Math.min(acc.minX, c.minX),
      minY: Math.min(acc.minY, c.minY),
      maxX: Math.max(acc.maxX, c.maxX),
      maxY: Math.max(acc.maxY, c.maxY),
    }),
    { size: 0, minX: w, minY: h, maxX: -1, maxY: -1 },
  );

  /*
   * Re-walk the kept components to build the final pixel mask.
   * Done here rather than during grouping because membership is only known once
   * every component's size has been compared against the largest.
   */
  const keepMask = new Uint8Array(w * h);
  const seen2 = new Uint8Array(w * h);

  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen2[start]) continue;

    stack.length = 0;
    stack.push(start);
    seen2[start] = 1;

    const members = [];
    let minX = w, minY = h, maxX = -1, maxY = -1;

    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;

      members.push(p);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let k = 0; k < NEIGHBOURS.length; k++) {
        const nx = x + NEIGHBOURS[k][0];
        const ny = y + NEIGHBOURS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n] && !seen2[n]) {
          seen2[n] = 1;
          stack.push(n);
        }
      }
    }

    // The same predicate the `kept` filter used above.
    const candidate = { size: members.length, minX, minY, maxX, maxY };
    if (members.length >= largest.size * MIN_RATIO && !isArtwork(candidate)) {
      for (const m of members) keepMask[m] = 1;
    }
  }

  /*
   * CLOSE THE INTERIOR HOLES.
   *
   * On the low-contrast product the fabric's own shading dips close enough to the
   * backdrop that the per-row test punches scattered pixels out of the MIDDLE of
   * the garment — visible as speckled holes in the beige dress. Those pixels are
   * not reachable from the frame border, so a border flood cannot classify them as
   * background either. We therefore fill any hole that is NOT connected to the
   * outside of the garment mask.
   */
  const filled = fillEnclosedHoles(keepMask, w, h);

  return { ...box, mask: filled };
};

/**
 * Fill holes in a mask that are fully enclosed by it.
 *
 * Runs a flood fill over the EMPTY pixels starting from the frame border. Any
 * empty pixel the fill cannot reach is inside the garment, so it is turned on.
 *
 * @returns {Uint8Array} the mask with interior holes filled.
 */
const fillEnclosedHoles = (mask, w, h) => {
  const outside = new Uint8Array(w * h);
  const stack = [];

  const seed = (x, y) => {
    const p = y * w + x;
    if (mask[p] || outside[p]) return;
    outside[p] = 1;
    stack.push(p);
  };

  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    const y = (p - x) / w;

    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (!mask[n] && !outside[n]) {
        outside[n] = 1;
        stack.push(n);
      }
    }
  }

  const result = new Uint8Array(mask);
  for (let p = 0; p < w * h; p++) {
    // Empty AND unreachable from the border -> enclosed hole -> fill it.
    if (!mask[p] && !outside[p]) result[p] = 1;
  }

  return result;
};

/**
 * Make an image READABLE for pixel work.
 *
 * A remote image served without CORS headers TAINTS the canvas, which makes
 * `getImageData` throw and extraction impossible. Fetching the bytes and inlining
 * them as a data URI produces a same-origin image, which is readable.
 *
 * Returns the source unchanged when it is already local (data:/blob:) or when the
 * fetch fails, so behaviour degrades instead of breaking.
 */
export const toReadableSource = async (src) => {
  if (!src || typeof src !== 'string') return src;
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;

  try {
    const res = await fetch(src, { mode: 'cors' });
    if (!res.ok) return src;
    const blob = await res.blob();

    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(typeof fr.result === 'string' ? fr.result : src);
      fr.onerror = () => resolve(src);
      fr.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
};

/**
 * Extract the garment from a Hiraya catalog asset.
 *
 * @param {string|Object} src  image URL / data URI, OR a garment object carrying
 *        `raw_image_url` / `image_url` / `display_image_url`.
 * @param {Object} [options]
 * @param {boolean} [options.preferRaw=true]  prefer the raw upload over the
 *        composed display card — see the header for why it segments better.
 * @returns {Promise<{url:string,width:number,height:number,extracted:boolean,reason?:string}>}
 *   `url` is ALWAYS renderable: a transparent PNG blob URL of the garment alone on
 *   success, or the given source on failure so a tile is never left blank.
 */
export const extractGarment = async (src, options = {}) => {
  const { preferRaw = true } = options;

  /*
   * SOURCE PREFERENCE.
   *
   * 1. THE TRY-ON MATTE WINS OUTRIGHT (`ghost_mannequin_url`).
   *    It is STAGE 1's bare cut-out — transparent, trimmed, and with no frame,
   *    wordmark or product-name script on it. There is nothing left to segment,
   *    so it is passed straight through (see the check below). Everything the
   *    heuristics in this file struggle with — a caption welded to the fabric, a
   *    pale garment against a pale backdrop — simply does not exist in a matte.
   *
   * 2. Otherwise the RAW photograph, because the display card's artwork is the
   *    same colour as its own frame and cannot be separated by colour.
   *
   * 3. The display card last, as a fallback only.
   */
  const matteCandidate = src && typeof src === 'object'
    ? (src.ghost_mannequin_url || src.tryon_image_url || '')
    : '';

  const candidate = src && typeof src === 'object'
    ? (matteCandidate
        || (preferRaw
          ? (src.raw_image_url || src.image_url || src.display_image_url)
          : (src.display_image_url || src.image_url || src.raw_image_url)))
    : src;

  if (!candidate || typeof candidate !== 'string') {
    return { url: '', width: 0, height: 0, extracted: false, reason: 'no-source' };
  }
  if (typeof document === 'undefined') {
    return { url: candidate, width: 0, height: 0, extracted: false, reason: 'no-dom' };
  }

  const readable = await toReadableSource(candidate);
  const img = await loadImage(readable);
  if (!img || !img.width || !img.height) {
    return { url: candidate, width: 0, height: 0, extracted: false, reason: 'load-failed' };
  }

  /*
   * PASS A PREPARED MATTE STRAIGHT THROUGH.
   *
   * STAGE 1 already cut this garment out. Every step below exists to recover a
   * garment from a photograph with a background in it — a transparent matte has
   * no background to divide, so running the colour segmentation on one would be
   * both pointless and harmful (the per-row "deviation from the border colour"
   * test reads transparent pixels as the backdrop and can eat real fabric).
   *
   * The matte is detected by its OWN transparency — a real cut-out has a large
   * transparent margin — rather than by trusting the field name, so an empty or
   * bogus `ghost_mannequin_url` still falls through to normal extraction.
   */
  if (matteCandidate) {
    const probe = document.createElement('canvas');
    probe.width = img.width;
    probe.height = img.height;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0);

    let transparent = 0;
    let opaque = 0;
    try {
      const { data: pd } = pctx.getImageData(0, 0, img.width, img.height);
      for (let i = 3; i < pd.length; i += 4) {
        if (pd[i] < 24) transparent++;
        else opaque++;
      }
    } catch {
      transparent = 0;
    }

    const total = img.width * img.height;
    // A genuine matte is mostly transparent and still has a solid subject.
    if (transparent > total * 0.2 && opaque > total * 0.03) {
      return {
        url: candidate,
        width: img.width,
        height: img.height,
        extracted: true,
        reason: 'prepared-matte',
      };
    }
  }

  const scan = toScan(img);
  if (!scan) {
    return { url: candidate, width: img.width, height: img.height, extracted: false, reason: 'tainted' };
  }

  const { w, h, data } = scan;

  /*
   * STEP 1 — segment the WHOLE frame first (no seam knowledge yet).
   *
   * The seam is found from the segmentation rather than before it, because the
   * reliable seam signal is a collapse in the per-row FOREGROUND coverage — you
   * cannot measure coverage until you know what the foreground is.
   */
  const { mask: wholeFrameBg } = segmentAgainstRowBackground(data, w, h, h);

  const foreground = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!wholeFrameBg[p] && data[p * 4 + 3] >= 16) foreground[p] = 1;
  }

  // STEP 2 — find the reflection seam from that coverage profile.
  const seam = findReflectionSeam(foreground, w, h);
  const scanBottom = seam !== null ? Math.max(1, seam - 1) : h;

  /*
   * STEP 3 — everything at or below the seam is discarded outright, so the
   * mirrored copy can never be mistaken for garment.
   */
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < scanBottom; y++) {
    const base = y * w;
    for (let x = 0; x < w; x++) mask[base + x] = foreground[base + x];
  }

  /*
   * STEP 3b — strip the product-name caption BEFORE grouping.
   *
   * It has to happen here, on the raw foreground, rather than after
   * `extractGarmentComponents`. Once the 8-connected flood has merged the script
   * into the garment's component there is no way to tell the script's rows from
   * the dress's, and the measured EMERALD render proved it: the script was still
   * legible in the cut-out after a post-grouping strip.
   *
   * Clearing the caption rows first means the flood never sees the script at all,
   * so the largest component IS the garment.
   */
  const captionRow = stripCaptionBand(mask, w, h);

  /*
   * REMOVE THE REFLECTION BY ROW — BEFORE THE MASK IS HEALED.
   *
   * ORDER MATTERS, AND THIS IS THE FIX.
   *
   * The measured component split on the live catalog is unambiguous:
   *
   *   EMERALD  garment  top 5%..72%   reflection top 74%..99%
   *   BEIGE    garment  top 7%..72%   reflection top 73%..90%
   *
   * Both garments END at ~72% and both mirrors BEGIN just below. Content below a
   * per-frame floor is therefore the reflection.
   *
   * Crucially this must run BEFORE `closeMask`. A morphological close bridges the
   * one-or-two-row gap between a garment's hem and its mirror, so measuring "the
   * last wide row" on the HEALED mask reports the reflection's own width and
   * returns ~99% — the opposite of the intent, and exactly why the mirrored band
   * survived the first attempt at this cut.
   */
  /*
   * The mirror is already excluded: STEP 3 copies only rows above `scanBottom`, so
   * nothing at or below the seam is ever in `mask`.
   *
   * (`findGarmentEnd`/a second cut were tried here and REMOVED: with a correct
   * seam from `findReflectionSeam` they were redundant, and without one they made
   * things worse — on a shot whose mirror is as wide as the garment, "the last
   * wide row" IS the mirror, so the helper walked to the frame bottom and cut
   * nothing.)
   */

  /*
   * Heal the pinholes and thin tears a low-contrast backdrop punches into the
   * fabric BEFORE grouping, so the garment arrives as one connected mass rather
   * than a set of slivers.
   *
   * ANISOTROPIC ON PURPOSE: wide across, shallow down.
   *
   * MEASURED on BEIGE, whose pale fabric makes the per-row colour test drop
   * narrow columns out of the dress's own right edge. The final alpha's row
   * structure read:
   *
   *   y13%: 4-69 | 89-97     <- the dress, then a SEPARATE 8%-wide sliver
   *   y17%: 16-75 | 80-85
   *   y50%: 14-69 | 75-78 | 87-91
   *
   * i.e. repeated narrow vertical gaps with detached slivers hugging the right
   * of the body. Those slivers are what render as torn flaps.
   *
   * A round close of 2 could not bridge an 8-12px gap. A WIDE HORIZONTAL close
   * bridges it (joining each sliver back to the body) while a shallow vertical
   * one avoids fattening the silhouette's top and hem — which is what a round
   * kernel of the same width would do.
   */
  const healed = closeMask(mask, w, h, 1, 5);

  const comp = extractGarmentComponents(healed, w, h);

  if (!comp || comp.size < w * h * 0.01) {
    return { url: candidate, width: img.width, height: img.height, extracted: false, reason: 'no-garment-region' };
  }

  const garmentMask = comp.mask;

  /*
   * STEP 4 — crop to the mask's ACTUAL opaque bounds, in ORIGINAL image pixels.
   *
   * Recomputed by scanning the FINAL mask rather than trusting `comp`'s box,
   * because the caption strip above (and any component we dropped) changed which
   * rows and columns really contain garment. Trusting the pre-strip box is what
   * left the script inside the crop.
   */
  const bounds = (() => {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) {
        if (garmentMask[base + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY };
  })();

  if (!bounds) {
    return { url: candidate, width: img.width, height: img.height, extracted: false, reason: 'empty-mask-after-strip' };
  }

  const ratio = img.width / w;
  const sx = Math.max(0, bounds.minX * ratio);
  const sy = Math.max(0, bounds.minY * ratio);
  const sw = Math.min(img.width - sx, (bounds.maxX - bounds.minX + 1) * ratio);
  const sh = Math.min(img.height - sy, (bounds.maxY - bounds.minY + 1) * ratio);

  if (sw < 8 || sh < 8) {
    return { url: candidate, width: img.width, height: img.height, extracted: false, reason: 'crop-too-small' };
  }

  const outW = Math.round(sw);
  const outH = Math.round(sh);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

  /*
   * STEP 5 — write the component mask into the output ALPHA channel.
   *
   * The mask is at SCAN resolution and the crop is at ORIGINAL resolution, so
   * each output pixel maps to a scan pixel by dividing by `ratio` and offsetting
   * by the crop origin. Sampling the mask per output pixel (rather than scaling
   * the mask image) keeps the edges exact instead of interpolated, which matters
   * because a soft alpha edge would show the removed background as a grey halo.
   */
  try {
    const region = octx.getImageData(0, 0, outW, outH);
    const px = region.data;

    /*
     * PRECOMPUTE THE X MAPPING ONCE, NOT PER PIXEL.
     *
     * The original inner loop recomputed `Math.min(Math.max(Math.floor(...)))`
     * for `scanX` on EVERY output pixel — on a 739x905 cut-out that is ~670,000
     * four-call sequences for a value that depends only on `x`. Hoisting it into
     * a lookup of length `outW` removes that entirely: the row loop then does one
     * array read per pixel.
     *
     * This was the single hottest loop in the extraction (measured 1580ms on the
     * EMERALD product).
     */
    const scanXOf = new Int32Array(outW);
    for (let x = 0; x < outW; x++) {
      const sxv = Math.floor(bounds.minX + x / ratio);
      scanXOf[x] = sxv < 0 ? 0 : sxv >= w ? w - 1 : sxv;
    }

    for (let y = 0; y < outH; y++) {
      const syv = Math.floor(bounds.minY + y / ratio);
      const scanY = syv < 0 ? 0 : syv >= h ? h - 1 : syv;
      const rowBase = scanY * w;

      let o = y * outW * 4 + 3; // alpha of this row's first output pixel
      for (let x = 0; x < outW; x++, o += 4) {
        // Only retained garment components survive; artwork, speckles, the
        // reflection and the backdrop all become fully transparent.
        if (!garmentMask[rowBase + scanXOf[x]]) px[o] = 0;
      }
    }
    octx.putImageData(region, 0, 0);
  } catch {
    return { url: candidate, width: img.width, height: img.height, extracted: false, reason: 'mask-apply-failed' };
  }

  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) {
    return { url: candidate, width: img.width, height: img.height, extracted: false, reason: 'encode-failed' };
  }

  return {
    url: URL.createObjectURL(blob),
    width: outW,
    height: outH,
    extracted: true,
    reflectionSeam: seam,
    captionRow,
  };
};

/** Frees an object URL produced by extractGarment (no-op for others). */
export const releaseGarmentUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
};

export default extractGarment;
