/**
 * garmentCompositor — STAGE 1 of the two-stage garment pipeline.
 *
 * Produces the catalog image every garment shares:
 *   1. cuts the garment out of the admin's photo (in-browser WASM engine via
 *      `removeImageBackground`),
 *   2. CLEANS that cut-out (`cleanCutoutMatte`) so only the garment remains — the
 *      engine's mask can still carry the product-name script, a logo and small
 *      leftover backdrop patches, all of which are erased here,
 *   3. draws it centred on THE SINGLE DEFAULT HIRAYA FRAME,
 *   4. returns the composite as a PNG Blob + object URL.
 *
 * THE FRAME IS THE SAME FOR EVERY GARMENT. It is an obsidian-black canvas with
 * gold ornamental side borders and the HIRAYA wordmark at the foot. There is
 * exactly ONE background — no per-occasion backgrounds. Only two things change
 * per product: the cut-out garment, and (optionally) the product name drawn
 * under it for the admin's preview.
 *
 * WHY CANVAS AND NOT THE AI: cutting out then compositing keeps the garment
 * pixel-perfect. Asking a generative model to "redraw" the garment risks
 * changing the product itself, which is unacceptable for a catalog.
 */

import { removeImageBackground } from './removeBackground';
import logoImg from '../assets/logo.png';

/** Output size of the composed catalog image (portrait catalog ratio). */
const OUTPUT_WIDTH = 1000;
const OUTPUT_HEIGHT = 1250;

/**
 * Fraction of the canvas the garment may occupy (keeps a premium margin).
 *
 * RAISED from 0.74. On a real catalog card the cut-out sat noticeably small in
 * the frame, so the garment now fills more of the display area — still inside
 * the gold ornamental border and clear of the HIRAYA wordmark, which is reserved
 * by the 220px foot inset applied at the draw site.
 */
const MAX_GARMENT_SCALE = 0.88;

/** The single shared frame palette — mirrors config/hiraya_backgrounds.php. */
const FRAME = {
  background: '#000',
  vignette: '#161616',
  gold: '#CB997E',
  goldSoft: '#FFE8D6',
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
    const mask = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (data[p * 4 + 3] >= ALPHA_MIN) mask[p] = 1;
    }

    // 2. Label 8-connected components (same neighbourhood as the segmenter, so a
    //    thin strap is not split off from its bodice).
    const components = labelComponents(mask, sw, sh);
    if (components.length === 0) return null;

    /*
     * 3. Merge near-neighbour components into logical blocks, so a caption is
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

    const coverageCache = new Map();
    const coverageOf = (g) => {
      if (!coverageCache.has(g)) coverageCache.set(g, columnCoverage(g, sw));
      return coverageCache.get(g);
    };

    const keep = new Uint8Array(N);

    // The garment itself always survives.
    for (const p of largest.members) keep[p] = 1;

    for (const g of groups) {
      if (g === largest) continue;

      // (a) Noise floor.
      if (g.size < largest.size * MIN_RATIO) continue;

      // (b) Lettering / brand mark — rejected by shape, at ANY height.
      if (looksLikeText(g)) continue;

      // (c) A strip running along the frame border is leftover backdrop.
      const hugsEdge =
        g.minX <= EDGE_GUARD ||
        g.minY <= EDGE_GUARD ||
        g.maxX >= sw - 1 - EDGE_GUARD ||
        g.maxY >= sh - 1 - EDGE_GUARD;
      if (hugsEdge) continue;

      const overlapsX = Math.min(g.maxX, largest.maxX) - Math.max(g.minX, largest.minX) >= 0;
      const overlapsY = Math.min(g.maxY, largest.maxY) - Math.max(g.minY, largest.minY) >= 0;

      // (d) A detached island that shares neither axis with the garment is
      //     artwork or a backdrop patch — never part of the garment.
      if (!overlapsX || !overlapsY) continue;

      // (e) Bulk check: a group occupying almost none of its own width is a
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

/** Draw an image with `contain` semantics, centred, honouring a max scale. */
const drawContain = (ctx, img, width, height, maxScale = 1, centerY = height / 2) => {
  const scale = Math.min(width / img.width, height / img.height) * maxScale;
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const dx = (width - drawW) / 2;
  const dy = centerY - drawH / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
};

