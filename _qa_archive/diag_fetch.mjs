/** Diagnose whether the Supabase fetch works and produces a readable image. */
export default async function run(page) {
  return await page.evaluate(async () => {
    const mod = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';
    const url = `${SUP}/products/catalog/1789529378546-vq9blwc.jpg`;

    const out = { tests: [] };

    // 1. Plain fetch
    try {
      const res = await fetch(url, { mode: 'cors' });
      out.tests.push({ test: 'fetch cors', ok: res.ok, status: res.status, type: res.type });
    } catch (e) {
      out.tests.push({ test: 'fetch cors', error: String(e) });
    }

    // 2. No-cors fetch
    try {
      const res = await fetch(url, { mode: 'no-cors' });
      out.tests.push({ test: 'fetch no-cors', ok: res.ok, status: res.status, type: res.type });
    } catch (e) {
      out.tests.push({ test: 'fetch no-cors', error: String(e) });
    }

    // 3. toReadableSource result: does it become a data URI?
    const readable = await mod.toReadableSource(url);
    out.readableIsDataUri = readable.startsWith('data:');
    out.readablePrefix = readable.slice(0, 40);
    out.readableLength = readable.length;

    // 4. Is that readable image actually usable on a canvas?
    if (out.readableIsDataUri) {
      const img = await new Promise((r) => {
        const i = new Image();
        i.onload = () => r(i);
        i.onerror = () => r(null);
        i.src = readable;
      });
      out.imageLoaded = !!img;
      if (img) {
        try {
          const cv = document.createElement('canvas');
          cv.width = 10; cv.height = 10;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(img, 0, 0, 10, 10);
          cx.getImageData(0, 0, 1, 1);
          out.canvasReadable = true;
        } catch (e) {
          out.canvasReadable = false;
          out.canvasError = String(e);
        }
      }
    }

    // 5. What does extractGarment say now?
    const r = await mod.extractGarment({ raw_image_url: url });
    out.extract = { extracted: r.extracted, reason: r.reason, w: r.width, h: r.height, seam: r.reflectionSeam };

    return out;
  });
}
