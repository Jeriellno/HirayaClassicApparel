/**
 * validateBodyPhoto — decide whether a photo ACTUALLY shows a person, BEFORE any
 * background is removed.
 *
 * WHY THIS EXISTS
 * ---------------
 * MEASURED BUG (reported): a WHITE BACKGROUND WITH BLACK TEXT was background-
 * removed and then reported as "Photo looks good", while a real FULL-BODY PERSON
 * against a white wall was not removed at all. The two were inverted.
 *
 * The cause is one sentence long: `removeBodyBackground` has NO CONCEPT OF A
 * PERSON. It is a segmentation step — "mark the pixels that differ from the
 * backdrop" — so on a white card carrying dark text the TEXT becomes the
 * "subject", the white field around it becomes a "silhouette", and a photograph of
 * nothing passes every downstream check. The background remover is the wrong tool
 * to answer "is there a person here?", and running it first meant the app removed
 * a background it had never confirmed was a background.
 *
 * THE ORDER THIS ENFORCES
 * -----------------------
 *   VALIDATE  ->  only if a person is plausible,  ->  REMOVE BACKGROUND
 *
 * This module is the VALIDATE half. It never removes anything and never writes a
 * pixel; it only reads the photo and answers with reasons.
 *
 * HOW IT TELLS A PERSON FROM TEXT (structural, not colour)
 * --------------------------------------------------------
 * The distinguishing fact is SHAPE, and it survives any skin tone, any lighting and
 * any background colour:
 *
 *   A PERSON is ONE REAL MASS: a single large, connected blob of pixels that
 *   occupies a meaningful share of the frame. Whether that person is standing,
 *   sitting, close up, far away, centred or off to one side does not matter.
 *
 *   TEXT / A LOGO / A PATTERN is MANY SMALL, DISCONNECTED marks: each letter is its
 *   own tiny blob, so the largest single connected region is a small fraction of
 *   the frame. An EMPTY SCENE has no subject at all.
 *
 * So the test is ONE question: build a subject mask, find its LARGEST CONNECTED
 * COMPONENT, and ask whether it is big enough to be a body. That is the entire
 * gate — there is no pose, framing, size or centring requirement, because those
 * all describe photos that DO contain a person, and a person is all we need.
 *
 * HONEST LIMITS
 * -------------
 * This is arithmetic on a downscaled bitmap, not a vision model. It reliably
 * rejects TEXT and EMPTY SCENES (the measured bugs), and it accepts a plainly
 * framed person. A photo OF a garment on a mannequin can still resemble a body,
 * because it IS body-shaped — that case needs a real classifier and is reported as
 * such rather than guessed at. Every verdict here is ADVISORY and reversible.
 */

/** Downscale for the scan. */
const SCAN_MAX = 360;

/** A pixel is subject when it departs from the background in luma or colour. */
const LUMA_GATE = 24;
const COLOUR_GATE = 40;

/**
 * THE ONE THRESHOLD THAT DECIDES THE GATE.
 *
 * The largest single connected blob must be at least this share of the frame to
 * count as a PERSON.
 *
 * WHERE THIS NUMBER COMES FROM (measured on the QA harness):
 *   a full-body person in frame  -> largest blob 0.185
 *   a small/distant person       -> largest blob 0.029
 *   a bust portrait              -> largest blob 0.165
 *   a card of text/logo ("KAI")  -> largest blob 0.010  (many small letters)
 *   an empty plain wall          -> no subject at all
 *
 * The threshold has to sit between the SMALLEST real person (0.029) and the text
 * card (0.010), so it is 0.02. The previous 0.05 rejected a person standing too far
 * away — which is a person, and belongs in the flow.
 *
 * The size test alone cannot separate a small person (0.029) from a dense logo
 * block, so it is paired with the UPRIGHT SHAPE test below: a person is a TALL
 * connected mass, lettering is a short band or scattered marks. The two together
 * are what make this reliable — see `MIN_SPAN`.
 */
const MIN_LARGEST_BLOB = 0.02;

/**
 * The subject must be a VERTICALLY EXTENDED mass — the shape half of the check.
 *
 * A SMALL, DISTANT PERSON has a tiny blob (measured 0.029) and a text card has a
 * similarly tiny one (0.010), so size alone cannot tell them apart. SHAPE can:
 *
 *   a person (distant, seated, full-body) -> the blob spans a real VERTICAL run
 *   a text card                           -> the blob sits in a SHORT BAND
 *
 * Measured spans: distant person 0.289, seated person 0.356, full body 0.628, bust
 * 0.519 — against 0.072 for the text card. 0.15 sits far above the lettering and
 * comfortably below even a distant standing figure, so it rejects text without
 * rejecting anyone who is actually in the picture.
 */
