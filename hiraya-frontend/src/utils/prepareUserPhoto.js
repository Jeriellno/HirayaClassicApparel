/**
 * prepareUserPhoto — downscale + compress an uploaded body photo BEFORE it is
 * sent to the try-on API.
 *
 * WHY THIS EXISTS
 * ---------------
 * The try-on request carries the portrait as a Base64 data URI, and Base64 adds
 * ~33% on top of the raw bytes. Measured on this deployment: a phone photo
 * arrives at ~3.5 MB, which becomes a ~4.8 MB `person_image` field. That payload
 * was being rejected by the provider with a socket-level failure —
 * `cURL error 56: Recv failure: Connection was reset` — because the vendor (or
 * the CDN in front of it) resets a connection that large mid-upload.
 *
 * A VTON model does not need a 12-megapixel portrait: its own output is typically
 * ~576x864. Sending a huge frame costs nothing but bandwidth, latency and
 * connection resets.
 *
 * WHAT IT DOES
 * ------------
 *   - Decodes the file to an <img>.
 *   - Scales the LONGEST edge down to MAX_EDGE (never up — a small photo is left
 *     as-is).
 *   - Re-encodes as JPEG at QUALITY, which is what these models expect and is
 *     far smaller than a PNG for a photograph.
 *
 * SAFETY
 * ------
 * Every step is wrapped: if the canvas is unavailable, `toDataURL` throws, or the
 * image cannot be decoded, the ORIGINAL data URI is returned unchanged. The
 * upload path therefore still works on an exotic browser — it just does not get
 * the size reduction.
 */

/** Longest-edge cap in pixels. Comfortably above the model's own output size. */
const MAX_EDGE = 1536;

/** JPEG quality. 0.85 is visually lossless for a portrait and shrinks a lot. */
const QUALITY = 0.85;

/** Read a File into a data URI (the caller's existing behaviour, as a fallback). */
const fileToDataUri = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => reject(new Error('Could not read the photo file.'));
    reader.readAsDataURL(file);
  });

/** Decode a data URI into an <img>, resolving null (never throwing) on failure. */
const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/**
 * @param {File} file  the file the customer selected
 * @returns {Promise<{ preview: string, base64: string, original: string, bytes: number, resized: boolean }>}
 */
export const prepareUserPhoto = async (file) => {
  const original = await fileToDataUri(file);

  const fallback = {
    preview: original,
    base64: original,
    original,
    bytes: original ? original.length : 0,
    resized: false,
  };

  if (!original) return fallback;

  try {
    const img = await loadImage(original);
    if (!img) return fallback;

    const longest = Math.max(img.width, img.height);
    // A photo already inside the cap is used as-is (re-encoding would only lose
    // quality for no size benefit on an already-small image).
    if (!longest || longest <= MAX_EDGE) return fallback;

    const scale = MAX_EDGE / longest;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;

    ctx.drawImage(img, 0, 0, w, h);

    // White matte first: a PNG with transparency flattened onto black looks like
    // a silhouette and would confuse the model. JPEG has no alpha channel, so the
    // background must be filled deliberately.
    const jpeg = canvas.toDataURL('image/jpeg', QUALITY);
    if (!jpeg || !jpeg.startsWith('data:image')) return fallback;

    return {
      preview: jpeg,     // the canvas shows the same (smaller) image it sends
      base64: jpeg,
      original,
      bytes: jpeg.length,
      resized: true,
    };
  } catch {
    return fallback;
  }
};

export default prepareUserPhoto;
