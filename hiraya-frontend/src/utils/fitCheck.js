/**
 * fitCheck — the PRE-RENDER fit advisor for the Virtual Try-On Studio.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every check here is arithmetic on data the app ALREADY holds:
 *
 *   - the customer's 5-core body measurements (users table: chest_bust, waist,
 *     hips, shoulder_width, sleeve_length),
 *   - each garment's per-size table (products.size_measurements),
 *   - and the silhouette the local compositor already derives from the photo
 *     (measureSilhouette / buildBodyFrame / measureBodyPose).
 *
 * So there is NO model, NO network call and NO API key involved — it works with
 * the free tier and offline. That is deliberate: an image model is the wrong
 * tool for "is 96 cm within the band this Medium is cut for", because that is a
 * comparison, not a picture.
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is NOT a gate. The caller decides how to present each item:
 *
 *   - status 'pass'  -> the render is sound for this item.
 *   - status 'warn'  -> the render is usable, but the customer should be told.
 *   - status 'block' -> reserved for the two cases where the render itself is
 *                       unusable (no usable photo geometry, or no measurement
 *                       to judge against at all). Even then the caller may
 *                       choose to render with a warning — this module only
 *                       REPORTS, it never refuses.
 *
 * That separation keeps the honesty requirement (the customer is always told
 * what limited the fit) without ever silently swapping their render for nothing.
 *
 * THE FIVE CHECKS
 * ---------------
 *   pose          — is the subject standing square / full-figure in the frame?
 *   posture       — is the torso upright, or leaning/hunched?
 *   bodyVsGarment — does the chosen size sit in the right band for the body?
 *   garmentData   — does this garment actually carry usable size measurements?
 *   measurements  — is the body profile complete enough to judge size at all?
 *
 * Each returns the SAME shape (see `item()` below) so the UI can render them
 * uniformly and a new check can be added without touching the panel.
 */

import { resolveMeasurements, measureSilhouette } from './bodyGeometry';
import { measureBodyPose } from './bodyPose';
import { analysePhotoQuality } from './photoQuality';

/**
 * Overall severities, ordered so the worst one wins when the UI folds the list
 * into a single badge.
 */
export const FIT_STATUS = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  BLOCK: 'block',
});

/** Rank for picking the headline status: block > warn > pass. */
const SEVERITY = { pass: 0, warn: 1, block: 2 };

/**
 * Build one uniform check result.
 *
 * @param {string} id     stable key for the check ('pose', 'posture', ...)
 * @param {string} label  short human title
 * @param {string} status one of FIT_STATUS
 * @param {string} detail the customer-facing sentence (plain language, no jargon)
 * @param {Object} [extra] any measured evidence worth surfacing / debugging
 */
const item = (id, label, status, detail, extra = {}) => ({
  id,
  label,
  status,
  detail,
  ...extra,
});

/**
 * Fold a list of checks into one overall verdict for the headline badge.
 *
 * @param {Array} items
 * @returns {{status:string, counts:{pass:number,warn:number,block:number}}}
 */
export const summariseFitCheck = (items = []) => {
  const counts = { pass: 0, warn: 0, block: 0 };
  let worst = FIT_STATUS.PASS;
  for (const it of items) {
    if (counts[it.status] === undefined) continue;
    counts[it.status] += 1;
    if (SEVERITY[it.status] > SEVERITY[worst]) worst = it.status;
  }
  return { status: worst, counts };
};

/**
 * HOW BIG AN OPAQUE SUBJECT MUST BE TO COUNT AS A FULL FIGURE.
 *
 * These are the floors that promote a photo OUT of 'unknown' when there is no alpha
 * silhouette to read (see the branch inside checkPose). They are deliberately LOW:
 * the opaque reader is a coarse arithmetic read, so the job here is only to confirm
 * "there is a body-sized subject in frame", not to grade how good the photo is.
 *
 * MEASURED (QA harness, 600x900 frames, via utils/photoQuality):
 *
 *   a real full-body person  -> subjectWidth 0.392, coverage 0.825 <-- passes
 *   a real close-up          -> subjectWidth 0.500, coverage 0.864 <-- passes
 *   a bust crop              -> subjectWidth 0.762, coverage 0.854 <-- passes
 *   a shoe product shot      -> subjectWidth 0.637, coverage 0.233 <-- fails
 *   an empty wall            -> subjectWidth 0.000                <-- fails
 *
 * The COVERAGE floor is what does the real work: it is the one number that separates
 * a body standing in the frame (0.82-0.86) from a product lying in it (0.23). The
 * WIDTH floor exists only to reject a thin sliver, which a real subject never is.
 */