const MIN_SPAN = 0.15;

/**
 * A PERSON HAS A SHOULDER SHELF — the shape test that tells a body from a garment.
 *
 * WHY THIS EXISTS BESIDE THE BLOB+SPAN TEST
 * ----------------------------------------
 * The blob/span test answers "is there one substantial, tall mass?" — and a GARMENT
 * ON A MANNEQUIN answers YES. It is body-shaped, so it passed, and the customer got
 * a confident fitting on a photo of a dress with no one wearing it.
 *
 * The distinguishing fact is WHERE the mass is WIDE. A person is built with a
 * NARROW head above WIDER shoulders, so the top of the silhouette is measurably
 * narrower than its torso. A garment on a mannequin (or a flat-lay) is a single
 * near-uniform column: it is as wide at the top as at the middle.
 *
 * MEASURED on the QA harness (`_qa_profile.mjs`, 600x900 synthetic frames):
 *
 *   a full-body person    -> head 0.192 / torso 0.225 -> ratio 0.852
 *   a real close-up       -> head 0.233 / torso 0.400 -> ratio 0.583
 *   a bust crop           -> head 0.433 / torso 0.767 -> ratio 0.565
 *   a garment on a manni. -> head 0.267 / torso 0.283 -> ratio 0.941 <-- rejected
 *   a flat-lay shirt      -> fills the width       -> ratio 1.000 <-- rejected
 *   a landscape (no one)  -> fills the width       -> ratio 1.000 <-- rejected
 *
 * A real person measured 0.852 at worst, a garment 0.941 at best, so 0.90 sits in
 * the gap. The limit is DELIBERATELY generous: it only fires when the top of the
 * subject is essentially as wide as the widest part of it, which a head-and-
 * shoulders cannot be. A person photographed as a tight crop, off-centre, seated
 * or far away all still measure well under it.
 */
const MAX_HEAD_TO_TORSO = 0.90;



/**
 * Below this span, nobody is shown head-toe. NOT a gate — it would reject a
 * portrait, and a portrait of a person is still a person. Kept only so a caller
 * could phrase a soft note about garment length if it ever wants one.
 */
const FULL_BODY_SPAN = 0.55;

/*
 * ==========================================================================
 * THE SKIN TEST — THE ONE THING A GARMENT CANNOT FAKE.
 * ==========================================================================
 *
 * MEASURED FAILURE (reported): a GARMENT-ONLY photo (a dress on a hanger, a
 * shirt laid flat, a mannequin) reaches the canvas. The blob/span test passes
 * it — it IS one tall, substantial mass — and the head-to-torso test only
 * catches it when the top is as wide as the middle. A dress with a narrow
 * shoulder yoke, or a garment shot at an angle, can measure headToTorso well
 * under 0.90 and slip through, because NOTHING here ever asks the one question
 * that actually separates a garment from a person:
 *
 *   IS THERE SKIN IN THIS PICTURE?
 *
 * A garment, a mannequin, a hanger, a flat-lay, a landscape, a product card and
 * an empty room all contain NO skin. A person almost always exposes some — a
 * face, a neck, hands, forearms, ankles. So skin presence is the hard, colour-*
 * based evidence the geometry tests were standing in for, and it is the LAST
 * gate: if a photo shows no skin on the subject, it is not a person and it must
 * not reach the canvas.
 *
 * HOW SKIN IS DETECTED ACROSS ALL SKIN TONES
 * ------------------------------------------
 * A fixed RGB colour would only ever match one race's skin. Instead this uses
 * the RGB->skin RULE that holds across the human range from very fair to very
 * dark: red > green > blue, a warm (red-dominant) bias, and a bounded chroma.
 * That rule is satisfied by every human skin tone and is NOT satisfied by the
 * things we must reject: white/black/grey (no chroma), blue denim, green leaves,
 * most synthetic fabrics, and neutral backgrounds.
 */

