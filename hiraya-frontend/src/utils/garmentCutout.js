/*
 * ============================================================================
 * GARMENT CUT-OUT — lift a garment off its flat catalogue card, in the browser
 * ============================================================================
 *
 * The catalogue images (`display_image_url`) are FINISHED CARDS: the garment
 * centred on one flat colour (cream, peach, black…) with a thin decorative
 * frame and sometimes a small emblem. None of them carries transparency, and
 * the in-browser ML remover (`@imgly/background-removal`) is switched off
 * because it crashes the React tree (see hooks/useTransparentImage.js).
 *
 * This is a small, dependency-free alternative that works BECAUSE the cards
 * are flat:
 *
 *   1. Estimate the card colour from a thin ring of border pixels (median).
 *      A noisy ring means "not a flat card" — give up and keep the original.
 *   2. Flood-fill that colour inward from the border band, through pixels
 *      within a tolerance, so the fill reaches both outside AND inside the
 *      decorative frame but stops at the garment's silhouette.
 *   3. Give the fill a soft matte (alpha ramps with colour distance).
 *   4. Keep only the large connected shapes: frame lines, corner brackets and
 *      the emblem are small islands and are dropped. Then choke the matte by
 *      2px and feather it by 1px, which trims the card-coloured edge fringe.
 *   5. Apply that matte to the full-resolution image, crop tight, and hand
 *      back a PNG object URL plus the garment's average colour for any halo
 *      drawn behind it.
 *
 * Anything that goes wrong (CORS-tainted canvas, decode failure, a garment the
 * same colour as its card) resolves to `null`, and callers show the original.
 * Results are cached per URL for the session, so each image is processed once.
 * ==========================================================================*/

const MAX_SIDE = 720;          // processing resolution (long side, px)
const TOL_SEED = 30;           // a border pixel this close to the card colour seeds the fill
const TOL_LOW = 22;            // fully transparent below this distance
const TOL_HIGH = 64;           // the fill never crosses a pixel further than this
const BAND = 0.14;             // seeds come from this outer share of each side
const KEEP_SHARE = 0.1;        // islands smaller than 10% of the largest are dropped

const cache = new Map();

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
};

