/**
 * prepareVtonGarment — turn a catalog product into the CLEANEST possible VTON
 * garment input, as a `data:image/png;base64,...` string for the backend.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Studio's AI render path (`requestBackendRender` -> POST /tryon/generate)
 * sends `garments[].image` STRAIGHT to PixelAPI/FASHN. What it sent was:
 *
 *     g.ghost_mannequin_url || g.image_url
 *
 * measured on the live catalog (2 products, 15 EMERALD and 16 BEIGE):
 *
 *   ghost_mannequin_url : 0 / 2 populated  -> the first branch never fires
 *   image_url           : 1080x1350 JPEG   -> the whole MARKETING CARD
 *                         (beige/pink backdrop, floral wreath, a mirror
 *                          reflection below the hem, a script wordmark)
 *   display_image_url   : 1000x1250 PNG    -> the ghost-mannequin FRAME
 *                         (black card, gold borders, Hiraya logo, reflection)
 *
 * So the VTON model was handed a POSTER OF A DRESS and asked to re-dress a
 * person in it. It faithfully reproduced the poster: wrong colour, wrong
 * texture, a cropped silhouette and the card's own artwork. That is the whole
 * reported bug.
 *
 * WHAT THIS DOES
 * --------------
 *   1. GUARANTEED MATTE FIRST (`ghost_mannequin_url`). A real transparent
 *      cut-out needs no work — it is returned as-is.
 *   2. Otherwise run the EXISTING `extractGarment` segmenter over the product's
 *      raw photograph / display card. It returns a transparent, trimmed PNG of
 *      the garment alone (no frame, no logo, no wordmark, no reflection, no
 *      backdrop) — the format every VTON model documents as its input.
 *   3. Encode that PNG as a data URI, which is what the backend accepts.
 *
 * HONESTY CONTRACT
 * ----------------
 * The returned object always describes what actually happened:
 *
 *   { dataUri, source, extracted, reason }
 *
 *   `source`    'ghost' | 'display' | 'raw' | 'none'
 *   `extracted` true only when we handed the model a real transparent cut-out.
 *   `reason`    a machine-readable note when `extracted === false`, so the UI
 *               can warn instead of silently sending a marketing card.
 *
 * It NEVER throws and NEVER returns an empty string when a usable asset exists:
 * a failure falls back to the best available source so the pipeline still runs
 * (the caller decides whether to warn). If NOTHING is available it returns
 * `{ dataUri: '', source: 'none', extracted: false, reason: 'no-asset' }`.
 */

import { extractGarment, releaseGarmentUrl } from './extractGarment';

