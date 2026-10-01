/**
 * bodyGeometry — derive the SUBJECT'S placement and real-world scale from the
 * portrait pixels plus the customer's measurements.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The previous compositor positioned every garment with:
 *
 *     const regionX = (canvasW - regionW) / 2;    // centre of the CANVAS
 *     const scale   = Math.min(regionW / sw, regionH / sh);
 *
 * Two independent failures came out of those two lines, and they are exactly
 * what the reported render showed:
 *
 *   1. `regionX` centres the garment on the CANVAS MIDLINE. The compositor had
 *      no idea where the person actually stood, so a subject framed off-centre
 *      got a garment pinned to the middle of the picture — the garment floats
 *      beside the torso instead of over it.
 *
 *   2. `Math.min(...)` is a CONTAIN fit: it takes the smaller of the width and
 *      height ratios, so the garment can never fill its region and always lands
 *      smaller than the body it is meant to cover. That is the "undersized"
 *      complaint, and it is structural, not a tuning issue.
 *
 * Both are fixed by measuring the SUBJECT first (silhouette scan) and scaling
 * from the customer's OWN measurements second (pixel-per-cm), instead of
 * trusting hard-coded fractions of the frame.
 *
 * EVERYTHING HERE IS DETERMINISTIC AND LOCAL — no model, no network, no AI
 * call. It reads pixels that already exist on the canvas.
 */

/* ------------------------------------------------------------------ *
 * Metric anchors
 *
 * Both sides are in CENTIMETRES so the ratio is dimensionless.
 *
 * The LEFT value is a body dimension the customer supplies (5-core schema).
 * The RIGHT value is the fraction of BODY HEIGHT that dimension represents on
 * a typical adult standing figure — the classic fashion-illustration canon
 * (7.5 heads tall).
 *
 * WHY THESE RATIOS, AND WHY THEY ARE HONEST: the sizing profile has
 * NO height field (see AccountSettings.jsx — only an upper and a lower SIZE
 * are collected, and the centimetres are derived from the size chart). So an
 * absolute height must be estimated rather than read, so an absolute
 * pixel-per-cm factor cannot be computed from the sizing profile alone. What CAN
 * be derived reliably is the RATIO between two body dimensions, because that
 * ratio is independent of how tall the person is. We therefore scale garments
 * to the subject by matching MEASURED PROPORTIONS, not absolute metres, and we
 * say so rather than pretending to a precision the data cannot support.
 * ------------------------------------------------------------------ */
export const BODY_HEIGHT_RATIOS = {
  /** Shoulder seam to shoulder seam, as a fraction of total body height. */
  shoulder_width: 0.255,
  /** Chest circumference governs the horizontal extent of a top. */
  chest_bust: 0.19,
  /** Hip circumference governs the horizontal extent of a bottom/dress. */
  hips: 0.20,
  /** Shoulder to wrist — the longest vertical arm span (sleeve axis). */
  sleeve_length: 0.44,
};

/**
 * Per-category garment geometry, expressed as fractions of BODY HEIGHT.
 *
 * These are MEASUREMENTS OF A GARMENT, not of the frame — which is the key
 * difference from the old BODY_REGIONS table. A top occupies roughly from the
 * shoulder line to just below the waist; that is a property of the garment and
 * a person, and it stays true regardless of how the photo was cropped.
 */
export const GARMENT_SPANS = {
  /*
   * WHY THESE END VALUES, AND WHY THEY DIFFER BY CATEGORY
   * ----------------------------------------------------
   * Each entry says where the piece sits on the figure, as a fraction of BODY
   * HEIGHT, measured FROM THE SHOULDER LINE:
   *
   *   `fromShoulder`      how far ABOVE the shoulder the piece begins (negative),
   *   `toBelowShoulder`   how far BELOW it the piece ends.
   *
   * The previous values made a JACKET (outerwear, 0.32) barely longer than a
   * SHIRT (top, 0.28), which is wrong: a coat hangs well past a top. And a DRESS
   * at 0.72 stopped at mid-thigh rather than at the hem. These spans are the
   * corrected, category-accurate lengths so each piece covers the region it is
   * actually worn over — the "flexible / correctly aligned per body part"
   * requirement.
   */
  top: { fromShoulder: -0.02, toBelowShoulder: 0.30, widthOf: 'shoulder_width', widthFactor: 1.14 },
  dress: { fromShoulder: 0.00, toBelowShoulder: 0.86, widthOf: 'shoulder_width', widthFactor: 1.18 },
  outerwear: { fromShoulder: -0.05, toBelowShoulder: 0.42, widthOf: 'shoulder_width', widthFactor: 1.30 },
  bottom: { fromShoulder: 0.24, toBelowShoulder: 0.86, widthOf: 'hips', widthFactor: 1.10 },
  footwear: { fromShoulder: 0.94, toBelowShoulder: 1.02, widthOf: 'shoulder_width', widthFactor: 0.42 },
};