function cutOut(img) {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);

  const frame = ctx.getImageData(0, 0, W, H); // throws on a tainted canvas
  const px = frame.data;
  const N = W * H;

  /* 1 — the card colour, from a thin outer ring. */
  const ring = Math.max(2, Math.round(Math.min(W, H) * 0.02));
  const rs = [];
  const gs = [];
  const bs = [];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (x >= ring && x < W - ring && y >= ring && y < H - ring) continue;
      const i = (y * W + x) * 4;
      rs.push(px[i]);
      gs.push(px[i + 1]);
      bs.push(px[i + 2]);
    }
  }
  const bg = [median(rs), median(gs), median(bs)];

  let spread = 0;
  for (let k = 0; k < rs.length; k += 1) {
    spread += Math.hypot(rs[k] - bg[0], gs[k] - bg[1], bs[k] - bg[2]);
  }
  if (spread / rs.length > 26) return null; // not a flat card

  /* Colour distance of every pixel from the card colour. */
  const dist = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p += 1, i += 4) {
    dist[p] = Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
  }

  /* 2 — flood from every card-coloured pixel in the border band. */
  const filled = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  const bx = Math.round(W * BAND);
  const by = Math.round(H * BAND);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (x >= bx && x < W - bx && y >= by && y < H - by) continue;
      const p = y * W + x;
      if (dist[p] < TOL_SEED) {
        filled[p] = 1;
        queue[tail++] = p;
      }
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % W;
    const neighbours = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
    for (const q of neighbours) {
      if (q < 0 || q >= N || filled[q] || dist[q] >= TOL_HIGH) continue;
      filled[q] = 1;
      queue[tail++] = q;
    }
  }

  /* 3 — soft matte + de-spill on the filled region. */
  const alpha = new Uint8ClampedArray(N);
  for (let p = 0; p < N; p += 1) {
    if (!filled[p]) {
      alpha[p] = 255;
      continue;
    }
    const d = dist[p];
    alpha[p] = d <= TOL_LOW ? 0 : Math.round(((d - TOL_LOW) / (TOL_HIGH - TOL_LOW)) * 255);
  }

  /* 4 — keep only the big shapes (label 4-connected opaque islands). */
  const label = new Int32Array(N);
  const sizes = [0];
  for (let s = 0; s < N; s += 1) {
    if (alpha[s] < 128 || label[s]) continue;
    const id = sizes.length;
    let count = 0;
    head = 0;
    tail = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const p = queue[head++];
      count += 1;
      const x = p % W;
      const neighbours = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
      for (const q of neighbours) {
        if (q < 0 || q >= N || label[q] || alpha[q] < 128) continue;
        label[q] = id;
        queue[tail++] = q;
      }
    }
    sizes.push(count);
  }
  const largest = Math.max(0, ...sizes);
  if (largest < N * 0.03) return null; // nothing garment-sized survived

  const keep = sizes.map((size) => size >= largest * KEEP_SHARE);

  const matte = new Uint8ClampedArray(N);
  for (let p = 0; p < N; p += 1) {
    let a = alpha[p];
    if (a >= 128 && !keep[label[p]]) a = 0;
    // Half-transparent pixels belong to a kept island only if one touches them.
    if (a > 0 && a < 128) {
      const x = p % W;
      const near = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]
        .some((q) => q >= 0 && q < N && keep[label[q]] && label[q] > 0);
      if (!near) a = 0;
    }
    matte[p] = a;
  }

  /*
   * CHOKE + FEATHER. The outermost 1–2px of a garment are a blend of the
   * garment and the card; on a dark card they read as a black outline and are
   * too far from the card colour to be keyed out. Eroding the matte by 2px
   * (separable min filter) and softening it by 1px (separable box blur)
   * trims that rim and leaves a clean, slightly soft silhouette.
   */
  const pass = (src, horizontal, radius, reduce) => {
    const dst = new Uint8ClampedArray(N);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let acc = reduce === 'min' ? 255 : 0;
        let n = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const v = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : src[yy * W + xx];
          if (reduce === 'min') acc = Math.min(acc, v);
          else acc += v;
          n += 1;
        }
        dst[y * W + x] = reduce === 'min' ? acc : acc / n;
      }
    }
    return dst;
  };
  const choked = pass(pass(matte, true, 2, 'min'), false, 2, 'min');
  const finalMatte = pass(pass(choked, true, 1, 'mean'), false, 1, 'mean');

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let kept = 0;

  for (let p = 0, i = 0; p < N; p += 1, i += 4) {
    const a = finalMatte[p];
    px[i + 3] = a;

    if (a > 0) {
      const x = p % W;
      const y = (p - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (a === 255 && (p & 3) === 0) {
        sumR += px[i];
        sumG += px[i + 1];
        sumB += px[i + 2];
        kept += 1;
      }
    }
  }
  if (maxX < 0 || kept === 0) return null;

  /*
   * 5 — apply the matte to the FULL-RESOLUTION image, cropped tight.
   * The matte was computed at the reduced processing size for speed; drawing
   * it scaled up as a `destination-in` mask keeps the garment's own pixels at
   * full sharpness and gives the edge a smooth, bilinear soft falloff.
   */
  ctx.putImageData(frame, 0, 0);

  const padX = Math.round((maxX - minX) * 0.03);
  const padY = Math.round((maxY - minY) * 0.03);
  const cx = Math.max(0, minX - padX);
  const cy = Math.max(0, minY - padY);
  const cw = Math.min(W, maxX + padX + 1) - cx;
  const ch = Math.min(H, maxY + padY + 1) - cy;

  const k = 1 / scale; // processing px → natural px
  const out = document.createElement('canvas');
  out.width = Math.round(cw * k);
  out.height = Math.round(ch * k);
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(img, cx * k, cy * k, cw * k, ch * k, 0, 0, out.width, out.height);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(canvas, cx, cy, cw, ch, 0, 0, out.width, out.height);

  const color = `rgb(${Math.round(sumR / kept)}, ${Math.round(sumG / kept)}, ${Math.round(sumB / kept)})`;

  return new Promise((resolve) => {
    out.toBlob((blob) => {
      resolve(blob ? { src: URL.createObjectURL(blob), color, width: out.width, height: out.height } : null);
    }, 'image/png');
  });
}

/**
 * Resolves to `{ src, color, width, height }` for a garment lifted off its
 * card, or `null` when the image is not a flat card (callers keep the
 * original). One attempt per URL per session.
 */
export const getGarmentCutout = (url) => {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);
  if (!cache.has(url)) {
    cache.set(
      url,
      loadImage(url)
        // The pixel work (~0.5s per image) waits for an idle moment so it
        // never lands in the middle of a scroll or an entrance animation.
        .then((img) => whenIdle().then(() => cutOut(img)))
        .catch(() => null)
    );
  }
  return cache.get(url);
};

const whenIdle = () =>
  new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 1200 });
    } else {
      setTimeout(resolve, 60);
    }
  });
