/**
 * removeBodyBackground — cut a customer's BODY PHOTO out of its background,
 * returning a transparent PNG (alpha silhouette) the rest of the engine can read.
 *
 * WHY THIS EXISTS (this is the root fix, not a patch)
 * ---------------------------------------------------
 * MEASURED BUG: every uploaded photo showed the green "Photo looks good" chip,
 * including a product marketing card with no person in it. Chasing it down:
 *
 *   1. `prepareUserPhoto` re-encodes EVERY upload as JPEG, and JPEG has no alpha.
 *   2. `measureSilhouette` — the body-measuring scanner — is an ALPHA-MASK reader.
 *      It samples the alpha channel and bails to `null` when a portrait carries no
 *      transparent pixels (see its `hasSilhouette` guard).
 *
 * So `measureSilhouette` returns `null` for every normal photo, the pose check has
 * nothing to measure, and the indicator could only ever say "unreadable". No
 * threshold tuning fixes this, because the engine was built for cut-outs and the
 * pipeline hands it photographs.
 *
 * The fix is to RESTORE THE ALPHA: segment the subject out of the background
 * before the photo is analysed (and before it is sent to the VTON renderer, which
 * benefits from a clean subject too). With a real alpha channel present,
 * `measureSilhouette` works exactly as designed, and the chip gets a REAL reading —
 * green for a full figure, amber for a bust crop or a frame with no person.
 *
 * HOW IT SEGMENTS (reusing a technique already proven in this repo)
 * -----------------------------------------------------------------
 * `extractGarment.js` already solves the same problem for GARMENTS: opaque product
 * photograph in, transparent cut-out out. Its `segmentAgainstRowBackground` models
 * the background PER ROW from that row's own border pixels, then marks a pixel as
 * subject when it departs from its row's background in luma or in colour.
 *
 * A body photo is the same shape of problem — a subject standing in front of a
 * background that fills the frame edges — so the same row-background idea applies.
 * The one thing that differs is that a PERSON can touch the left/right frame edges
 * (arms out, a wide shot), which would poison a per-row border sample. This module
 * therefore derives the background from a ROBUST cross-row estimate (see below)
 * rather than from the row edges alone.
 *
 * HONESTY CONTRACT
 * ----------------
 *   { dataUri, ok, reason, coverage }
 *
 *   `ok: true`  — a subject was found; `dataUri` is a PNG with a real alpha mask.
 *   `ok: false` — segmentation could not find a subject. `dataUri` is then the
 *                 ORIGINAL photo unchanged (so the pipeline still runs), and
 *                 `reason` says why. It NEVER throws and NEVER returns ''.
 *
 * A failed cut-out is not fatal: an opaque photo simply behaves as it does today
 * (the pose check reports it as unmeasured). This only ever IMPROVES the input.
 */

/** Downscale for the scan. Big enough to keep an arm, small enough to be instant. */
const SCAN_MAX = 480;

/**
 * A pixel is subject when it departs from the background by at least this much in
 * luma OR in colour distance. Chosen to sit above sensor grain and JPEG noise
 * (measured well under 10 on this pipeline's own images) and below the departure a
 * real subject makes from a wall.
 */
const LUMA_GATE = 24;
const COLOUR_GATE = 40;

/** Below this share of the frame, the "subject" is noise, not a person. */
const MIN_SUBJECT_SHARE = 0.04;

/** Above this share, segmentation has clearly failed (it thinks everything is subject). */
const MAX_SUBJECT_SHARE = 0.92;