/**
 * Canonical measurement shape. Accepts the Studio's 5-core CM schema and
 * tolerates the legacy inch values that older sessions stored.
 *
 * @param {Object} raw  measurements_json as stored on the session / form.
 * @returns {{chest_bust:number, waist:number, hips:number, shoulder_width:number, sleeve_length:number}}
 */
export const resolveMeasurements = (raw = {}) => {
  /**
   * A body measurement is in INCHES only when it is plausible for a shoulder
   * width: an adult shoulder seam is 35-50 cm, i.e. 14-20 in. The old test was
   * "<= 60 means inches" applied to EVERY field, which is structurally wrong for
   * the small ones:
   *
   *   shoulder_width 38 cm -> 38 <= 60 -> treated as inches -> 96.5 cm  (2.5x too wide)
   *   sleeve_length  58 cm -> 58 <= 60 -> treated as inches -> 147.3 cm (absurd)
   *
   * So every shoulder/sleeve value was silently inflated by 2.54, which poisoned
   * the pixel-per-cm factor and every garment box derived from it. Only the
   * circumference fields (chest/waist/hips, normally 70-110 cm) ever reached a
   * sane branch, which is why a top could look almost right while its shoulders
   * were metres off.
   *
   * The honest rule: a value is imperial only when converting it lands in the
   * anatomically plausible metric range for THAT dimension. Anything already in
   * the plausible metric range is taken at face value.
   *
   * @param {string[]} keys   aliases to try, in order
   * @param {[number,number]} cmRange  plausible centimetre range for this field
   */
  const pick = (keys, cmRange) => {
    for (const key of keys) {
      const value = Number(raw?.[key]);
      if (!Number.isFinite(value) || value <= 0) continue;

      const [lo, hi] = cmRange;
      // Already a believable metric value -> trust it.
      if (value >= lo && value <= hi) return value;

      // Otherwise, if inches would be believable, this is an imperial entry.
      const asCm = value * 2.54;
      if (asCm >= lo && asCm <= hi) return asCm;

      // Neither reading is plausible (out of range either way). Return it as a
      // centimetre value rather than silently inflating it by 2.54 — a value
      // outside the range is far more likely a typo than an imperial entry.
      return value;
    }
    return null;
  };

  return {
    // Circumferences: an adult is ~60-160 cm / ~24-63 in.
    chest_bust: pick(['chest_bust', 'chest'], [60, 160]) ?? 94,
    waist: pick(['waist'], [50, 150]) ?? 76,
    hips: pick(['hips'], [60, 170]) ?? 100,
    // Linear spans are much smaller and must NOT share the circumference rule.
    shoulder_width: pick(['shoulder_width'], [30, 60]) ?? 41,
    sleeve_length: pick(['sleeve_length'], [45, 90]) ?? 61,
  };
};

/**
 * Scan the portrait for the subject's silhouette.
 *
 * WHY A SILHOUETTE SCAN AND NOT A POSE MODEL
 * ------------------------------------------
 * This build ships no pose estimator (no MediaPipe / TFJS / PoseNet), and the
 * one CV model that IS present — `@imgly/background-removal` — is behind a kill
 * switch (`CLIENT_CUTOUT_ENABLED = false`) because it throws an uncaught
 * `startTime` TypeError out of its own rAF callback and takes the React tree
 * down. So landmark-based limb tracking is NOT available here, and faking it
 * would be a lie embedded in the product.
 *
 * What IS available, and is genuinely useful, is the SUBJECT'S SILHOUETTE: the
 * alpha channel of the uploaded portrait. When the customer uploads a cut-out
 * (which the reported render clearly is — a mannequin floating on a transparent
 * background) we get an exact body mask for free. From that mask we can find:
 *
 *   - the horizontal CENTRE of mass of the body  -> where to hang garments
 *   - the TOP of the head                        -> the body-height origin
 *   - the shoulder line                          -> where a top starts
 *   - the TOTAL body height in pixels            -> the scale denominator
 *
 * so garments are anchored to the PERSON rather than to the picture.
 *
 * @param {HTMLImageElement} img  the portrait
 * @returns {Object|null} geometry, or null when no usable silhouette exists.
 */
