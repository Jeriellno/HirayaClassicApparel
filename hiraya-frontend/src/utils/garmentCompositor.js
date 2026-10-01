/**
 * garmentCompositor — STAGE 1 of the two-stage garment pipeline.
 *
 * Produces the catalog image every garment shares:
 *   1. cuts the garment out of the admin's photo (in-browser WASM engine via
 *      `removeImageBackground`),
 *   2. CLEANS that cut-out (`cleanCutoutMatte`) so only the garment remains — the
 *      engine's mask can still carry the product-name script, a logo and small
 *      leftover backdrop patches, all of which are erased here,
 *   3. picks the OCCASION background the AI tagged the garment with and draws
 *      the cut-out centred on it (one preset per vibe, plus a contrast guard so
 *      a dark garment never lands on a dark frame),
 *   4. returns the composite as a PNG Blob + object URL.
 *
 * THE BACKGROUND FOLLOWS THE OCCASION. It used to be one obsidian-black canvas
 * with gold ornamental borders for every product in the shop, which made a linen
 * summer dress and a midnight barong look like the same shoot. The AI already
 * tags each garment with an occasion/vibe and the backend already canonicalises
 * it, so the key is now spent on the background instead of being discarded. The
 * selection is deterministic: same garment + same occasion => same background.
 *
 * WHY CANVAS AND NOT THE AI: cutting out then compositing keeps the garment
 * pixel-perfect. Asking a generative model to "redraw" the garment risks
 * changing the product itself, which is unacceptable for a catalog.
 */

import { removeImageBackground } from './removeBackground';
import { pickFramePreset, DEFAULT_PRESET_KEY, FRAME_PRESETS } from './framePresets';

/** Output size of the composed catalog image (portrait catalog ratio). */
const OUTPUT_WIDTH = 1000;
const OUTPUT_HEIGHT = 1250;

/**
 * Fraction of the canvas the garment may occupy (keeps a premium margin).
 *
 * RAISED from 0.74. On a real catalog card the cut-out sat noticeably small in
 * the frame, so the garment now fills more of the display area — still inside
 * the ornamental border, with a premium margin all round.
 */
const MAX_GARMENT_SCALE = 0.88;

/**
 * THE LEGACY PALETTE — kept only so the "obsidian + gold" card can still be
 * produced on purpose (an explicit `occasion: 'hiraya-legacy'`). Every normal
 * product now lands on an occasion preset from `framePresets.js`.
 *
 * This is the single frame the catalog used to draw for EVERY garment, and it
 * is the "black with a gold border" look the brief asked to replace.
 */
const FRAME = {
  background: '#000',
  vignette: '#161616',
  gold: '#FBE8CE',
  goldSoft: '#F7F1DE',
};

/**
 * The preset a product falls back to when nothing at all is known about it.
 * Chosen to be a light surface so the majority of garments (light, summer and
 * everyday fabric) read well on it and the contrast guard rarely has to fire.
 */
const FALLBACK_FRAME = {
  key: DEFAULT_PRESET_KEY,
  label: FRAME_PRESETS[DEFAULT_PRESET_KEY].label,
  base: FRAME_PRESETS[DEFAULT_PRESET_KEY].base,
  vignette: FRAME_PRESETS[DEFAULT_PRESET_KEY].vignette,
  accent: FRAME_PRESETS[DEFAULT_PRESET_KEY].accent,
  accentSoft: FRAME_PRESETS[DEFAULT_PRESET_KEY].accentSoft,
  panel: FRAME_PRESETS[DEFAULT_PRESET_KEY].panel,
  light: FRAME_PRESETS[DEFAULT_PRESET_KEY].light,
};

/** Load an image element from any URL / data URI / blob URL. */
const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });

/**
 * Crop an image to its OPAQUE bounds and return a canvas of exactly that region.
 *
 * Used to trim the try-on matte: the background-removal engine returns the
 * original frame size with the transparent margin still in it, and the try-on
 * measures fabric per row, so leftover padding would be measured as garment.
 *
 * Returns null when the image has no opaque pixels (nothing to trim to), so the
 * caller can fall back rather than emit an empty PNG.
 */
