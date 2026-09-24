/**
 * BODY-PHOTO GATE FIXTURE TEST
 * ============================
 *
 * The requirement this proves, in the customer's own words:
 *
 *   "BAWAL lahat ng image na walang person. Hindi dapat lumabas sa canvas ang
 *    image na walang tao — kunwari damit lang, dapat ibalik sa user na walang
 *    person."
 *
 * So the gate is asserted in BOTH directions:
 *
 *   - A GARMENT-ONLY photo (a dress on a hanger, no skin) MUST be REJECTED.
 *   - A GARMENT THAT IS SKIN-COLOURED must STILL be rejected (colour alone must
 *     not fool it — it has to be a PERSON, not a warm blob).
 *   - A PERSON (skin-toned head/neck/hands on a body) MUST be ACCEPTED.
 *   - An EMPTY scene MUST be rejected.
 *
 * Each fixture is drawn as a synthetic frame with known shape AND known skin
 * content, fed to the real `/src/utils/validateBodyPhoto.js`, and the returned
 * `isPerson` is asserted against the expectation.
 *
 * A CONSTRAINT CHECK (`kind: 'constraints'`), so a regression fails CI.
 */

const SCRIPT = `(async () => {
  const { validateBodyPhoto } = await import('/src/utils/validateBodyPhoto.js');

  /**
   * Build a frame: a plain background + a subject drawn per-row.
   *
   * The subject is INSET from every border (a margin of 12px), exactly like a
   * real photo where nobody stands flush against the frame edge. This matters:
   * validateBodyPhoto estimates the background from the BORDER pixels, so a
   * subject touching the edge would pollute that estimate — a fixture artifact,
   * not a product behaviour.
   */
  const draw = (W, H, opts) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');

    g.fillStyle = opts.bg || '#f2f2f2';
    g.fillRect(0, 0, W, H);

    const pad = 12; // keep the subject off every border
    const usable = H - pad * 2;
    for (let y = pad; y < H - pad; y++) {
      const row = opts.spec((y - pad) / usable);
      if (!row) continue;
      const { w, color } = row;
      g.fillStyle = color;
      g.fillRect(Math.round((W - w) / 2), y, w, 1);
    }
    return cv.toDataURL('image/png');
  };

  const SKIN = '#c8956d';   // a warm human skin tone (r>g>b)
  const DARK_SKIN = '#6b4a34';
  const GARMENT = '#3a4a6b'; // a cool blue dress — no skin
  const SKIN_GARMENT = '#b07a52'; // a warm beige dress that MIMICS skin colour

  const CASES = [
    {
      name: 'full-body person (skin head + limbs)',
      expectPerson: true,
      draw: () => draw(300, 600, {
        spec: (f) => {
          if (f < 0.06) return { w: 26, color: SKIN };      // head — SKIN
          if (f < 0.11) return { w: 16, color: SKIN };      // neck — SKIN
          if (f < 0.30) return { w: 90, color: GARMENT };   // shoulders (clothed)
          if (f < 0.55) return { w: 74, color: GARMENT };   // torso (clothed)
          if (f < 0.90) return { w: 60, color: DARK_SKIN }; // legs — SKIN
          return { w: 40, color: DARK_SKIN };               // feet — SKIN
        },
      }),
    },
    {
      name: 'dark-skinned person (must still pass)',
      expectPerson: true,
      draw: () => draw(300, 600, {
        spec: (f) => {
          if (f < 0.06) return { w: 26, color: DARK_SKIN };
          if (f < 0.11) return { w: 16, color: DARK_SKIN };
          if (f < 0.30) return { w: 90, color: GARMENT };
          if (f < 0.55) return { w: 74, color: GARMENT };
          if (f < 0.95) return { w: 60, color: DARK_SKIN };
          return { w: 40, color: DARK_SKIN };
        },
      }),
    },
    {
      name: 'garment only — a blue dress on a hanger (NO person)',
      expectPerson: false,
      draw: () => draw(300, 600, {
        spec: (f) => {
          if (f < 0.08) return { w: 20, color: '#8a8a8a' };  // hanger hook
          if (f < 0.20) return { w: 70, color: GARMENT };    // shoulder yoke
          if (f < 0.70) return { w: 96, color: GARMENT };    // body of dress
          if (f < 0.98) return { w: 88, color: GARMENT };    // hem
          return null;
        },
      }),
    },
    {
      name: 'skin-COLOURED garment — warm beige dress (must NOT fool the gate)',
      expectPerson: false,
      draw: () => draw(300, 600, {
        spec: (f) => {
          if (f < 0.10) return { w: 24, color: SKIN_GARMENT };
          if (f < 0.75) return { w: 96, color: SKIN_GARMENT };
          if (f < 0.98) return { w: 90, color: SKIN_GARMENT };
          return null;
        },
      }),
    },
    {
      name: 'flat-lay shirt — fills the frame width (NO person)',
      expectPerson: false,
      draw: () => draw(300, 600, {
        spec: (f) => {
          if (f < 0.05) return { w: 40, color: GARMENT };
          if (f < 0.95) return { w: 280, color: GARMENT };   // laid flat, wide
          return { w: 120, color: GARMENT };
        },
      }),
    },
    {
      name: 'empty scene — blank wall (NO person)',
      expectPerson: false,
      draw: () => draw(300, 600, { spec: () => null }),
    },
  ];

  const results = [];
  for (const c of CASES) {
    const src = c.draw();
    let v = null;
    try {
      v = await validateBodyPhoto(src);
    } catch (e) {
      results.push({ name: c.name, expectPerson: c.expectPerson, fatal: String(e?.message || e) });
      continue;
    }
    results.push({
      name: c.name,
      expectPerson: c.expectPerson,
      isPerson: v.isPerson,
      reason: v.reason,
      skinShare: v.evidence ? v.evidence.skinShare : null,
      headToTorso: v.evidence ? v.evidence.headToTorso : null,
    });
  }
  return { fatal: null, cases: results };
})()`;

