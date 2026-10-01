/**
 * framePresets — the OCCASION-AWARE catalog backgrounds.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The catalog image used to be drawn onto ONE fixed frame: an obsidian-black
 * canvas with gold ornamental borders, identical for every product in the shop.
 * The AI already tags each garment with an occasion/vibe (`summer`, `formal`,
 * `cultural`, …) and the backend already canonicalises it
 * (`App\Services\OccasionBackgroundResolver`), but that key was thrown away and
 * the same black card was drawn for a linen summer dress and a barong.
 *
 * Now the occasion IS the background selector. Each preset is DRAWN IN CODE —
 * there is no uploaded background asset, so the card stays pixel-consistent,
 * costs no extra network request, and still works with the console offline.
 *
 * THE PALETTE RULES THAT MATTER
 * -----------------------------
 * 1. NO RANDOMNESS. Same garment + same occasion => same background, so an
 *    image never mysteriously changes between saves. The rule is enforced by
 *    keeping every preset a pure constant (no rotation, no shuffle).
 * 2. A DARK GARMENT ON A DARK FRAME DISAPPEARS. This is the same "black on
 *    black" separation failure already documented in `extractGarment.js`: the
 *    frame's artwork and a black barong are the same tone, so the alpha edge
 *    that makes the garment readable is the only thing left. Every preset
 *    therefore carries a `light` flag, and `pickFramePreset` will NOT return a
 *    dark surface for a dark garment — it escalates to a light tint instead.
 * 3. THE FRAME NEVER CARRIES A WORDMARK. The storefront already prints the
 *    product name directly beneath the image; stamping it twice looked like a
 *    bug. See `drawFrame`'s note in `garmentCompositor.js`.
 *
 * MIRRORED ON THE BACKEND
 * -----------------------
 * The keys below are the SAME keys as `config/hiraya_backgrounds.php`'s
 * `occasions` map, which is what `OccasionBackgroundResolver` canonicalises AI
 * output into. Change one and you must change the other.
 */

/** Canvas size the presets are authored against (the compositor's output). */
export const PRESET_FRAME_SIZE = { width: 1000, height: 1250 };

/**
 * The single fallback when neither the AI's occasion nor the garment category
 * yields anything usable. Kept as a string (not a preset) so there is exactly
 * ONE definition of the default — here — mirroring `hiraya_backgrounds.default`.
 */
export const DEFAULT_PRESET_KEY = 'everyday';

/**
 * ONE preset per canonical occasion key.
 *
 * `base`       flat fill for the canvas.
 * `vignette`   the colour the radial gradient fades to behind the garment.
 * `accent`     the primary border rule — must read clearly ON `base`.
 * `accentSoft` the inner hairline and the corner filigree.
 * `panel`      an optional soft shape behind the garment. It is what actually
 *              carries the "vibe": a warm arc for summer, a deep keyline for
 *              cultural, a horizon band for the everyday card. Drawn FIRST,
 *              under the vignette, so it never competes with the garment.
 * `light`      true when `base` is a LIGHT surface. Drives the contrast guard.
 * `scene`      the THEME IMAGE painted behind the garment (an office, a beach,
 *              a ballroom…). Files live in `public/backgrounds/`; drop a real
 *              photo in with the same name (or point this at a .jpg) to replace
 *              an illustration. When it cannot load, the colour card is drawn.
 *              `base` is the scene's dominant tone, used for letterbox tiles.
 */
const SCENE_DIR = '/backgrounds';