const trimToOpaqueBounds = (img) => {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0);

    const { data } = pctx.getImageData(0, 0, w, h);
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) {
        if (data[(base + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0 || maxY < 0) return null;

    const outW = maxX - minX + 1;
    const outH = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    out.getContext('2d').drawImage(img, minX, minY, outW, outH, 0, 0, outW, outH);
    return out;
  } catch {
    return null;
  }
};

/**
 * CLEAN THE CUT-OUT: keep ONLY the garment, drop leftover text and stray
 * background patches.
 *
 * WHY THIS EXISTS
 * ---------------
 * `removeImageBackground` runs a neural matting model. It is good at separating
 * the SUBJECT from the backdrop, but its mask is semantic, not pixel-exact. On a
 * real garment photo that means the cut-out regularly still carries:
 *
 *   - the product-name SCRIPT / brand TEXT that sits over the backdrop (the
 *     model treats a label as part of the subject),
 *   - the logo or watermark printed on the backdrop,
 *   - small disconnected BACKDROP PATCHES the model failed to clear (a stripe of
 *     wall, a speckle near the edge).
 *
 * Compositing that raw mask is exactly why the admin's card showed bits of the
 * original background and the garment's own caption on top of the HIRAYA frame.
 * This pass removes them BEFORE the frame is drawn.
 *
 * HOW (all offline, on a canvas — no model, no network)
 * ----------------------------------------------------
 * The previous version kept the largest connected mass and rejected small
 * blobs. Measured against real admin uploads that was too weak: it let residue
 * through in four ways, each now handled explicitly.
 *
 *   a. GLYPH FRAGMENTS. One caption breaks into many components, because
 *      anti-aliased stems fall below the alpha floor. Judged ALONE against a
 *      4 %-of-garment size gate each fragment looks like harmless noise — yet
 *      together they spell the product name. They are now MERGED into one
 *      logical block (`groupBlocks`) before any decision is made.
 *
 *   b. TOP-BAND BLIND SPOT. Text was only rejected inside the top 16 % of the
 *      frame AND only when smaller than 12 % of the garment, so a caption over
 *      a wide banner failed both gates and always survived. Text is now found
 *      by SHAPE (`looksLikeText`) at any height in the frame.
 *
 *   c. FRAGMENTED GARMENTS. A pale garment breaking into two comparable halves
 *      kept only the bigger half. Groups of similar size to the main mass are
 *      now kept as garment.
 *
 *   d. EDGE / HALO RESIDUE. A leftover backdrop strip hugging the frame border,
 *      and a thin halo reaching towards the subject, are both rejected — the
 *      latter by measuring how much of its own bounding box a group fills.
 *
 * A final `denoise` pass drops isolated pixels so nothing survives as a visible
 * speck on the HIRAYA frame.
 *
 * The thresholds mirror the measured values in `extractGarment.js` so the two
 * pipelines agree on what counts as fabric vs. artwork.
 *
 * @param {HTMLImageElement} img  the transparent cut-out from the removal engine.
 * @returns {HTMLCanvasElement|null} a cleaned copy, or null when it could not run
 *          (the caller then keeps the untouched cut-out rather than failing).
 */
/** 8-connected neighbourhood: a thin strap must not be split off its bodice. */
const NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * Label every opaque region at scan resolution and return per-region statistics.
 *
 * @param {Uint8Array} mask          per-pixel 1/0 opaque flags.
 * @param {number} sw @param {number} sh  scan dimensions.
 * @returns {Array<{members:number[],size:number,minX:number,minY:number,maxX:number,maxY:number}>}
 */
const labelComponents = (mask, sw, sh) => {
  const N = sw * sh;
  const seen = new Uint8Array(N);
  const stack = [];
  const components = [];

  for (let start = 0; start < N; start++) {
    if (!mask[start] || seen[start]) continue;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    const members = [];
    let minX = sw, minY = sh, maxX = -1, maxY = -1;

    while (stack.length) {
      const p = stack.pop();
      const x = p % sw;
      const y = (p - x) / sw;

      members.push(p);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let k = 0; k < NEIGHBOURS.length; k++) {
        const nx = x + NEIGHBOURS[k][0];
        const ny = y + NEIGHBOURS[k][1];
        if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
        const n = ny * sw + nx;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }

    components.push({ members, size: members.length, minX, minY, maxX, maxY });
  }

  return components;
};

/**
 * MERGE components that belong to one logical mass, WITHOUT widening the mask.
 *
 * A caption like "CULTURE MEETS STYLE" is many small components — one per stem —
 * and each one individually passes a "this is only noise" size test. Grouping by
 * near-neighbour bounding boxes recovers the caption as the single wide block it
 * visually is, so the size and shape gates below can actually see it and reject
 * it. This is what stops text surviving as a trail of dots.
 *
 * Only the GROUPING is inferred; membership is never extended. If two real
 * garment pieces are grouped by accident, keeping them is harmless — the failure
 * being guarded against is text surviving, not fabric being kept.
 *
 * @param {Array} components              raw connected components.
 * @param {number} sw @param {number} sh  scan dimensions.
 * @returns {Array} groups of `{ members, size, minX, minY, maxX, maxY }`.
 */
const groupBlocks = (components, sw, sh) => {
  if (components.length <= 1) return components;

  /*
   * Neighbourhood radius. Components whose bounding boxes are within this many
   * scan pixels of each other become one block. It scales with the frame so
   * behaviour is identical for a 400px and a 4000px upload — and is large enough
   * to bridge normal letter spacing while staying far smaller than the gap
   * between a garment and a detached backdrop patch.
   */
  const GAP = Math.max(2, Math.round(Math.min(sw, sh) * 0.02));

  const n = components.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    // Path compression so repeated lookups stay near-constant time.
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };

  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Sort by minX so the sweep below only tests nearby neighbours, not O(n²).
  const order = components.map((_, i) => i).sort((a, b) => components[a].minX - components[b].minX);

  for (let i = 0; i < order.length; i++) {
    const a = components[order[i]];
    for (let j = i + 1; j < order.length; j++) {
      const b = components[order[j]];

      // Everything past this point starts even further right — no overlap left.
      if (b.minX > a.maxX + GAP) break;

      const nearX = a.minX - GAP <= b.maxX && b.minX - GAP <= a.maxX;
      const nearY = a.minY - GAP <= b.maxY && b.minY - GAP <= a.maxY;
      if (nearX && nearY) union(order[i], order[j]);
    }
  }

  const byRoot = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let group = byRoot.get(root);
    if (!group) {
      group = { members: [], size: 0, minX: sw, minY: sh, maxX: -1, maxY: -1 };
      byRoot.set(root, group);
    }

    const c = components[i];
    group.members.push(...c.members);
    group.size += c.size;
    if (c.minX < group.minX) group.minX = c.minX;
    if (c.minY < group.minY) group.minY = c.minY;
    if (c.maxX > group.maxX) group.maxX = c.maxX;
    if (c.maxY > group.maxY) group.maxY = c.maxY;
  }

  return Array.from(byRoot.values());
};

/**
 * True when a group has the GEOMETRY of lettering / a brand mark rather than of
 * fabric. Deliberately shape-based so it works at any height in the frame and
 * for any script size — the old version's fixed "top 16 %" band was exactly what
 * let wide banners through.
 *
 * A caption is WIDE, SHORT, and mostly empty inside its bounding box (the gaps
 * within and between glyphs). A garment piece has bulk: a sleeve is long, a
 * bodice fills its box. Requiring BOTH the aspect and the fill test keeps
 * genuinely flat garment parts — a waistband, a belt — safe.
 */
const looksLikeText = (group) => {
  const w = group.maxX - group.minX + 1;
  const h = group.maxY - group.minY + 1;

  // A single row can never be a garment — always lettering or an edge.
  if (h <= 2) return true;

  const aspect = w / h;
  const fill = group.size / (w * h);

  // Wide + hollow -> a line of text (also catches a horizontal logo lockup).
  if (aspect >= 2.6 && fill < 0.30) return true;

  // Very wide and thin even when dense -> a banner / rule / underline.
  if (aspect >= 5 && h <= 12) return true;

  return false;
};

/**
 * A BRIDGE IS ONLY A FEW PIXELS WIDE — SO CUT IT AND SEE WHAT FALLS.
 *
 * WHY THE SHAPE AND SECTION TESTS STILL MISSED THE ARTWORK
 * -------------------------------------------------------
 * A flower sprig staged above a garment is usually NOT floating in clear air — it
 * rests ON the shoulder, and often a stem trails down onto the bodice. That single
 * contact point welds artwork and clothing into one 8-connected mass, and no test
 * that looks at blocks, bounding boxes or empty-row gaps can see a seam that
 * isn't there.
 *
 * It also defeats the section split: the two are joined by pixels, so there are
 * no empty rows between them and the block never separates. And the merge radius
 * is WIDER than the detach threshold (8px vs 6px on a 512px scan), so a near
 * neighbour is absorbed into `largest` before any gate can see it as separate.
 *
 * THE FIX — MORPHOLOGICAL OPENING.
 *
 * Opening = ERODE, then DILATE. Erosion shrinks every mass by a pixel on each
 * side, which severs any joint only a few pixels wide. Whatever survives erosion
 * is genuinely thick — fabric — because a flower's petals and a logo's thin
 * strokes are exactly what erosion destroys. Dilating the survivors by the same
 * amount grows them back to their original size, with no seam left.
 *
 * This is the one operation that separates objects joined by a thin contact
 * without guessing from proportions. It is also why it is applied to the GARMENT
 * and re-validated, not used as a blanket filter: the result is checked below and
 * discarded if it loses too much, so a thin or lacy garment degrades to the
 * original rather than to nothing.
 *
 * @param {Uint8Array} mask  the 0/1 mask to open, in place-safe copy form.
 * @param {number} sw @param {number} sh
 * @param {number} radius      erosion/dilation radius in scan pixels.
 * @returns {Uint8Array} a NEW mask.
 */