export default async function run(page) {
  const raw = await page
    .evaluate(SCRIPT)
    .catch((e) => ({ fatal: 'evaluate failed: ' + (e?.message || String(e)) }));

  if (raw.fatal) {
    const checks = [{ id: 0, name: 'body-photo gate', verdict: 'FAIL', why: raw.fatal }];
    return {
      kind: 'constraints',
      ok: false,
      passed: 0,
      failed: 1,
      skipped: 0,
      checks,
      report: '\n  BODY-PHOTO GATE FIXTURE TEST\n  ' + '='.repeat(58) + '\n  FATAL: ' + raw.fatal + '\n',
    };
  }

  const checks = raw.cases.map((c, i) => {
    const ok = c.isPerson === c.expectPerson;
    return {
      id: i + 1,
      name: c.name,
      verdict: ok ? 'pass' : 'FAIL',
      detail: {
        isPerson: c.isPerson,
        expected: c.expectPerson,
        reason: c.reason,
        skinShare: c.skinShare,
        headToTorso: c.headToTorso,
      },
      why: ok
        ? null
        : 'gate said isPerson=' + c.isPerson + ' (' + c.reason + '), expected ' + c.expectPerson,
    };
  });

  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const lines = ['', '  BODY-PHOTO GATE FIXTURE TEST', '  ' + '='.repeat(58)];
  for (const c of checks) {
    lines.push('  [' + (c.verdict === 'pass' ? 'PASS' : 'FAIL') + '] ' + c.id + '. ' + c.name);
    for (const entry of Object.entries(c.detail)) lines.push('         ' + entry[0] + ': ' + entry[1]);
    if (c.why) lines.push('         -> ' + c.why);
  }
  lines.push('  ' + '-'.repeat(58));
  lines.push('  ' + (checks.length - failures.length) + ' passed · ' + failures.length + ' failed');
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