export const FRAME_PRESETS = {
  summer: {
    label: 'Summer',
    scene: `${SCENE_DIR}/summer.svg`,
    base: '#FFF3E2',
    vignette: '#FFE3C0',
    accent: '#E8A33D',
    accentSoft: '#F2C98A',
    panel: 'arc',
    light: true,
  },
  cultural: {
    label: 'Cultural / Traditional',
    scene: `${SCENE_DIR}/cultural.svg`,
    base: '#3A2418',
    vignette: '#4A2A20',
    accent: '#D8A45E',
    accentSoft: '#F0D2A4',
    panel: 'keyline',
    light: false,
  },
  formal: {
    label: 'Formal / Evening',
    scene: `${SCENE_DIR}/formal.svg`,
    base: '#1E1830',
    vignette: '#2C2247',
    accent: '#C9B7E8',
    accentSoft: '#EADFF9',
    panel: 'keyline',
    light: false,
  },
  business: {
    label: 'Business / Office',
    scene: `${SCENE_DIR}/business.svg`,
    base: '#E6EAF0',
    vignette: '#DDE3EC',
    accent: '#5A6B85',
    accentSoft: '#A8B4C7',
    panel: 'horizon',
    light: true,
  },
  streetwear: {
    label: 'Streetwear / Urban',
    scene: `${SCENE_DIR}/streetwear.svg`,
    base: '#26262C',
    vignette: '#33333C',
    accent: '#8E8E9C',
    accentSoft: '#C7C7D2',
    panel: 'keyline',
    light: false,
  },
  everyday: {
    label: 'Everyday / Casual',
    scene: `${SCENE_DIR}/everyday.svg`,
    base: '#F4ECE0',
    vignette: '#EFE6D8',
    accent: '#B08A54',
    accentSoft: '#DCC7A4',
    panel: 'horizon',
    light: true,
  },
};

/**
 * Garment category -> occasion key, used only when the AI returned no usable
 * occasion. Mirrors the historical `OccasionBackgroundResolver` docblock,
 * which resolved "an AI-detected occasion (or a garment category)".
 *
 * Categories are the closed set validated in `ProductRequest` / the AI prompt:
 * TOPS, BOTTOMS, DRESSES, OUTERWEAR, FORMAL_MEN, FORMAL_WOMEN, FULL_BODY.
 */
const CATEGORY_FALLBACK = {
  TOPS: 'everyday',
  BOTTOMS: 'business',
  DRESSES: 'formal',
  OUTERWEAR: 'everyday',
  // Men's formal is suits and tuxedos — the store files those under the
  // Business / Office look. Gowns (FORMAL_WOMEN) stay on the evening scene.
  FORMAL_MEN: 'business',
  FORMAL_WOMEN: 'formal',
  FULL_BODY: 'formal',
};

/**
 * GARMENT WORDS -> THEME, for the product NAME and DESCRIPTION.
 *
 * The occasion aliases below only know occasion words ("office", "beach"), but
 * a product is usually named after the GARMENT ("Black Tuxedo", "Khaki Polo").
 * With no garment vocabulary those names fell through to the category, which is
 * why a tuxedo landed on the wrong background. `toxido` / `tuxido` are the
 * spellings actually used in this catalog.
 */
const GARMENT_WORDS = {
  summer: ['sundress', 'sun dress', 'shorts', 'board shorts', 'tank top', 'sando', 'swimsuit', 'swimwear', 'bikini',
    'hawaiian', 'aloha', 'floral', 'linen', 'sarong', 'kaftan', 'romper', 'sandals'],
  cultural: ['barong', 'barong tagalog', 'filipiniana', 'terno', 'baro t saya', 'maria clara', 'kimona', 'malong',
    'patadyong', 'inabel', 'jusi', 'pina', 'camisa de chino'],
  formal: ['gown', 'evening gown', 'ball gown', 'cocktail dress', 'prom dress', 'sequin', 'sequined'],
  business: ['tuxedo', 'toxido', 'tuxido', 'suit', 'suits', 'blazer', 'slacks', 'trousers', 'polo', 'polo shirt',
    'necktie', 'dress shirt', 'button down', 'chinos', 'vest', 'waistcoat', 'pencil skirt', 'office wear'],
  streetwear: ['hoodie', 'sweatshirt', 'joggers', 'cargo', 'cargo pants', 'graphic tee', 'bomber', 'denim jacket',
    'oversized', 'sneakers', 'track jacket', 'varsity jacket', 'bucket hat'],
  everyday: ['t shirt', 'tshirt', 'tee', 'shirt', 'jeans', 'cardigan', 'sweater', 'henley', 'leggings', 'basic tee'],
};

/**
 * Lowercase match tokens per occasion, so an AI answer phrased its own way
 * ("Beach Wear", "beachwear", "resort") still lands on `summer`. This is the
 * frontend mirror of the `aliases` in `config/hiraya_backgrounds.php` — the
 * backend canonicalises first, so this is the second line of defence.
 */