/** Convert any blob URL / http URL into a base64 data URI, or '' on failure. */
const toDataUri = async (src) => {
  if (!src || typeof src !== 'string') return '';
  if (src.startsWith('data:image')) return src;
  if (typeof document === 'undefined') return '';

  try {
    const res = await fetch(src);
    if (!res.ok) return '';
    const blob = await res.blob();

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
};

/**
 * Does this product carry the RAW admin upload AND the composed display card
 * as two DIFFERENT assets?
 *
 * Used only to classify the source honestly. `display_image_url` is written by
 * the admin auto-fill stage; when it is present the card at `image_url` is the
 * raw upload, which is not what the customer sees on the shop and is not what
 * the model should be told the garment looks like.
 */
const hasDistinctDisplay = (product) => {
  const display = product?.display_image_url;
  return typeof display === 'string' && display.trim() !== '';
};

/**
 * Resolve the CLEANEST VTON garment input for one product.
 *
 * @param {Object} product  a product / selectedGarment object carrying any of
 *        `ghost_mannequin_url`, `display_image_url`, `image_url`, `raw_image_url`.
 * @returns {Promise<{dataUri:string, source:string, extracted:boolean, reason:string|null, width:number, height:number}>}
 */
export const prepareVtonGarment = async (product) => {
  if (!product || typeof product !== 'object') {
    return { dataUri: '', source: 'none', extracted: false, reason: 'no-product', width: 0, height: 0 };
  }

  const ghost = typeof product.ghost_mannequin_url === 'string' ? product.ghost_mannequin_url.trim() : '';
  const display = typeof product.display_image_url === 'string' ? product.display_image_url.trim() : '';
  const raw =
    (typeof product.raw_image_url === 'string' && product.raw_image_url.trim()) ||
    (typeof product.image_url === 'string' && product.image_url.trim()) ||
    '';

  /* ---- 1. A REAL MATTE NEEDS NO WORK ---- */
  if (ghost) {
    const dataUri = await toDataUri(ghost);
    if (dataUri) {
      return { dataUri, source: 'ghost', extracted: true, reason: null, width: 0, height: 0 };
    }
    // An unreachable ghost URL must not sink the render — fall through.
  }

  /*
   * ---- 2. SEGMENT A CUT-OUT FROM THE BEST PHOTOGRAPH ----
   *
   * `extractGarment` prefers the RAW upload by default because it segments
   * better (light backdrop, dark garment) than the black display card, whose
   * frame/logo/script are ALSO black and cannot be told from the garment by
   * colour. We hand it the whole product so it can apply its own measured
   * preference order:
   *
   *   ghost_mannequin_url (handled above) -> raw_image_url -> image_url -> display
   */
  const segment = await extractGarment(
    {
      ghost_mannequin_url: ghost,
      raw_image_url: raw,
      image_url: raw,
      display_image_url: display,
    },
    { preferRaw: true },
  );

  const extractedUrl = segment?.url || '';
  const dataUri = await toDataUri(extractedUrl);
  releaseGarmentUrl(extractedUrl);

  if (dataUri && segment?.extracted) {
    return {
      dataUri,
      source: hasDistinctDisplay(product) ? 'display-or-raw' : 'raw',
      extracted: true,
      reason: segment.reason || null,
      width: segment.width || 0,
      height: segment.height || 0,
    };
  }

  /*
   * ---- 3. SEGMENTATION FAILED — SEND THE CLEANEST THING WE HAVE, AND SAY SO ----
   *
   * The display card is preferred over the raw marketing card here: both carry
   * artwork, but the display card at least frames ONLY the garment, whereas the
   * raw card may also carry a busy lifestyle backdrop.
   */
  const fallback = display || raw;
  if (fallback) {
    const fallbackUri = await toDataUri(fallback);
    if (fallbackUri) {
      return {
        dataUri: fallbackUri,
        source: display ? 'display' : 'raw',
        // NOT extracted: the model is being handed a framed/composed image.
        extracted: false,
        reason: segment?.reason || 'segmentation-failed',
        width: segment?.width || 0,
        height: segment?.height || 0,
      };
    }
  }

  return { dataUri: '', source: 'none', extracted: false, reason: 'no-asset', width: 0, height: 0 };
};

/**
 * Resolve every garment in a stack, preserving order.
 *
 * The garments are independent, so they are prepared IN PARALLEL. Most pieces
 * carry a ghost-mannequin matte, which makes this a network download per
 * garment; measured on two garments (uncached, 2026-10-03) one-at-a-time took
 * 883–1692 ms and parallel 212–523 ms. A canvas segmentation still runs on the
 * main thread, so those simply interleave — never slower than sequential.
 * `Promise.all` over `map` keeps the result in stack order.
 *
 * @param {Array<Object>} garments
 * @returns {Promise<Array<{dataUri, source, extracted, reason, width, height, product}>>}
 */
export const prepareVtonGarments = async (garments) =>
  Promise.all(
    (Array.isArray(garments) ? garments : []).filter(Boolean).map(async (garment) => {
      /*
       * ONE GARMENT MUST NEVER SINK THE STACK.
       *
       * `prepareVtonGarment` is written not to throw, but it calls a canvas
       * segmenter whose failure modes are environment-specific (a browser with
       * canvas disabled, an OOM on a huge image). A per-garment failure degrades
       * to an empty asset, which the caller already handles by filtering.
       */
      try {
        const prepared = await prepareVtonGarment(garment);
        return { ...prepared, product: garment };
      } catch (err) {
        console.warn('[Hiraya] Garment preparation failed; skipping it:', garment?.name, err);
        return { dataUri: '', source: 'none', extracted: false, reason: 'prepare-threw', width: 0, height: 0, product: garment };
      }
    }),
  );

export default prepareVtonGarment;