export const measureSilhouette = (img) => {
  if (!img?.width || !img?.height) return null;

  /*
   * Work on a downscale. A 4000px portrait scanned pixel-by-pixel would block
   * the main thread for seconds; 220px is ample to locate a body envelope and
   * is ~300x less work.
   */
  const SCAN = 220;
  const scanW = SCAN;
  const scanH = Math.max(1, Math.round(SCAN * (img.height / img.width)));

  let ctx;
  try {
    const probe = document.createElement('canvas');
    probe.width = scanW;
    probe.height = scanH;
    ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, scanW, scanH);
  } catch {
    return null;
  }

  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, scanW, scanH));
  } catch {
    // Tainted canvas: the portrait is cross-origin without CORS. We cannot read
    // its pixels, so we return null and the caller falls back to a centred
    // layout — degraded, but never broken.
    return null;
  }

  /*
   * Determine whether this portrait actually carries an alpha silhouette.
   * A JPEG portrait is fully opaque, in which case there is no mask to scan and
   * a background subtraction would be guesswork. Detect and bail honestly.
   */
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 200) transparent++;
  }
  const hasSilhouette = transparent / (data.length / 4) > 0.05;

  if (!hasSilhouette) {
    return null;
  }

  // Per-row envelope: leftmost and rightmost opaque pixel, plus the row width.
  const rows = [];
  for (let y = 0; y < scanH; y++) {
    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < scanW; x++) {
      if (data[(y * scanW + x) * 4 + 3] > 200) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    rows.push(minX === -1 ? null : { minX, maxX, width: maxX - minX + 1 });
  }

  const occupied = rows.filter(Boolean);
  if (occupied.length < scanH * 0.1) return null; // Not a body-shaped mask.

  const topRow = rows.findIndex(Boolean);
  let bottomRow = scanH - 1;
  while (bottomRow > 0 && !rows[bottomRow]) bottomRow--;

  const bodyTop = topRow / scanH;
  const bodyBottom = bottomRow / scanH;
  const bodyHeightFraction = bodyBottom - bodyTop;

  if (bodyHeightFraction < 0.2) return null; // Too small to be a full figure.

  /*
   * SHOULDER LINE.
   *
   * THE OLD RULE WAS "the widest row in the upper 40% of the figure", and it is
   * WRONG on a real body more often than it is right.
   *
   * MEASURED FAILURE (the mannequin portrait): the figure spans rows 11..211, so
   * the search window was rows 11..91 — and on a torso whose HIPS are wider than
   * its SHOULDERS (which is most figures, and emphatically this mannequin) the
   * widest row in that window is a HIP row. The scanner picked row 85, which sits
   * 37% down the body, and anchored every garment there. A dress is then hung
   * from the hips: it starts too low, and reads as a strip down the legs rather
   * than a garment on the torso. The window was meant to EXCLUDE a flared skirt,
   * but 40% of the body is already past the waist — it excludes too little.
   *
   * THE RIGHT ANCHOR IS THE TOP OF THE SHOULDER PLATEAU, NOT ITS WIDEST ROW.
   *
   * Anatomically the shoulder line is where the body FIRST reaches full width
   * below the neck: the deltoids flare out, the envelope jumps from the neck's
   * few pixels to the full shoulder span, and then it stays roughly that wide
   * through the upper torso. So we look for the FIRST ROW that reaches a high
   * fraction of the figure's upper-torso width, rather than the single widest
   * row. That is stable regardless of whether the hips ultimately turn out wider.
   *
   * Concretely: find the widest row in the window (as before, for the SCALE), but
   * then walk BACK UP to the first row that reaches 80% of that width. That row is
   * the top of the shoulder plateau — the shoulder line.
   */
  const upperLimit = Math.round(topRow + bodyHeightFraction * scanH * 0.4);
  let widestUpperRow = topRow;
  let upperWidth = 0;
  for (let y = topRow; y <= upperLimit && y < scanH; y++) {
    if (rows[y] && rows[y].width > upperWidth) {
      upperWidth = rows[y].width;
      widestUpperRow = y;
    }
  }

  /*
   * Walk back up from the widest upper row to the first row within 80% of it.
   * 0.8 is chosen so a genuine shoulder plateau qualifies across its whole span
   * while the neck (a few pixels against a ~50px shoulder) does not.
   */
  const plateauFloor = upperWidth * 0.8;
  let shoulderRow = widestUpperRow;
  for (let y = topRow; y <= widestUpperRow; y++) {
    if (rows[y] && rows[y].width >= plateauFloor) {
      shoulderRow = y;
      break;
    }
  }
  let shoulderWidth = rows[shoulderRow] ? rows[shoulderRow].width : upperWidth;

  /*
   * FIGURE SHAPE — IS THIS A FULL FIGURE?
   * ======================================
   *
   * THE DEFECT THIS FIXES.
   *
   * Every span in GARMENT_SPANS is expressed as a fraction of BODY HEIGHT and
   * assumes the subject is a STANDING FULL FIGURE: a dress, for example, runs
   * `toBelowShoulder: 0.86`, i.e. from the shoulder line down 86% of a body.
   *
   * That assumption is fine while the silhouette really is a full figure. But a
   * head-and-shoulders BUST CROP produces a mask whose visible extent is the
   * bust itself — its "body height" is the bust's height, not a person's. Fed
   * into the standing-figure spans, a dress on a bust is placed to run from the
   * shoulder down 86% of the BUST, and since a bust occupies nearly the whole
   * frame it lands well PAST the bottom edge and is cropped (measured: a dress on
   * a 350x350 bust spanned 38.6% -> 116.8% of the frame). Nothing anywhere in the
   * engine noticed there are no legs to wear a dress.
   *
   * SO WE MEASURE IT — and the test has to be specific, because "is there stuff
   * below the hip line?" is NOT the same question as "are there legs?". The
   * first version of this check asked only the first question and reported
   * `hasLegs: true` for a MANNEQUIN STAND: the stand's pole is a narrow column
   * that runs a long way down, which satisfied "a lower envelope exists and
   * extends far", while being nothing a garment can be worn on.
   *
   * WHAT ACTUALLY DISTINGUISHES LEGS (measured from the mask, see qa_mask_art):
   *
   *   1. TWO COLUMNS. Legs are a PAIR — two separate occupied runs separated by
   *      background (the gap between them, or the gap visible below a skirt). A
   *      stand/a pedestal/a single pole is ONE run. Counting interior background
   *      runs in the row is the direct, unambiguous test.
   *
   *   2. REAL WIDTH PER COLUMN. Each leg occupies a substantial fraction of the
   *      body's width. A pole is a few pixels against a 50px torso — measured at
   *      ~12px envelope with NO gap, vs legs which are wider AND split.
   *
   *   3. DEPTH. The legs must extend well below the hip line to be the bottom of
   *      a standing figure.
   *
   * A bust fails (1) immediately — below the chest it tapers to a point and
   * stops. A mannequin stand fails (1) too, which is the case that fooled the
   * previous version. A standing person passes all three.
   *
   * Because the answer drives a RENDER CHANGE (clamping garment hems), the
   * verdict is deliberately CONSERVATIVE: we only claim legs on positive
   * evidence, and anything we cannot confirm is reported as "not a full figure",
   * which clamps the hem to the subject rather than drawing into empty space.
   */
  const figureHeightPx = (bottomRow - topRow) * scanH;

  // Widest row anywhere in the figure — the scale a leg envelope is judged against.
  let widestBodyWidth = 0;
  for (let y = topRow; y <= bottomRow; y++) {
    if (rows[y] && rows[y].width > widestBodyWidth) widestBodyWidth = rows[y].width;
  }

  /*
   * Per-row indicator: does this row contain an INTERIOR gap — i.e. two or more
   * separate occupied runs, meaning a left and a right leg?
   *
   * Scans the row's pixels left to right and counts transitions from empty to
   * filled after the first filled run has begun. One transition = one object.
   * Two or more = a split, which on a lower-body row is the inter-leg gap.
   * A minimum run/gap length filters anti-aliasing speckle so a ragged edge
   * cannot be mistaken for a real gap. Working in SCAN pixels, a gap must be at
   * least ~2px — at 220px wide that is visually significant, and a 1px tear is
   * not.
   */
  const MIN_RUN = 2;
  const rowRuns = (y) => {
    const r = rows[y];
    if (!r) return { count: 0, runs: [] };
    const runs = [];
    let runStart = -1;
    for (let x = r.minX; x <= r.maxX; x++) {
      const filled = data[(y * scanW + x) * 4 + 3] > 200;
      if (filled && runStart === -1) runStart = x;
      if (!filled && runStart !== -1) {
        runs.push({ start: runStart, end: x - 1 });
        runStart = -1;
      }
    }
    if (runStart !== -1) runs.push({ start: runStart, end: r.maxX });
    return { count: runs.length, runs: runs.filter((q) => q.end - q.start + 1 >= MIN_RUN) };
  };

  /*
   * Sample the DEEP LOWER BAND — below 65% of the figure, which is past the
   * hands even on a figure with its arms at its sides. This matters: the first
   * version started at 52% and counted the gap between an ARM and the TORSO as
   * the inter-leg gap, so an ordinary standing figure scored a bogus "legs"
   * split from its own arms (and so did the mannequin, whose arms separate from
   * its body over the same rows).
   *
   * Below 65% there are no arms, so a row that splits into two columns is
   * splitting into legs or into nothing.
   */
  const hipRowEstimate = Math.round(topRow + (bottomRow - topRow) * 0.52);
  const lowerStart = topRow + Math.round((bottomRow - topRow) * 0.65);

  let splitRows = 0;
  let sampledRows = 0;
  let bestSplitWidth = 0;
  let widestOfTwo = 0;
  for (let y = lowerStart; y <= bottomRow; y++) {
    if (!rows[y]) continue;
    sampledRows++;
    const { runs } = rowRuns(y);

    // Both runs substantial (>= 12% of the widest body row each) = two limbs,
    // not a stray speck beside one column.
    const substantial = runs.filter((q) => q.end - q.start + 1 >= Math.max(2, widestBodyWidth * 0.12));
    if (substantial.length >= 2) {
      splitRows++;
      const span = substantial[substantial.length - 1].end - substantial[0].start + 1;
      if (span > bestSplitWidth) {
        bestSplitWidth = span;
        widestOfTwo = span;
      }
    }
  }

  const splitRatio = sampledRows ? splitRows / sampledRows : 0;
  const lowerWidths = [];
  for (let y = lowerStart; y <= bottomRow; y++) {
    if (rows[y]) lowerWidths.push(rows[y].width);
  }
  lowerWidths.sort((a, b) => a - b);
  const lowerEnvelope = lowerWidths.length ? lowerWidths[Math.floor(lowerWidths.length / 2)] : 0;

  const lowerExtent = bottomRow > hipRowEstimate ? (bottomRow - hipRowEstimate) / scanH : 0;

  /*
   * The verdict, and why each term is there.
   *
   * (1) SPLIT PRESENCE. Legs are a pair, so SOME of the deep-lower rows must show
   *     two substantial columns. This is the term that rejects a stand: a pole is
   *     ONE column on every row, so its splitRatio is exactly 0.
   *
   *     THE THRESHOLD IS 0.15, NOT 0.5, AND THAT NUMBER IS MEASURED.
   *
   *     A first version demanded the split hold on the MAJORITY of rows (0.5) as
   *     a noise guard. On the real portrait that rejected a genuine full figure:
   *     the mannequin's legs are close together, so the gap between them closes
   *     and reopens across rows and the split registered on only 34% of them —
   *     the classifier said "no legs", the hem was clamped, and a full-length
   *     dress was truncated at the hips. That is a worse failure than the one the
   *     term was protecting against, and it was visible in the render.
   *
   *     The fixture test (qa_figure_classifier.mjs) shows the two populations are
   *     nowhere near each other: a drawn standing figure scores 0.92, a drawn
   *     stand and a drawn bust both score 0.00. 0.15 sits in that gap with room
   *     on both sides — it tolerates an intermittently-closing leg gap while
   *     still rejecting a pole outright.
   *
   * (2) OVERALL WIDTH. The two columns together must span a real fraction of the
   *     body's widest row. A pole beside its own reflection spans almost nothing.
   *
   * (3) DEPTH. They must extend far enough below the hip line to be a lower body
   *     rather than a short pedestal.
   *
   * All three are RATIOS of the figure's own measurements, so the test is
   * resolution- and distance-independent.
   */
  const hasLegs =
    figureHeightPx > 0 &&
    widestBodyWidth > 0 &&
    splitRatio >= 0.15 &&
    bestSplitWidth >= widestBodyWidth * 0.4 &&
    lowerExtent >= 0.3;

  // Horizontal centre of the torso band (shoulder -> hip), NOT of the canvas.
  // This is the fix for the off-centre subject: the garment follows the body.
  const hipRow = Math.round(topRow + bodyHeightFraction * scanH * 0.55);
  let sumX = 0;
  let counted = 0;
  for (let y = shoulderRow; y <= hipRow && y < scanH; y++) {
    if (rows[y]) {
      sumX += (rows[y].minX + rows[y].maxX) / 2;
      counted++;
    }
  }
  const torsoCentreX = counted > 0 ? sumX / counted : scanW / 2;

  const pxPerScanX = img.width / scanW;

  /*
   * SHOULDER SLOPE (radians).
   *
   * A garment laid on a level horizontal always looks pasted on, because almost
   * nobody's shoulders are truly level. We compare the row at which the body's
   * LEFT edge and RIGHT edge first appear: if one side starts higher than the
   * other, the shoulders tilt that way.
   */
  let leftStart = -1;
  let rightStart = -1;
  const slopeSearchEnd = Math.min(scanH - 1, Math.round(topRow + bodyHeightFraction * scanH * 0.35));
  for (let y = topRow; y <= slopeSearchEnd; y++) {
    if (!rows[y]) continue;
    // "Left edge present" = the row's leftmost opaque pixel is near the envelope
    // it settles into, i.e. the shoulder has begun on that side.
    if (leftStart === -1 && rows[y].minX < scanW * 0.5) leftStart = y;
    if (rightStart === -1 && rows[y].maxX > scanW * 0.5) rightStart = y;
  }

  let shoulderSlope = 0;
  if (leftStart >= 0 && rightStart >= 0 && shoulderWidth > 0) {
    // Row difference -> vertical pixels -> radians via the measured span.
    const dyScan = rightStart - leftStart;
    const dyPx = dyScan * (img.height / scanH);
    const spanPx = shoulderWidth * pxPerScanX;
    // Clamp to ~11.5 degrees: real shoulders tilt a little, not a lot, and an
    // unbounded value would badly skew a garment on a noisy silhouette.
    shoulderSlope = Math.max(-0.2, Math.min(0.2, Math.atan2(dyPx, Math.max(1, spanPx))));
  }

  return {
    /** Top of the subject, as a fraction of image height. */
    bodyTop,
    /** Bottom of the subject, as a fraction of image height. */
    bodyBottom,
    /** Total subject height, as a fraction of image height (e.g. 0.78). */
    bodyHeightFraction,
    /** Shoulder line, as a fraction of image height. */
    shoulderFraction: shoulderRow / scanH,
    /** Horizontal centre of the torso, in IMAGE pixels. */
    torsoCentreX: torsoCentreX * pxPerScanX,
    /** Shoulder-to-shoulder envelope width, in IMAGE pixels. */
    shoulderPx: shoulderWidth * pxPerScanX,
    /**
     * Does this silhouette actually contain LEGS?
     *
     * `false` means the portrait is a bust / head-and-shoulders crop. The
     * standing-figure spans in GARMENT_SPANS cannot be trusted on it, and a
     * caller that would otherwise run a garment past the subject must clamp to
     * `subjectBottom` instead (see resolveGarmentBox).
     */
    hasLegs,
    /**
     * The bottom of what the SUBJECT actually occupies, as a fraction of image
     * height. Equal to `bodyBottom` — named separately because its purpose here
     * is the CLAMP BOUND: a garment must never be drawn past it.
     */
    subjectBottom: bodyBottom,
    /**
     * The measured figure-shape numbers the `hasLegs` verdict was read from, so
     * a caller (or a QA trace) can see the evidence rather than only the boolean.
     */
    figureShape: {
      hasLegs,
      widestBodyWidth,
      lowerEnvelope,
      /** Fraction of lower-band rows that split into two substantial columns. */
      splitRatio: +splitRatio.toFixed(3),
      /** Widest two-column span found in the lower band, in scan px. */
      bestSplitWidth,
      lowerExtent: +lowerExtent.toFixed(3),
      figureHeightPx: Math.round(figureHeightPx),
    },
    /** Shoulder tilt in radians (positive = the subject's right side sits lower). */
    shoulderSlope,
  };
};

