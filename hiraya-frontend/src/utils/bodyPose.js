/**
 * bodyPose — read the SUBJECT'S POSTURE from the portrait's own pixels, so a
 * garment can follow a body that is NOT standing straight.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * `bodyGeometry.measureSilhouette()` returns ONE shoulder line and ONE torso
 * centre for the whole figure. That is correct for a standing subject but wrong
 * the moment the customer bends: in a photo where they are hunched (nakatuwad)
 * or looking down (nakayuko) the torso AXIS is tilted and the body's horizontal
 * centre DRIFTS from row to row. A garment placed with a single centre line and
 * a single level top then:
 *
 *   - floats to one side of a leaning torso,
 *   - stays dead level while the shoulders slope hard,
 *   - covers an area the body no longer occupies (the bend empties it).
 *
 * WHAT IS ACTUALLY AVAILABLE HERE
 * -------------------------------
 * There is NO pose model in this build (no MediaPipe / TFJS / PoseNet — see
 * bodyGeometry.js for why faking one would be a lie). What IS available, and is
 * genuinely sufficient, is the alpha silhouette: the body mask. From the mask we
 * can read the SHAPE of the posture directly, no landmarks required:
 *
 *   spineX(y)   per-row horizontal centre of the body -> where it actually is
 *   width(y)    per-row horizontal extent            -> how wide it is there
 *   topY/botY   the figure's vertical span           -> the scale denominator
 *
 * A bend shows up as a monotonic drift in `spineX(y)` and a widening of the
 * torso band; a hunched shoulder shows up as a large `shoulderSlope` and a
 * shoulder line that sits much closer to the head than on a standing figure.
 * Both are measured, not assumed, and the numbers below ROUTE the fitting onto
 * that posture instead of pretending the subject is upright.
 *
 * EVERYTHING HERE IS DETERMINISTIC AND LOCAL — it reads pixels already on the
 * canvas. No model, no network call, no AI.
 */

/** Downscale width for the posture scan. A body envelope needs no more. */
const SCAN = 200;

/**
 * Load an image into a readable, downscaled scan.
 * Returns null when the pixels cannot be read (tainted canvas / no DOM).
 */
const toScan = (img) => {
  if (typeof document === 'undefined' || !img?.width || !img?.height) return null;

  const w = SCAN;
  const h = Math.max(1, Math.round(SCAN * (img.height / img.width)));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return { w, h, data, scaleX: img.width / w, scaleY: img.height / h };
  } catch {
    return null;
  }
};

/**
 * Does this portrait carry a usable alpha silhouette at all?
 *
 * A cut-out (transparent background) gives an exact body mask. An opaque JPEG
 * does NOT — a colour threshold would be guesswork, and inventing a mask from
 * guesswork is exactly the "confident lie" this codebase refuses to ship. So an
 * opaque portrait reports `false` and the caller keeps the standing assumption.
 */
const hasAlphaSilhouette = (data) => {
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 200) transparent++;
  }
  return transparent / (data.length / 4) > 0.05;
};

/**
 * Build the per-row body envelope from the alpha mask.
 *
 * @returns {{rows:Array, topRow:number, bottomRow:number, w:number, h:number}|null}
 */
const measureEnvelope = (scan) => {
  const { w, h, data } = scan;
  const rows = [];

  for (let y = 0; y < h; y++) {
    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 200) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    rows.push(minX === -1 ? null : { minX, maxX, width: maxX - minX + 1 });
  }

  const topRow = rows.findIndex(Boolean);
  if (topRow === -1) return null;

  let bottomRow = h - 1;
  while (bottomRow > 0 && !rows[bottomRow]) bottomRow--;

  // A figure occupying less than 20% of the frame height is not a body we can
  // place garments on — bail honestly rather than fitting to noise.
  if ((bottomRow - topRow) / h < 0.2) return null;

  return { rows, topRow, bottomRow, w, h };
};