const openMask = (mask, sw, sh, radius) => {
  if (radius < 1) return mask.slice();

  // Erode: a pixel survives only if its whole (2r+1) neighbourhood is set. Done as
  // a separable min-filter (horizontal then vertical) so it stays O(N) rather
  // than O(N * r^2) on a 512px scan.
  const erode = (src) => {
    const tmp = new Uint8Array(src.length);
    const out = new Uint8Array(src.length);

    for (let y = 0; y < sh; y++) {
      const base = y * sw;
      for (let x = 0; x < sw; x++) {
        let ok = 1;
        for (let d = -radius; d <= radius && ok; d++) {
          const nx = x + d;
          if (nx < 0 || nx >= sw || !src[base + nx]) ok = 0;
        }
        tmp[base + x] = ok;
      }
    }

    for (let y = 0; y < sh; y++) {
      const base = y * sw;
      for (let x = 0; x < sw; x++) {
        let any = 0;
        for (let d = -radius; d <= radius && !any; d++) {
          const ny = y + d;
          if (ny >= 0 && ny < sh && tmp[ny * sw + x]) any = 1;
        }
        out[base + x] = any;
      }
    }
    return out;
  };

  // Dilate: the inverse — a pixel is set if ANY neighbour is set.
  const dilate = (src) => {
    const tmp = new Uint8Array(src.length);
    const out = new Uint8Array(src.length);

    for (let y = 0; y < sh; y++) {
      const base = y * sw;
      for (let x = 0; x < sw; x++) {
        let any = 0;
        for (let d = -radius; d <= radius && !any; d++) {
          const nx = x + d;
          if (nx >= 0 && nx < sw && src[base + nx]) any = 1;
        }
        tmp[base + x] = any;
      }
    }

    for (let y = 0; y < sh; y++) {
      const base = y * sw;
      for (let x = 0; x < sw; x++) {
        let any = 0;
        for (let d = -radius; d <= radius && !any; d++) {
          const ny = y + d;
          if (ny >= 0 && ny < sh && tmp[ny * sw + x]) any = 1;
        }
        out[base + x] = any;
      }
    }
    return out;
  };

  return dilate(erode(mask));
};

/**
 * Fraction of a group's own columns that actually contain opaque pixels.
 *
 * A real garment piece spans nearly every column of its bounding box. A halo or
 * a pair of thin tendrils reaching towards the garment covers only a few — this
 * is how "barely touching" residue is told apart from a sleeve.
 *
 * `sw` is passed in because a member is a flat index (`y * sw + x`) and only the
 * caller knows the scan width.
 *
 * @param {Object} group @param {number} sw  scan width.
 * @returns {number} 0..1 coverage ratio.
 */
const columnCoverage = (group, sw) => {
  const w = group.maxX - group.minX + 1;
  if (w <= 0) return 0;

  const seen = new Uint8Array(w);
  for (const p of group.members) {
    const x = p % sw;
    if (x >= group.minX && x <= group.maxX) seen[x - group.minX] = 1;
  }

  let covered = 0;
  for (let i = 0; i < w; i++) if (seen[i]) covered++;
  return covered / w;
};

/**
 * Remove isolated pixels from the keep-mask: a pixel survives only when at least
 * two of its 8 neighbours also survive. Kills the single-pixel speckle the alpha
 * threshold alone leaves behind, while never eroding a solid region.
 */
const denoise = (keep, sw, sh) => {
  const next = keep.slice();

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const p = y * sw + x;
      if (!keep[p]) continue;

      let neighbours = 0;
      for (let k = 0; k < NEIGHBOURS.length; k++) {
        const nx = x + NEIGHBOURS[k][0];
        const ny = y + NEIGHBOURS[k][1];
        if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
        if (keep[ny * sw + nx]) neighbours++;
      }

      if (neighbours < 2) next[p] = 0;
    }
  }

  return next;
};

/**
 * THE ROWS THAT REACH BOTH EDGES OF THE BLOCK, GROUPED INTO HORIZONTAL RUNS.
 *
 * WHY RUNS AND NOT SINGLE ROWS
 * ----------------------------
 * The first attempt tested one row at a time, using that row's own height. A row
 * is one pixel tall by definition, so the aspect ratio of ANY wide row came out
 * enormous and almost every row of a real garment was flagged as text — then the
 * restore-guard undid the whole thing and nothing was ever removed.
 *
 * A line of text is only identifiable as a line when its rows are considered
 * TOGETHER: several consecutive full-width rows stacked up, still much wider than
 * the stack is tall. A shoulder is also full-width, but the torso below it is not,
 * so a garment breaks the run long before the stack gets flat.
 *
 * @returns {Array<{ startRow:number, endRow:number, width:number, height:number }>}
 *          one entry per maximal run of full-width rows, in block-relative rows.
 */
const findFullWidthRuns = (rows, blockMinX, blockMaxX) => {
  const blockW = blockMaxX - blockMinX + 1;
  // A row counts as "full width" when it comes within this fraction of BOTH edges.
  const SLACK = Math.max(1, Math.round(blockW * 0.12));

  const runs = [];
  let runStart = -1;

  for (let r = 0; r <= rows.length; r++) {
    const row = rows[r];
    const isFull =
      row &&
      row.count > 0 &&
      row.minX - blockMinX <= SLACK &&
      blockMaxX - row.maxX <= SLACK;

    if (isFull) {
      if (runStart === -1) runStart = r;
      continue;
    }

    // The run ended at r-1 (or never started).
    if (runStart !== -1) {
      const endRow = r - 1;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let rr = runStart; rr <= endRow; rr++) {
        if (rows[rr].minX < minX) minX = rows[rr].minX;
        if (rows[rr].maxX > maxX) maxX = rows[rr].maxX;
      }
      runs.push({
        startRow: runStart,
        endRow,
        width: maxX - minX + 1,
        // The HEIGHT OF THE STACK, which is the only meaningful denominator.
        height: endRow - runStart + 1,
      });
      runStart = -1;
    }
  }

  return runs;
};

/**
 * Is a full-width run a LINE OF TEXT rather than part of the garment?
 *
 * A garment has no horizontal slice that is both nearly as wide as the whole
 * garment AND many times wider than it is tall. Shoulders are wide but the torso
 * below them is not; a sleeve and a bodice are tall and narrow; a skirt is tall.
 * The shape that is simultaneously very wide and very flat is a row of letters, an
 * underline, or a horizontal logo lockup.
 *
 * The ratio is 4:1 — deliberately strict, because a false positive here erases
 * real fabric, and a missed word is merely cosmetic.
 */
const isTextRun = (run, blockW) => {
  if (run.width < 8 || run.height < 1) return false;
  if (run.width / run.height < 4) return false;
  // The run must actually span the garment, not sit inside it.
  return run.width >= blockW * 0.75;
};