const OPAQUE_MIN_SUBJECT_WIDTH = 0.12;
const OPAQUE_MIN_COVERAGE = 0.5;

/**
 * POSE — is the frame a standing full figure the standing garment spans assume?
 *
 * Evidence comes from the SAME silhouette the compositor uses, so this can never
 * disagree with the render: `hasLegs === false` is exactly what makes the engine
 * clamp every full-length piece to the bust.
 *
 * When that silhouette is null — which is EVERY JPEG, because an alpha-mask scanner
 * cannot read an opaque photo — the OPAQUE reader (`quality`) decides instead. See
 * the branch inside for why that matters.
 *
 * @param {Object|null} silhouette from measureSilhouette()
 * @param {Object|null} quality    from analysePhotoQuality() — the only reader that
 *                                 can see an opaque upload.
 */
const checkPose = (silhouette, quality = null) => {
  if (!silhouette) {
    /*
     * No alpha silhouette. That is the COMMON case, not an edge case: every
     * upload is re-encoded as JPEG (see prepareUserPhoto), and an alpha-mask
     * scanner cannot read an opaque photo. So before falling back to "unreadable",
     * we consult the OPAQUE analysis (photoQuality) — which is the only reader that
     * can actually see a JPEG.
     *
     * ----------------------------------------------------------------------------
     * HONEST LIMIT — WHAT THIS CAN AND CANNOT DO (measured, not assumed)
     * ----------------------------------------------------------------------------
     * A first draft tried to detect a PRODUCT CARD by its geometry: an image
     * cropped edge-to-edge, wider than a standing person. It was driven by a QA
     * harness (`.qa-photoquality.html`) that drew a product card and a full-body
     * person, and the harness SHOWED THE TEST FAILING: both measured as tall blobs
     * spanning ~81-88% of the frame, and the geometry could not separate them. Any
     * threshold that called the synthetic card "an object" would also have called
     * real, tightly-framed customer photos "an object".
     *
     * So no object/product verdict is emitted from geometry. What IS left is what
     * the evidence supports:
     *
     *   - There is NO PERSON-like subject at all (an empty frame, a plain surface):
     *     `subjectWidth` is 0. This is a genuine, measurable finding and is
     *     reported as `figureType: 'object'`.
     *   - There IS a subject, but its body outline cannot be measured (which is
     *     every JPEG here): reported as `figureType: 'unknown'`, honestly.
     *
     * Distinguishing "a person" from "a photo OF a garment" reliably needs a
     * vision model, not arithmetic on a downscaled bitmap. Until that is wired in,
     * this check refuses to guess.
     */
    if (quality?.readable && quality.subjectWidth === 0) {
      return item(
        'pose',
        'Photo pose',
        FIT_STATUS.WARN,
        'No person could be found in this photo — it reads as an empty scene or a ' +
        'flat surface. Upload a full-body photo of yourself so the fitting has a ' +
        'real body to dress.',
        {
          figureType: 'object',
          poseReadable: false,
          evidence: quality,
        }
      );
    }

    /*
     * ==========================================================================
     * THE OPAQUE READER ALREADY MEASURED THE SUBJECT — SO USE ITS NUMBERS.
     * ==========================================================================
     *
     * MEASURED BUG (reported): after the body-photo cut-out was removed from the
     * upload flow, EVERY photo showed "Fit not measured" on the canvas — including
     * a plainly good, full-body, evenly-lit picture.
     *
     * The cause was in this exact branch. `measureSilhouette` above needs an alpha
     * mask, so it returns null for every JPEG; this branch treated that as "nothing
     * could be measured" and returned `figureType: 'unknown'` — WITHOUT READING
     * `quality`, which `runFitCheck` had already computed on the very same image.
     *
     * That reader can see a JPEG: it finds the subject against the border-consensus
     * background and reports how much of the frame it spans (`coverage`) and how
     * wide it gets (`subjectWidth`). Those two numbers are enough to say something
     * TRUE about the photo instead of the blanket 'unknown'.
     *
     * What they can and cannot decide:
     *   - A real person spans a large share of the frame height AND is wider than a
     *     stick: coverage high, subjectWidth meaningful.
     *   - An empty scene was already handled above (`subjectWidth === 0`).
     *   - A flat surface / distant wall has no vertical extent worth speaking of.
     *
     * CONSERVATIVE BY DESIGN: this only ever PROMOTES a photo out of 'unknown', and
     * only when the opaque reader actually saw a body-sized subject. Anything that
     * does not clear both floors still falls through to the honest 'unknown' below —
     * the check never guesses a pass from absent evidence.
     */
    if (
      quality?.readable &&
      quality.subjectWidth >= OPAQUE_MIN_SUBJECT_WIDTH &&
      quality.coverage >= OPAQUE_MIN_COVERAGE
    ) {
      /*
       * ========================================================================
       * A BODY-SIZED SUBJECT — BUT THAT IS NOT PROOF OF A PERSON.
       * ========================================================================
       *
       * MEASURED BUG (reported): a GARMENT-ONLY photo (a barong on a hanger, a
       * dress on a mannequin) reached the canvas showing the green "PHOTO LOOKS
       * GOOD" chip. This branch caused it. `subjectWidth` and `coverage` are
       * ARITHMETIC ON A DOWNSCALED BITMAP — they measure "how big is the tall
       * mass", never "is the mass a person". A garment answers the size question
       * exactly like a body does; `photoQuality`'s own header says so (a product
       * card and a full-body person measured nearly identical blobs).
       *
       * So this branch must NOT emit FIT_STATUS.PASS / 'full-figure' — that is a
       * claim it cannot support, and the chip then reads as a green "your photo
       * is good" over a photo of no person.
       *
       * WHAT REPLACES IT: a NEUTRAL, UNMEASURED report. The size evidence is
       * still returned (so the panel can say "we could not measure your outline"),
       * but it is no longer a pass. The AUTHORITATIVE person verdict is
       * `validateBodyPhoto` (the skin gate), which runs at upload and refuses a
       * no-person photo before this panel is ever shown. This check is advisory
       * only, and an advisory read must never contradict that verdict.
       */
      return item(
        'pose',
        'Photo pose',
        FIT_STATUS.WARN,
        'Your body outline could not be measured from this photo, so the fit is an ' +
        'approximation. A full-body photo against a plain, evenly lit background ' +
        'gives a measured fit.',
        { figureType: 'unknown', poseReadable: false, evidence: quality }
      );
    }

    /*
     * Opaque photo with no measurable body signature. Without a readable outline
     * the fit is an approximation, and the customer must be told that rather than
     * shown a confident chip.
     */
    return item(
      'pose',
      'Photo pose',
      FIT_STATUS.WARN,
      'Your body outline could not be measured from this photo, so the fit is an ' +
      'approximation. A full-body photo against a plain, evenly lit background ' +
      'gives a measured fit.',
      { figureType: 'unknown', poseReadable: false, evidence: quality || null }
    );
  }

  if (silhouette.hasLegs === false) {
    return item(
      'pose',
      'Photo pose',
      FIT_STATUS.WARN,
      'This looks like a head-and-shoulders crop, so long pieces (dresses, ' +
      'bottoms) are only shown as far as the frame allows. A full-body photo ' +
      'fits them properly.',
      { figureType: 'bust', poseReadable: true }
    );
  }

  /*
   * THE SUBJECT FILLS THE ENTIRE FRAME — this is an OBJECT, not a person.
   *
   * WHY THIS CHECK HAD TO BE ADDED
   * ------------------------------
   * MEASURED: a PRODUCT MARKETING CARD (a dress photographed against a pink
   * backdrop with a floral border and a "KAI" wordmark) was reported as
   * "Photo looks good / Full standing figure detected".
   *
   * The reason is that `hasLegs` alone cannot tell a standing person from a
   * photograph OF a garment: the saliency segmenter locked onto the dress, and a
   * dress hem that splits into two panels satisfies the leg-envelope test
   * (`splitRatio >= 0.15`, two substantial columns in the lower band). The check
   * asked "are there two columns down there?" and never asked "is this a person
   * at all?".
   *
   * A HUMAN PHOTOGRAPHED FULL-BODY LEAVES MARGIN. Whoever shoots it frames the
   * subject INSIDE the picture: `PhotoGuide` explicitly instructs "Whole body in
   * frame, phone at chest height ... with a little space above and below". So a
   * genuine full-body portrait has `bodyTop > 0` and `bodyHeightFraction < ~0.95`.
   *
   * A PRODUCT CARD has no such margin — the garment is cropped TO the image edge
   * by the upload pipeline, so the "subject" starts at the very top row and runs
   * to the very bottom. That combination is the signature of an object filling its
   * own frame, and it is what this branch rejects.
   *
   * The thresholds are deliberately LOOSE. They are chosen to catch a card that
   * bleeds off both edges, not to police how tightly a customer framed themselves:
   * a real person standing close to the camera can still reach `bodyTop` near 0.02
   * and 0.93 of the height, and both are allowed here.
   */
  const bodyTop = Number(silhouette.bodyTop ?? 0);
  const bodyHeightFraction = Number(silhouette.bodyHeightFraction ?? 0);

  const bleedsOffBothEdges = bodyTop <= 0.015 && bodyHeightFraction >= 0.96;

  if (bleedsOffBothEdges) {
    return item(
      'pose',
      'Photo pose',
      FIT_STATUS.WARN,
      'This photo is filled edge-to-edge by a subject with no space above or ' +
      'below it, which is how a product or garment shot looks — not a person ' +
      'standing in frame. Upload a full-body photo of yourself against a plain ' +
      'background so the fitting has a real body to dress.',
      {
        figureType: 'object',
        poseReadable: true,
        bodyTop: +bodyTop.toFixed(3),
        bodyHeightFraction: +bodyHeightFraction.toFixed(3),
      }
    );
  }

  return item(
    'pose',
    'Photo pose',
    FIT_STATUS.PASS,
    'Full standing figure detected — the standing garment lengths apply.',
    { figureType: silhouette.hasLegs === true ? 'full-figure' : 'unknown', poseReadable: true }
  );
};

