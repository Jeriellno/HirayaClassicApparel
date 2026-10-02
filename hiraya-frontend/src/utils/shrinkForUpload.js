/**
 * Shrink a catalog image before it is posted to the backend.
 *
 * WHY: the product form posts the original photo plus a full-resolution PNG
 * card and matte for the main garment AND for every colour. Three colours at
 * phone-camera resolution easily pass the server's request ceiling (HTTP 413)
 * and the per-file limits in ProductRequest (5 MB original, 10 MB card/matte).
 *
 * The longest side is capped at `maxDim` and the image is re-encoded. PNG input
 * stays PNG so try-on mattes keep their transparency in the format the VTON
 * providers already accept; anything else becomes JPEG. If re-encoding does not
 * make the file smaller, the original is returned unchanged.
 */
const MAX_DIM = 2048;
// PNG is lossless, so its size tracks pixel count; 1600px keeps an RGBA matte
// well under the 10 MB card/matte limit.
const MAX_DIM_PNG = 1600;
const JPEG_QUALITY = 0.9;

/** Raw originals have a 5 MB limit (ProductRequest), so a PNG one is capped harder. */
export const ORIGINAL_PHOTO = { maxDimPng: 1280 };

const loadBitmap = async (blob) => {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);

  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const encode = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export const shrinkForUpload = async (blob, { maxDim = MAX_DIM, maxDimPng = MAX_DIM_PNG } = {}) => {
  if (!(blob instanceof Blob) || !/^image\/(png|jpe?g|webp)$/i.test(blob.type)) return blob;

  const isPng = /png$/i.test(blob.type);
  const limit = isPng ? maxDimPng : maxDim;

  try {
    const source = await loadBitmap(blob);
    const width = source.width;
    const height = source.height;
    const scale = Math.min(1, limit / Math.max(width, height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();

    const type = isPng ? 'image/png' : 'image/jpeg';
    const out = await encode(canvas, type, isPng ? undefined : JPEG_QUALITY);

    if (!out || (scale === 1 && out.size >= blob.size)) return blob;

    // Keep a File a File, with an extension that matches the new type.
    if (blob instanceof File) {
      const base = blob.name.replace(/\.[^.]+$/, '') || 'image';
      return new File([out], `${base}.${isPng ? 'png' : 'jpg'}`, { type, lastModified: blob.lastModified });
    }
    return out;
  } catch (error) {
    console.warn('shrinkForUpload: sending the original image', error);
    return blob;
  }
};

export default shrinkForUpload;
