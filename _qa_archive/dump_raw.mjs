import { writeFileSync } from 'node:fs';

/** Dump both RAW jpgs so I can look at the actual input sources. */
export default async function run(page) {
  const urls = await page.evaluate(async () => {
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
    return [
      { name: 'raw_emerald.jpg', data: await toDataUri(`${SUP}/products/catalog/1789529378546-vq9blwc.jpg`) },
      { name: 'raw_beige.jpg', data: await toDataUri(`${SUP}/products/catalog/1789553970904-kl0wdgp.jpg`) },
    ];
  });

  const written = [];
  for (const u of urls) {
    const b64 = u.data.replace(/^data:[^;]+;base64,/, '');
    const p = `C:/hiraya/${u.name}`;
    writeFileSync(p, Buffer.from(b64, 'base64'));
    written.push(p);
  }
  return { written };
}
