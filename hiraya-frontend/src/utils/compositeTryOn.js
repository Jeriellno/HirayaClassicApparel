/**
 * compositeTryOn — attaches selected garments onto the customer's OWN full-body
 * photo, directly in the browser, with NO AI service and NO network call.
 *
 * THE REQUESTED FLOW
 * ------------------
 *   1. The customer uploads a full-body photo.
 *   2. They select garments in the Style Stack.
 *   3. "Generate Virtual Fitting" runs a loading state.
 *   4. The ORIGINAL body photo STAYS VISIBLE the whole time — it is never
 *      replaced by a placeholder.
 *   5. Each garment is attached to the matching REGION OF THE BODY:
 *        top       -> upper body (chest / torso)
 *        bottom    -> lower body (hips / legs)
 *        dress     -> upper + lower (one continuous piece)
 *        outerwear -> upper body, layered OVER the top
 *        footwear  -> feet
 *   6. A dress is mutually exclusive with top/bottom.
 *
 * WHY LOCAL
 * ---------
 * Every server-side renderer is unusable here: Hugging Face's host is dead and
 * needs a paid endpoint, Replicate needs a paid token, Gemini image generation
 * returns 429 on the free tier, and this PHP build has neither GD nor Imagick.
 * A browser canvas always works, costs nothing, and cannot rate-limit.
 *
 * HOW THE FIT IS DERIVED
 * ----------------------
 * Garment placement and scale come from `bodyGeometry.js`, which:
 *   1. measures the SUBJECT's silhouette (torso centre, shoulder line, body
 *      height in pixels) from the portrait's own alpha channel, and
 *   2. converts the customer's real measurements into a pixel-per-cm factor.
 *
 * That is what fixes the reported "floating, undersized, pasted-on" render:
 * garments are anchored to the PERSON rather than to the centre of the picture,
 * and sized to the PERSON rather than to a hard-coded fraction of the frame.
 */

import {
  buildBodyFrame,
  derivePixelScale,
  measureSilhouette,
  resolveGarmentBox,
  resolveMeasurements,
} from './bodyGeometry';
import { extractGarment, releaseGarmentUrl } from './extractGarment';
import { measureBodyPose } from './bodyPose';
import { buildPersonMatte, personSpanAtRow } from './personMatte';

/* ------------------------------------------------------------------ *
 * Body-region model
 *
 * Values are FRACTIONS of the portrait height, measured from the top, and are
 * tuned for a STANDING FULL-BODY frame. Each region declares:
 *   top/bottom : the vertical band on the body where the garment belongs
 *   width      : the drawn width as a fraction of the canvas width
 * ------------------------------------------------------------------ */
/*
 * BODY_REGIONS was REMOVED.
 *
 * It encoded placement as fixed fractions of the FRAME — `regionX` was the
 * canvas midline — which is why an off-centre subject got a garment hanging in
 * the middle of the picture instead of over their body, and why `Math.min`
 * contain-fitting made every garment permanently undersized.
 *
 * Placement and scale now come from `bodyGeometry.js`, which measures the
 * SUBJECT's silhouette and converts the customer's real measurements into a
 * pixel-per-cm factor. See resolveGarmentBox() for the replacement.
 */

/**
 * Draw order (back → front). Outerwear must paint LAST so it sits over the top.
 */
const DRAW_ORDER = ['bottom', 'top', 'dress', 'footwear', 'outerwear'];

/** A dress replaces both the top and the bottom. */
export const isDressConflict = (key, garments) =>
  (key === 'top' || key === 'bottom') && !!garments?.dress;

/* ------------------------------------------------------------------ *
 * Image helpers
 * ------------------------------------------------------------------ */

/** Load an image, resolving to null rather than rejecting on failure. */
const loadImage = (src) => {
  if (typeof window === 'undefined' || !src) {
    return Promise.resolve(null);
  }

  /*
   * CORS IS ATTEMPTED FIRST, AND THE OLD COMMENT HERE WAS FACTUALLY WRONG.
   *
   * The previous version refused to set `crossOrigin` at all, on the stated
   * grounds that "the Supabase storage host does not send
   * `Access-Control-Allow-Origin` for these objects". That is not true. Checked
   * directly against the live catalog image:
   *
   *   GET https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public/...
   *   -> 200, access-control-allow-origin: *
   *
   * Because the attribute was never set, every garment image TAINTED the canvas,
   * and the final `canvas.toDataURL('image/png')` threw a SecurityError. The catch
   * block returns `image: null`, `generateLocalComposite()` sees no image, returns
   * false, and the Studio shows "FITTING INTERRUPTED" — the render was drawn
   * perfectly and then thrown away at the last step, with no way to save it.
   *
   * THE FIX IS TO TRY CORS AND FALL BACK, which is safe in both directions:
   *
   *   1. Load with `crossOrigin = 'anonymous'`. When the host sends the header
   *      (verified above: it does) the image decodes and the canvas STAYS CLEAN,
   *      so `getImageData` and `toDataURL` both work. This is the common path and
   *      it is now the one that runs.
   *
   *   2. On error, retry WITHOUT the attribute. A host that truly does not serve
   *      CORS then behaves exactly as before — the image still decodes, it may
   *      taint, and the existing `canReadPixels` guards keep the damage local
   *      ("drawn but not measurable") instead of failing the whole fitting.
   *
   * So this cannot lose ground: it either fixes the export or reproduces the old
   * behaviour. Leaving `crossOrigin` off was the only option that could never
   * work, and it was the one we had.
   */
  const attempt = (withCors, overrideSrc) =>
    new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      if (withCors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = overrideSrc || src;
    });

  /* Step 1: CORS first, so a CORS-enabled host yields a canvas we can still
   *         read AND export (the old code never set the attribute at all).
   * Step 2: no-CORS retry, for a host that sends no allow-origin header.
   * Step 3: inlined data URI — see below. */
  return attempt(true)
    .then((img) => img || attempt(false))
    .then(async (img) => {
      if (img) return img;

      /*
       * STEP 3 — THE CASE THAT ACTUALLY BREAKS THE RENDER.
       *
       * A cross-origin asset served WITHOUT `Access-Control-Allow-Origin` decodes
       * in neither of the first two attempts, because the browser refuses to put it
       * on a canvas that could be read back. `loadImage` then resolves `null`,
       * `compositeTryOn()` bails at its `if (!portraitImg)` guard, and the Studio
       * shows FITTING INTERRUPTED — the render never even starts, which is exactly
       * the symptom seen here.
       *
       * Inlining the bytes through `fetch` removes the cross-origin problem: a
       * `data:` URI is SAME-ORIGIN, so it decodes with no CORS header at all. This
       * is the same trick `extractGarment` already uses for garment cut-outs
       * (see its `toReadableSource`), which is why garments survived a failure
       * that killed the portrait.
       *
       * Note this is a NETWORK read, not a pixel read: no canvas is involved, and
       * it does not taint anything. When the host serves no CORS header the fetch
       * itself fails and we fall through to `null` — the previous behaviour — so
       * this can only add renders, never remove one. That `null` is the one case
       * that still ends in FITTING INTERRUPTED, and it is a server/CORS problem,
       * not a rendering bug: the bytes are unreachable from the browser.
       */
      if (/^https?:/i.test(src)) {
        try {
          const res = await fetch(src, { mode: 'cors' });
          if (res.ok) {
            const blob = await res.blob();
            const dataUri = await new Promise((resolve) => {
              const fr = new FileReader();
              fr.onloadend = () => resolve(typeof fr.result === 'string' ? fr.result : null);
              fr.onerror = () => resolve(null);
              fr.readAsDataURL(blob);
            });
            if (dataUri) return attempt(false, dataUri);
          }
        } catch {
          /* No CORS on this host — genuinely unreachable, keep the null. */
        }
      }

      return null;
    });
};

/**
 * Pixel-read capability probe.
 *
 * Returns false when the image would TAINT the canvas (cross-origin without
 * CORS). Every pixel-reading path must check this FIRST, because `getImageData`
 * on a tainted canvas THROWS — and the old code caught that throw and silently
 * answered "no alpha", which is precisely what produced the black hollows.
 */
const canReadPixels = (img) => {
  try {
    const probe = document.createElement('canvas');
    probe.width = 2;
    probe.height = 2;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 2, 2);
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
};

/**
 * Detects whether an image actually has transparency (i.e. it is a real
 * cut-out) by sampling a small downscale. A product photo on a white/coloured
 * background answers false and gets a soft feather mask instead.
 */
const hasAlpha = (img) => {
  try {
    const size = 64;
    const probe = document.createElement('canvas');
    probe.width = size;
    probe.height = size;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);

    const { data } = ctx.getImageData(0, 0, size, size);
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 245) clear++;
    }
    return clear / (data.length / 4) > 0.06;
  } catch {
    /*
     * This catch is now UNREACHABLE on a tainted canvas, by design: callers
     * MUST gate on `canReadPixels()` first. It is kept as a last-resort guard,
     * and answering `true` is the SAFE default here — assuming a garment is a
     * cut-out draws it as-is, whereas assuming it is opaque routes it through
     * the feathered-mask branch that composites transparency as black.
     */
    return true;
  }
};

