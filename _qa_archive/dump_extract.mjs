/**
 * Dump the extraction output to disk so I can LOOK at it.
 */
export default async function run(page) {
  return await page.evaluate(async () => {
    const mod = await import('/src/utils/extractGarment.js');
    const SUP = 'https://qnyskltxjfdsvncaehvh.supabase.co/storage/v1/object/public';

    const toDataUri = async (url) => {
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(fr.result);
        fr.readAsDataURL(blob);
      });
    };

    const url = `${SUP}/products/catalog/1789529379424-kivp9kr.png`;
    const dataUri = await toDataUri(url);

    const r = await mod.extractGarment(dataUri);

    // Compose a side-by-side: original card vs extracted cut-out on a checker
    // background so transparency is visible.
    const load = (src) => new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    });

    const a = await load(dataUri);
    const b = await load(r.url);

    const H = 700;
    const aw = Math.round(a.naturalWidth * (H / a.naturalHeight));
    const bw = b ? Math.round(b.naturalWidth * (H / b.naturalHeight)) : 0;

    const cv = document.createElement('canvas');
    cv.width = aw + bw + 20;
    cv.height = H;
    const cx = cv.getContext('2d');

    // Checkerboard to reveal alpha.
    for (let y = 0; y < H; y += 20) {
      for (let x = 0; x < cv.width; x += 20) {
        cx.fillStyle = ((x / 20 + y / 20) % 2) ? '#cccccc' : '#ffffff';
        cx.fillRect(x, y, 20, 20);
      }
    }

    cx.drawImage(a, 0, 0, aw, H);
    if (b) cx.drawImage(b, aw + 20, 0, bw, H);

    // Write the comparison PNG to disk via the debug endpoint instead of
    // returning megabytes of base64 through stdout.
    const dataUrl = cv.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const buf = await blob.arrayBuffer();

    return {
      _writeFile: 'extract_compare.png',
      _bytes: Array.from(new Uint8Array(buf)),
      extracted: r.extracted,
      sourceSize: { w: a.naturalWidth, h: a.naturalHeight },
      cutoutSize: b ? { w: b.naturalWidth, h: b.naturalHeight } : null,
      reason: r.reason,
    };
  });
}