/**
 * ERASE TEXT PRINTED ACROSS THE GARMENT.
 *
 * THE CASE THE BLOCK-LEVEL GATES CANNOT CATCH.
 * --------------------------------------------
 * A caption or watermark laid ACROSS the garment is 8-connected to it — the
 * letters touch the fabric, so `labelComponents` returns them as ONE block and
 * every whole-block test passes. The block is the largest, so it is kept
 * wholesale, and the product's own name ends up in the display image.
 *
 * This walks the accepted block row by row, finds the runs of rows that reach
 * both edges, and erases the ones that are flat enough to be lettering. Working
 * per run is what makes it possible to remove a word in the middle of a bodice
 * without disturbing the fabric above or below it.
 */
const removeTextBandsFromBlock = (block, keep, sw, sh) => {
  const minY = Math.max(0, block.minY);
  const maxY = Math.min(sh - 1, block.maxY);
  if (maxY <= minY) return;

  const blockMinX = block.minX;
  const blockMaxX = block.maxX;
  const blockW = blockMaxX - blockMinX + 1;

  // Per-row extents of the block's own pixels, as a plain (count, minX, maxX)
  // triple per row. A plain array is used because the run finder needs to index
  // past the end (a sentinel row) to know where a run ends.
  const rowCount = maxY - minY + 1;
  const rows = new Array(rowCount);

  for (let r = 0; r < rowCount; r++) {
    rows[r] = { count: 0, minX: blockMaxX + 1, maxX: blockMinX - 1 };
  }

  for (const p of block.members) {
    const x = p % sw;
    const y = (p - x) / sw;
    if (y < minY || y > maxY) continue;
    const r = y - minY;
    rows[r].count++;
    if (x < rows[r].minX) rows[r].minX = x;
    if (x > rows[r].maxX) rows[r].maxX = x;
  }

  for (const run of findFullWidthRuns(rows, blockMinX, blockMaxX)) {
    if (!isTextRun(run, blockW)) continue;

    for (let r = run.startRow; r <= run.endRow; r++) {
      const y = minY + r;
      const rowBase = y * sw;
      for (let x = blockMinX; x <= blockMaxX; x++) {
        if (keep[rowBase + x]) keep[rowBase + x] = 0;
      }
    }
  }

  /*
   * EMPTY ROWS ARE A DEFINITIVE SEPARATOR — AND THE FIX FOR FLOATING ARTWORK.
   *
   * A pressed-flower sprig or a brand roundel shot above the garment can be
   * MERGED INTO the garment block before any shape test runs: `groupBlocks`
   * bridges near neighbours, so artwork sitting a few pixels off the shoulder
   * becomes part of `largest` and is kept wholesale.
   *
   * But there is one thing the merge cannot fake: the empty band of rows between
   * the artwork and the collar. A row with ZERO of the block's own pixels is
   * empty air. A garment is one mass with no gap through it; two objects with
   * clear air between them are two objects, however close their bounding boxes
   * came.
   *
   * So the block is SPLIT at every empty row, and only the section holding the
   * bulk of the pixels survives. The garment is always the larger mass — a sprig
   * or a roundel is a fraction of the clothing it was staged with — and the
   * discarded section is the decoration. This is the one test that cannot
   * produce a false positive, because it requires literally zero fabric pixels
   * in the gap rather than inferring from shape.
   *
   * A SINGLE empty row is NOT a split. One blank scan line is a hole in lace or
   * a gap in a weave, and treating it as separation would amputate part of the
   * garment. Two or more consecutive empty rows is real air between objects.
   */
  const sectionOf = (rows) => {
    const pixels = [0];
    for (let r = 0; r < rows.length; r++) {
      if (rows[r].count === 0) {
        if (r + 1 < rows.length && rows[r + 1].count === 0) {
          pixels.push(0);
          r++; // Skip the pair so a run of N blanks opens exactly one section.
          while (r + 1 < rows.length && rows[r + 1].count === 0) r++;
        }
        continue;
      }
      pixels[pixels.length - 1] += rows[r].count;
    }

    // The garment is the section holding the most pixels.
    let keepSection = 0;
    for (let i = 1; i < pixels.length; i++) {
      if (pixels[i] > pixels[keepSection]) keepSection = i;
    }
    return { sections: pixels.length, keepSection };
  };

  const { sections, keepSection } = sectionOf(rows);

  if (sections > 1) {
    let section = 0;
    for (let r = 0; r < rowCount; r++) {
      if (rows[r].count === 0) {
        if (r + 1 < rowCount && rows[r + 1].count === 0) {
          section++;
          while (r + 1 < rowCount && rows[r + 1].count === 0) r++;
        }
        continue;
      }
      if (section !== keepSection) {
        const y = minY + r;
        const rowBase = y * sw;
        for (let x = blockMinX; x <= blockMaxX; x++) {
          if (keep[rowBase + x]) keep[rowBase + x] = 0;
        }
      }
    }
  }

  /*
   * IF A BAND REMOVED SOMETHING, THE RESULT MUST STILL BE A GARMENT.
   *
   * The edge case this guards: a garment that genuinely IS a wide flat shape —
   * a folded band of fabric, a very wide sash. If erasing left almost nothing
   * behind, the "text" was the product, so the pixels are restored and the
   * garment ships intact. Losing a product is far worse than keeping a word.
   */
  let surviving = 0;
  for (const p of block.members) if (keep[p]) surviving++;
  if (surviving < block.size * 0.55) {
    for (const p of block.members) keep[p] = 1;
  }
};