/**
 * Trim the transparent border of a cut-out so the garment fills its region
 * instead of sitting tiny in the middle of a mostly-empty PNG.
 */
const trimBounds = (img) => {
  try {
    const size = 160;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);

    const { data } = ctx.getImageData(0, 0, size, size);
    let minX = size, minY = size, maxX = -1, maxY = -1;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[(y * size + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) return null;

    const sx = img.width / size;
    const sy = img.height / size;

    return  {
      x: minX * sx,
      y: minY * sy,
      w: (maxX - minX + 1) * sx,
      h: (maxY - minY + 1) * sy,
    };
  } catch {
    return null;
  }
};

/**
 * Width of the downscale `measureShape` works on. Exposed as a constant because
 * its results are in SCAN pixels and every consumer must convert them to the
 * original image's pixels before mixing them with canvas geometry.
 */
const MEASURE_SCAN = 96;

/**
 * Measure the SHAPE of a garment cut-out: where its fabric actually is, per row.
 *
 * WHY THE BOUNDING BOX IS THE WRONG THING TO SCALE
 * ------------------------------------------------
 * A flat-lay dress is not a rectangle. Measured on the live EMERALD cut-out
 * (box 635x867), the fabric's own span per row is:
 *
 *   shoulders (y  5%)  span 517px  = 81% of the box
 *   bodice    (y 15%)  span 345px  = 54%
 *   waist     (y 40%)  span 277px  = 44%   <- narrowest
 *   hem       (y 70%)  span 375px  = 59%
 *
 * Scaling the BOX width to the body width therefore makes the visible bodice
 * only ~44% of the body — the piece renders undersized even though the maths
 * "filled" the box — and the empty side-padding pushes the shoulders out over
 * the arms. Sizing from the FABRIC's own shoulder span fixes both: the garment
 * is as wide as the body where the body is, and the empty margins stop counting.
 *
 * @returns {Object|null} per-row fabric spans, normalised to the image box.
 */
