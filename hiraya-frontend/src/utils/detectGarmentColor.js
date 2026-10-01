/**
 * Detects a garment's main colour from its background-removed cut-out.
 *
 * Used by the product form's colour panel so an admin can drop one photo per
 * colour and get "Navy", "Maroon"… filled in automatically instead of picking
 * every colour by hand. Only opaque pixels count (the cut-out's transparent
 * background is ignored), and the result is the NEAREST named shop colour plus
 * the measured swatch hex. Presentation helper only — the admin can override.
 */

/** The colours the shop most often stocks: [name, hex]. */
export const QUICK_COLORS = [
  ['Black', '#1A1A1A'],
  ['White', '#F7F7F5'],
  ['Cream', '#F5F0EB'],
  ['Beige', '#E8DCC8'],
  ['Brown', '#6B4F3A'],
  ['Navy', '#1F2A44'],
  ['Blue', '#3B5B8C'],
  ['Gray', '#8A8A8A'],
  ['Green', '#4B6E4F'],
  ['Maroon', '#6E2A2A'],
  ['Red', '#A63A3A'],
  ['Pink', '#E5A8B8'],
  ['Yellow', '#D9B64A'],
  ['Orange', '#C9733A'],
  ['Purple', '#5E4A7A'],
];

const toRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Perceptually weighted RGB distance ("redmean") — good enough for naming. */
const distance = (a, b) => {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
};

/**
 * Named shop colours, nearest first, for a measured hex.
 * @returns {Array<[string, string]>}
 */
export const rankColorNames = (hex) => {
  const rgb = toRgb(hex);
  return [...QUICK_COLORS].sort((x, y) => distance(rgb, toRgb(x[1])) - distance(rgb, toRgb(y[1])));
};

/**
 * @param {Blob} blob  a transparent PNG cut-out
 * @returns {Promise<{ name: string, hex: string } | null>}
 */
export const detectGarmentColor = async (blob) => {
  if (!blob || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, size, size);
    bitmap.close?.();
    const { data } = ctx.getImageData(0, 0, size, size);

    // Median per channel over opaque pixels: robust to prints, shadows and seams.
    const rs = [];
    const gs = [];
    const bs = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
    if (rs.length < 20) return null;
    const median = (arr) => {
      arr.sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)];
    };
    const hex = toHex([median(rs), median(gs), median(bs)]);
    return { name: rankColorNames(hex)[0][0], hex };
  } catch {
    return null;
  }
};