const ALIASES = {
  summer: ['summer', 'beach', 'beachwear', 'beach wear', 'vacation', 'resort', 'tropical', 'swim', 'pool'],
  cultural: ['cultural', 'traditional', 'filipiniana', 'barong', 'ethnic', 'heritage', 'tribal', 'native'],
  formal: ['formal', 'evening', 'gala', 'black tie', 'wedding', 'cocktail', 'prom', 'semi formal', 'party'],
  business: ['business', 'office', 'work', 'corporate', 'professional', 'interview', 'business casual', 'smart casual'],
  streetwear: ['street', 'streetwear', 'urban', 'street style', 'hip hop', 'skate', 'grunge'],
  everyday: ['everyday', 'every day', 'casual', 'daily', 'weekend', 'lounge', 'relaxed', 'basic', 'errand', 'minimalist'],
};

const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Exact alias hit, else first containment hit, else null. Mirrors the PHP. */
const matchOccasionKey = (raw) => {
  const needle = normalise(raw);
  if (!needle) return null;

  let containsMatch = null;
  for (const key of Object.keys(FRAME_PRESETS)) {
    for (const alias of ALIASES[key] ?? []) {
      if (needle === alias) return key;               // exact always wins
      if (!containsMatch && needle.includes(alias)) containsMatch = key;
    }
  }
  return containsMatch;
};

/**
 * Resolve the occasion key for a garment: AI occasion first, then the garment
 * category, then the single default. Always returns a real preset key.
 *
 * @param {string|string[]|null} occasion  the AI's occasion answer (string or array)
 * @param {string|null}         category   the AI's garment category
 * @returns {string} a key of FRAME_PRESETS
 */
export const resolveOccasionKey = (occasion, category = null) => {
  // An array: the AI lists the most relevant first, so honour that order.
  const list = Array.isArray(occasion) ? occasion : [occasion];
  for (const entry of list) {
    const key = matchOccasionKey(entry);
    if (key) return key;
  }

  const byCategory = CATEGORY_FALLBACK[normalise(category).toUpperCase()];
  if (byCategory) return byCategory;

  return DEFAULT_PRESET_KEY;
};

/** True when `key` names a real preset (i.e. a value the admin may pick). */
export const isThemeKey = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(FRAME_PRESETS, key);

/**
 * Word-bounded alias match for FREE TEXT (a product name or description).
 *
 * `matchOccasionKey` uses plain containment, which is right for the AI's short
 * occasion tags but wrong for prose: "network" would contain "work" and
 * "Liverpool" would contain "pool". Here an alias only counts when it appears as
 * whole words, so a description can steer the theme without false hits.
 */
const matchThemeInText = (text) => {
  const haystack = ` ${normalise(text)} `;
  if (haystack.trim() === '') return null;

  /*
   * THE MOST SPECIFIC WORD WINS, not the first theme in the list. "Dress Shirt"
   * must be Business (the longer "dress shirt"), not Everyday ("shirt"); a plain
   * first-hit loop let whichever theme came first in key order claim it.
   * Ties go to key order, so the result stays deterministic.
   *
   * A GARMENT word outranks an occasion word: "Tuxedo — Black Tie" names the
   * garment (a tuxedo -> Business / Office) and merely mentions a dress code.
   */
  let best = null;
  let bestScore = 0;
  for (const key of Object.keys(FRAME_PRESETS)) {
    const candidates = [
      ...(ALIASES[key] ?? []).map((word) => [word, word.length]),
      ...(GARMENT_WORDS[key] ?? []).map((word) => [word, 100 + word.length]),
    ];
    for (const [word, score] of candidates) {
      if (score > bestScore && haystack.includes(` ${word} `)) {
        best = key;
        bestScore = score;
      }
    }
  }
  return best;
};

/**
 * THE BACKGROUND THEME FOR A PRODUCT, FROM THE DETAILS THE ADMIN SAVED.
 *
 * Order, strongest intent first:
 *   1. the theme the admin picked explicitly in the form,
 *   1b. the AI's `background_vibe` read from the photo,
 *   2. the product NAME (short and deliberate — "Summer Linen Dress"),
 *   3. the AI's occasion tags,
 *   4. the description,
 *   5. the category fallback, then the single default.
 *
 * Deterministic, so the same details always give the same background.
 *
 * @returns {string} a key of FRAME_PRESETS
 */