/**
 * Convert the subject silhouette + measurements into the pixel geometry every
 * garment is placed against.
 *
 * The frame also carries a FIGURE-TYPE verdict (`hasLegs`), measured from the
 * silhouette: a full standing figure has a leg envelope below the hip line, a
 * bust crop does not. That is what lets the engine tell the two apart instead of
 * treating every portrait as if it were a full body.
 *
 * @param {Object} silhouette  from measureSilhouette()
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {Object} the layout frame garments scale and position against.
 */
export const buildBodyFrame = (silhouette, canvasW, canvasH) => {
  /*
   * When no silhouette is available (opaque JPEG portrait, or a cross-origin
   * image we cannot read), fall back to the classic full-length portrait
   * assumption the old code hard-coded — but now it is a documented FALLBACK
   * rather than the only behaviour, and `isEstimated` lets the UI say so.
   */
  if (!silhouette) {
    const bodyTop = 0.06;
    const bodyBottom = 0.98;
    return {
      isEstimated: true,
      canvasW,
      canvasH,
      bodyTop,
      bodyBottom,
      bodyHeightFraction: bodyBottom - bodyTop,
      shoulderFraction: bodyTop + (bodyBottom - bodyTop) * 0.14,
      torsoCentreX: canvasW / 2,
      shoulderPx: canvasW * 0.38,
      // No silhouette means no measurable tilt, so the fallback stays level.
      shoulderSlope: 0,
      /*
       * UNKNOWN, not `false`. With no mask we cannot see whether there are legs,
       * and claiming either way would be a guess dressed as a measurement. The
       * null propagates to `isFullFigure` below and forces the honest "approx"
       * framing rather than a confident "this is a bust" that we cannot support.
       */
      hasLegs: null,
      subjectBottom: bodyBottom,
    };
  }

  return { isEstimated: false, canvasW, canvasH, ...silhouette };
};