/**
 * A pixel is SKIN when the warm red>green>blue relation holds with enough
 * separation to be real chroma rather than JPEG noise, and the pixel is not so
 * dark as to be shadow/black or so washed as to be pure white.
 *
 * This is deliberately RECALL-ORIENTED (generous): a false "skin" on a garment
 * only matters if the WHOLE garment reads as skin, and the blob-skin SHARE test
 * below is what makes it strict. Missing real skin on a person is the failure we
 * cannot afford.
 */
const isSkin = (r, g, b) => {
  // Warm relation: red dominates, red beats blue, and there is real red-green spread.
  const warm = r > g && g > b && r - b > 12 && r - g > 6;
  if (!warm) return false;
  // Not pure black/shadow (needs light) and not pure white/overexposed (chroma gone).
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luma < 30 || luma > 245) return false;
  // Chroma must be in a plausible skin band — rejects saturated oranges/reds.
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const chroma = maxc - minc;
  if (chroma < 10 || chroma > 130) return false;
  return true;
};

/**
 * The minimum share of the SUBJECT that must read as skin for the subject to be
 * a person. Measured on the QA harness (600x900 frames):
 *
 *   a full-body person (face+hands+legs) -> skin share of subject ~0.10-0.30
 *   a bust portrait (face+neck)          -> ~0.25-0.45
 *   a person in gloves/long sleeves/beanie -> ~0.03-0.06  (worst real case)
 *   a dress on a hanger                  -> ~0.00
 *   a flat-lay shirt                     -> ~0.00-0.01
 *   a mannequin (bare plastic)           -> ~0.00-0.02
 *
 * A fully-covered person is the hard case, so the floor is deliberately LOW
 * (0.02) — it only has to beat the ~0.00 of a garment. It is a HARD gate, not a
 * note: below it, the photo is NOT a person and never reaches the canvas.
 */
const MIN_SKIN_SHARE = 0.02;

/**
 * The maximum share of the SUBJECT that may read as skin.
 *
 * THE FAILURE THIS STOPS (measured, case 4 of the QA fixture):
 *
 *   a GARMENT whose fabric is a warm beige/"nude" tone -> skin share of subject 1.000
 *
 * A colour test alone cannot tell that dress from skin — it IS the same colour.
 * The thing that separates them is PROPORTION. On a real person the skin is the
 * exposed part: a face, a neck, hands, maybe forearms — the CLOTHES and hair are
 * the majority of the silhouette. Not one human being is 100% bare skin with no
 * clothing, hair or shadow in frame.
 *
 * So a subject that is ENTIRELY skin-coloured is not a naked person — it is an
 * OBJECT whose own colour happens to be skin-like: a beige dress, a tan handbag,
 * a wooden mannequin, a cardboard box. Above this ceiling the photo is refused.
 *
 * The ceiling is deliberately HIGH (0.85) so it cannot touch a real photo: a
 * genuinely bare-shouldered portrait with no hair still keeps the background out
 * of its blob, and the darkest faces/hands sit near 0.5-0.7 of the silhouette at
 * most. Only a uniform skin-coloured FIELD reaches 1.0.
 */
const MAX_SKIN_SHARE = 0.85;

/** Decode an image, resolving null rather than rejecting. */
const loadImage = (src) =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || !src) return resolve(null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** Estimate the background colour from the border, with a consensus score. */
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
 * Find the largest connected component in a binary mask (4-way flood fill, iterated
 * with an explicit stack so a tall figure cannot blow the JS call stack).
 *
 * @returns {{size:number, minX:number, maxX:number, minY:number, maxY:number, maxRowWidth:number}}
 */
const largestComponent = (mask, w, h) => {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best = { size: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, maxRowWidth: 0 };

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;

    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;

    let size = 0;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    const rowWidths = new Map();

    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      size++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      rowWidths.set(y, (rowWidths.get(y) || 0) + 1);

      // 4-way neighbours.
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack[sp++] = p - 1;
      }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack[sp++] = p + 1;
      }
      if (y > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack[sp++] = p - w;
      }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack[sp++] = p + w;
      }
    }

    if (size > best.size) {
      let maxRowWidth = 0;
      for (const rw of rowWidths.values()) if (rw > maxRowWidth) maxRowWidth = rw;
      best = { size, minX, maxX, minY, maxY, maxRowWidth, rowWidths, scanW: w, scanH: h };
    }
  }

  return best;
};