/**
 * POSTURE — is the torso upright, or leaning/hunched?
 *
 * A leaning subject is not an error — the compositor follows the lean — but the
 * customer should know the render is reading their posture rather than a
 * straight-on reference.
 *
 * @param {Object|null} pose from measureBodyPose()
 */
const checkPosture = (pose) => {
  if (!pose?.available) {
    return item(
      'posture',
      'Body posture',
      FIT_STATUS.WARN,
      'Posture could not be read from the photo, so the garment is placed on an ' +
      'upright assumption.',
      { posture: 'unknown', bent: false }
    );
  }

  const { posture, bent, tiltRadians = 0 } = pose;

  if (bent) {
    const degrees = Math.round(Math.abs(tiltRadians) * (180 / Math.PI));
    return item(
      'posture',
      'Body posture',
      FIT_STATUS.WARN,
      `You are ${posture} in this photo, so the garment follows your posture ` +
      `(about ${degrees}° of lean) rather than standing straight. A square-on ` +
      'pose gives the truest line.',
      { posture, bent: true, tiltDegrees: degrees }
    );
  }

  return item(
    'posture',
    'Body posture',
    FIT_STATUS.PASS,
    'Upright posture detected — the garment is placed on a straight body line.',
    { posture: posture || 'upright', bent: false }
  );
};

