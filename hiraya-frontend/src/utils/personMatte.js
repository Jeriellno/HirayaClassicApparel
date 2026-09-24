/**
 * personMatte — an ON-DEVICE person segmentation mask, with NO network call and
 * NO API key.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every server-side try-on engine was proven unusable on this deployment:
 *
 *   - Gemini image generation: BILLED-ONLY. The free tier reports `limit: 0` for
 *     every image model (verified against five of them), so it can never render.
 *     The Gemini web app works because it runs on a consumer subscription — a
 *     different product, not the same quota.
 *   - Hugging Face IDM-VTON: the free ZeroGPU Space is alive and its /upload and
 *     /call/tryon endpoints accept requests, but `/queue/join` — the WebSocket
 *     that returns the render — answers HTTP 403 to every non-browser client,
 *     even with a valid token in the query string AND the Authorization header.
 *     ZeroGPU gates GPU work behind an authenticated BROWSER session.
 *
 * So the renderer has to run in the browser. This module supplies the one piece
 * the existing canvas compositor could not do for itself: a MASK OF THE PERSON.
 *
 * WHAT IT CHANGES IN THE RENDER
 * -----------------------------
 * Without a person mask, `compositeTryOn` can only place a garment by GEOMETRY —
 * it measures the silhouette's width per row and draws a rectangle-ish box over
 * the torso. Fabric therefore lands on background pixels beside the arms, and any
 * part of the garment that should be hidden BEHIND the body (the far side of a
 * coat, the back of a leg) is drawn on top instead. That is what makes a
 * composite read as a "pasted sticker" rather than as worn clothing.
 *
 * With the mask:
 *   - fabric is CLIPPED to the person, so nothing spills onto the background;
 *   - the arms can be restored IN FRONT of the fabric, so a sleeve reads as worn.
 *
 * HOW IT RUNS FOR FREE
 * --------------------
 * `@imgly/background-removal` already had its 88 MB ISNet ONNX model mirrored
 * into this app's own backend (`public/vendor/imgly/models/isnet_fp16`) for the
 * Style Stack's garment cut-outs. That model is a saliency segmenter — it
 * separates a SUBJECT from its background. Pointed at a full-body portrait, the
 * subject it separates is THE PERSON. No new download, no new dependency, no
 * quota, no token, and it works offline.
 *
 * The engine returns a cut-out of the person (RGBA, transparent background).
 * Its ALPHA CHANNEL is exactly the mask we want.
 *
 * FAILURE BEHAVIOUR
 * -----------------
 * Everything here is best-effort. If the model cannot load (offline, a blocked
 * asset path, a browser without the needed WASM features), this returns `null`
 * and the compositor falls back to its geometric placement — degraded, never
 * broken. That matters: a render must never fail because an ENHANCEMENT did.
 */

import { removeImageBackground } from './removeBackground';

/**
 * The matte is only worth using above this confidence.
 *
 * ISNet is a saliency model, not a body-parser. On a full-body portrait it
 * segments the person cleanly, but on a close-up it may lock onto a face, and on
 * a busy background it may take in furniture. Those failures all produce a mask
 * that covers a suspiciously LARGE or SMALL share of the frame, so the coverage
 * is measured and implausible results are rejected rather than trusted.
 */
const MIN_SUBJECT_COVERAGE = 0.06; // below this the model found almost nothing
const MAX_SUBJECT_COVERAGE = 0.85; // above this it took the whole frame

/**
 * Inference is slow on CPU and the first call must download/compile the model,
 * so the window is generous — but finite. A promise that never settles would
 * leave the Studio on a spinner with no recovery.
 */
const MATTE_TIMEOUT_MS = 180000;

/**
 * Cache keyed on the portrait data URI, since the mask is expensive and the same
 * portrait is re-rendered on every "Generate"/"Retry" press. Capped so a long
 * session cannot retain one full-size bitmap per uploaded photo forever.
 */
const matteCache = new Map();
const MATTE_CACHE_LIMIT = 3;

