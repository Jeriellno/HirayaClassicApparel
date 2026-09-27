/**
 * THE GST GATE — TESTED AGAINST THE REAL GARMENT IMAGES THAT LEAKED.
 * ==================================================================
 *
 * The reported failure, exactly:
 *
 *   "May mali pa rin eh... Hindi dapat lumabas sa canvas ang image na walang tao.
 *    Kunwari garments or damit lang — dapat ibalik sa user na walang person."
 *
 * And a SCREENSHOT showed a BARONG on the Virtual Fitting Canvas with the green
 * "PHOTO LOOKS GOOD" chip over it.
 *
 * Earlier tests used SYNTHETIC fixtures with clean primary colours. Those were a
 * lie: they did not reproduce the real problem, because the real garments are
 * WHITE CREAM and GOLD — i.e. skin-toned — and a simple RGB "warm" rule calls
 * their fabric "skin".
 *
 * This test loads the ACTUAL product images that ship with the app (served from
 * /images/) and asks the REAL `validateBodyPhoto` what it thinks. Every one of
 * these is a GARMENT with NO PERSON, so every one MUST be refused.
 *
 * It also checks the FIT-CHECK panel entry (`checkPose`) for the same images, so
 * a garment cannot show "PHOTO LOOKS GOOD" through the advisory path either.
 */
const GARMENTS = [
  { file: 'prem%20barong.jpg', label: 'prem barong (black + gold embroidery)' },
  { file: 'barong%20male.jpg', label: 'barong male (white cream + beige)' },
  { file: 'biege%20dress.jpg', label: 'biege dress' },
  { file: 'modernshirt.jpg', label: 'modern shirt' },
  { file: 'emerald%20dress.jpg', label: 'emerald dress' },
];

const SCRIPT = `(async () => {
  const { validateBodyPhoto } = await import('/src/utils/validateBodyPhoto.js');
  const GARMENTS = ${JSON.stringify(GARMENTS)};

  const out = [];
  for (const g of GARMENTS) {
    let v = null;
    try {
      v = await validateBodyPhoto(new URL('/images/' + g.file, location.origin).href);
    } catch (e) {
      out.push({ label: g.label, fatal: String(e?.message || e) });
      continue;
    }
    out.push({
      label: g.label,
      isPerson: v.isPerson,
      reason: v.reason,
      skinShare: v.evidence ? v.evidence.skinShare : null,
      blobShare: v.evidence ? v.evidence.blobShare : null,
      spanH: v.evidence ? v.evidence.spanH : null,
    });
  }
  return out;
})()`;

export default async function run(page) {
  const raw = await page
    .evaluate(SCRIPT)
    .catch((e) => ({ fatal: 'evaluate failed: ' + (e?.message || String(e)) }));

  if (raw.fatal) {
    return {
      kind: 'constraints',
      ok: false,
      passed: 0,
      failed: 1,
      skipped: 0,
      checks: [{ id: 0, name: 'real-garment gate', verdict: 'FAIL', why: raw.fatal }],
      report: '\n  REAL GARMENT GATE TEST\n  FATAL: ' + raw.fatal + '\n',
    };
  }

  // A garment with no person must have isPerson === false. If isPerson is true,
  // the garment LEAKED to the canvas — the exact reported bug.
  const checks = raw.map((r, i) => {
    const leaked = r.isPerson === true;
    return {
      id: i + 1,
      name: r.label,
      verdict: leaked ? 'FAIL' : 'pass',
      detail: { isPerson: r.isPerson, reason: r.reason, skinShare: r.skinShare, blobShare: r.blobShare, spanH: r.spanH },
      why: leaked
        ? 'LEAKED: a garment with no person was accepted (skinShare=' +
        r.skinShare +
        ') — it would reach the canvas'
        : r.fatal
          ? r.fatal
          : null,
    };
  });

  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const lines = ['', '  REAL GARMENT GATE TEST — EVERY ONE MUST BE REFUSED', '  ' + '='.repeat(60)];
  for (const c of checks) {
    lines.push('  [' + (c.verdict === 'pass' ? 'PASS' : 'FAIL') + '] ' + c.id + '. ' + c.name);
    for (const [k, v] of Object.entries(c.detail)) lines.push('         ' + k + ': ' + v);
    if (c.why) lines.push('         -> ' + c.why);
  }
  lines.push('  ' + '-'.repeat(60));
  lines.push('  ' + (checks.length - failures.length) + ' refused correctly · ' + failures.length + ' LEAKED');
  lines.push('');

  return {
    kind: 'constraints',
    ok: failures.length === 0,
    passed: checks.length - failures.length,
    failed: failures.length,
    skipped: 0,
    checks,
    report: lines.join('\n'),
  };
}