/**
 * Scale factor that expresses "how many pixels is one centimetre on THIS
 * subject".
 *
 * The subject's real shoulder-to-shoulder width is a known quantity (the
 * customer's `shoulder_width`, in cm). Their pixel shoulder width is measured
 * from the silhouette. Dividing gives px/cm directly — this is the "pixel-to-
 * metric ratio" the brief asks for, derived from data we actually hold.
 *
 * @returns {{pxPerCm:number, source:string}}  px/cm plus how it was obtained.
 */
export const derivePixelScale = (frame, shoulderCm, canvasH = 0) => {
  /*
   * The silhouette measures the OUTER ARM ENVELOPE, which is wider than the
   * bare shoulder seam the customer enters. 1.32 is the empirical sweep of the
   * deltoid/arm against the anatomical shoulder seam on a standing figure — it
   * is a correction for what we measured vs what the tape measure describes,
   * and it is stated here rather than buried so it can be tuned.
   */
  const ARM_ENVELOPE_FACTOR = 1.32;
  const cm = Number(shoulderCm);

  if (frame?.shoulderPx > 0 && Number.isFinite(cm) && cm > 0) {
    return {
      pxPerCm: frame.shoulderPx / (cm * ARM_ENVELOPE_FACTOR),
      source: 'silhouette',
    };
  }

  /*
   * No silhouette: estimate from body height against the canon 7.5-head figure
   * and the standard 168cm standing assumption. Labelled `estimated` so nothing
   * downstream claims more precision than it has.
   */
  const assumedHeightCm = 168;
  const frameHeightPx = canvasH || frame.canvasH || 0;
  return {
    pxPerCm: (frame.bodyHeightFraction * frameHeightPx) / assumedHeightCm,
    source: 'estimated',
  };
};