const cleanCutoutMatte = (img) => {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    /*
     * Work at a bounded scan size. Every threshold below is expressed as a
     * FRACTION of the frame, so the result is resolution-independent while the
     * flood fills stay fast on a huge upload.
     */
    const SCAN_MAX = 512;
    const scale = Math.min(1, SCAN_MAX / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));

    const scan = document.createElement('canvas');
    scan.width = sw;
    scan.height = sh;
    const sctx = scan.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, sw, sh);

    let pixels;
    try {
      pixels = sctx.getImageData(0, 0, sw, sh);
    } catch {
      // A tainted canvas cannot be cleaned; leave the cut-out untouched.
      return null;
    }

    const data = pixels.data;
    const N = sw * sh;

    // 1. Opaque mask — anything with a meaningful alpha is a candidate pixel.
    const ALPHA_MIN = 24;
    const rawMask = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (data[p * 4 + 3] >= ALPHA_MIN) rawMask[p] = 1;
    }

    /*
     * 2. SEVER THIN BRIDGES BEFORE SEGMENTING — THE FLOWER-ON-SHOULDER FIX.
     *
     * A sprig, a roundel or a corner motif is usually staged RESTING ON the
     * garment, not floating in clear air. One contact point welds artwork and
     * clothing into a single 8-connected mass, so every downstream test is blind:
     * the shape gates see one garment, and the section split never fires because
     * there are no empty rows to split on. The contact is also wider than the
     * detach threshold, so the artwork is never even a separate block.
     *
     * Erosion by a few pixels cuts that joint — and it is the right cut, because
     * what survives erosion is genuinely thick fabric while a petal edge, a stem
     * and a logo's thin strokes are exactly what erosion destroys. Dilating back
     * by the same amount restores the garment to full size with no seam.
     *
     * THE RESULT IS VALIDATED, NOT TRUSTED. A thin strap, a lace panel or a
     * chiffon sleeve can be a few pixels across too, and opening it would eat
     * real product. So the opened mask is only adopted if it keeps the bulk of
     * the garment; otherwise the original mask is used unchanged and the pipeline
     * continues exactly as before. Degrading to "artwork stays" is recoverable;
     * degrading to "the product is gone" is not.
     */
    const BRIDGE_RADIUS = 2;
    let mask = rawMask;

    if (N > 0) {
      const opened = openMask(rawMask, sw, sh, BRIDGE_RADIUS);
      const keptAfter = opened.reduce((a, v) => a + v, 0);
      const keptBefore = rawMask.reduce((a, v) => a + v, 0);

      // Anything under a third of the original means erosion ate the subject
      // rather than a joint — that is a thin garment, not a bridged one.
      if (keptBefore > 0 && keptAfter >= keptBefore * 0.66) {
        mask = opened;
      }
    }

    // 3. Label 8-connected components (same neighbourhood as the segmenter, so a
    //    thin strap is not split off from its bodice).
    const components = labelComponents(mask, sw, sh);
    if (components.length === 0) return null;

    /*
     * 4. Merge near-neighbour components into logical blocks, so a caption is
     *    measured as the one wide line it is rather than as a handful of dots
     *    that each pass a size test on their own.
     */
    const groups = groupBlocks(components, sw, sh);

    // 4. The garment is the biggest block. Two blocks of comparable size are two
    //    halves of one fragmented pale garment, so `largest` is a reference for
    //    scaling the thresholds — never a pick-one-winner rule.
    const largest = groups.reduce((a, b) => (b.size > a.size ? b : a), groups[0]);

    /*
     * 5. Decide what is garment and what is left-over artwork / backdrop.
     *
     * MEASURED RATIONALES (mirroring extractGarment.js):
     *
     *   - SIZE FLOOR: a group below 1.5 % of the garment is specks. The floor is
     *     deliberately low — text has already been caught by SHAPE, so this pass
     *     no longer needs to be aggressive about small things, and a genuine
     *     small part (a belt buckle, a button placket) can survive.
     *
     *   - TEXT / LOGO: rejected on shape, anywhere in the frame. That is the gate
     *     the old fixed top-band test could never reach.
     *
     *   - EDGE-HUGGING BACKDROP: a group whose bounding box runs along the frame
     *     border is a leftover strip of the original backdrop — not a garment
     *     that merely touches an edge, which is why the guard band is thin.
     *
     *   - FLOATING PATCH: a group that shares NEITHER axis with the garment is a
     *     detached island — the script name, the logo, or a backdrop speckle the
     *     model kept. A real sleeve or hem always shares a column range with the
     *     body, even when it fragments away from it vertically.
     *
     *   - THIN TENDRIL: a group inside the garment's box that covers only a few
     *     of its own columns is a halo, never fabric.
     */
    const MIN_RATIO = 0.015;
    const EDGE_GUARD = Math.max(2, Math.round(Math.min(sw, sh) * 0.012));

    /*
     * HOW FAR APART TWO BLOCKS MUST BE BEFORE "DETACHED" MEANS ANYTHING.
     *
     * A garment photographed against a plain wall is usually ONE connected mass,
     * but a pale fabric breaks up under the alpha threshold, and a sleeve can
     * separate from a bodice by a pixel or two. Those are still the same garment.
     *
     * IT MUST EXCEED THE MERGE RADIUS, OR THIS GATE CAN NEVER FIRE.
     * -------------------------------------------------------------------
     * `groupBlocks` (step 4) already absorbed anything within GAP pixels into a
     * single block, and GAP is 2 % of the frame's short side. A detach threshold
     * SMALLER than that is measuring a distance that can no longer exist by the
     * time this runs — the two objects have been declared neighbours and are one
     * group. That is why artwork sitting a few pixels off a shoulder survived
     * despite this test existing: the gap it needed to show was already closed.
     *
     * So it sits comfortably ABOVE the merge radius (2 % -> 3.5 %), which keeps
     * it meaningful while leaving the thin-strap case — a one or two pixel
     * separation, far below both — merging as it always did.
     */
    const DETACH_GAP = Math.max(3, Math.round(Math.min(sw, sh) * 0.035));

    const coverageCache = new Map();
    const coverageOf = (g) => {
      if (!coverageCache.has(g)) coverageCache.set(g, columnCoverage(g, sw));
      return coverageCache.get(g);
    };

    const keep = new Uint8Array(N);

    /*
     * THE GARMENT IS THE LARGEST BLOCK — BUT LARGEST ALONE IS NOT ENOUGH.
     *
     * A caption printed ACROSS the garment, or a logo sitting on top of it, forms
     * one 8-connected mass with it: the letters touch the fabric, so the
     * segmenter never sees them as separate, and `largest` then includes every
     * word. Keeping `largest` wholesale is what put the product's own name and
     * watermark into the display image.
     *
     * So the garment block is REFINED rather than trusted. Inside it, the rows are
     * examined and any HORIZONTAL BAND that spans nearly the full width while
     * being much shorter than it is wide is lettering laid over the garment.
     * A real garment has no such band: shoulders are wide but tall, a sleeve is
     * tall and narrow, a skirt is tall. Only a line of text is both very wide and
     * very flat — see `isFlatFullWidthBand`.
     */
    for (const p of largest.members) keep[p] = 1;
    removeTextBandsFromBlock(largest, keep, sw, sh);

    for (const g of groups) {
      if (g === largest) continue;

      // (a) Noise floor.
      if (g.size < largest.size * MIN_RATIO) continue;

      /*
       * (b) ARTWORK FLOATING ABOVE THE GARMENT — THE FLOWER AND LOGO CASE.
       *
       * This is the decoration a product photo is shot with: a pressed-flower
       * sprig, a brand roundel, a corner motif. It sits in the empty space ABOVE
       * the shoulders, so it shares columns with the garment but NOT rows — and
       * gate (d) below only rejects a group that misses on BOTH axes, so a
       * group that merely misses on one still sailed through.
       *
       * THAT IS THE HOLE. (d) requires `!overlapsX || !overlapsY`, which reads
       * as "reject on either axis", but it is a disjunction over two *overlap*
       * tests, so anything overlapping in EITHER direction survives. The artwork
       * above a shirt overlaps in X and misses only in Y — and was kept.
       *
       * The rule: a garment is a SINGLE connected mass. A group that is
       * vertically separated from the body and sits above it, with nothing
       * bridging the gap, is a photographic accessory, not a garment piece. A
       * real sleeve shares rows with the bodice; a hem shares rows with the
       * skirt. Something floating in clear air above the shoulders is not part
       * of the clothing.
       *
       * `gapRows` is the vertical distance between the two blocks, and it must
       * be non-trivial. Touching or slightly separated (a shoulder seam broken by
       * a hair) is still the same garment and is NOT rejected here.
       */
      const gapBelow = largest.minY - g.maxY;
      const gapAbove = g.minY - largest.maxY;
      const isDetachedVertically = gapBelow > 0 || gapAbove > 0;
      const verticalGap = Math.max(gapBelow, gapAbove);

      if (isDetachedVertically && verticalGap > DETACH_GAP) {
        continue;
      }

      // (c) Lettering / brand mark — rejected by shape, at ANY height.
      if (looksLikeText(g)) continue;

      // (d) A strip running along the frame border is leftover backdrop.
      const hugsEdge =
        g.minX <= EDGE_GUARD ||
        g.minY <= EDGE_GUARD ||
        g.maxX >= sw - 1 - EDGE_GUARD ||
        g.maxY >= sh - 1 - EDGE_GUARD;
      if (hugsEdge) continue;

      const overlapsX = Math.min(g.maxX, largest.maxX) - Math.max(g.minX, largest.minX) >= 0;
      const overlapsY = Math.min(g.maxY, largest.maxY) - Math.max(g.minY, largest.minY) >= 0;

      // (e) A detached island that shares neither axis with the garment is
      //     artwork or a backdrop patch — never part of the garment.
      if (!overlapsX || !overlapsY) continue;

      // (f) Bulk check: a group occupying almost none of its own width is a
      //     halo/tendril. Real fabric spans its columns.
      if (coverageOf(g) < 0.25) continue;

      // A real, connected garment piece (sleeve, skirt panel, hem).
      for (const p of g.members) keep[p] = 1;
    }

    /*
     * 6. De-speckle, then write the decision back as ALPHA at the ORIGINAL
     *    resolution, sampling the scan mask per pixel so the edge stays crisp
     *    (a scaled mask would blur it).
     */
    const cleaned = denoise(keep, sw, sh);

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.drawImage(img, 0, 0);

    const region = octx.getImageData(0, 0, w, h);
    const px = region.data;

    // Precompute the x -> scan-x map once (it only depends on x).
    const scanXOf = new Int32Array(w);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x * sw / w);
      scanXOf[x] = sx < 0 ? 0 : sx >= sw ? sw - 1 : sx;
    }

    for (let y = 0; y < h; y++) {
      const sy = Math.floor(y * sh / h);
      const rowBase = (sy < 0 ? 0 : sy >= sh ? sh - 1 : sy) * sw;
      let o = y * w * 4 + 3;
      for (let x = 0; x < w; x++, o += 4) {
        if (!cleaned[rowBase + scanXOf[x]]) px[o] = 0;
      }
    }

    octx.putImageData(region, 0, 0);
    return out;
  } catch {
    // Cleaning is best-effort: on any failure the caller keeps the raw cut-out.
    return null;
  }
};