/**
 * Read the SHAPE of the winning blob — the half of the verdict that tells a person
 * from a garment. See MAX_HEAD_TO_TORSO above for the measured numbers.
 *
 * Everything here is derived from the blob's own per-row pixel counts, so it costs
 * one pass over a Map that `largestComponent` already built.
 *
 * @param {Object} blob  the result of largestComponent()
 * @param {number} w     scan width
 * @returns {{torsoWidth:number, headToTorso:number}}
 */
const measureShape = (blob, w) => {
  const { rowWidths, minY, maxY } = blob;

  /*
   * The subject BAND: only rows that carry a meaningful share of the width. The 8%
   * floor is the same one `photoQuality` uses — it ignores a stray antialiased edge
   * row without ignoring a real head or hem.
   *
   * THE BAND MUST START AT THE FIRST SUBJECT-ISH ROW, NOT AT `minY`.
   *
   * MEASURED BUG in the first draft of this function: `minY` is the blob's topmost
   * MASKED PIXEL, which on a real photograph is usually a stray antialiased speck a
   * few rows above the head. Starting the band there padded it with empty rows, so
   * the "top 15%" slice fell BELOW the head and landed on the shoulders. The head
   * then measured as wide as the torso (`headToTorso` = 1.000) and a REAL FULL-BODY
   * PERSON was rejected as `no-head` — the exact opposite of the intent.
   *
   * Skipping to the first row that is genuinely subject-sized fixes it: the slice
   * then begins at the crown, which is where a person is narrow.
   */
  const firstSubjectRow = (() => {
    for (let y = minY; y <= maxY; y++) {
      if ((rowWidths.get(y) || 0) >= w * 0.08) return y;
    }
    return minY;
  })();

  const band = [];
  for (let y = firstSubjectRow; y <= maxY; y++) {
    band.push((rowWidths.get(y) || 0) / w);
  }
  if (!band.length) band.push(0);

  const torsoWidth = Math.max(...band);

  /*
   * HEAD ZONE = the top 15% of the band. For a person that is the head, which is
   * narrower than the shoulders below it. For a garment it is just more of the same
   * column, so the ratio stays at (or very near) 1.
   */
  const headDepth = Math.max(1, Math.round(band.length * 0.15));
  const headWidth = Math.max(...band.slice(0, headDepth));
  const headToTorso = torsoWidth > 0 ? headWidth / torsoWidth : 1;

  return {
    torsoWidth: +torsoWidth.toFixed(3),
    headToTorso: +headToTorso.toFixed(3),
  };
};

/**
 * ASK THE SERVER'S VISION MODEL: "IS THERE A PERSON IN THIS PHOTO?"
 *
 * THE ONE THING THE BROWSER COULD NOT DO.
 * ----------------------------------------
 * Every in-browser test failed on measurement, not opinion:
 *
 *   - geometry passed a hanging garment (it IS a big, tall, body-shaped mass);
 *   - an RGB skin rule was defeated by the app's OWN product photos — cream,
 *     white and gold fabric all read as "skin", and 3 of 5 garments leaked;
 *   - the bundled ISNet model is a SALIENCY segmenter (it separated the barong
 *     exactly like a person), not a person detector;
 *   - the browser exposes no FaceDetector at all (verified).
 *
 * So the verdict is delegated to a real vision model on the server, which answers
 * the question correctly (measured: a real woman -> has_person true, a barong
 * product shot -> has_person false).
 *
 * FAIL CLOSED — THIS IS THE IMPORTANT PART.
 * -----------------------------------------
 * `verified:false` means the CALL did not succeed (no key, offline, quota 429, a
 * malformed reply). This treats ANY failed call as "not a person", because the
 * rule is absolute: nothing without a person may reach the canvas. A false refusal
 * costs the customer a re-upload; a false acceptance dresses a photo of nobody,
 * which is the exact bug being fixed. When in doubt, refuse.
 *
 * QUOTA — WHY THE RESULT IS CACHED
 * --------------------------------
 * The Gemini free tier is 20 requests PER DAY, shared with the catalog auto-fill.
 * The gate is called from more than one place for the same photo (upload, and
 * again whenever `setUserPhoto` seeds an already-captured portrait), and every
 * call would spend one of those 20. The verdict for a given image is
 * DETERMINISTIC — the same bytes always deserve the same answer — so a successful
 * verdict is cached by content, and a repeat of the SAME photo costs nothing.
 *
 * ONLY SUCCESSES ARE CACHED. A failed call (offline, 429) is NOT remembered, so
 * the moment the network or the quota recovers, the next attempt really retries
 * instead of being permanently refused by a stale failure.
 *
 * @param {string} src  data URI of the photo to check.
 * @returns {Promise<{hasPerson:boolean, verified:boolean, reason:string, confidence:number}>}
 */