/**
 * Resolve ONE garment's placement rectangle.
 *
 * Returns the pixel box the garment draw should fill, anchored to the SUBJECT
 * (torso centre + shoulder line), never to the canvas midline.
 *
 * THE SUBJECT-EXTENT CLAMP
 * ------------------------
 * `GARMENT_SPANS` expresses how long a piece is as a fraction of BODY HEIGHT,
 * on the assumption that the subject is a standing FULL FIGURE. On a bust crop
 * that assumption is false — the "body height" is the bust's height — and a
 * dress at 0.86 body-heights runs from the shoulders straight past the bottom of
 * the frame. That is the reported crop failure: measured on a 350x350 bust, the
 * dress spanned 38.6% -> 116.8% of the frame.
 *
 * So the computed bottom is clamped to `frame.subjectBottom * canvasH`, the
 * bottom of what the SUBJECT actually occupies.
 *
 * WHY SHORTEN RATHER THAN REFUSE: a customer who uploaded a bust still wants to
 * see how the dress looks on them. Truncating the piece to the visible figure is
 * the useful answer; refusing to render throws away the whole interaction. The
 * limitation is REPORTED (see the `figureType` diagnostics in compositeTryOn) so
 * the UI can tell them a full-length photo would fit better — rather than the
 * engine silently drawing fabric into empty space.
 *
 * @param {string} key        top | bottom | dress | outerwear | footwear
 * @param {Object} frame      from buildBodyFrame()
 * @param {Object} metrics    from resolveMeasurements()
 * @param {Object} scale      from derivePixelScale()
 * @param {number} canvasW
 * @param {number} canvasH
 */