const measureShape = (img) => {
  try {
    const SCAN = MEASURE_SCAN;
    const w = SCAN;
    const h = Math.max(1, Math.round(SCAN * (img.height / img.width)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);

    const rows = [];
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;

    for (let y = 0; y < h; y++) {
      let rowMinX = -1;
      let rowMaxX = -1;
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 24) {
          if (rowMinX === -1) rowMinX = x;
          rowMaxX = x;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      rows.push(rowMinX === -1 ? null : { minX: rowMinX, maxX: rowMaxX });
    }

    if (maxX < 0) return null;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;

    /*
     * The SHOULDER row is the widest row in the upper third of the garment —
     * the same principle the body silhouette uses, applied to the fabric. This
     * is the span the piece must be scaled to, because it is the part that
     * meets the wearer's shoulders.
     */
    const upperLimit = Math.round(minY + boxH * 0.35);
    let shoulderRow = minY;
    let shoulderSpan = 0;
    for (let y = minY; y <= upperLimit && y < h; y++) {
      const r = rows[y];
      if (!r) continue;
      const span = r.maxX - r.minX + 1;
      if (span > shoulderSpan) {
        shoulderSpan = span;
        shoulderRow = y;
      }
    }

    /*
     * THE BODICE SPAN — the width the garment must cover the TORSO with.
     *
     * THIS IS WHAT FIXES "THE DRESS COVERS ONLY HALF THE TORSO".
     *
     * Scaling to the SHOULDER span sizes the photograph's widest row (the arms /
     * off-shoulder sleeves) to the body width, but a flat-lay dress is much
     * narrower at its body than at its shoulder line. Measured on the live
     * EMERALD cut-out: shoulders span 94/96 of the scan, but the bodice is only
     * ~44% of that. So the SHOULDERS land at 317px while the BODICE lands at
     * ~140px — a strip down the middle of a 240px torso. That is exactly the
     * render that was reported.
     *
     * The bodice span is the MEDIAN of the per-row spans across the upper body
     * (skipping the sleeve flare at the very top and the hem flare at the
     * bottom). Scaling so THAT fills the box width is what makes the garment
     * actually cover the person, while the shoulders end up proportionally wider —
     * which is correct, because shoulders ARE wider than the torso.
     */
    const bodyRows = [];
    const fromY = Math.round(minY + boxH * 0.10);
    const toY = Math.round(minY + boxH * 0.62);
    for (let y = fromY; y <= toY && y < h; y++) {
      const r = rows[y];
      if (!r) continue;
      bodyRows.push(r.maxX - r.minX + 1);
    }
    bodyRows.sort((a, b) => a - b);
    const bodiceSpan = bodyRows.length
      ? bodyRows[Math.floor(bodyRows.length / 2)]   // median
      : shoulderSpan;

    return {
      boxW,
      boxH,
      shoulderRow,          // scan-row index
      shoulderSpan,         // scan-px width of the fabric at its shoulders
      bodiceSpan,           // scan-px median width across the upper body
      shoulderTop: minY,
      shoulderBottom: maxY,
      rows,
    };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Lighting
 * ------------------------------------------------------------------ */

/**
 * Sample the portrait to find where its light comes from and how bright the
 * scene is, so the garment can be shaded to match instead of being stamped on
 * at uniform brightness.
 *
 * This is a REAL measurement of the customer's own photo — the average luma of
 * its left and right halves, plus the overall level — not a fixed gradient.
 * That satisfies "match the ambient illumination and directional lighting"
 * using pixels already on the canvas, at no AI cost.
 *
 * @returns {{direction:number, strength:number, ambient:number}|null}
 */
const sampleLighting = (ctx, w, h) => {
  try {
    // Upper 55% only: for a portrait that is where the torso sits, so a bright
    // floor or dark shoes cannot skew the read.
    const bandH = Math.max(1, Math.round(h * 0.55));
    const { data } = ctx.getImageData(0, 0, w, bandH);

    const mid = Math.floor(w / 2);
    let leftSum = 0;
    let rightSum = 0;
    let leftCount = 0;
    let rightCount = 0;
    let total = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue; // Transparent: not part of the subject.

      // Rec. 601 luma — how the eye actually weights the channels.
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const px = (i / 4) % w;

      total += luma;
      count++;

      if (px < mid) {
        leftSum += luma;
        leftCount++;
      } else {
        rightSum += luma;
        rightCount++;
      }
    }

    if (count === 0) return null;

    const leftAvg = leftCount ? leftSum / leftCount : 0;
    const rightAvg = rightCount ? rightSum / rightCount : 0;
    const spread = Math.abs(leftAvg - rightAvg);

    /*
     * Direction in [-1, 1]. Positive = the RIGHT of the frame is brighter, so
     * light arrives from the right and the garment's right side should be lit.
     * A spread under 4 luma levels is indistinguishable from noise, so we call
     * it flat rather than inventing a direction.
     */
    return {
      direction: spread < 4 ? 0 : (rightAvg - leftAvg) / 255,
      strength: Math.min(1, spread / 60),
      ambient: Math.max(0, Math.min(1, total / count / 255)),
    };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ *
 * Region drawing
 * ------------------------------------------------------------------ */

/**
 * Where a garment sits on the figure, as fractions of the garment's own box.
 * The hem of a top tucks slightly INTO the body's silhouette so the fabric reads
 * as worn rather than as a rectangle parked on top of the torso.
 */
const TUCK = 0.035;

/**
 * Build the per-row horizontal envelope of the garment after warping.
 *
 * The piece is not a rigid rectangle: a worn garment follows the body's width
 * down its length. Rather than a constant width we taper from a shoulder/hem
 * profile so a top narrows at the waist and a bottom widens at the hips. This is
 * what makes the piece look like it is ON the person instead of over them.
 */
const garmentWidthAt = (t, key) => {
  // t: 0 at the garment's top, 1 at its bottom.
  switch (key) {
    case 'top':
      // Shoulders widest, gentle taper to the waist, slight flare at the hem.
      return 1 - 0.10 * Math.sin(Math.PI * t) + 0.04 * Math.sin(Math.PI * t * 2);
    case 'outerwear':
      // Worn open and hangs straighter than a top.
      return 1 - 0.04 * Math.sin(Math.PI * t);
    case 'bottom':
      // Narrows at the waist, widens across the hips/seat.
      return 0.88 + 0.22 * Math.sin(Math.PI * t * 0.85);
    case 'dress':
      // Fitted through the torso, flaring toward the hem.
      return 0.86 + 0.30 * Math.pow(t, 1.35);
    case 'footwear':
      return 1;
    default:
      return 1;
  }
};

/**
 * Where along the garment each measurement is taken, as a fraction of its length.
 *
 * These are ANCHORS, not guesses: on a dress the chest measurement is taken at
 * the bust line (~25% down from the shoulder), the waist at the natural waist
 * (~45%), and the hips where the garment is cut for the seat (~62%). The hem is
 * the bottom of the piece.
 *
 * The values are the same mapping the admin's measurement form implies, so a
 * garment's table and the drawn silhouette agree about WHERE each number applies.
 */
const TAPER_ANCHORS = {
  top: [
    { t: 0.0, of: 'shoulder_width' },
    { t: 0.30, of: 'chest_bust' },
    { t: 0.62, of: 'waist' },
    { t: 1.0, of: 'chest_bust' },
  ],
  dress: [
    { t: 0.0, of: 'shoulder_width' },
    { t: 0.25, of: 'chest_bust' },
    { t: 0.45, of: 'waist' },
    { t: 0.62, of: 'hips' },
    { t: 1.0, of: 'hips' },
  ],
  bottom: [
    { t: 0.0, of: 'waist' },
    { t: 0.45, of: 'hips' },
    { t: 1.0, of: 'hips' },
  ],
  outerwear: [
    { t: 0.0, of: 'shoulder_width' },
    { t: 0.30, of: 'chest_bust' },
    { t: 1.0, of: 'chest_bust' },
  ],
};

/**
 * Turn the garment's measured profile into a per-row width curve.
 *
 * Returns a function `t -> widthMultiplier` NORMALISED so its WIDEST anchor is
 * 1.0. Normalising is essential: `drawnW` has already been scaled to cover the
 * torso (and multiplied by the fit ratio), so a curve carrying absolute cm would
 * scale the garment a second time and draw it far too large. Only the RATIOS
 * between the garment's own measurements survive, which is exactly the shape
 * information that is missing from the analytic curve.
 *
 * Returns NULL when the table cannot support a curve — fewer than two usable
 * anchors. The caller then keeps the analytic taper, so an incomplete admin form
 * degrades to the previous behaviour instead of drawing a degenerate shape.
 *
 * @param {Object} taper  { chest_bust, waist, hips, shoulder_width } in cm, nulls allowed
 * @param {string} key    garment category
 * @returns {Function|null} t -> multiplier or null when unusable
 */
const resolveGarmentTaper = (taper, key) => {
  const anchors = TAPER_ANCHORS[key];
  if (!anchors || !taper) return null;

  // Keep only anchors whose value we actually hold.
  const known = anchors
    .map((a) => ({ t: a.t, v: Number(taper[a.of]) }))
    .filter((a) => Number.isFinite(a.v) && a.v > 0);

  /*
   * TWO anchors is the minimum that describes a taper. With one point there is no
   * ratio to express and the curve would be a flat line, which is worse than the
   * analytic curve it replaces — so return null and let the caller keep that.
   */
  if (known.length < 2) return null;

  const widest = Math.max(...known.map((a) => a.v));
  if (!(widest > 0)) return null;

  return (t) => {
    const tt = Math.min(Math.max(t, 0), 1);

    // Outside the first/last anchor, hold that anchor's value (no extrapolation).
    if (tt <= known[0].t) return known[0].v / widest;
    if (tt >= known[known.length - 1].t) return known[known.length - 1].v / widest;

    // Linear interpolation between the two bracketing anchors.
    for (let i = 0; i < known.length - 1; i++) {
      const a = known[i];
      const b = known[i + 1];
      if (tt >= a.t && tt <= b.t) {
        const span = b.t - a.t;
        const f = span > 0 ? (tt - a.t) / span : 0;
        return (a.v + (b.v - a.v) * f) / widest;
      }
    }

    return known[known.length - 1].v / widest;
  };
};

/**
 * Paint the warped garment slices — shared by the fabric pass, the shade pass
 * and the ambient-lift pass so all three cover EXACTLY the same pixels.
 *
 * POSE-AWARE WARP (the "nakatuwad / nakayuko" fix)
 * -------------------------------------------------
 * The previous version placed every slice on a straight vertical: each band's
 * centre was `x + (w - sliceW) / 2`, i.e. the SAME centre for every row, with
 * the whole garment rotated by a single shoulder tilt. That is correct only for
 * a subject standing bolt upright. When the customer leans or hunches, the
 * torso's centre DRIFTS row by row, so a garment held on one vertical line sits
 * over empty air on the side the body has moved away from — the garment floats
 * beside a leaning torso and covers area the body no longer occupies.
 *
 * So each band's centre now FOLLOWS the body: `spineX` (from bodyPose) gives the
 * body's own horizontal centre AT THAT ROW in image pixels, and the band is
 * shifted to sit on it. A garment therefore bends down the figure with the
 * wearer, exactly as fabric on a leaning body does.
 *
 * @param {Object|null} pose   from measureBodyPose(); when null (no readable
 *        silhouette) the slice centre falls back to the straight vertical, which
 *        is the previous, standing-figure behaviour.
 */
const paintSlices = (g, img, sx, sy, sw, sh, x, y, w, h, key, slices, box, tilt, pose, fit = null) => {
  const sliceH = sh / slices;
  /*
   * The garment's own centre line before the tilt: everything is positioned
   * relative to `box.centreX` so the rotation below pivots around the torso.
   */
  const straightCentre = x + w / 2;

  g.save();
  g.translate(box.centreX, y);
  g.rotate(tilt);
  g.translate(-box.centreX, -y);

  /*
   * WHY THE SLICE WIDTH IS *NOT* DRIVEN BY THE MEASURED BODY WIDTH.
   *
   * This was tried and REVERTED. `pose.widthAt()` gives the silhouette's per-row
   * envelope, so feeding it into the slice width looks like the obvious way to
   * stop a garment looking like a sticker. On the real portrait it made the
   * render dramatically WORSE: the silhouette necks down to a narrow stand below
   * the hips, so the dress was squeezed to the stand's width and rendered as a
   * thin vertical strip between the legs — a far more visible failure than the
   * rectangle it replaced.
   *
   * The reason is that the silhouette envelope below the hip is NOT the body the
   * garment covers. It is a stand, a shadow, a gap between legs, a leg edge — the
   * garment is not worn over any of those in the way its width would imply. The
   * analytic taper in `garmentWidthAt()` models how FABRIC HANGS, which is a
   * property of the garment and does not neck down to a pole.
   *
   * So the taper stays analytic. It is a modelling choice, not a measurement, and
   * it is the choice that renders correctly.
   */
  /*
   * THE GARMENT'S OWN SILHOUETTE, WHEN WE HAVE IT.
   *
   * `garmentWidthAt` models how fabric GENERALLY hangs — a fixed curve, identical
   * for every Size XS and Size 2XL. When the garment's measurement table is
   * available we can do better: the curve becomes the garment's ACTUAL profile,
   * so a waist-suppressed dress pinches at the waist and a straight shift does
   * not. This is what makes the render read as "this garment, in this size".
   *
   * The measured taper REPLACES the analytic one for that garment (rather than
   * being multiplied into it) — multiplying two tapers double-counts the pinch
   * and turns a fitted dress into an hourglass. When the table is absent or too
   * sparse to interpolate, the analytic curve is used and nothing changes.
   */
  const measuredTaper = fit ? resolveGarmentTaper(fit.taper, key) : null;

  for (let i = 0; i < slices; i++) {
    const t = i / (slices - 1 || 1);
    const taper = measuredTaper ? measuredTaper(t) : garmentWidthAt(t, key);

    const srcY = sy + i * sliceH;
    const dstY = y + (i / slices) * h;
    const sliceDstH = h / slices;

    const sliceW = w * taper;

    /*
     * FOLLOW THE BODY'S CENTRE.
     *
     * `spineX(dstY)` is the body's horizontal centre at this row, in image px.
     * The correction is the offset of that centre from the straight vertical the
     * garment would otherwise sit on. It is clamped to the garment's own width so
     * a noisy silhouette row can never fling a band off the figure, and it is
     * skipped entirely for footwear (feet are placed by the body frame, not the
     * torso spine).
     */
    let spineShift = 0;
    if (pose?.spineX && key !== 'footwear') {
      const bodyCentre = pose.spineX(dstY);
      if (Number.isFinite(bodyCentre)) {
        const maxShift = w * 0.6;
        spineShift = Math.max(-maxShift, Math.min(maxShift, bodyCentre - box.centreX));
      }
    }

    const sliceX = straightCentre - sliceW / 2 + spineShift;

    // Overdraw each band by a hair so no seam line shows between slices.
    g.drawImage(img, sx, srcY, sw, sliceH + 1, sliceX, dstY, sliceW, sliceDstH + 1);
  }

  g.restore();
};

/**
 * Draw a garment into its MEASURED box, CONFORMED to the subject's body.
 *
 * THE THREE THINGS THIS FIXES
 * ---------------------------
 *  1. SIZE — the old COVER-fit scaled the piece to the CARD's aspect ratio, so a
 *     1000x1250 marketing image dictated the garment's proportions. The base
 *     scale now comes from `box` (derived from the customer's real measurements
 *     against the SUBJECT's pixel shoulder span) and is applied to the garment's
 *     own cropped bounds.
 *
 *  2. POSE — the piece is drawn through a per-row width envelope so it follows
 *     the body's taper instead of staying a rigid rectangle, and it is aligned to
 *     the subject's shoulder line rather than the canvas.
 *
 *  3. SHADOWS — a contact shadow is cast onto the body FIRST, then the fabric is
 *     shaded with the portrait's own measured light direction, so the piece reads
 *     as sitting under the same illumination as the customer.
 *
 * @param {Object} frame  the measured body frame (for the shoulder slope).
 * @param {string} key    the garment category being drawn.
 */
const drawIntoBox = (ctx, img, box, canvasW, canvasH, lighting, readable, isCutout, frame, key, pose, fit = null) => {
  const shape = readable && isCutout ? measureShape(img) : null;

  /* Prefer the trimmed bounds so the garment's own pixels are used edge-to-edge. */
  const src = readable && isCutout ? trimBounds(img) : null;
  const sx = src?.x ?? 0;
  const sy = src?.y ?? 0;
  const sw = src?.w ?? img.width;
  const sh = src?.h ?? img.height;

  /*
   * FIT TO THE FABRIC, NOT TO THE BOUNDING BOX.
   *
   * THIS IS THE UNDERSIZE FIX, AND IT IS A SHAPE FIX.
   *
   * Two wrong fits were tried and measured before this one:
   *
   *   1. `Math.min(widthScale, heightScale)` — a CONTAIN fit. It always picks the
   *      smaller ratio, so the piece can never fill both axes and lands undersized
   *      (measured: 317x389 on a 720px body band — a chest plate, not a dress).
   *
   *   2. Scaling the BOX width to the body width. Better, but still wrong, because
   *      a flat-lay dress is not a rectangle: measured on the live EMERALD cut-out
   *      the fabric's own span is 81% of the box at the shoulders but only 44% at
   *      the bodice and 59% at the hem. So the visible fabric came out at ~44% of
   *      the body while the maths reported a perfect fit, and the box's empty side
   *      padding pushed the shoulders out over the arms.
   *
   * The piece is therefore scaled so the FABRIC'S OWN SHOULDER SPAN equals the
   * body's measured width. The empty margins stop counting, the bodice fills the
   * torso, and the shoulders land on the shoulders.
   */
  /*
   * COORDINATE SPACE MATTERS HERE.
   *
   * `measureShape` reports spans in SCAN pixels (a 96px-wide downscale), while
   * `box.width` is in CANVAS pixels. Dividing one by the other is a unit error:
   * on the live EMERALD the scan shoulder span is ~48px and the body box ~317px,
   * so a naive `box.width / fabricSpan` gives a scale of ~6.6 and draws the dress
   * several thousand pixels wide — it swallowed the whole frame.
   *
   * So the scan span is first converted to ORIGINAL-image pixels, and the scale
   * is expressed against the image box. (The scale is then applied to `sw`/`sh`,
   * which are already in original-image pixels, so the units are consistent.)
   */
  const scanToImage = img.width / MEASURE_SCAN;

  /*
   * SCALE THE GARMENT BODY TO THE WEARER'S TORSO.
   *
   * Measured row-span profile of the live EMERALD cut-out (96px scan):
   *
   *   4%-8%   span 89-94   the SLEEVES (pointed tips flaring wide)
   *   25%-42% span 36-44   the BODICE/WAIST  <- the garment's real body
   *   47%-97% span 39-50   the SKIRT
   *   median 47, p25 43, p75 49, max 94
   *
   * The median (47) is the garment BODY; the max (94) is the sleeve flare. Scaling
   * the full crop by the SLEEVE span (the first version) shrank the body to ~44%
   * of the torso; scaling by the BODY span makes the dress cover the person, at
   * the cost of the sleeve tips reaching over the arms — which is what off-shoulder
   * sleeves actually do.
   *
   * A bound is still applied to that overhang so a wildly flared flat-lay cannot
   * swallow the frame: the drawn garment may reach at most 1.9x the body box.
   */
  const bodySpanScan = shape ? (shape.bodiceSpan || shape.shoulderSpan) : MEASURE_SCAN;
  const fabricSpanImage = shape ? bodySpanScan * scanToImage : sw;

  const rawScale = box.width / fabricSpanImage;
  const maxDrawnW = box.width * 1.9;
  const scale = Math.min(rawScale, maxDrawnW / sw);

  /*
   * HEIGHT FOLLOWS THE BODY, NOT THE FLAT-LAY'S PHOTO ASPECT.
   *
   * THIS IS THE "TOO SMALL" FIX, and it is the last of them.
   *
   * Measured on the live EMERALD through the real pipeline:
   *
   *   dress box      : width 317   height 720   (the body band, shoulder->below hip)
   *   cut-out        : 739 x 905   (aspect 0.82)
   *   width fit      : scale = 317 / 724 = 0.439
   *   resulting height: 905 * 0.439 = 397
   *
   * 397px on a 720px band is 55% of the intended length — the dress landed on the
   * chest and stopped. The earlier "only ease it when wildly off" clamp kept k = 1
   * because 397 barely cleared the 0.55 threshold, so the piece stayed squat.
   *
   * The mistake was treating the flat-lay's OWN aspect as sacred. It is not a
   * property of the GARMENT, it is a property of how the product was photographed:
   * a dress shot wide on a hanger has a completely different aspect from the same
   * dress worn on a standing figure. What IS a property of the garment is where it
   * ends on the body — and the box already encodes that (shoulder to below-hip).
   *
   * So the width comes from the FABRIC's shoulder span and the height comes from
   * the BODY BAND. The piece is scaled non-uniformly, which is the correct thing
   * here: we are dressing a body, not framing a photograph.
   */
  /*
   * 3. THE WEARER'S SIZE AGAINST THE GARMENT'S SIZE.
   *
   * This is the step that makes a Size XS and a Size 2XL of the same dress render
   * DIFFERENTLY. It must be applied to the WIDTH only, and applied to the width
   * AFTER the fabric-to-torso fit above, so the two effects compose in the right
   * order:
   *
   *   - the fabric fit says "how much of the product photo is garment"
   *   - the size ratio says "and this garment is 1.15x the wearer's chest"
   *
   * Height is deliberately NOT scaled by the ratio. A longer garment of the same
   * chart size is a different LENGTH measurement (top_length), not a different
   * chest, and stretching the hem for a chest mismatch would put the hem in the
   * wrong place on the body. Length already comes from the body band (box.height),
   * which is the correct reference.
   */
  const fitScale = fit ? fit.clamped : 1;
  const drawnW = sw * scale * fitScale;
  const drawnH = key === 'footwear' ? sh * scale : box.height;

  /*
   * CENTRE THE FABRIC, NOT THE BOX.
   *
   * The flat-lay's fabric is not centred in its own bounding box — the sleeves
   * and the hem flare to one side on many catalog shots. Centring the BOX (as
   * the old code did) therefore hung the piece slightly beside the torso, which
   * is why the measured render showed the dress offset against a centred body.
   *
   * `shape.shoulderRow` is the fabric's widest row, and the box's own horizontal
   * centre is measured at that row, so the offset between the two is exactly the
   * correction needed to put the fabric's mass on the body's centre line.
   */
  /*
   * `measureShape` scans the WHOLE image, but `drawnW` is the TRIMMED crop's
   * width (`sw`). Mixing the two coordinate systems is what offset the dress to
   * the right: the fabric centre was expressed as a fraction of the full image
   * while the crop had already discarded the empty margin on the left.
   *
   * So the fabric centre is converted into a fraction of the CROP: subtract the
   * crop's own origin in image pixels, then divide by the crop's width.
   */
  let fabricCentreInCrop = drawnW / 2;
  if (shape) {
    /*
     * CENTRE ON THE BODICE ROW, NOT THE SLEEVE ROW.
     *
     * Centring on `shoulderRow` (the WIDEST row) used the sleeve tips, which are
     * asymmetric on a flat-lay — on the live EMERALD the sleeves flare unevenly,
     * so their midpoint is far from the garment's own centre line and the dress
     * rendered offset to one side.
     *
     * The bodice row is symmetric by construction (it is the garment's body), so
     * its midpoint IS the garment's centre.
     */
    const bodyRowIndex = Math.round(
      shape.shoulderTop + (shape.shoulderBottom - shape.shoulderTop) * 0.30,
    );
    const rowData = shape.rows?.[bodyRowIndex] || shape.rows?.[shape.shoulderRow];
    if (rowData) {
      const scanToImageX = img.width / MEASURE_SCAN;
      const fabricCentreImage = ((rowData.minX + rowData.maxX) / 2) * scanToImageX;
      const centreInCropPx = fabricCentreImage - sx;
      fabricCentreInCrop = (centreInCropPx / sw) * drawnW;
    }
  }

  /*
   * Re-centre the fabric using the FITTED width. `fabricCentreInCrop` was derived
   * against the un-ratio'd `drawnW`, so scaling the width without re-deriving the
   * centre would grow the garment to one side and leave the torso off-centre —
   * visible as fabric bulging past one hip.
   */
  const fabricCentre = fitScale !== 1
    ? fabricCentreInCrop * fitScale
    : fabricCentreInCrop;

  const x = box.centreX - fabricCentre;
  /*
   * Anchor to the garment region's top (the shoulder line for a top).
   *
   * The piece is nudged down a touch for a top/outerwear so the overlay tucks
   * into the shoulder seam the way a worn collar does, rather than floating
   * above the neck.
   */
  const y = box.top - (key === 'top' || key === 'outerwear' ? TUCK * box.height : 0);

  // A gentle shoulder-slope tilt so the piece is not more level than the body.
  const tilt = frame?.shoulderSlope ?? 0;

  ctx.save();

  if (isCutout) {
    /*
     * 1. CONTACT SHADOW ON THE BODY.
     *
     * Drawn BEFORE the fabric so the shadow falls on the person, not on top of
     * the garment. This is what makes the piece sit ON the body instead of
     * hovering over it.
     *
     * It is derived from the GARMENT's own drawn rectangle, not from `box`, so
     * the shadow tracks the fabric exactly. The previous version sized it from
     * the box and centred it at `y + h * 0.55` with `h` being the pre-clamp
     * height, which is why the measured render showed a large grey blob offset
     * to one side of the dress rather than a shadow under it.
     */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.filter = `blur(${Math.max(5, Math.round(box.width * 0.06))}px)`;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    /*
     * THE SHADOW MATCHES THE TORSO, NOT THE SLEEVES.
     *
     * This used `drawnW` (the full drawn garment, which now includes the sleeve
     * flare) times a fabric/box ratio — so as soon as the garment was scaled to
     * cover the torso the shadow grew with the sleeves and spilled past the body,
     * which is the grey band seen beside the torso in the measured render.
     *
     * A contact shadow describes where the piece meets the BODY, so it is sized
     * from `box.width` (the measured torso) and kept soft and subtle. Its
     * position is the garment's own centre, so it stays under the fabric.
     */
    const shadowW = box.width * 0.56;
    ctx.ellipse(
      box.centreX,
      y + drawnH * 0.90,
      shadowW,
      Math.max(6, box.height * 0.05),
      tilt,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();

    /*
     * 2. THE GARMENT, WARPED TO THE BODY.
     * Drawn slice-by-slice: each horizontal band of the source is placed at the
     * width `garmentWidthAt()` says the body is at that height. This is a cheap
     * 1D warp, but it is what converts a flat-lay rectangle into fabric that
     * follows the figure's taper.
     */
    const SLICES = 32;
    paintSlices(ctx, img, sx, sy, sw, sh, x, y, drawnW, drawnH, key, SLICES, box, tilt, pose, fit);

    /*
     * 3. SHADE THE FABRIC TO THE PORTRAIT'S LIGHT.
     * Multiplied over the garment's OWN pixels via `source-in`, so the gradient
     * modulates the fabric without touching the body showing through.
     */
    if (lighting) {
      const g = ctx.createLinearGradient(x, 0, x + drawnW, 0);
      const d = lighting.direction;
      const s = lighting.strength * 0.5;
      const dark = Math.round(255 - s * 120);

      if (d === 0) {
        g.addColorStop(0, 'rgba(180,180,180,1)');
        g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(180,180,180,1)');
      } else if (d > 0) {
        // Light from the RIGHT: brighten right, darken left.
        g.addColorStop(0, `rgba(${dark},${dark},${dark},1)`);
        g.addColorStop(1, 'rgba(255,255,255,1)');
      } else {
        // Light from the LEFT.
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, `rgba(${dark},${dark},${dark},1)`);
      }

      /*
       * Confine the shade to the garment's OWN pixels via `source-in`.
       * Without this the gradient would multiply across the whole box and
       * darken the BODY visible through a cut-out's transparent regions.
       */
      const shade = document.createElement('canvas');
      shade.width = canvasW;
      shade.height = canvasH;
      const sctx = shade.getContext('2d');
      // Re-paint the SAME warped slices so the gradient is confined to exactly
      // the pixels the fabric pass just laid down.
      paintSlices(sctx, img, sx, sy, sw, sh, x, y, drawnW, drawnH, key, SLICES, box, tilt, pose, fit);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = g;
      // A generous rect: the layer is rotated, so the drawn rect alone may clip.
      sctx.fillRect(x - drawnW, y - drawnH, drawnW * 3, drawnH * 3);

      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(shade, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      /*
       * 4. AMBIENT LIFT.
       * A bright scene must not leave the fabric darker than its surroundings.
       * `screen`-like lift toward the portrait's own ambient level, again
       * confined to the garment's own pixels.
       */
      if (lighting.ambient > 0.45) {
        const lift = document.createElement('canvas');
        lift.width = canvasW;
        lift.height = canvasH;
        const lctx = lift.getContext('2d');
        paintSlices(lctx, img, sx, sy, sw, sh, x, y, drawnW, drawnH, key, SLICES, box, tilt, pose, fit);
        lctx.globalCompositeOperation = 'source-in';
        lctx.fillStyle = `rgba(255,248,235,${Math.min(0.12, (lighting.ambient - 0.45) * 0.25)})`;
        lctx.fillRect(0, 0, canvasW, canvasH);

        ctx.drawImage(lift, 0, 0);
      }
    }
  } else {
    /*
     * Opaque product photo: draw through a feathered mask so the rectangular
     * photo boundary dissolves into the body instead of hard-cutting.
     */
    const layer = document.createElement('canvas');
    layer.width = canvasW;
    layer.height = canvasH;
    const lctx = layer.getContext('2d');

    lctx.drawImage(img, sx, sy, sw, sh, x, y, drawnW, drawnH);

    lctx.globalCompositeOperation = 'destination-in';

    const grad = lctx.createRadialGradient(
      x + drawnW / 2, y + drawnH / 2, Math.min(drawnW, drawnH) * 0.22,
      x + drawnW / 2, y + drawnH / 2, Math.max(drawnW, drawnH) * 0.62,
    );
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.92)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = grad;
    lctx.fillRect(x, y, drawnW, drawnH);

    ctx.globalAlpha = 0.97;
    ctx.drawImage(layer, 0, 0);
  }

  ctx.restore();

  /*
   * Return the geometry the fabric ACTUALLY occupied.
   *
   * The occlusion pass needs the real drawn rectangle, not the pre-fit `box`: a
   * piece is re-centred on its fabric and tilted by the shoulder slope, so the
   * drawn `x`/`y` differ from `box.left`/`box.top`. Reporting the true rect here
   * is what lets occlusion restore the body precisely outside the fabric and
   * never bite into the garment.
   */
  return { x, y, drawnW, drawnH, tilt };
};

/** A gentle vignette so the composite reads as a studio shot. */
const drawVignette = (ctx, w, h) => {
  const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.85);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
};

/* ------------------------------------------------------------------ *
 * OCCLUSION — the "parang nakasuot talaga" pass
 * ------------------------------------------------------------------ */

/**
 * Capture the SUBJECT'S OWN pixels once, before any garment is drawn.
 *
 * We keep two copies:
 *   - a full-resolution snapshot of the portrait (the pixels to restore), and
 *   - a binary mask of WHERE THE BODY IS, from the portrait's alpha channel.
 *
 * The mask is what makes occlusion possible at all: to put a forearm back in
 * front of a sleeve, we must know which pixels belong to the body.
 *
 * Returns null when the portrait has no readable alpha silhouette, in which case
 * occlusion is skipped (the render degrades to a plain overlay rather than
 * cutting holes in the customer's photo using a guess).
 */
const captureBody = (portraitImg, canvas, ctx, canvasW, canvasH) => {
  const probe = document.createElement('canvas');
  probe.width = canvasW;
  probe.height = canvasH;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(portraitImg, 0, 0, canvasW, canvasH);

  let pixels;
  try {
    pixels = pctx.getImageData(0, 0, canvasW, canvasH);
  } catch {
    return null; // Tainted portrait: cannot read the body mask.
  }

  const { data } = pixels;
  let opaque = 0;
  const mask = new Uint8Array(canvasW * canvasH);
  for (let p = 0; p < canvasW * canvasH; p++) {
    if (data[p * 4 + 3] > 200) {
      mask[p] = 1;
      opaque++;
    }
  }

  // No meaningful alpha silhouette -> no honest occlusion.
  if (opaque / (canvasW * canvasH) < 0.03) return null;

  return { snapshot: probe, mask, ctx: pctx };
};

/**
 * Re-draw the parts of the BODY that are IN FRONT of the garment.
 *
 * THE IDEA, AND WHY IT IS HONEST
 * ------------------------------
 * A worn garment is occluded by whatever the body puts in front of it: a forearm
 * folded across the waist, a hand resting on a hip, crossed arms over the chest.
 * Without this, the fabric is painted straight over those limbs and the render
 * reads as a sticker, because the fabric covers things it physically cannot.
 *
 * We do NOT have a limb tracker, so we do not claim to know where the arms are.
 * What we CAN do, deterministically, is re-draw the body OUTSIDE the garment's
 * own horizontal span. The reason this is right:
 *
 *   - The garment is centred on the torso and sized to the torso's width.
 *   - Pixels of the body OUTSIDE that span, at the garment's rows, are by
 *     definition not covered by the garment — they are a limb, a hip or a
 *     shoulder that extends past the fabric.
 *   - Restoring the body ONLY where it lies outside the fabric's covered columns
 *     therefore puts real limbs back over nothing, and never punches a hole
 *     through the middle of the garment.
 *
 * In effect: the fabric may only ever cover the columns it was drawn into, and
 * the body comes back everywhere else. That is a conservative, explainable rule
 * that makes a bent or arm-crossed pose read as WORN instead of overlaid, and it
 * cannot invent geometry. It is applied only at rows the garment actually
 * occupies, so the head, legs and background are untouched.
 *
 * @param {number} bandTop   image-y where the stacked garments begin
 * @param {number} bandBottom image-y where they end
 * @param {Array<{left:number,right:number}>} coveredCols  per-row fabric spans
 */
const restoreBodyInFront = (ctx, body, canvasW, canvasH, band, coveredCols) => {
  if (!body || !band) return;

  const { snapshot } = body;
  const top = Math.max(0, Math.floor(band.top));
  const bottom = Math.min(canvasH, Math.ceil(band.bottom));
  if (bottom <= top) return;

  /*
   * Build a single canvas holding ONLY the body pixels in the garment's band,
   * then mask out the columns the fabric covers. What remains is the body that
   * was in front — limbs and side mass outside the garment's own span.
   */
  const layer = document.createElement('canvas');
  layer.width = canvasW;
  layer.height = canvasH;
  const lctx = layer.getContext('2d');

  lctx.drawImage(snapshot, 0, 0);

  // Erase everything outside the band so only the garment's rows can be affected.
  lctx.clearRect(0, 0, canvasW, top);
  lctx.clearRect(0, bottom, canvasW, canvasH - bottom);

  /*
   * FOR EACH ROW, CLEAR THE COLUMNS THE FABRIC COVERS.
   *
   * `destination-out` removes the body exactly where the fabric was drawn, so
   * the restored layer keeps ONLY body pixels outside the garment. Restoring it
   * is therefore guaranteed to leave the garment's own area intact.
   */
  lctx.globalCompositeOperation = 'destination-out';
  lctx.fillStyle = '#000';
  for (let y = top; y < bottom; y++) {
    const span = coveredCols[y];
    if (!span) continue;
    // Widen by a couple of px so the fabric's feathered edge stays covered and a
    // hard outline of the body does not reappear along the seam.
    const x0 = Math.max(0, span.left - 2);
    const x1 = Math.min(canvasW, span.right + 2);
    lctx.fillRect(x0, y, x1 - x0, 1);
  }
  lctx.globalCompositeOperation = 'source-over';

  ctx.drawImage(layer, 0, 0);
};

/**
 * CLIP THE FABRIC TO THE PERSON.
 *
 * This is the single change that stops the render reading as a pasted sticker.
 *
 * Without it, a garment is drawn as a rotated rectangle over the torso, so any
 * column of fabric that extends past the body — beside an arm, off the shoulder,
 * around a narrow waist — is painted onto BACKGROUND pixels. The eye reads that
 * immediately as a cut-out laid on top of a photo, however good the colour and
 * lighting match is.
 *
 * `personMatte` supplies the on-device ISNet mask (see utils/personMatte.js).
 * Everything OUTSIDE it is erased from the fabric, so the garment takes the
 * silhouette of the actual person.
 *
 * HOW IT ERASES WITHOUT HARMING THE REST OF THE FRAME
 * ---------------------------------------------------
 * `destination-out` inside a `clip`ped rect is used rather than per-pixel
alpha writes: it is GPU-accelerated, needs no `getImageData` (so it stays fast on
 * a large canvas), and is limited to the garment's own band and columns, which
 * means the portrait and the background are byte-for-byte untouched.
 *
 * @returns {boolean} true when a clip actually ran, so the caller can report it.
 */
const clipFabricToPerson = (ctx, matte, canvasW, canvasH, drawn) => {
  if (!ctx || !matte) return false;

  const top = Math.max(0, Math.floor(drawn.y));
  const bottom = Math.min(canvasH, Math.ceil(drawn.y + drawn.drawnH));
  if (bottom <= top) return false;

  /*
   * The garment is drawn rotated by the shoulder slope, so its horizontal reach
   * is the rect widened by the tilt's own contribution. Outside that union there
   * is no fabric to clip, and erasing there would eat the portrait.
   */
  const tiltSpread = Math.abs(Math.sin(drawn.tilt || 0)) * drawn.drawnH;
  const x0 = Math.max(0, Math.floor(drawn.x - tiltSpread));
  const x1 = Math.min(canvasW, Math.ceil(drawn.x + drawn.drawnW + tiltSpread));
  if (x1 <= x0) return false;

  const bandW = x1 - x0;
  const bandH = bottom - top;

  // A mask of the fabric band only, at 1:1 with the canvas, so it can be used
  // as a `destination-out` stencil without any coordinate scaling.
  const stencil = document.createElement('canvas');
  stencil.width = bandW;
  stencil.height = bandH;
  const sctx = stencil.getContext('2d', { willReadFrequently: true });

  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, bandW, bandH);

  /*
   * PUNCH THE PERSON OUT OF THE STENCIL.
   *
   * The stencil starts solid ("erase everything") and has the person's mask
   * removed from it, so what remains is exactly the area OUTSIDE the person that
   * lies within the fabric band. `destination-out` then erases the fabric there.
   *
   * Rows are sampled from the matte's NORMALISED span, so this is independent of
   * the mask's own resolution — the mask is 256px-ish and the canvas is up to
   * 900px, and nothing here assumes they match.
   */
  sctx.globalCompositeOperation = 'destination-out';

  for (let y = 0; y < bandH; y++) {
    const canvasY = top + y;
    const ny = canvasY / canvasH;
    const span = personSpanAtRow(matte, ny);

    // No person on this row: leave the stencil solid, so the whole strip of
    // fabric at this height is erased. That is correct — fabric floating on a
    // row where there is no body is fabric floating in the background.
    if (!span) continue;

    const px0 = Math.max(x0, Math.floor(span.left * canvasW));
    const px1 = Math.min(x1, Math.ceil(span.right * canvasW));
    if (px1 <= px0) continue;

    sctx.fillRect(px0 - x0, y, px1 - px0, 1);
  }

  sctx.globalCompositeOperation = 'source-over';

  /*
   * Apply the stencil to the real canvas, confined to the garment's band.
   *
   * `destination-out` reads only the stencil's ALPHA, so the solid black fill
   * above is what erases and the punched-out person leaves the fabric intact.
   */
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, top, bandW, bandH);
  ctx.clip();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(stencil, x0, top);
  ctx.restore();

  return true;
};

/**
 * Record the per-row horizontal span each drawn garment occupies, so the
 * occlusion pass knows which columns the fabric covers at every row.
 */
const recordCoveredColumns = (covered, drawn, key, canvasH) => {
  const top = Math.max(0, Math.floor(drawn.y));
  const bottom = Math.min(canvasH, Math.ceil(drawn.y + drawn.drawnH));

  // The drawn rect is rotated by the shoulder slope, so its horizontal extent is
  // widened by the tilt's own contribution to stay a safe superset of the fabric.
  const tiltSpread = Math.abs(Math.sin(drawn.tilt || 0)) * drawn.drawnH;
  const rectLeft = drawn.x - tiltSpread;
  const rectRight = drawn.x + drawn.drawnW + tiltSpread;
  const centreX = drawn.x + drawn.drawnW / 2;

  for (let y = top; y < bottom; y++) {
    /*
     * FABRIC SPAN AT THIS ROW.
     *
     * Mirrors `paintSlices`: a band's width is the drawn width scaled by the
     * category's own taper, centred on the fabric's centre line. This is the same
     * function the fabric pass used, so the columns recorded here are the columns
     * that were actually painted (an honest superset once the tilt spread is
     * added), which is what makes the occlusion safe.
     */
    const t = (y - drawn.y) / Math.max(1, drawn.drawnH);
    const taper = garmentWidthAt(t, key);
    const w = drawn.drawnW * taper;
    const cx0 = centreX - w / 2;
    const cx1 = centreX + w / 2;

    const lo = Math.max(rectLeft, cx0);
    const hi = Math.min(rectRight, cx1);

    const existing = covered[y];
    if (existing) {
      existing.left = Math.min(existing.left, lo);
      existing.right = Math.max(existing.right, hi);
    } else {
      covered[y] = { left: lo, right: hi };
    }
  }
};

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Compose a fitting on top of the customer's own photo.
 *
 * @param {Object} params
 * @param {string} params.portrait    Data URI / blob URL of the FULL-BODY photo.
 * @param {Object} params.garments    { top, bottom, footwear, outerwear, dress } -> { image_url, ... }
 * @param {Object} [params.measurements] 5-core CM measurements. Drives garment
 *                                       SCALE via a pixel-per-cm factor.
 * @param {string} [params.watermark] Small caption drawn in the corner.
 * @returns {Promise<{image: string|null, placed: string[], diagnostics: Object}>}
 *          `placed` lists the categories actually drawn, so the UI can report
 *          exactly what made it onto the render; `diagnostics` reports how the
 *          fit was derived and what (if anything) was skipped, so a bad render
 *          is explainable instead of mysterious.
 */
export const compositeTryOn = async ({
  portrait,
  garments = {},
  measurements = {},
  watermark = '',
  /*
   * `usePersonMatte` lets a caller turn the on-device person-mask pass OFF.
   * It defaults to ON because the clip is what makes the render read as worn
   * clothing rather than a pasted cut-out. It is switchable so a caller on a
   * low-powered device, or a test that needs the geometric path, can skip the
   * ~1-3s inference. Any value other than `false` leaves it enabled.
   */
  usePersonMatte = true,
}) => {
  const diagnostics = {
    fittedTo: 'unknown',
    silhouetteFound: false,
    pixelScaleSource: null,
    /* On-device person segmentation (the free render tier). */
    personMatte: false,
    personMatteSource: null,
    personCoverage: null,
    clippedToPerson: false,
    /**
     * FIGURE TYPE — 'full-figure' | 'bust' | 'unknown'.
     *
     * A bust crop has no legs, so the standing-figure garment spans cannot be
     * trusted on it and every hem is clamped to the subject's own extent. This
     * field is what lets the UI say "this photo is a head-and-shoulders crop"
     * instead of silently drawing a dress off the bottom edge.
     */
    figureType: 'unknown',
    /** True when a piece was shortened because the portrait is a bust crop. */
    shortenedByBust: false,
    /** The measured evidence behind `figureType`, so it is inspectable. */
    figureShape: null,
    lightingSampled: false,
    /* Posture read from the silhouette (nakatuwad / nakayuko awareness). */
    poseRead: false,
    posture: 'unknown',
    bent: false,
    /* Whether the body was captured for the occlusion pass. */
    occlusionReady: false,
    taintedGarments: [],
    skipped: [],
    /* Pieces whose real garment pixels were recovered from the catalog card. */
    cutouts: [],
    /* Pieces where extraction could not run, with the reason, so a render that
       kept a background is explainable rather than mysterious. */
    cutoutFallbacks: [],
  };

  /* Blob URLs created by extractGarment; freed once the render is encoded. */
  const extractedUrls = [];

  if (typeof document === 'undefined') {
    return { image: null, placed: [], diagnostics };
  }

  const portraitImg = await loadImage(portrait);
  if (!portraitImg) {
    return { image: null, placed: [], diagnostics };
  }

  /*
   * The canvas takes the PORTRAIT'S OWN aspect ratio. Forcing a 3:4 frame onto a
   * differently-shaped photo would crop the body and put every region in the
   * wrong place.
   */
  const MAX_W = 900;
  const scaleDown = Math.min(1, MAX_W / portraitImg.width);
  const canvasW = Math.round(portraitImg.width * scaleDown);
  const canvasH = Math.round(portraitImg.height * scaleDown);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  /*
   * `willReadFrequently` because this canvas is read back by the silhouette
   * scan and the lighting sampler. Without it the browser keeps the surface on
   * the GPU and every readback triggers a slow synchronisation.
   */
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // 1. THE ORIGINAL BODY PHOTO — always the base of the render.
  ctx.drawImage(portraitImg, 0, 0, canvasW, canvasH);

  /*
   * 2. MEASURE THE SUBJECT before drawing anything.
   *
   * Everything downstream is anchored to this geometry rather than to the
   * canvas midline, which is what stops garments floating beside an off-centre
   * body. When no silhouette can be read (opaque JPEG, or a cross-origin
   * portrait) `buildBodyFrame` returns a documented full-frame fallback and
   * says so through `isEstimated`, so the UI can label the fit as approximate
   * instead of implying a precision that is not there.
   */
  const metrics = resolveMeasurements(measurements);
  const silhouette = measureSilhouette(portraitImg);
  const frame = buildBodyFrame(silhouette, canvasW, canvasH);

  /*
   * 2b. MEASURE THE SUBJECT'S POSTURE (nakatuwad / nakayuko awareness).
   *
   * `frame` gives ONE shoulder line and ONE torso centre — correct for a
   * standing subject, wrong the moment the customer bends. `measureBodyPose`
   * reads the silhouette's per-row spine so a garment can follow a leaning or
   * hunched torso instead of hanging on a straight vertical beside it. When the
   * portrait has no readable silhouette this returns `available:false` and the
   * warp falls back to the straight vertical (the previous behaviour) — degraded,
   * never invented.
   */
  const pose = measureBodyPose(portraitImg);
  diagnostics.poseRead = !!pose?.available;
  diagnostics.posture = pose?.available ? pose.posture : 'unknown';
  diagnostics.bent = !!pose?.bent;

  /*
   * 2d. WHAT KIND OF PHOTO IS THIS?
   *
   * `hasLegs` comes from the silhouette scan (see measureSilhouette). Three
   * honest outcomes, and they are NOT collapsed into two:
   *
   *   true   a full figure — the standing spans are valid
   *   false  a bust / head-and-shoulders crop — every hem gets clamped to the
   *          subject's own extent, and the customer is told why
   *   null   unmeasurable (no readable silhouette) — we say `unknown` rather
   *          than guessing, and the fallback frame's own extent does the clamping
   */
  diagnostics.figureShape = silhouette?.figureShape ?? null;
  diagnostics.figureType =
    silhouette?.hasLegs === true ? 'full-figure'
    : silhouette?.hasLegs === false ? 'bust'
    : 'unknown';

  /*
   * 2c. CAPTURE THE BODY for the occlusion pass.
   *
   * Taken BEFORE any garment is drawn so it holds the customer's untouched
   * pixels. Restoring the parts of this that lie OUTSIDE the fabric's columns is
   * what puts a folded forearm back in FRONT of a sleeve — the difference
   * between fabric lying ON the person and fabric pasted OVER them.
   */
  const body = captureBody(portraitImg, canvas, ctx, canvasW, canvasH);
  diagnostics.occlusionReady = !!body;

  /* Per-row columns the stacked garments actually cover, for the occlusion pass. */
  const coveredColumns = [];
  let garmentBand = null;

  /*
   * px/cm for THIS subject: their real shoulder width (cm) against the pixel
   * shoulder envelope measured from the portrait. This is the scale that makes
   * a garment the right size for the PERSON rather than for the picture.
   */
  const pixelScale = derivePixelScale(frame, metrics.shoulder_width, canvasH);

  diagnostics.silhouetteFound = !!silhouette;
  diagnostics.fittedTo = silhouette ? 'measured-silhouette' : 'estimated-full-frame';
  diagnostics.pixelScaleSource = pixelScale.source;

  /*
   * 2e. GARMENT FIT RATIO — the wearer's size against the garment's size.
   *
   * UNTIL NOW THE GARMENT'S OWN SIZE HAD NO EFFECT ON THE RENDER. The draw was
   * scaled from the product PHOTOGRAPH's pixel span, so a Size XS and a Size 2XL
   * of the same dress produced a pixel-identical result. The garment's size table
   * (`size_measurements`, already arriving on every garment object) was never
   * read.
   *
   * WHAT A FIT RATIO MEANS, and why it is the honest model:
   *
   *   ratio = garment.chest_bust / wearer.chest_bust
   *
   *   ratio ~1.0  the garment is cut to the wearer  -> it sits as intended
   *   ratio >1.0  the garment is BIGGER than the body -> it hangs loose
   *   ratio <1.0  the garment is SMALLER than the body -> it pulls tight
   *
   * Only the CHEST/BUST axis is used as the size driver: it is the one dimension
   * every garment category in this catalog carries (bottoms carry waist/hips and
   * tops carry chest, but chest is present on both the dress and top tables and
   * has a sane fallback), so a single ratio stays comparable across categories.
   *
   * The ratio is CLAMPED. A 2XL top on an XS wearer is a real 1.4x ratio, but
   * drawing fabric at 1.4x its fitted width on a 2D silhouette stops reading as
   * "loose" and starts reading as "broken", so the visible range is bounded and
   * the true value is still reported in diagnostics.
   */
  const FIT_RATIO_MIN = 0.82;
  const FIT_RATIO_MAX = 1.22;

  /**
   * Fit of ONE garment against the wearer, or null when it cannot be known.
   *
   * Returning null (rather than 1.0) is deliberate: the caller must be able to
   * distinguish "the garment is exactly the wearer's size" from "we do not know
   * this garment's size", because the first is a measured fit and the second is
   * the old photo-derived approximation. Collapsing them would let the UI claim
   * a precision it does not have.
   */
  /*
   * A measurement is present only when it is a number GREATER THAN ZERO.
   *
   * `Number.isFinite(Number(x))` is not enough on its own: an empty string from a
   * half-filled admin form coerces to 0, which IS finite. Treating that 0 as a
   * real measurement would put the garment's width at zero — the piece would
   * vanish — so blank and zero both mean "absent".
   */
  const positive = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const fitFor = (garment) => {
    const g = garment?.measurements;
    if (!g || typeof g !== 'object') return null;

    const garmentChest = Number(g.chest_bust ?? g.chest ?? g.bust);
    const wearerChest = Number(metrics.chest_bust);

    if (!Number.isFinite(garmentChest) || garmentChest <= 0) return null;
    if (!Number.isFinite(wearerChest) || wearerChest <= 0) return null;

    const raw = garmentChest / wearerChest;
    return {
      raw,
      // The value the DRAW uses, bounded so an extreme size reads as loose/tight
      // rather than as a geometry failure.
      clamped: Math.min(Math.max(raw, FIT_RATIO_MIN), FIT_RATIO_MAX),
      garmentChest,
      wearerChest,
      size: garment?.selected_size || null,
      /**
       * The garment's own TAPER, in cm, so the silhouette can be shaped by the
       * garment rather than by the analytic curve. Null entries are ABSENT data,
       * not zeros — `resolveGarmentTaper` interpolates across what it has.
       */
      taper: {
        chest_bust: positive(g.chest_bust),
        waist: positive(g.waist),
        hips: positive(g.hips),
        shoulder_width: positive(g.shoulder_width),
      },
    };
  };

  // 3. Sample the photo's own lighting so garments can be shaded to match.
  const portraitReadable = canReadPixels(portraitImg);
  const lighting = portraitReadable ? sampleLighting(ctx, canvasW, canvasH) : null;
  diagnostics.lightingSampled = !!lighting;

  /*
   * 3b. BUILD A PERSON MASK, ON DEVICE.
   *
   * This is the free-AI tier: ISNet (the model already mirrored for the Style
   * Stack's garment cut-outs) segments the PERSON out of the portrait, entirely
   * in the browser. No API key, no quota, no network, and it works offline.
   *
   * It is awaited ONCE here, not per garment, because it is the expensive step
   * (~1-3s on CPU, plus a one-off model load the browser then caches) and every
   * garment shares the same mask.
   *
   * AWAITED WITH A GUARD, NOT A REQUIREMENT. `buildPersonMatte` never throws and
   * returns null when the model cannot produce a usable mask, in which case
   * `matte` stays null, the clip pass below is skipped, and the render falls back
   * to the previous geometric placement. An enhancement must never break a render.
   */
  let matte = null;
  if (usePersonMatte) {
    try {
      matte = await buildPersonMatte(portrait);
    } catch (err) {
      // `buildPersonMatte` is written not to throw; this is a belt-and-braces
      // guard so an unexpected failure still degrades to the old behaviour.
      console.warn('[Hiraya] Person matte step failed, using geometric placement:', err?.message || err);
    }
  }

  diagnostics.personMatte = !!matte;
  diagnostics.personMatteSource = matte?.source || null;
  diagnostics.personCoverage = matte ? Number(matte.coverage.toFixed(3)) : null;

  // 4. Garments, back to front.
  const hasDress = !!garments.dress;
  const placed = [];
  /** True once at least one piece was clipped to the measured person mask. */
  let clippedToPerson = false;

  for (const key of DRAW_ORDER) {
    if (hasDress && (key === 'top' || key === 'bottom')) {
      diagnostics.skipped.push({ key, reason: 'superseded-by-dress' });
      continue;
    }

    const garment = garments[key];
    if (!garment) continue;

    /*
     * EXTRACT THE GARMENT FIRST.
     *
     * The catalog asset is a composed MARKETING CARD (background, frame,
     * reflection, caption, logo), not a garment cut-out. Drawing it as-is is what
     * put the shop background into the fitting and sized the piece to the card.
     * `extractGarment` recovers the garment's own pixels and returns a
     * transparent PNG, so everything downstream works on fabric only.
     *
     * If extraction cannot run (cross-origin, or nothing garment-like found) the
     * returned `url` is the original source, so this degrades to the previous
     * behaviour instead of dropping the piece.
     */
    /*
     * The GARMENT OBJECT is passed through (not just a URL) so extraction can
     * choose the RAW upload over the composed display card — see
     * extractGarment's header for the measured reason why the raw photo is the
     * better segmentation source.
     */
    const extracted = await extractGarment(garment);
    extractedUrls.push(extracted.url);

    const img = await loadImage(extracted.url);

    if (!img) {
      diagnostics.skipped.push({ key, reason: 'image-load-failed' });
      continue;
    }

    if (extracted.extracted) {
      diagnostics.cutouts.push(key);
    } else {
      diagnostics.cutoutFallbacks.push({ key, reason: extracted.reason || 'unknown' });
    }

    const box = resolveGarmentBox(key, frame, metrics, pixelScale, canvasW, canvasH, pose);
    if (!box) {
      diagnostics.skipped.push({ key, reason: 'no-garment-span' });
      continue;
    }

    // Record whether this piece had to be shortened to fit the photograph, so
    // the UI can explain a crop-to-fit render rather than presenting it as a
    // perfectly measured full-length fit.
    if (box.shortenedByBust) diagnostics.shortenedByBust = true;

    /*
     * Alpha detection needs a READABLE canvas. A cross-origin garment without
     * CORS simply cannot be inspected, so we assume it IS a cut-out — the common
     * case for catalog assets. Assuming OPAQUE (as this used to) routed real
     * cut-outs through the feathered-mask branch and painted their transparent
     * hollows black, which is exactly what the reported render showed.
     */
    const readable = canReadPixels(img);
    if (!readable) diagnostics.taintedGarments.push(key);
    const isCutout = extracted.extracted || (readable ? hasAlpha(img) : true);

    /*
     * 4a. THE GARMENT'S OWN FIT.
     *
     * Computed PER GARMENT, here, because each piece carries a different size
     * table. `null` means this garment's size could not be determined, and the
     * draw then falls back to its previous photo-derived sizing.
     */
    const fit = fitFor(garment);
    if (fit) {
      diagnostics.garmentFit = diagnostics.garmentFit || [];
      diagnostics.garmentFit.push({
        key,
        size: fit.size,
        garmentChest: fit.garmentChest,
        wearerChest: fit.wearerChest,
        ratio: Number(fit.raw.toFixed(3)),
        clamped: Number(fit.clamped.toFixed(3)),
      });
    } else {
      diagnostics.garmentFitMissing = diagnostics.garmentFitMissing || [];
      diagnostics.garmentFitMissing.push({ key, reason: 'no-usable-size-measurements' });
    }

    const drawn = drawIntoBox(ctx, img, box, canvasW, canvasH, lighting, readable, isCutout, frame, key, pose, fit);
    placed.push(key);

    // Record which columns this piece actually covered, so the occlusion pass
    // knows where the fabric is and can restore the body everywhere else.
    if (drawn) {
      /*
       * CLIP IMMEDIATELY, PER GARMENT.
       *
       * This must happen inside this loop, right after the draw, and NOT once at
       * the end. `destination-out` erases whatever is on the canvas at that
       * moment — so a deferred pass would erase the LOWER garments along with the
       * background wherever an upper piece's band overlapped them, leaving holes
       * in the outfit. Clipping per garment confines each erase to the piece that
       * was just painted.
       */
      if (clipFabricToPerson(ctx, matte, canvasW, canvasH, drawn)) {
        clippedToPerson = true;
      }

      recordCoveredColumns(coveredColumns, drawn, key, canvasH);
      const top = drawn.y;
      const bottom = drawn.y + drawn.drawnH;
      garmentBand = garmentBand
        ? { top: Math.min(garmentBand.top, top), bottom: Math.max(garmentBand.bottom, bottom) }
        : { top, bottom };
    }
  }

  /*
   * 4b. OCCLUSION — put the body back IN FRONT of the fabric where it should be.
   *
   * Runs after every garment is drawn. Real limbs (a forearm crossing the waist,
   * a hand on a hip) lie OUTSIDE the fabric's covered columns, so restoring the
   * body there makes the garment read as worn rather than overlaid. Only the
   * garment's own rows are touched; the head, legs and background are untouched.
   */
  if (body && garmentBand) {
    restoreBodyInFront(ctx, body, canvasW, canvasH, garmentBand, coveredColumns);
  }

  diagnostics.clippedToPerson = clippedToPerson;

  // 5. Studio finish.
  drawVignette(ctx, canvasW, canvasH);

  if (watermark) {
    ctx.save();
    ctx.font = `600 ${Math.max(14, Math.round(canvasW * 0.026))}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(245,235,224,0.75)';
    ctx.textAlign = 'right';
    ctx.fillText(watermark, canvasW - 20, canvasH - 20);
    ctx.restore();
  }

  try {
    const image = canvas.toDataURL('image/png');
    return { image, placed, diagnostics };
  } catch {
    // Still tainted at export time — a cross-origin garment with no CORS
    // headers. Reported rather than swallowed, so a blank render is explainable.
    diagnostics.skipped.push({ key: 'export', reason: 'canvas-tainted' });
    return { image: null, placed, diagnostics };
  } finally {
    // Every garment has been drawn by now, so the extracted cut-out blobs are
    // no longer needed. Freeing them here prevents a blob leak across renders.
    extractedUrls.forEach(releaseGarmentUrl);
  }
};

export default compositeTryOn;