export const resolveThemeKey = ({ override = null, vibe = null, name = '', occasions = null, description = '', category = null } = {}) => {
  if (isThemeKey(override)) return override;

  // The scene the AI picked from the photo itself (`background_vibe`).
  if (isThemeKey(vibe)) return vibe;

  const byName = matchThemeInText(name);
  if (byName) return byName;

  const occasionList = (Array.isArray(occasions) ? occasions : [occasions]).filter(Boolean);
  for (const entry of occasionList) {
    const key = matchOccasionKey(entry);
    if (key) return key;
  }

  const byDescription = matchThemeInText(description);
  if (byDescription) return byDescription;

  return resolveOccasionKey(null, category);
};

/**
 * The flat surface colour of a product's catalog card, for the tile BEHIND it.
 *
 * Storefront tiles letterbox the 4:5 card with `object-contain`; the tile used to
 * be hard-coded black because every card was black. A cream Summer card on a
 * black tile shows black bars, so the tile takes the card's own base colour.
 * Products saved before themes existed have no `background_occasion` and still
 * carry the legacy black card, so they keep black.
 */
export const themeSurfaceFor = (product) => {
  const key = product?.background_occasion;
  return isThemeKey(key) ? FRAME_PRESETS[key].base : '#000000';
};

/**
 * Measure a cut-out's mean luminance (0..255) over its OPAQUE pixels only.
 * Transparent padding must not count, or a cut-out with a lot of empty margin
 * would read as "light" and get a light frame — which is exactly the bug this
 * guards against.
 */
export const meanLuminance = (img) => {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return 128;

  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  if (!pctx) return 128;
  pctx.drawImage(img, 0, 0);

  // ONE read for the whole image. Sampling per pixel would mean a getImageData
  // call inside the loop, which is O(w*h) allocations and freezes the tab.
  let data;
  try {
    data = pctx.getImageData(0, 0, w, h).data;
  } catch {
    return 128; // tainted canvas — treat as mid-grey and stay safe
  }

  let sum = 0;
  let counted = 0;
  const step = Math.max(1, Math.round(Math.min(w, h) / 160)); // bounded sample
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= 16) continue; // transparent padding is NOT fabric
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      counted += 1;
    }
  }
  return counted > 0 ? sum / counted : 128;
};

/**
 * THE CONTRAST GUARD.
 *
 * Picks the preset for a garment, escalating away from a dark surface when the
 * garment is itself dark, so a black barong on the cultural card keeps the
 * alpha edge that makes it readable. The escalation is deterministic: the same
 * cut-out always lands on the same preset, so re-running never silently
 * changes the background.
 *
 * @param {string|string[]|null} occasion
 * @param {string|null}         category
 * @param {HTMLImageElement|HTMLCanvasElement|null} [garment] measured for luminance
 * @param {boolean} [strict] true when the ADMIN picked this theme by hand: their
 *                           choice is honoured and the guard does not override it.
 * @returns {{ key: string, preset: Object, guarded: boolean }}
 */
export const pickFramePreset = (occasion, category = null, garment = null, strict = false) => {
  const key = resolveOccasionKey(occasion, category);
  const chosen = FRAME_PRESETS[key];

  // No garment to measure, or a light garment on a light frame already: fine.
  if (!garment || strict) return { key, preset: chosen, guarded: false };
  if (meanLuminance(garment) >= 96) return { key, preset: chosen, guarded: false };

  // Dark garment. If the chosen frame is light there is nothing to fix.
  if (chosen.light) return { key, preset: chosen, guarded: false };

  /*
   * Dark garment on a dark scene. The THEME IS KEPT — swapping a black tuxedo's
   * ballroom for a beach (the old escalation) is exactly the "wrong theme" bug.
   * `guarded` instead tells the painter to lift a soft light halo behind the
   * garment, which restores the edge without changing the scene.
   */
  return { key, preset: chosen, guarded: true };
};