export const resolveGarmentBox = (key, frame, metrics, scale, canvasW, canvasH, pose = null) => {
  const span = GARMENT_SPANS[key];
  if (!span) return null;

  const bodyPx = frame.bodyHeightFraction * canvasH;
  const shoulderY = frame.shoulderFraction * canvasH;

  const top = shoulderY + span.fromShoulder * bodyPx;
  const unclampedBottom = shoulderY + span.toBelowShoulder * bodyPx;

  /*
   * CLAMP THE HEM TO THE SUBJECT.
   *
   * `subjectBottom` is a FRACTION of image height (like bodyBottom). Multiplying
   * gives the pixel row the subject stops at. The clamp only ever SHORTENS a
   * piece (`Math.min`) — a garment that already fits inside the figure is
   * untouched, so this cannot regress a full-length render.
   *
   * The one-pixel floor guards the degenerate case: on a very short bust the
   * clamp could otherwise invert the box (bottom above top), and a garment with
   * zero or negative height is not a garment.
   */
  const subjectBottomY = (frame.subjectBottom ?? frame.bodyBottom ?? 1) * canvasH;
  const bottom = Math.max(Math.min(unclampedBottom, subjectBottomY), top + 1);
  const height = Math.max(1, bottom - top);

  /*
   * Width comes from the BODY DIMENSION the category depends on — a top is
   * sized by the chest/shoulder, a bottom by the hips — converted through the
   * same px/cm scale so both sides of the ratio are in the same units.
   */
  const bodyCm = metrics[span.widthOf] ?? metrics.shoulder_width;
  let width = Math.max(1, bodyCm * scale.pxPerCm * span.widthFactor);

  /*
   * POSE-AWARE WIDTH — MEASURED AGAINST THE TORSO'S OWN WIDEST ROW.
   *
   * THIS IS THE FIX FOR THE "MANIPIS NA STRIP" RENDER.
   *
   * A first attempt sampled the subject's width at the VERTICAL MIDDLE of the
   * piece's band and clamped the garment to 55%-150% of it. For a DRESS that band
   * runs from the shoulders to below the knee, so its middle is the MID-THIGH —
   * one of the narrowest rows on the body. The clamp therefore sized a full
   * A-line dress to a thigh, and the dress rendered as a thin vertical strip.
   *
   * The correct reference is the WIDEST row the piece crosses — the shoulders
   * and upper torso for a top or a dress, the hips for a bottom. That is the
   * dimension the garment is cut to, and it is the only bound that can be trusted
   * not to shrink a piece.
   *
   * The measured span is the OUTER ARM ENVELOPE (it includes the arms), so the
   * fabric is allowed to be a fraction of it, but the floor is kept HIGH (0.85)
   * so a real garment is never collapsed to a sliver, and the ceiling (1.35) only
   * stops a degenerate silhouette from swallowing the frame.
   */
  if (pose?.widthAt && key !== 'footwear') {
    // Sample across the piece's band and keep the WIDEST row — the dimension the
    // garment is actually cut to.
    let widest = 0;
    const samples = 8;
    for (let i = 0; i <= samples; i++) {
      const y = top + (height * i) / samples;
      const w = pose.widthAt(y);
      if (Number.isFinite(w) && w > widest) widest = w;
    }

    if (widest > 0) {
      const lo = widest * 0.85;
      const hi = widest * 1.35;
      width = Math.min(Math.max(width, lo), hi);
    }
  }

  /*
   * THE FRAME SANITY CLAMP.
   *
   * A garment wider than ~86% of the canvas is almost always a scaling error (a
   * bad measurement or a degenerate silhouette), not a real garment. Clamping
   * here means a bad input degrades to a plausible size instead of blanketing
   * the picture.
   */
  width = Math.min(width, canvasW * 0.86);

  // Anchored on the torso centre, then clamped so a garment can never be drawn
  // substantially off-frame even if the silhouette is unusual.
  const cx = Math.min(Math.max(frame.torsoCentreX, 8), canvasW - 8);
  const left = Math.min(Math.max(cx - width / 2, -width * 0.15), canvasW - width * 0.85);

  /*
   * `clampedToSubject` records whether the extent clamp actually bit, so a
   * caller can tell "this dress simply fits the figure" apart from "this dress
   * was shortened because the photo stops at the chest". Without the flag the two
   * are indistinguishable downstream. `shortenedByBust` narrows it to the case
   * the customer should be told about: the photo is not a full figure.
   */
  const clampedToSubject = bottom < unclampedBottom;

  return {
    left,
    top,
    width,
    height,
    centreX: cx,
    clampedToSubject,
    shortenedByBust: clampedToSubject && frame.hasLegs === false,
  };
};