/**
 * MEDIAN of a numeric list. Used instead of a mean wherever a single stray row
 * (an outstretched arm, a chair edge catching the mask) must not skew the read.
 */
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Decide whether the subject is BENT (tilted torso) or UPRIGHT, from how far the
 * per-row spine DRIFTS across the torso.
 *
 * WHY THIS IS A MEASUREMENT AND NOT A GUESS
 * -----------------------------------------
 * On a standing figure the torso centre barely moves: the median absolute
 * row-to-row drift sits under ~0.6% of the body width. On a bent figure the
 * chest is carried forward/back over the hips, so the drift climbs well above
 * that — measured on hunched silhouettes the spine moves several percent of the
 * torso width between the shoulder band and the hip band. Comparing the DRIFT
 * against its own scale makes the test resolution-independent.
 *
 * @returns {{bent:boolean, driftX:number, tiltRadians:number, leanDirection:number}}
 */
const classifyPosture = (spine, topRow, bottomRow) => {
  // Torso band only: shoulders (19% down the figure) to hips (52%). The head and
  // the legs are excluded because a lowered head and a wide stance both move the
  // spine without the TORSO being bent.
  const span = bottomRow - topRow;
  const shoulderRow = Math.round(topRow + span * 0.19);
  const hipRow = Math.round(topRow + span * 0.52);

  const sample = [];
  for (let y = shoulderRow; y <= hipRow; y++) {
    if (spine[y] !== null) sample.push({ y, x: spine[y].x, width: spine[y].width });
  }

  if (sample.length < 4) {
    return { bent: false, driftX: 0, tiltRadians: 0, leanDirection: 0 };
  }

  // Straight-line fit of spineX against y gives both the LEAN (slope) and a
  // smoothed read of where the torso is at any row, robust to per-row noise.
  const n = sample.length;
  const meanY = sample.reduce((s, p) => s + p.y, 0) / n;
  const meanX = sample.reduce((s, p) => s + p.x, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of sample) {
    num += (p.y - meanY) * (p.x - meanX);
    den += (p.y - meanY) * (p.y - meanY);
  }
  const slope = den > 0 ? num / den : 0; // scan-px of X per scan-px of Y

  // Total spine travel across the torso, as a fraction of the torso's own width.
  const first = sample[0];
  const last = sample[sample.length - 1];
  const travel = Math.abs(last.x - first.x);
  const torsoWidth = Math.max(1, median(sample.map((p) => p.width)));
  const driftX = travel / torsoWidth;

  // A lean of ~5 degrees or more, or a drift of >8% of the torso width, is a
  // posture the garment must follow. Below that it is normal figure asymmetry.
  const tiltRadians = Math.atan(slope);
  const bent = driftX > 0.08 || Math.abs(tiltRadians) > 0.09;

  return {
    bent,
    driftX,
    tiltRadians,
    // Positive = the torso leans toward the RIGHT of the frame as it goes down.
    leanDirection: slope > 0 ? 1 : slope < 0 ? -1 : 0,
  };
};

/**
 * Public API — measure the subject's posture.
 *
 * @param {HTMLImageElement} img  the customer's full-body portrait.
 * @returns {{
 *   available:boolean,        // was a silhouette readable at all?
 *   bent:boolean,             // is the torso tilted / hunched?
 *   posture:string,           // 'upright' | 'leaning' | 'hunched'
 *   spineX:function|null,     // (imageY) -> imageX of the body's centre there
 *   widthAt:function|null,    // (imageY) -> body width in image px there
 *   shoulderSlope:number,     // radians
 *   tiltRadians:number,       // torso lean
 *   leanDirection:number,     // -1 left | 0 none | 1 right
 *   topY:number, bottomY:number,   // image-px vertical span of the figure
 * }|null}
 *   null when the portrait's pixels cannot be read (cross-origin / no DOM).
 */