/**
 * MEASUREMENTS — is the body profile complete enough to judge size at all?
 *
 * @param {Object} metrics from resolveMeasurements()
 * @param {Object} raw     the raw measurement input, to tell "missing" from
 *                         "defaulted". resolveMeasurements() fills sane defaults,
 *                         so we check the RAW fields for real presence.
 */
const checkMeasurements = (raw = {}) => {
  const present = ['chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length'].filter(
    (k) => Number(raw?.[k] ?? raw?.[k === 'chest_bust' ? 'chest' : k]) > 0
  );

  if (present.length === 0) {
    /*
     * Nothing supplied at all. This is the strongest BLOCK we allow: the size
     * cannot be judged from a body we do not know, and the useful action is for
     * the customer to fill the profile — not to silently guess a size.
     */
    return item(
      'measurements',
      'Body profile',
      FIT_STATUS.BLOCK,
      'No body measurements are on file, so the size cannot be checked against ' +
      'you. Add your chest, waist and hips in the body profile to get a real ' +
      'size check.',
      { present: [], missing: ['chest_bust', 'waist', 'hips', 'shoulder_width', 'sleeve_length'] }
    );
  }

  if (!Number(raw?.chest_bust ?? raw?.chest) || !Number(raw?.waist)) {
    return item(
      'measurements',
      'Body profile',
      FIT_STATUS.WARN,
      'Your chest and waist are what the size is judged from. One of them is ' +
      'missing, so the size suggestion is approximate.',
      { present, missing: ['chest_bust', 'waist'].filter((k) => !Number(raw?.[k])) }
    );
  }

  return item(
    'measurements',
    'Body profile',
    FIT_STATUS.PASS,
    'Body profile is complete enough for a measured size check.',
    { present, missing: [] }
  );
};