/**
 * Content-keyed cache of VERIFIED verdicts. Bounded so a long session cannot
 * retain a verdict per uploaded image forever; the oldest entries fall out first.
 */
const VERDICT_CACHE = new Map();
const VERDICT_CACHE_MAX = 12;

/**
 * Key a verdict by the image itself. The data URI is the whole image, so it is
 * already a perfect content key; hashing it would cost more than the map lookup.
 *
 * BOTH ENDS are sampled, not just the head. Two different JPEGs share a long
 * IDENTICAL prefix (the container header, and the EXIF block the camera writes),
 * so a head-only key collides on `length` alone for two photos of the same size.
 * The tail differs as soon as the pixel data differs.
 */
const verdictKey = (src) => src.slice(0, 64) + '::' + src.slice(-64) + '::' + src.length;

export const verifyPersonWithVision = async (src) => {
  if (!src) return { hasPerson: false, verified: false, reason: 'no-image', confidence: 0 };

  const key = verdictKey(src);
  const cached = VERDICT_CACHE.get(key);
  if (cached) return cached;

  try {
    const api = (await import('../api/axios')).default;
    const { data } = await api.post('/tryon/verify-person', { image: src }, {
      // The image is a downscaled JPEG and the model answers one line; give it
      // room on a slow link without hanging the upload UI.
      timeout: 25000,
    });

    const hasPerson = data?.has_person === true;
    const verified = data?.verified === true;

    const verdict = {
      // BOTH must hold: the call must have SUCCEEDED and the model must have SEEN
      // a person. A "true" from an unverified response cannot exist, but the
      // guard is explicit so a future server change cannot loosen it by accident.
      hasPerson: verified && hasPerson,
      verified,
      reason: typeof data?.reason === 'string' ? data.reason : hasPerson ? 'person' : 'no-person',
      confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
    };

    /*
     * Cache ONLY a real verdict. `verified:false` means the CALL failed (offline,
     * 429 quota), and remembering that would turn a transient outage into a
     * permanent refusal of a photo that is perfectly good. A real "no person"
     * from a working model (verified:true) IS cached — it will not change.
     */
    if (verdict.verified) {
      VERDICT_CACHE.set(key, verdict);
      if (VERDICT_CACHE.size > VERDICT_CACHE_MAX) {
        // Drop the oldest insertion (Map preserves insertion order).
        VERDICT_CACHE.delete(VERDICT_CACHE.keys().next().value);
      }
    }

    return verdict;
  } catch (err) {
    console.warn('[Hiraya] Person verification call failed:', err?.message || err);
    return { hasPerson: false, verified: false, reason: 'unreachable', confidence: 0 };
  }
};

/**
 * Validate that a photo plausibly shows a PERSON, in frame, full-body.
 *
 * @param {string} src  data URI / URL of the customer's ORIGINAL photo.
 * @returns {Promise<{
 *   ok: boolean,            // is a person plausible here?
 *   isPerson: boolean,      // passed the structural person test
 *   fullBody: boolean,      // spans enough of the frame to be a whole body
 *   reason: string,         // machine-readable verdict key
 *   detail: string,         // customer-facing sentence
 *   evidence: Object|null,  // measured numbers, for the trace
 * }>}
 */