/** Where an image lands with `contain` semantics, centred, honouring a max scale. */
const containRect = (img, width, height, maxScale = 1, centerY = height / 2) => {
  const scale = Math.min(width / img.width, height / img.height) * maxScale;
  const w = img.width * scale;
  const h = img.height * scale;
  return { x: (width - w) / 2, y: centerY - h / 2, w, h };
};

/**
 * Paint the OCCASION PRESET frame: the flat base, the vibe panel, a soft radial
 * vignette, a double hairline border and corner ornaments in the preset's
 * accents. Drawn in code so every product is pixel-consistent and no background
 * asset is needed.
 *
 * NO WORDMARK. The foot of the frame is deliberately left empty. The frame used
 * to stamp a HIRAYA logo and a "VIRTUAL WARDROBE" line across the bottom of
 * every catalog image. That is branding, not product, and the brief is explicit:
 * the display image shows the GARMENT and nothing else — no text, no logo, no
 * sticker. Text over the image also competes with the product name the
 * storefront already prints directly beneath it, so the same word appeared
 * twice.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {Object} [preset] an entry of FRAME_PRESETS. Defaults to the light
 *                          everyday preset, never the legacy black card.
 */
const drawFrame = (ctx, width, height, preset = FALLBACK_FRAME) => {
  const base = preset?.base || FALLBACK_FRAME.base;
  const vignette = preset?.vignette || FALLBACK_FRAME.vignette;
  const accent = preset?.accent || FALLBACK_FRAME.accent;
  const accentSoft = preset?.accentSoft || FALLBACK_FRAME.accentSoft;

  // 1. Flat base.
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // 2. THE VIBE PANEL — what actually makes one occasion's card read
  //    differently from another's. Painted UNDER the vignette so it stays a
  //    soft wash rather than a hard shape competing with the garment.
  if (preset?.panel === 'arc') {
    // Summer: a broad warm arc low on the card, like low sun over water.
    const arc = ctx.createRadialGradient(
      width / 2, height * 1.02, height * 0.04,
      width / 2, height * 1.02, height * 0.78,
    );
    arc.addColorStop(0, accent);
    arc.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = arc;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else if (preset?.panel === 'keyline') {
    // Cultural / formal: a set of fine concentric rules, a quiet "atelier"
    // texture with no motif that could be mistaken for part of the garment.
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.14;
    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 4; i += 1) {
      const inset = 96 + i * 34;
      ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    }
    ctx.restore();
  } else if (preset?.panel === 'horizon') {
    // Business / everyday: a single calm band across the lower third.
    const band = ctx.createLinearGradient(0, height * 0.72, 0, height);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(1, accent);
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = band;
    ctx.fillRect(0, height * 0.72, width, height * 0.28);
    ctx.restore();
  }

  // 3. Soft radial vignette behind the garment for depth.
  const radial = ctx.createRadialGradient(
    width / 2, height * 0.44, height * 0.05,
    width / 2, height * 0.44, height * 0.72,
  );
  radial.addColorStop(0, vignette);
  radial.addColorStop(1, base);
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  // 4. Double hairline border inset from the edge.
  const outerInset = 34;
  const innerInset = 46;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(outerInset, outerInset, width - outerInset * 2, height - outerInset * 2);

  ctx.strokeStyle = accentSoft;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  ctx.strokeRect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);
  ctx.globalAlpha = 1;

  // 5. Corner ornaments at all four corners.
  const corner = (x, y, dirX, dirY) => {
    const armLen = 120;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + dirY * armLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dirX * armLen, y);
    ctx.stroke();

    // Small inner tick for a filigree feel.
    ctx.strokeStyle = accentSoft;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + dirX * 22, y + dirY * 58);
    ctx.lineTo(x + dirX * 22, y + dirY * 22);
    ctx.lineTo(x + dirX * 58, y + dirY * 22);
    ctx.stroke();
  };

  const pad = innerInset + 12;
  corner(pad, pad, 1, 1);
  corner(width - pad, pad, -1, 1);
  corner(pad, height - pad, 1, -1);
  corner(width - pad, height - pad, -1, -1);
};

/*
 * THEME SCENES — loaded once per session and reused for every card, so a save or
 * a theme-picker change never re-downloads the image. A failed load is not
 * cached, so a transient error does not stick for the whole session.
 */