/**
 * Paint the ONE shared HIRAYA frame: obsidian base, a soft radial vignette, a
 * double gold hairline border and gold corner ornaments down both sides.
 * Drawn in code so every product is pixel-identical and no asset is needed.
 */
const drawFrame = (ctx, width, height) => {
  // 1. Obsidian base.
  ctx.fillStyle = FRAME.background;
  ctx.fillRect(0, 0, width, height);

  // 2. Soft radial vignette behind the garment for depth.
  const vignette = ctx.createRadialGradient(
    width / 2, height * 0.44, height * 0.05,
    width / 2, height * 0.44, height * 0.72,
  );
  vignette.addColorStop(0, FRAME.vignette);
  vignette.addColorStop(1, FRAME.background);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  // 3. Double gold hairline border inset from the edge.
  const outerInset = 34;
  const innerInset = 46;
  ctx.strokeStyle = FRAME.gold;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(outerInset, outerInset, width - outerInset * 2, height - outerInset * 2);

  ctx.strokeStyle = FRAME.goldSoft;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  ctx.strokeRect(innerInset, innerInset, width - innerInset * 2, height - innerInset * 2);
  ctx.globalAlpha = 1;

  // 4. Gold ornamental corner flourishes at all four corners.
  const corner = (x, y, dirX, dirY) => {
    const armLen = 120;
    ctx.strokeStyle = FRAME.gold;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + dirY * armLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dirX * armLen, y);
    ctx.stroke();

    // Small inner tick for a filigree feel.
    ctx.strokeStyle = FRAME.goldSoft;
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

/**
 * Draw the HIRAYA wordmark at the foot of the frame.
 *
 * The logo asset is used when it loads; otherwise a typographic wordmark is
 * rendered so the frame is never left without its brand mark.
 */
const drawWordmark = async (ctx, width, height) => {
  const logoSize = 96;
  const footY = height - 118;

  try {
    const logo = await loadImage(logoImg);
    const scale = logoSize / Math.max(logo.width, logo.height);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    ctx.globalAlpha = 0.96;
    ctx.drawImage(logo, (width - lw) / 2, footY - lh / 2, lw, lh);
    ctx.globalAlpha = 1;
    return;
  } catch {
    // Fall through to the typographic wordmark.
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = FRAME.gold;
  ctx.font = '500 40px Cinzel, serif';
  ctx.fillText('HIRAYA', width / 2, footY);
  ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = 'rgba(203, 153, 126, 0.7)';
  ctx.fillText('V I R T U A L   W A R D R O B E', width / 2, footY + 40);
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
 * @returns {Promise<{ blob: Blob|null, url: string, matte: Blob|null, matteUrl: string, width?: number, height?: number }>}
 */
export const composeGarmentOnFrame = async ({ garmentSource, onProgress }) => {
  if (!garmentSource) {
    return { blob: null, url: '', matte: null, matteUrl: '' };
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
    const { url: cutoutUrl, blob: cutoutBlob } = await removeImageBackground(garmentUrl, { onProgress });

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

    // 3. Build the canvas.
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    // 4. Paint the SINGLE shared HIRAYA frame (same for every garment).
    drawFrame(ctx, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    // 5. Draw the garment cut-out centred in the frame's display area, sitting
    //    a little above the wordmark so nothing overlaps.
    const garment = garmentLayer || await loadImage(garmentLayerUrl);
    drawContain(
      ctx,
      garment,
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT - 220, // reserve the foot for the wordmark
      MAX_GARMENT_SCALE,
      (OUTPUT_HEIGHT - 220) / 2 + 20,
    );

    // 6. Brand the foot of the frame.
    await drawWordmark(ctx, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    // 7. Export as PNG so any transparency at the edges stays clean.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

    /*
     * 8. THE TRY-ON MATTE — the bare cut-out, trimmed tight.
     *
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
