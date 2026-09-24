/**
 * CAN ISNet TELL A BARONG FROM A PERSON?
 * =======================================
 *
 * The RGB skin test failed: 3 of 5 real garments leaked (their fabric is
 * cream/gold, i.e. skin-coloured). The app already ships a real NEURAL model
 * (ISNet, via @imgly/background-removal). Before wiring it into the gate, this
 * measures whether it actually separates the two cases.
 *
 * For each image it reports the matte's COVERAGE and its SHAPE (top-width vs
 * torso-width, aspect). A person has a head; a hanging garment is a column.
 */
export default async function run(page, ui) {
  const targets = [
    { url: '/images/prem%20barong.jpg', kind: 'GARMENT (black+gold barong)' },
    { url: '/images/barong%20male.jpg', kind: 'GARMENT (cream barong)' },
    { url: '/images/modernshirt.jpg', kind: 'GARMENT (modern shirt)' },
    { url: '/images/qarender', kind: 'SKIP' },
  ].filter((t) => t.kind !== 'SKIP');

  const script = `(async () => {
    const mod = await import('/src/utils/personMatte.js');
    const targets = ${JSON.stringify(targets)};
    const out = [];
    for (const t of targets) {
      const started = Date.now();
      let matte = null;
      let err = null;
      try {
        matte = await mod.buildPersonMatte(new URL(t.url, location.origin).href, { width: 256, height: 384 });
      } catch (e) { err = String(e?.message || e); }
      out.push({
        kind: t.kind,
        ok: !!matte,
        ms: Date.now() - started,
        coverage: matte ? +matte.coverage.toFixed(3) : null,
        bounds: matte ? matte.bounds : null,
        source: matte ? matte.source : null,
        err,
      });
    }
    return out;
  })()`;

  const raw = await page.evaluate(script).catch((e) => ({ fatal: String(e?.message || e) }));
  return { kind: 'diagnostic', raw };
}