const sceneCache = new Map();
const loadScene = (src) => {
  if (!src || typeof document === 'undefined') return Promise.resolve(null);
  if (!sceneCache.has(src)) {
    sceneCache.set(
      src,
      loadImage(src).catch(() => {
        sceneCache.delete(src);
        return null;
      })
    );
  }
  return sceneCache.get(src);
};

/**
 * Paint a theme scene to COVER the card, softly out of focus.
 *
 * The blur is a photographer's shallow depth of field: the room reads as an
 * office or a beach, but its detail never competes with the garment. It is
 * drawn a little oversized so the blur's soft edge falls outside the canvas.
 */
const drawScene = (ctx, width, height, scene) => {
  const sw = scene.naturalWidth || scene.width;
  const sh = scene.naturalHeight || scene.height;
  const scale = Math.max(width / sw, height / sh) * 1.04;
  const dw = sw * scale;
  const dh = sh * scale;

  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.drawImage(scene, (width - dw) / 2, (height - dh) / 2, dw, dh);
  ctx.restore();

  // Edge vignette — pulls the eye to the centre, where the garment is.
  const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.42, width / 2, height / 2, width * 0.95);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.26)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
};

/**
 * The garment's "stage": a soft spotlight behind it and a ground shadow under
 * it. When the contrast guard fired (a dark garment on a dark scene) the
 * spotlight becomes a stronger light halo, which restores the garment's edge
 * WITHOUT swapping the theme's scene for another one.
 */
const drawGarmentStage = (ctx, width, height, rect, guarded) => {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const radius = Math.max(rect.w, rect.h) * 0.62;

  const spot = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  spot.addColorStop(0, guarded ? 'rgba(255, 250, 240, 0.62)' : 'rgba(255, 255, 255, 0.22)');
  spot.addColorStop(0.6, guarded ? 'rgba(255, 250, 240, 0.28)' : 'rgba(255, 255, 255, 0.08)');
  spot.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, width, height);

  const groundY = Math.min(height - 20, rect.y + rect.h);
  const ground = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, rect.w * 0.45);
  ground.addColorStop(0, 'rgba(0, 0, 0, 0.30)');
  ground.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.save();
  ctx.translate(cx, groundY);
  ctx.scale(1, 0.18);
  ctx.translate(-cx, -groundY);
  ctx.fillStyle = ground;
  ctx.fillRect(cx - rect.w, groundY - rect.w, rect.w * 2, rect.w * 2);
  ctx.restore();
};