/**
 * GARMENT DATA — does this garment carry usable size measurements?
 *
 * A catalog card with no machine-readable size table cannot be size-checked. The
 * compositor handles it (it keeps its photo-derived sizing), but the customer is
 * told the size for THIS piece is a photo estimate rather than a size-chart one.
 *
 * @param {Object} garmentsByCategory map of category -> garment (or null)
 */
const checkGarmentData = (garmentsByCategory = {}) => {
  const selected = Object.entries(garmentsByCategory).filter(([, g]) => g);
  if (selected.length === 0) {
    return item(
      'garmentData',
      'Garment sizing',
      FIT_STATUS.WARN,
      'No garment selected yet, so there is nothing to size-check.',
      { checked: [], missing: [] }
    );
  }

  const missing = [];
  const checked = [];
  for (const [key, g] of selected) {
    const table = g.size_measurements ?? g.sizeMeasurements ?? null;
    /*
     * We accept the garment as size-checked when its table resolves for at least
     * one size. We do not need the size the customer picked here — that is the
     * job of checkBodyVsGarment — only whether ANY usable numbers exist.
     */
    const hasNumbers =
      table &&
      typeof table === 'object' &&
      Object.values(table).some(
        (row) => row && typeof row === 'object' && Object.values(row).some((v) => Number(v) > 0)
      );

    if (hasNumbers) checked.push(key);
    else missing.push(g.name || key);
  }

  if (missing.length > 0) {
    return item(
      'garmentData',
      'Garment sizing',
      FIT_STATUS.WARN,
      `The size of ${missing.join(', ')} is not on a size chart, so it is shown ` +
      'at a photo-estimated size rather than a measured one.',
      { checked, missing }
    );
  }

  return item(
    'garmentData',
    'Garment sizing',
    FIT_STATUS.PASS,
    'Every selected piece carries a size chart, so the fit is size-checked.',
    { checked, missing: [] }
  );
};

/**
 * BODY vs GARMENT — does the chosen size sit in the right band for the body?
 *
 * This is the heart of the "will it fit me" question. We compare the customer's
 * chest/bust (the one axis every category carries) against the band the chosen
 * size is cut for, using the same tolerance the compositor uses for its scale,
 * so the badge and the render agree.
 *
 * @param {Object} metrics          from resolveMeasurements()
 * @param {Object} garmentsByCategory category -> garment (with chosen `size` and
 *                                    its `size_measurements` table)
 * @param {Object} selectedSizes    category -> chosen size label (falls back to
 *                                  garment.size when absent)
 */