/** Load a data/blob URL into an <img>, resolving null rather than rejecting. */
const loadImage = (src) =>
  new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/**
 * Derive a boolean person mask from the engine's cut-out.
 *
 * The engine returns a PNG BLOB of the person with a transparent background, so
 * alpha is the mask. It is read at a REDUCED resolution: the compositor only
 * needs the mask's SHAPE, and a full-size bitmap would cost one `getImageData`
 * over the whole portrait (slow, and a large allocation) for no accuracy gain —
 * the mask is sampled per row/column and smoothed anyway.
 *
 * @param {string} cutoutUrl  Blob URL of the person cut-out.
 * @param {number} width      Mask width in pixels.
 * @param {number} height     Mask height in pixels.
 * @param {number} alphaFloor Alpha at or above this counts as "person".
 * @returns {Promise<{mask: Uint8Array, coverage: number}|null>}
 */
const maskFromCutout = async (cutoutUrl, width, height, alphaFloor = 32) => {
  const img = await loadImage(cutoutUrl);
  if (!img || !img.width || !img.height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // `imageSmoothingEnabled` is left ON: downscaling a hard-edged matte with
  // nearest-neighbour produces single-pixel holes that would punch speckles into
  // the fabric. Interpolation gives a soft edge that the alphaFloor then
  // threshold, which is both cheaper and cleaner.
  ctx.drawImage(img, 0, 0, width, height);

  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, width, height));
  } catch {
    // A tainted canvas. The cut-out is a blob URL from this origin, so this
    // should be unreachable — but a mask that cannot be read must never throw
    // into the render.
    return null;
  }

  const mask = new Uint8Array(width * height);
  let on = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] >= alphaFloor) {
      mask[p] = 1;
      on++;
    }
  }

  return { mask, coverage: on / (width * height) };
};

/**
 * Fill single-pixel holes and trim single-pixel spurs.
 *
 * ISNet's matte is good but not perfect: it occasionally drops a pixel at a
 * garment edge or along a low-contrast trouser leg. A lone hole in the mask
 * becomes a visible pinprick of background INSIDE the fabric once the garment is
 * clipped to it. One 3x3 majority pass removes those without moving a real
 * boundary, because a genuine edge continues over several rows.
 */
const despeckle = (mask, width, height) => {
  const out = new Uint8Array(mask.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let on = 0;
      let total = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          total++;
          on += mask[ny * width + nx];
        }
      }

      // Majority vote. A pixel flips only when its neighbourhood disagrees with
      // it, which leaves a straight edge exactly where it was.
      out[i] = on * 2 >= total ? 1 : 0;
    }
  }

  return out;
};

/**
 * Tighten the mask by one pixel and report the bounding box.
 *
 * A saliency matte is slightly OPTIMISTIC: it bleeds a pixel or two past the
 * subject into the background. When that bleeding fabric is clipped-in it draws
 * a dark halo around the body. Eroding by one pixel costs nothing visually and
 * removes it.
 *
 * The bounding box is returned alongside because the compositor needs to know
 * where the person actually is — recomputing it from the raw silhouette would
 * duplicate this scan.
 */
