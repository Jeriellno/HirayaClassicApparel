/**
 * photoQuality — a LIGHT, STANDALONE read of an OPAQUE upload (a JPEG phone photo).
 *
 * WHY THIS EXISTS
 * ---------------
 * MEASURED BUG: every uploaded photo showed the green "Photo looks good" chip —
 * including a PRODUCT MARKETING CARD (a dress on a pink backdrop with a floral
 * border and a "KAI" wordmark) with no person in it at all.
 *
 * The reason was not the pose criteria and not the chip copy. It was that the two
 * existing readers cannot see a JPEG:
 *
 *   1. `prepareUserPhoto` re-encodes EVERY upload as JPEG (no alpha channel), and
 *   2. `measureSilhouette` is an ALPHA-mask scanner — it returns `null` for any
 *      portrait without a transparent background, which is every JPEG.
 *
 * So `checkPose(null)` reported `figureType: 'unknown'`, and `'unknown'` was being
 * presented as a confident PASS. Nothing had actually measured the photo.
 *
 * `measureSilhouette` is deliberately NOT changed to handle this. It is a shared
 * engine used by the local compositor and the QA harness, its whole model is "an
 * opaque pixel is body, a transparent pixel is background", and bending it to
 * guess a background from a photograph would risk the geometry every garment is
 * placed against. This module is the separate, lower-stakes answer: it only has to
 * decide whether a photo LOOKS like a dressed person in frame, and it may be wrong
 * in the cautious direction without breaking a render.
 *
 * WHAT IT MEASURES (all on a small downscale, no models, no network)
 * ------------------------------------------------------------------
 * The analysis is built on a BORDER-CONSENSUS background: the four edges of the
 * image are sampled, and the colour that dominates them is taken to be the
 * background. Everything that disagrees with it is the SUBJECT. That is how a
 * photograph is read by eye — the room/wall fills the frame edges, the person
 * stands against it — and it needs no colour guesswork:
 *
 *   coverage      – what fraction of the frame height the subject spans.
 *   subjectWidth  – the subject's width as a fraction of the frame. 0 means no
 *                   person-like subject was found at all.
 *   borderShare   – how much of the border the winning background colour owns,
 *                   i.e. how trustworthy the background model is on this image.
 *
 * WHAT WAS TRIED AND REMOVED, AND WHY (both measured on a real QA harness)
 * ------------------------------------------------------------------------
 *   1. SKIN-TONE colour test — a pink product backdrop (#f6c9d6) scored 0.495
 *      "skin" while a drawn person scored 0.002. The verdict came out INVERTED, so
 *      it was removed. Colour classification without a model is not sound.
 *   2. EDGE-TO-EDGE + WIDTH geometry to call a card an "object" — the harness
 *      showed a product card and a full-body person measure as nearly identical
 *      tall blobs (coverage ~0.81 vs ~0.88). Any threshold that flagged one would
 *      flag real tightly-framed customer photos. Removed rather than tuned to fit
 *      synthetic drawings.
 *
 * Telling "a person" from "a photo OF a garment" reliably needs a vision model,
 * not arithmetic. This module reports only what it can reproduce, and the caller
 * keeps the honest "unreadable = warn" path for everything else. The verdict is
 * ADVISORY, exactly like the rest of fitCheck: it never blocks a render, it only
 * lets the customer be told the truth about their photo.
 */

/** Downscale target. Big enough to find a torso, small enough to stay instant. */
const SCAN = 160;

/**
 * Colour distance (in the 0..255-per-channel sense) from the background that
 * counts as "subject". Generous, because photographic lighting varies across a
 * single wall; the shape tests below, not this number, carry the verdict.
 */
const BG_DISTANCE = 60;

/**
 * Analyse an opaque image (any decoded HTMLImageElement).
 *
 * @param {HTMLImageElement} img
 * @returns {Object|null} measurements, or null when pixels cannot be read
 *   (a cross-origin taint, an undecodable image). The caller treats null exactly
 *   like an unreadable silhouette — as "we could not verify this", never as a pass.
 */