const checkBodyVsGarment = (metrics, garmentsByCategory = {}, selectedSizes = {}) => {
  const wearer = Number(metrics.chest_bust);
  if (!Number.isFinite(wearer) || wearer <= 0) {
    return item(
      'bodyVsGarment',
      'Size match',
      FIT_STATUS.WARN,
      'Without your chest measurement this garment cannot be size-matched.',
      { pieces: [] }
    );
  }

  /*
   * Tolerance band, symmetric around the garment's own chest measurement.
   *
   * A garment is cut to sit OUTSIDE the body, so the chest number on the chart
   * is normally a few cm larger than the wearer's. We therefore treat anything
   * from the wearer's chest to wearer + EASE as a comfortable fit, allow a small
   * negative ease for stretch fabrics, and flag the extremes.
   */
  const EASE_MAX = 12; // cm of room that still reads as "fitted", not "oversized"
  const EASE_MIN = -4; // cm of negative ease we tolerate (knit / stretch)

  const pieces = [];
  for (const [key, garment] of Object.entries(garmentsByCategory)) {
    if (!garment) continue;
    const table = garment.size_measurements ?? garment.sizeMeasurements ?? null;
    if (!table || typeof table !== 'object') {
      pieces.push({ key, verdict: 'unknown', size: null });
      continue;
    }

    const sizeKey = selectedSizes[key] ?? garment.size ?? null;

    /*
     * Resolve the row for the chosen size. When the chosen size is not on the
     * chart we fall back to scanning every row and picking the CLOSEST chest
     * value, so we still give an honest verdict instead of "unknown" for a
     * garment the customer clearly selected.
     */
    let row = sizeKey && typeof table[sizeKey] === 'object' ? table[sizeKey] : null;
    let matchedSize = sizeKey;

    const rows = Object.entries(table).filter(
      ([, r]) => r && typeof r === 'object' && Number(r.chest_bust ?? r.chest) > 0
    );

    if (!row && rows.length > 0) {
      let best = null;
      let bestDist = Infinity;
      for (const [size, r] of rows) {
        const dist = Math.abs(Number(r.chest_bust ?? r.chest) - wearer);
        if (dist < bestDist) {
          bestDist = dist;
          best = [size, r];
        }
      }
      if (best) {
        [matchedSize, row] = best;
      }
    }

    const garmentChest = Number(row?.chest_bust ?? row?.chest);
    if (!Number.isFinite(garmentChest) || garmentChest <= 0) {
      pieces.push({ key, verdict: 'unknown', size: matchedSize || null });
      continue;
    }

    const ease = garmentChest - wearer;
    let verdict;
    if (ease < EASE_MIN) verdict = 'too-tight';
    else if (ease > EASE_MAX) verdict = 'too-loose';
    else verdict = 'ok';

    pieces.push({
      key,
      verdict,
      size: matchedSize || null,
      garmentChest,
      wearerChest: wearer,
      ease: Number(ease.toFixed(1)),
    });
  }

  const tight = pieces.filter((p) => p.verdict === 'too-tight');
  const loose = pieces.filter((p) => p.verdict === 'too-loose');

  if (tight.length > 0) {
    return item(
      'bodyVsGarment',
      'Size match',
      FIT_STATUS.WARN,
      `The size you picked for ${tight.map((p) => p.key).join(', ')} is cut ` +
      `smaller than your chest — it may feel tight. Consider one size up.`,
      { pieces }
    );
  }

  if (loose.length > 0) {
    return item(
      'bodyVsGarment',
      'Size match',
      FIT_STATUS.WARN,
      `The size you picked for ${loose.map((p) => p.key).join(', ')} is cut ` +
      `larger than a fitted look on your chest — expect a looser drape.`,
      { pieces }
    );
  }

  if (pieces.length === 0) {
    return item(
      'bodyVsGarment',
      'Size match',
      FIT_STATUS.WARN,
      'No garment could be size-matched.',
      { pieces }
    );
  }

  return item(
    'bodyVsGarment',
    'Size match',
    FIT_STATUS.PASS,
    'Chosen sizes sit in the right band for your chest measurement.',
    { pieces }
  );
};

/**
 * Run every fit check against ONE try-on setup.
 *
 * @param {Object} params
 * @param {HTMLImageElement|string} params.portrait  the customer's photo (an
 *        already-decoded Image is ideal; a data URI works but will be measured
 *        synchronously only if already loaded).
 * @param {Object} params.measurements             raw 5-core input
 * @param {Object} params.garmentsByCategory        category -> garment
 * @param {Object} [params.selectedSizes]           category -> chosen size label
 * @returns {{status:string, items:Array, counts:Object}}
 */
export const runFitCheck = ({
  portrait,
  measurements = {},
  garmentsByCategory = {},
  selectedSizes = {},
} = {}) => {
  const metrics = resolveMeasurements(measurements);

  /*
   * The silhouette/pose readers need a decoded image with readable pixels. When
   * the caller passes a data URI (not yet an Image) we skip the pixel checks and
   * report them as unreadable rather than throwing — the size checks, which need
   * no pixels, still run.
   */
  const isImage =
    portrait && typeof portrait === 'object' && typeof portrait.width === 'number';

  let silhouette = null;
  let pose = null;
  let quality = null;
  if (isImage) {
    try {
      silhouette = measureSilhouette(portrait);
      pose = measureBodyPose(portrait);
    } catch {
      silhouette = null;
      pose = null;
    }

    /*
     * The OPAQUE reader. `measureSilhouette` above needs an alpha mask and so
     * returns null for every uploaded JPEG; this one works on the actual pixels
     * and is what lets the pose check say anything about a real photo at all. It is
     * run unconditionally (not only as a fallback) so the evidence is present in
     * the trace either way.
     */
    try {
      quality = analysePhotoQuality(portrait);
    } catch {
      quality = null;
    }
  }

  const items = [
    checkPose(silhouette, quality),
    checkPosture(pose),
    checkMeasurements(measurements),
    checkGarmentData(garmentsByCategory),
    checkBodyVsGarment(metrics, garmentsByCategory, selectedSizes),
  ];

  return { ...summariseFitCheck(items), items };
};

export default runFitCheck;