/** PNG-encode an image or canvas (keeps its alpha). */
const canvasBlobOf = async (source) => {
  let canvas = source;
  if (!(source instanceof HTMLCanvasElement)) {
    canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
};

/**
 * Paint ONE catalog card: the occasion background, then the garment centred on
 * it. Shared by the first compose and by `reframeCutout`, so a re-themed card is
 * drawn by exactly the same code as the original.
 *
 * @returns {Promise<{ blob: Blob|null, frame: { key: string, preset: Object, guarded: boolean } }>}
 */
const paintCard = async (garment, occasion, category, strict = false) => {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  /*
   * PICK THE BACKGROUND, now that the garment's actual pixels are known.
   *
   * The occasion decides the vibe, and the garment decides whether that vibe
   * is SAFE: `pickFramePreset` measures the cut-out's luminance and refuses to
   * put a dark garment on a dark frame, where the alpha edge is the only
   * thing separating them. That is the same black-on-black failure documented
   * in `extractGarment.js`. `strict` (an admin's explicit pick) skips the guard.
   */
  const frame = pickFramePreset(occasion, category, garment, strict);

  // Paint the theme's SCENE (an office, a beach…); the flat colour card is only
  // the fallback when the scene image cannot load.
  const scene = await loadScene(frame.preset?.scene);
  if (scene) {
    drawScene(ctx, OUTPUT_WIDTH, OUTPUT_HEIGHT, scene);
  } else {
    drawFrame(ctx, OUTPUT_WIDTH, OUTPUT_HEIGHT, frame.preset);
  }

  // Where the garment will land (centred, contained, premium margin).
  const rect = containRect(garment, OUTPUT_WIDTH, OUTPUT_HEIGHT, MAX_GARMENT_SCALE);

  drawGarmentStage(ctx, OUTPUT_WIDTH, OUTPUT_HEIGHT, rect, frame.guarded);

  /*
   * The garment, with a soft drop shadow so it sits IN the scene rather than
   * pasted on it. No wordmark, no text, no logo — the display image is the
   * garment alone. See `drawFrame`'s note.
   */
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 14;
  ctx.drawImage(garment, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  // Export as PNG so any transparency at the edges stays clean.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, frame };
};

/**
 * RE-THEME AN EXISTING CUT-OUT — swap the background without re-cutting.
 *
 * The garment is already transparent (the `cutout` returned by
 * `composeGarmentOnFrame`, or a product's stored `ghost_mannequin_url`), so the
 * removal engine is skipped entirely: this is a single canvas paint, fast enough
 * to run on every save and on every change of the theme picker.
 *
 * @param {Object} params
 * @param {Blob|string} params.cutout       transparent garment (Blob or URL)
 * @param {string|string[]} [params.occasion] theme / occasion key
 * @param {string} [params.category]        fallback when the occasion is unusable
 * @param {boolean} [params.strictOccasion] honour the occasion exactly (admin pick)
 * @returns {Promise<{ blob: Blob|null, url: string, backgroundKey: string,
 *                     backgroundLabel: string, backgroundGuarded: boolean }>}
 */
export const reframeCutout = async ({ cutout, occasion = null, category = null, strictOccasion = false }) => {
  if (!cutout) throw new Error('reframeCutout needs a transparent cut-out.');

  const isBlob = typeof cutout !== 'string';
  const src = isBlob ? URL.createObjectURL(cutout) : cutout;
  try {
    const garment = await loadImage(src);
    const { blob, frame } = await paintCard(garment, occasion, category, strictOccasion);
    return {
      blob: blob || null,
      url: blob ? URL.createObjectURL(blob) : '',
      backgroundKey: frame.key,
      backgroundLabel: frame.preset?.label || FRAME_PRESETS[DEFAULT_PRESET_KEY].label,
      backgroundGuarded: frame.guarded,
    };
  } finally {
    if (isBlob) {
      try { URL.revokeObjectURL(src); } catch { /* already revoked */ }
    }
  }
};

/**
 * Compose a garment cut-out onto THE SINGLE DEFAULT HIRAYA FRAME.
 *
 * TWO PRODUCTS COME OUT OF THIS STEP
 * ----------------------------------
 * 1. `blob` / `url`  — the framed MARKETING CARD (black canvas, gold borders,
 *    wordmark). This is what the shop shows. Stored as `display_image_url`.
 *
 * 2. `matte` / `matteUrl` — the BARE transparent cut-out, trimmed tight. This is
 *    what the virtual try-on needs. Stored as `ghost_mannequin_url`.
 *
 * WHY THE MATTE EXISTS
 * --------------------
 * The framed card cannot be used for try-on: its black background, gold frame and
 * wordmark are NOT separable from the garment by colour (measured — the card's
 * artwork and its frame are the same black), so the client-side extractor had to
 * guess, and on some products it guessed wrong (the product-name script, for
 * instance, is set in the same tone as the dress and touches it).
 *
 * Producing the matte HERE removes the guess entirely: the cut-out already exists
 * at this point, so handing it on untouched means the try-on receives real fabric
 * with a real alpha edge — no caption, no frame, no re-segmentation error.
 *
 * @param {Object}  params
 * @param {File|string} params.garmentSource  The admin's uploaded file OR an image URL.
 * @param {Function} [params.onProgress]      (0..1) progress for the cut-out step.
 * @param {boolean} [params.skipCache]        Force a FRESH cut-out, ignoring the
 *                                            IndexedDB cache. A re-run needs this:
 *                                            the cache is keyed on the source image,
 *                                            so without it a re-run would hand back
 *                                            the identical cut-out from the first
 *                                            pass and look like a button that did
 *                                            nothing — which is precisely the moment
 *                                            somebody reaches for it.
 * @param {string|string[]} [params.occasion] The AI's occasion/vibe answer. Drives
 *                                            WHICH background preset is drawn.
 * @param {string} [params.category]          The AI's garment category, used as a
 *                                            fallback when the occasion is unusable.
 * @returns {Promise<{ blob: Blob|null, url: string, matte: Blob|null, matteUrl: string,
 *                     backgroundKey: string, backgroundLabel: string,
 *                     backgroundGuarded: boolean, width?: number, height?: number }>}
 */export const composeGarmentOnFrame = async ({
  garmentSource,
  onProgress,
  skipCache = false,
  occasion = null,
  category = null,
  strictOccasion = false,
}) => {
  if (!garmentSource) {
    return {
      blob: null, url: '', matte: null, matteUrl: '',
      backgroundKey: DEFAULT_PRESET_KEY,
      backgroundLabel: FRAME_PRESETS[DEFAULT_PRESET_KEY].label,
      backgroundGuarded: false,
    };
  }

  // 1. Resolve the admin's photo into a URL the cut-out engine can read.
  let garmentUrl;
  let revokeGarmentUrl = false;
  if (typeof garmentSource === 'string') {
    garmentUrl = garmentSource;
  } else {
    garmentUrl = URL.createObjectURL(garmentSource);
    revokeGarmentUrl = true;
  }

  try {
    // 2. Cut the garment out of its original background.
    const { url: cutoutUrl, blob: cutoutBlob } = await removeImageBackground(garmentUrl, { onProgress, skipCache });

    /*
     * A cut-out is the WHOLE POINT of this step. If removal failed we must NOT
     * silently compose the untouched original onto the frame: that is how the
     * admin's raw photo (background and all) ended up as the shop image, which
     * looked like the original merely pasted onto another picture.
     *
     * Instead we bail out and report failure, so the caller keeps the original
     * as the product image and can prompt the admin to retry the removal.
     */
    if (!cutoutBlob) {
      throw new Error('Background removal did not produce a cut-out; refusing to compose the original photo.');
    }

    /*
     * 2b. CLEAN THE CUT-OUT — the step that actually makes the garment the ONLY
     * thing on the transparency.
     *
     * The removal engine returns a semantically-correct but not pixel-exact matte:
     * product-name script, a logo/watermark and small leftover backdrop patches
     * routinely survive on it. Compositing that raw mask is why the card used to
     * show fragments of the admin's original background and the garment's own
     * caption. `cleanCutoutMatte` keeps only the garment mass and erases the rest.
     *
     * Both outputs below (the framed card AND the try-on matte) are built from
     * this SAME cleaned source, so they can never disagree about what the garment
     * is. On any internal failure it returns null and we fall back to the raw
     * cut-out, so a cleaning problem degrades instead of blocking the save.
     */
    let garmentLayer = null;
    let garmentLayerUrl = cutoutUrl;
    try {
      const rawCut = await loadImage(cutoutUrl);
      garmentLayer = cleanCutoutMatte(rawCut) || rawCut;
    } catch {
      // Could not decode the cut-out for cleaning — keep the engine's output.
      garmentLayer = null;
    }

    // 3-7. Pick the occasion background and paint the card (see `paintCard`).
    const garment = garmentLayer || await loadImage(garmentLayerUrl);
    const { blob, frame } = await paintCard(garment, occasion, category, strictOccasion);

    /*
     * THE CLEANED, UNTRIMMED CUT-OUT — kept so the card can be RE-THEMED later
     * (`reframeCutout`) without running the ~95 MB removal engine again. It is
     * untrimmed on purpose: the same margins give the same garment scale, so a
     * re-themed card matches the first one exactly except for its background.
     */
    let cutout = null;
    try {
      cutout = await canvasBlobOf(garment);
    } catch {
      // Re-theming falls back to the try-on matte; the card itself is fine.
    }

    // 8. THE TRY-ON MATTE — the bare cut-out, trimmed tight.
    /*
     * `removeImageBackground` has already produced a transparent PNG; the only
     * thing it needs is a TRIM, because the engine returns the original frame size
     * with the transparent margin left in. A padded matte would make the try-on's
     * per-row fabric measurement read the padding instead of the garment, so it is
     * cropped to its opaque bounds here — the same bounds the try-on would have had
     * to discover for itself, but now measured from an image with NO background,
     * NO caption and NO frame to confuse it.
     */
    let matte = null;
    let matteUrl = '';
    let matteSize = null;
    try {
      const cutImg = garmentLayer || await loadImage(cutoutUrl);
      const trimmed = trimToOpaqueBounds(cutImg);
      if (trimmed) {
        matte = await new Promise((resolve) => trimmed.toBlob(resolve, 'image/png'));
        if (matte) {
          matteUrl = URL.createObjectURL(matte);
          matteSize = { width: trimmed.width, height: trimmed.height };
        }
      }
    } catch {
      // The framed card is still valid; a missing matte only means the try-on
      // falls back to extracting from the shop photo, as it does today.
    }

    // Release the intermediate cut-out object URL now that it has been drawn.
    if (cutoutUrl?.startsWith('blob:')) {
      try { URL.revokeObjectURL(cutoutUrl); } catch { /* already revoked */ }
    }

    return {
      blob: blob || null,
      url: blob ? URL.createObjectURL(blob) : garmentUrl,
      matte,
      matteUrl,
      cutout,
      // WHICH background was used — the admin console shows it, and the product
      // row records it in `background_occasion` so the choice stays auditable
      // and the image can be regenerated later without re-running the AI.
      backgroundKey: frame.key,
      backgroundLabel: frame.preset?.label || FRAME_PRESETS[DEFAULT_PRESET_KEY].label,
      backgroundGuarded: frame.guarded,
      ...(matteSize || {}),
    };
  } finally {
    if (revokeGarmentUrl) {
      try { URL.revokeObjectURL(garmentUrl); } catch { /* already revoked */ }
    }
  }
};

/** Release an object URL produced by `composeGarmentOnFrame`. */
export const releaseCompositeUrl = (url) => {
  if (typeof url === 'string' && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
  }
};

export default composeGarmentOnFrame;