const erodeAndBound = (mask, width, height) => {
  const out = new Uint8Array(mask.length);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;

      // Keep the pixel only when all four neighbours are also person. This is a
      // 4-connected erosion, which preserves limbs and hair better than an
      // 8-connected one that would eat thin structures like wrists and ankles.
      const solid =
        (x === 0 || mask[i - 1]) &&
        (x === width - 1 || mask[i + 1]) &&
        (y === 0 || mask[i - width]) &&
        (y === height - 1 || mask[i + width]);

      if (solid) {
        out[i] = 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  return { mask: out, bounds: { minX, minY, maxX, maxY } };
};

/**
 * Build a person mask for a portrait, on device.
 *
 * @param {string} portrait      Data URI / URL of the customer's full-body photo.
 * @param {Object} [options]
 * @param {number} [options.width]   Mask width (default 256).
 * @param {number} [options.height]  Mask height (default 256).
 * @returns {Promise<Object|null>}
 *   `{ mask, width, height, bounds, coverage, source }`, or `null` when the
 *   model could not produce a usable mask. NEVER throws.
 */
export const buildPersonMatte = async (portrait, options = {}) => {
  if (!portrait || typeof document === 'undefined') return null;

  const width = options.width || 256;
  const height = options.height || 256;
  const cacheKey = `${width}x${height}::${portrait}`;

  if (matteCache.has(cacheKey)) return matteCache.get(cacheKey);

  /*
   * Take the mask at the portrait's OWN aspect ratio rather than a square.
   * `compositeTryOn` maps mask coordinates onto the canvas, and a stretched mask
   * would put the person's shoulders at the wrong rows — the garment would sit
   * at the wrong height, which is the exact class of bug this mask is meant to
   * fix.
   */
  let maskW = width;
  let maskH = height;

  const source = await loadImage(portrait);
  if (source && source.width && source.height) {
    const aspect = source.height / source.width;
    if (aspect >= 1) {
      maskH = height;
      maskW = Math.max(32, Math.round(height / aspect));
    } else {
      maskW = width;
      maskH = Math.max(32, Math.round(width * aspect));
    }
  }

  const job = (async () => {
    let cutout = null;

    try {
      const result = await Promise.race([
        removeImageBackground(portrait),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('person matte timed out')), MATTE_TIMEOUT_MS);
        }),
      ]);

      cutout = result?.url || null;
    } catch (err) {
      console.warn('[Hiraya] On-device person matte unavailable:', err?.message || err);
      return null;
    }

    if (!cutout) return null;

    try {
      const raw = await maskFromCutout(cutout, maskW, maskH);
      if (!raw) return null;

      const coverage = raw.coverage;

      /*
       * REJECT IMPLAUSIBLE MATTES.
       *
       * Both ends of the range are real failure modes seen with saliency models:
       * a near-empty mask means the model locked onto a small high-contrast
       * detail (a bag, a logo), and a near-full mask means it treated the
       * background as the subject. Clipping a garment to either would be worse
       * than not clipping at all, so the compositor is told "no mask" instead.
       */
      if (coverage < MIN_SUBJECT_COVERAGE || coverage > MAX_SUBJECT_COVERAGE) {
        console.warn(
          `[Hiraya] Person matte rejected: subject covers ${(coverage * 100).toFixed(1)}% of the frame.`
        );
        return null;
      }

      const cleaned = erodeAndBound(despeckle(raw.mask, maskW, maskH), maskW, maskH);
      if (!cleaned) return null;

      return {
        mask: cleaned.mask,
        width: maskW,
        height: maskH,
        bounds: cleaned.bounds,
        coverage,
        source: 'isnet-fp16-on-device',
      };
    } finally {
      // The cut-out blob is no longer needed once its alpha has been sampled.
      if (typeof cutout === 'string' && cutout.startsWith('blob:')) {
        URL.revokeObjectURL(cutout);
      }
    }
  })();

  matteCache.set(cacheKey, job);
  if (matteCache.size > MATTE_CACHE_LIMIT) {
    // Drop the oldest entry. `Map` preserves insertion order, so the first key
    // is the least recently added.
    matteCache.delete(matteCache.keys().next().value);
  }

  return job;
};

/**
 * Sample the mask at a normalised coordinate (0..1 across the frame).
 *
 * Out-of-range coordinates answer `false` (not a person), because every caller
 * is testing "is fabric allowed here", and the safe answer outside the frame is
 * no.
 */
export const maskAt = (matte, nx, ny) => {
  if (!matte) return false;

  const x = Math.floor(nx * matte.width);
  const y = Math.floor(ny * matte.height);
  if (x < 0 || y < 0 || x >= matte.width || y >= matte.height) return false;

  return matte.mask[y * matte.width + x] === 1;
};

/**
 * The horizontal span of the person on a given row, in normalised units.
 *
 * This is what lets a garment be clipped to the BODY rather than to the frame:
 * the compositor asks "on the row my hem sits at, where does the person actually
 * begin and end?".
 *
 * @returns {{left: number, right: number}|null} null when the row has no person.
 */
export const personSpanAtRow = (matte, ny) => {
  if (!matte) return null;

  const y = Math.floor(ny * matte.height);
  if (y < 0 || y >= matte.height) return null;

  const rowStart = y * matte.width;
  let left = -1;
  let right = -1;

  for (let x = 0; x < matte.width; x++) {
    if (matte.mask[rowStart + x]) {
      if (left < 0) left = x;
      right = x;
    }
  }

  if (left < 0) return null;

  return { left: left / matte.width, right: (right + 1) / matte.width };
};

/** Release a cached matte so its bitmaps are not retained. */
export const releasePersonMatte = (portrait) => {
  if (!portrait) return;
  for (const key of Array.from(matteCache.keys())) {
    if (key.includes(portrait)) matteCache.delete(key);
  }
};

export default buildPersonMatte;