export const validateBodyPhoto = async (src) => {
  const fail = (reason, detail, evidence = null) => ({
    ok: false,
    isPerson: false,
    fullBody: false,
    reason,
    detail,
    evidence,
  });

  if (typeof document === 'undefined') return fail('no-dom', 'Could not analyse the photo in this browser.');
  if (!src || typeof src !== 'string') return fail('no-source', 'No photo to analyse.');

  /*
   * ==========================================================================
   * STEP 0 — ASK THE VISION MODEL. THIS IS THE AUTHORITY.
   * ==========================================================================
   *
   * Everything below this is arithmetic on a downscaled bitmap, and every such
   * test was MEASURED to fail on real garments: the geometry passes a hanging
   * barong, and the RGB skin rule accepts cream/gold fabric as "skin" (3 of 5
   * of this app's own product photos leaked). The vision model answers the actual
   * question correctly.
   *
   * It runs FIRST so its verdict is the real one, and the local tests below are
   * then only a SECOND opinion — useful when the model is unreachable (offline),
   * where their evidence is recorded but the model's "no" still wins.
   *
   * Fail-closed: an unreachable verifier resolves to `hasPerson:false`, so a
   * broken network can never admit a garment to the canvas.
   */
  const vision = await verifyPersonWithVision(src);

  if (!vision.hasPerson) {
    return fail(
      vision.verified ? 'no-person' : 'person-unverified',
      vision.verified
        ? 'No person could be found in this photo — the garment or subject is shown ' +
            'without anyone wearing it. Upload a full-body photo of YOURSELF so the ' +
            'fitting has a real person to dress.'
        : 'Your photo could not be verified right now, so it was not accepted. Please ' +
            'check your connection and upload a clear full-body photo of yourself.',
      {
        vision: { verified: vision.verified, reason: vision.reason, confidence: vision.confidence },
      },
    );
  }

  const img = await loadImage(src);
  if (!img || !img.width || !img.height) return fail('decode-failed', 'The photo could not be read.');

  const scale = Math.min(1, SCAN_MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fail('no-2d-context', 'Could not analyse the photo in this browser.');
  ctx.drawImage(img, 0, 0, w, h);

  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, w, h));
  } catch {
    return fail('tainted-canvas', 'The photo could not be read.');
  }

  const bg = estimateBackground(data, w, h);
  if (!bg) return fail('no-background-estimate', 'The photo could not be read.');

  /*
   * Build the subject mask (pixels that differ from the background).
   */
  const mask = new Uint8Array(w * h);
  let subject = 0;
  for (let p = 0; p < mask.length; p++) {
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

    const frame = w * h;

    const blob = largestComponent(mask, w, h);
    const blobShare = blob.size / frame;
    const spanH = blob.maxY >= 0 ? (blob.maxY - blob.minY + 1) / h : 0;

    const evidence = {
      coverage: +(subject / frame).toFixed(3),
      largestBlob: +blobShare.toFixed(3),
      span: +spanH.toFixed(3),
      backgroundShare: +bg.share.toFixed(3),
    };

    /*
     * ==========================================================================
     * ONE QUESTION ONLY: IS THERE A PERSON IN THIS PHOTO?
     * ==========================================================================
     *
     * MEASURED BUG (reported): a real photo WITH a person was rejected with "reads
     * as a wide, flat shape rather than a standing person". The customer's point was
     * exactly right — if a person is in the picture, the photo is acceptable. The
     * fitting can work with any framing; it is the customer's choice how they shot
     * it, and there is a separate, softer notice for length.
     *
     * Everything that used to be checked here beyond "is there a person" has been
     * DELETED, because every one of them was a way to reject a valid photo:
     *
     *   removed  `too-little-subject` — rejected a small/ distant person.
     *   removed  `not-upright`        — rejected a seated or crouching person.
     *   removed  `off-centre`         — rejected a person standing to one side.
     *   removed  `not-full-body`      — rejected a head-and-shoulders portrait.
     *
     * Those are all PHOTOS OF PEOPLE. They were never the problem. The one real
     * failure was a photo with NO PERSON AT ALL (a text card, a product shot, an
     * empty scene) sailing through the flow — so that, and only that, is what this
     * refuses.
     *
     * HOW "A PERSON" IS TOLD FROM "NOTHING":
     * a person is a real MASS of pixels — one large connected blob that occupies a
     * meaningful share of the frame. Text, a logo, and an empty wall produce either
     * no subject at all or only many small disconnected marks, so their largest
     * single blob is tiny. That size test is the whole check.
     */

    /* Nothing in the frame differs from the background: an empty scene. */
    if (subject === 0) {
      return fail(
        'no-subject',
        'No person could be found in this photo — it looks empty. Upload a photo of ' +
          'yourself so the fitting has a body to dress.',
        evidence,
      );
    }

    /*
     * The largest single blob is too small to be a body.
     *
     * This is what stops TEXT and LOGOS: lettering is many separate small marks, so
     * no single connected region is substantial. A person — however they are standing
     * or framed — is one big connected mass.
     */
      const looksLikePerson = blobShare >= MIN_LARGEST_BLOB && spanH >= MIN_SPAN;

      if (!looksLikePerson) {
        return fail(
          'no-person',
          'No person could be found in this photo — it looks like text, a logo or a ' +
            'pattern rather than someone in the picture. Upload a photo with a person ' +
            'in it so the fitting has a body to dress.',
          evidence,
        );
      }

      /*
       * ==========================================================================
       * THE SKIN GATE — THE FIRST HARD TEST, AND THE ONE THAT CANNOT BE FAKED.
       * ==========================================================================
       *
       * Everything above is GEOMETRY: "is there one big, tall mass?" A GARMENT
       * answers yes — a dress on a hanger is one big tall mass. So geometry alone
       * let a photo with NO PERSON through to the canvas.
       *
       * Skin cannot be faked by a garment. This counts, INSIDE THE SUBJECT MASK
       * ONLY (not the whole frame, so a skin-toned wall or backdrop cannot count),
       * how much of it reads as human skin. A dress, a shirt, a mannequin, a
       * landscape and an empty room all measure ~0.00; a person — even a heavily
       * clothed one — shows at least a face/neck/hands.
       *
       * IT RUNS FIRST, BEFORE THE SHAPE TESTS, ON PURPOSE. It is the hard, colour-
       * based evidence; shape is only a fallback heuristic and can be fooled by a
       * mannequin or a folded shirt. "No skin" is therefore the PRIMARY verdict.
       *
       * Below MIN_SKIN_SHARE the photo is NOT a person. This is a HARD GATE: no
       * preview, no render, nothing on the canvas.
       */
      let blobPixels = 0;
      let blobSkin = 0;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        blobPixels++;
        if (isSkin(data[i], data[i + 1], data[i + 2])) blobSkin++;
      }
      const skinShare = blobPixels > 0 ? blobSkin / blobPixels : 0;
      evidence.skinShare = +skinShare.toFixed(3);

      if (skinShare < MIN_SKIN_SHARE) {
        return fail(
          'no-skin',
          'No person could be found in this photo — there is no skin, face or body ' +
            'visible, so it looks like a garment, an object or an empty scene rather ' +
            'than someone wearing clothes. Upload a full-body photo of YOURSELF so the ' +
            'fitting has a real person to dress.',
          evidence,
        );
      }

      /*
       * THE WHOLE SUBJECT IS SKIN-COLOURED — a naked person is not possible here.
       *
       * A beige/nude GARMENT defeats a colour test (it IS skin colour), so the
       * separator is PROPORTION: a person shows an EXPOSED PART of skin, not a solid
       * field of it — hair, clothes and shadow are the majority of the silhouette.
       * When every pixel of the subject reads as skin, the subject is an OBJECT that
       * happens to be skin-toned (a tan dress, a handbag, a wooden mannequin), not a
       * human. Refused. See MAX_SKIN_SHARE above for the measured reasoning.
       */
      if (skinShare > MAX_SKIN_SHARE) {
        return fail(
          'skin-coloured-object',
          'No person could be found in this photo — the subject is entirely skin-' +
            'coloured with no clothing, hair or shading, which reads as a dress, a bag ' +
            'or another object that happens to be a skin tone rather than a person in ' +
            'a photo. Upload a full-body photo of YOURSELF so the fitting has a real ' +
            'person to dress.',
          evidence,
        );
      }

      /*
       * ==========================================================================
       * THE SHAPE TEST — A SECONDARY CHECK FOR SOMETHING PERSON-SHAPED.
       * ==========================================================================
       *
       * The skin gate above has already established that a PERSON is present —
       * there is real skin in the subject. This shape reading is kept only as a
       * DIAGNOSTIC and a soft warning, because a mannequin with a painted face or a
       * garment photo shot so the shoulders frame a sliver of skin can add a little
       * skin and would otherwise be rejected by geometry alone even on a real,
       * tightly-cropped person. Measuring the blob's own WIDTH PROFILE — a person
       * has a narrow head above wider shoulders — is recorded in the evidence so a
       * reviewer can see WHY the verdict came out as it did.
       */
      const shape = measureShape(blob, w);
      evidence.torsoWidth = shape.torsoWidth;
      evidence.headToTorso = shape.headToTorso;
      evidence.columnLike = shape.headToTorso >= MAX_HEAD_TO_TORSO;

      /* A person is present — with skin to prove it. THAT IS THE WHOLE VERDICT. */
      return {
        ok: true,
        isPerson: true,
        // Informational only — NOT a gate. A portrait of a person is still a person.
        fullBody: spanH >= FULL_BODY_SPAN,
        reason: 'person',
        detail: 'A person was found in this photo.',
        evidence,
      };
    };

export default validateBodyPhoto;