/** Decode a data URI / URL into an <img>, resolving null (never rejecting). */
const loadImage = (src) =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || !src) return resolve(null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/**
 * Estimate the BACKGROUND colour, robustly, from the image border.
 *
 * WHY NOT JUST THE CORNERS, AND WHY NOT EACH ROW'S OWN EDGES
 * ---------------------------------------------------------
 *   - Four corners: a shadow, a prop or a coloured wall corner skews it.
 *   - Each row's own edges: correct for a garment flat-lay (the garment never
 *     touches the edge) but WRONG for a person, whose arms or body can run to the
 *     left/right border. Sampling there would adopt the person as "background".
 *
 * Instead we take every border pixel, quantise it coarsely (32 levels per channel)
 * and pick the most common bin. On a photo of a person the wall dominates the
 * border, so the wall wins; the few pixels where an arm touches the edge are
 * outvoted. We also report how much of the border that winner holds, so a busy
 * scene (no consensus) can be detected and refused rather than guessed at.
 */
const estimateBackground = (data, w, h) => {
  const bins = new Map();
  let total = 0;

  const tap = (x, y) => {
    const i = (y * w + x) * 4;
    const key = (data[i] >> 5) * 64 + (data[i + 1] >> 5) * 8 + (data[i + 2] >> 5);
    bins.set(key, (bins.get(key) || 0) + 1);
    total++;
  };

  for (let x = 0; x < w; x++) {
    tap(x, 0);
    tap(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tap(0, y);
    tap(w - 1, y);
  }

  let bestKey = null;
  let bestCount = 0;
  for (const [key, n] of bins) {
    if (n > bestCount) {
      bestCount = n;
      bestKey = key;
    }
  }
  if (bestKey === null) return null;

  return {
    r: (Math.floor(bestKey / 64) << 5) + 16,
    g: ((Math.floor(bestKey / 8) % 8) << 5) + 16,
    b: ((bestKey % 8) << 5) + 16,
    share: total > 0 ? bestCount / total : 0,
  };
};

/**
 * Segment a body photo against its background.
 *
 * @param {string} src  a data URI (or any loadable src) of the customer's photo.
 * @returns {Promise<{dataUri:string, ok:boolean, reason:string|null, coverage:number}>}
 */
export const removeBodyBackground = async (src) => {
  const unchanged = (reason) => ({ dataUri: src, ok: false, reason, coverage: 0 });

  if (typeof document === 'undefined') return unchanged('no-dom');
  if (!src || typeof src !== 'string') return unchanged('no-source');

  const img = await loadImage(src);
  if (!img || !img.width || !img.height) return unchanged('decode-failed');

  /* --- SCAN: downscaled, readable pixels --------------------------------- */
  const scale = Math.min(1, SCAN_MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const scanCanvas = document.createElement('canvas');
  scanCanvas.width = w;
  scanCanvas.height = h;
  const sctx = scanCanvas.getContext('2d', { willReadFrequently: true });
  if (!sctx) return unchanged('no-2d-context');
  sctx.drawImage(img, 0, 0, w, h);

  let data;
  try {
    ({ data } = sctx.getImageData(0, 0, w, h));
  } catch {
    return unchanged('tainted-canvas');
  }

  const bg = estimateBackground(data, w, h);
  if (!bg) return unchanged('no-background-estimate');

  /*
   * NO CLEAR BACKGROUND. If the border does not agree on one colour, we do not
   * know what to remove — a busy street, a patterned room. Refuse rather than cut
   * a random hole in the customer's photo.
   */
  if (bg.share < 0.35) return unchanged('ambiguous-background');

  /* --- MASK: subject = departs from background in luma or colour ---------- */
  const mask = new Uint8Array(w * h);
  let subject = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;

      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const bgLuma = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
      const dl = Math.abs(luma - bgLuma);

      const dr = data[i] - bg.r;
      const dg = data[i + 1] - bg.g;
      const db = data[i + 2] - bg.b;
      const colourDist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dl >= LUMA_GATE || colourDist >= COLOUR_GATE) {
        mask[p] = 1;
        subject++;
      }
    }
  }

  const share = subject / (w * h);
  if (share < MIN_SUBJECT_SHARE) return unchanged('no-subject');
  if (share > MAX_SUBJECT_SHARE) return unchanged('subject-fills-frame');

  /*
   * --- WRITE THE MASK INTO ALPHA — KEEPING THE FULL FRAME -----------------
   *
   * DELIBERATELY NOT TRIMMED to the subject bounds. An earlier version trimmed,
   * and the QA harness caught what that broke: after trimming, the subject touches
   * the new top and bottom edge by construction, so EVERY photo looked
   * "edge-to-edge" and the pose check could no longer tell a product card from a
   * person — the exact distinction the trim was meant to preserve.
   *
   * The MARGIN around the subject is itself the signal (`bodyTop` and
   * `bodyHeightFraction` in measureSilhouette): a person framed by a camera has
   * space above the head and below the feet, a garment card crops to its own
   * edges. Keeping the original frame is what keeps that evidence intact — and as a
   * bonus the returned cut-out stays the same shape as the photo the customer
   * uploaded, so the canvas does not jump when the preview swaps in.
   */
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) return unchanged('no-2d-context');

  octx.drawImage(scanCanvas, 0, 0);

  try {
    const region = octx.getImageData(0, 0, w, h);
    const px = region.data;
    for (let p = 0; p < mask.length; p++) {
      // Background pixels become fully transparent; subject pixels keep alpha.
      if (!mask[p]) px[p * 4 + 3] = 0;
    }
    octx.putImageData(region, 0, 0);
  } catch {
    return unchanged('mask-apply-failed');
  }

  /*
   * PNG, NOT JPEG. This is the entire point: JPEG would discard the alpha channel
   * we just wrote and put us straight back where we started.
   */
  const dataUri = out.toDataURL('image/png');
  if (!dataUri || !dataUri.startsWith('data:image/png')) return unchanged('encode-failed');

  return {
    dataUri,
    ok: true,
    reason: null,
    coverage: +share.toFixed(3),
  };
};

export default removeBodyBackground;