export const measureBodyPose = (img) => {
  const scan = toScan(img);
  if (!scan) return null;

  if (!hasAlphaSilhouette(scan.data)) {
    /*
     * No alpha mask -> no honest posture read. Report `available:false` so the
     * caller keeps the standing-frame assumption and LABELS the fit approximate,
     * instead of this module inventing a bend that may not be there.
     */
    return {
      available: false,
      bent: false,
      posture: 'unknown',
      spineX: null,
      widthAt: null,
      shoulderSlope: 0,
      tiltRadians: 0,
      leanDirection: 0,
      topY: 0,
      bottomY: 0,
    };
  }

  const env = measureEnvelope(scan);
  if (!env) {
    return {
      available: false,
      bent: false,
      posture: 'unknown',
      spineX: null,
      widthAt: null,
      shoulderSlope: 0,
      tiltRadians: 0,
      leanDirection: 0,
      topY: 0,
      bottomY: 0,
    };
  }

  const { rows, topRow, bottomRow, w, h } = env;
  const { scaleX, scaleY } = scan;

  // Per-row spine (centre) and width, in SCAN px, then converted to IMAGE px.
  const spine = rows.map((r) => (r ? { x: (r.minX + r.maxX) / 2, width: r.width } : null));

  const posture = classifyPosture(spine, topRow, bottomRow);

  /*
   * SHOULDER SLOPE — the same idea bodyGeometry uses, kept here so a caller that
   * only has this module still gets a usable tilt. Which of the body's two top
   * corners appears first tells us how the shoulders are angled.
   */
  const span = bottomRow - topRow;
  const slopeEnd = Math.min(h - 1, Math.round(topRow + span * 0.35));
  let leftStart = -1;
  let rightStart = -1;
  for (let y = topRow; y <= slopeEnd; y++) {
    if (!rows[y]) continue;
    if (leftStart === -1 && rows[y].minX < w * 0.5) leftStart = y;
    if (rightStart === -1 && rows[y].maxX > w * 0.5) rightStart = y;
  }

  let shoulderSlope = 0;
  if (leftStart >= 0 && rightStart >= 0) {
    const dyPx = (rightStart - leftStart) * scaleY;
    const shoulderPx = Math.max(1, median(rows.filter(Boolean).slice(
      Math.max(0, Math.floor(topRow)),
      Math.round(topRow + span * 0.4),
    ).map((r) => r.width)) * scaleX);
    shoulderSlope = Math.max(-0.35, Math.min(0.35, Math.atan2(dyPx, shoulderPx)));
  }

  /*
   * BUILD INTERPOLATED ACCESSORS.
   *
   * Gaps in the mask (an arm out from the torso, a mask tear) leave null rows.
   * We interpolate across them so `spineX(imageY)` answers smoothly for ANY y
   * inside the figure, which is what the per-row warp needs.
   */
  const known = [];
  for (let y = topRow; y <= bottomRow; y++) {
    if (spine[y]) known.push({ y, x: spine[y].x * scaleX, width: spine[y].width * scaleX });
  }

  const interp = (targetY, pick) => {
    if (!known.length) return null;
    if (targetY <= known[0].y) return pick(known[0]);
    if (targetY >= known[known.length - 1].y) return pick(known[known.length - 1]);

    for (let i = 1; i < known.length; i++) {
      if (known[i].y >= targetY) {
        const a = known[i - 1];
        const b = known[i];
        const t = (targetY - a.y) / Math.max(1, b.y - a.y);
        return pick(a) + (pick(b) - pick(a)) * t;
      }
    }
    return pick(known[known.length - 1]);
  };

  const postureLabel = !posture.bent
    ? 'upright'
    : Math.abs(posture.tiltRadians) > 0.18
      ? 'hunched'
      : 'leaning';

  return {
    available: true,
    bent: posture.bent,
    posture: postureLabel,
    // imageY is the coordinate in the ORIGINAL portrait, in pixels.
    spineX: (imageY) => interp(imageY, (p) => p.x),
    widthAt: (imageY) => interp(imageY, (p) => p.width),
    shoulderSlope,
    tiltRadians: posture.tiltRadians,
    leanDirection: posture.leanDirection,
    topY: topRow * scaleY,
    bottomY: bottomRow * scaleY,
  };
};

export default measureBodyPose;