export const analysePhotoQuality = (img) => {
  if (!img?.width || !img?.height) return null;

  const scanW = SCAN;
  const scanH = Math.max(1, Math.round(SCAN * (img.height / img.width)));

  let ctx;
  try {
    const probe = document.createElement('canvas');
    probe.width = scanW;
    probe.height = scanH;
    ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, scanW, scanH);
  } catch {
    return null;
  }

  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, scanW, scanH));
  } catch {
    return null; // Tainted canvas. Cannot read the pixels.
  }

  const at = (x, y) => {
    const i = (y * scanW + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  /*
   * BORDER-CONSENSUS BACKGROUND.
   *
   * Collect every pixel on the four edges, quantise them into coarse colour bins
   * (32 levels per channel), and take the bin that occurs most often as the
   * background. Requiring the winner to hold a MINIMUM SHARE of the border is what
   * makes this honest: if the edges disagree wildly (a busy scene, the subject
   * itself running off the frame), there is no consensus, and we say so instead of
   * inventing one.
   */
  const bins = new Map();
  let borderCount = 0;
  const tapBorder = (x, y) => {
    const [r, g, b] = at(x, y);
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    bins.set(key, (bins.get(key) || 0) + 1);
    borderCount++;
  };
  for (let x = 0; x < scanW; x++) {
    tapBorder(x, 0);
    tapBorder(x, scanH - 1);
  }
  for (let y = 0; y < scanH; y++) {
    tapBorder(0, y);
    tapBorder(scanW - 1, y);
  }

  let bestKey = null;
  let bestCount = 0;
  for (const [key, n] of bins) {
    if (n > bestCount) {
      bestCount = n;
      bestKey = key;
    }
  }
  const borderShare = borderCount > 0 ? bestCount / borderCount : 0;

  const bgR = (Math.floor(bestKey / 64) << 5) + 16;
  const bgG = ((Math.floor(bestKey / 8) % 8) << 5) + 16;
  const bgB = ((bestKey % 8) << 5) + 16;

  /*
   * Build the subject mask: anything far enough from the consensus background.
   */
  const mask = new Uint8Array(scanW * scanH);
  let subjectPixels = 0;

  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < scanW; x++) {
      const [r, g, b] = at(x, y);
      const dist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
      if (dist > BG_DISTANCE * 3) {
        mask[y * scanW + x] = 1;
        subjectPixels++;
      }
    }
  }

  if (subjectPixels === 0 || borderShare < 0.4) {
    return {
      readable: true,
      coverage: 0,
      subjectWidth: 0,
      borderShare: +borderShare.toFixed(3),
      note: subjectPixels === 0 ? 'no subject detected' : 'no clear background',
    };
  }

  /* --- SUBJECT EXTENT: where it starts, ends, and how wide it gets -------- */
  /*
   * A row counts as "subject" when a meaningful share of it is masked. The 8%
   * floor ignores a stray antialiased edge row without ignoring a real head or
   * hem, which are both narrower than the shoulders/hips around them.
   */
  let topRow = -1;
  let bottomRow = -1;
  let maxRowWidth = 0;
  for (let y = 0; y < scanH; y++) {
    let rowHits = 0;
    for (let x = 0; x < scanW; x++) if (mask[y * scanW + x]) rowHits++;
    if (rowHits >= scanW * 0.08) {
      if (topRow === -1) topRow = y;
      bottomRow = y;
    }
    if (rowHits > maxRowWidth) maxRowWidth = rowHits;
  }
  if (topRow === -1) {
    topRow = 0;
    bottomRow = scanH - 1;
  }

  const coverage = (bottomRow - topRow + 1) / scanH;
  const subjectWidth = maxRowWidth / scanW;

  /*
   * NOTE ON WHAT IS DELIBERATELY NOT RETURNED HERE.
   *
   * An earlier draft also returned `edgeToEdge` (touching the top and bottom
   * border) and `textLike` (a band of many short high-contrast runs, meant to be a
   * wordmark), and `checkPose` used them to call a product card an "object".
   *
   * The QA harness disproved both as discriminators: a synthetic product card and
   * a synthetic person produced nearly identical `coverage`/`subjectWidth`, and the
   * card's border stroke was itself counted as the subject, so the edge test was
   * reading the wrong thing. Rather than tune thresholds against drawings — which
   * would then misfire on real customer photos, the exact failure we set out to fix
   * — those fields were dropped and no product verdict is emitted from geometry.
   *
   * What remains is only what was reproducible: whether ANY person-like subject is
   * present (`subjectWidth > 0`) and how much of the frame it spans.
   */
  return {
    readable: true,
    /** Fraction of image height the subject spans. */
    coverage: +coverage.toFixed(3),
    /** Widest subject row, as a fraction of image width. 0 means no subject. */
    subjectWidth: +subjectWidth.toFixed(3),
    /** Share of the border owned by the winning background bin — a confidence. */
    borderShare: +borderShare.toFixed(3),
    note: null,
  };
};

export default analysePhotoQuality;
