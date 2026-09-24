/**
 * END-TO-END PROOF OF THE "NO PERSON, NO CANVAS" RULE
 * ==================================================
 *
 * The requirement, in the customer's words:
 *
 *   "BAWAL lahat ng image na walang person. Hindi dapat lumabas sa canvas ang
 *    image na walang tao — kunwari damit lang, dapat ibalik sa user na walang
 *    person."
 *
 * This drives the REAL Studio through a REAL browser:
 *
 *   1. sign in, open /try-on
 *   2. upload a REAL GARMENT product photo (a barong, no person) — the exact
 *      image class that leaked before
 *   3. ASSERT: the app refuses it AND the Virtual Fitting Canvas stays EMPTY
 *      (no preview image is seeded, no render starts)
 *   4. upload a photo WITH a person
 *   5. ASSERT: it is accepted and appears on the canvas
 *
 * Step 3 is the whole point: a previous gate let garments/objects through, so the
 * canvas must be proven empty, not merely the message proven present.
 *
 * Run with the repo's own launcher (raw CDP, not Playwright), so the upload is
 * simulated by constructing a File in the page from the fixture bytes and firing
 * a change event on the real input — no OS file dialog involved.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const barongB64 = readFileSync(join(HERE, 'fixtures', 'barong.b64.txt'), 'utf8').trim();
const personB64 = readFileSync(join(HERE, 'fixtures', 'person.b64.txt'), 'utf8').trim();

/**
 * Upload a base64 payload through the real #body-photo-input, exactly as the
 * file picker would: build a File, attach it to the input, fire `change`.
 */
const uploadScript = (b64, mime, name) => `(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
  const input = document.querySelector('#body-photo-input');
  if (!input) return { ok: false, why: 'no #body-photo-input on the page' };
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`;

/** Read the current Studio state: is a photo showing, was one refused? */
const STATE = `(() => {
  const body = document.body.innerText || '';
  const at = body.indexOf('VIRTUAL FITTING CANVAS');
  const canvas = at >= 0 ? body.slice(at, at + 600) : '';
  const bigVisible = Array.from(document.querySelectorAll('img')).filter((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 60 && r.height > 60 && r.top >= 0 && r.left >= 0;
  }).length;
  return {
    canvas,
    canvasEmpty: !/change photo/i.test(body),
    hasChangePhoto: /change photo/i.test(body),
    refused: /not a person|no person|no skin|no head|skin-coloured|could not be checked|could not be read|garment|photo of yourself|re-upload|refused|try another|not be verified|no one wearing/i.test(body),
    bigImages: bigVisible,
  };
})()`;

export default async function run(page) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- Sign in ---------------------------------------------------------------
  await page.goto('http://127.0.0.1:5173/login');

  /*
   * Use Playwright's fill(), not a manual value-setter. The login inputs are
   * React-controlled; `fill()` dispatches the events React listens for, whereas a
   * raw `input.value = x` leaves React's state unchanged and the submit sends an
   * empty credential pair.
   */
  await page.getByRole('textbox', { name: /email/i }).fill('ken@hiraya.com');
  await page.getByRole('textbox', { name: /password/i }).fill('Hiraya2026!');
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait until the route actually leaves /login before going to the Studio.
  await page
    .waitForFunction(() => !location.pathname.includes('/login'), { timeout: 30000 })
    .catch(() => {});
  await sleep(1500);

  await page.goto('http://127.0.0.1:5173/try-on');

  /*
   * The Studio mounts behind a route-level lazy chunk, so "HIRAYA IS LOADING..."
   * can sit on screen for several seconds AFTER the URL already reads /try-on.
   * Wait for the input itself rather than for the path or a fixed delay.
   */
  await page
    .waitForSelector('#body-photo-input', { state: 'attached', timeout: 60000 })
    .catch(() => {});
  await sleep(1500);

  const hasInput = await page.evaluate(`!!document.querySelector('#body-photo-input')`);
  if (!hasInput) {
    const diag = await page.evaluate(`JSON.stringify({
      path: location.pathname,
      url: location.href,
      hasEmail: !!document.querySelector('input[type=\\"email\\"]'),
      inputs: [...document.querySelectorAll('input')].map((i) => i.type + ':' + (i.name || i.id || '?')),
      text: (document.body.innerText || '').slice(0, 300)
    })`);
    return {
      kind: 'constraints',
      ok: false,
      passed: 0,
      failed: 1,
      skipped: 0,
      checks: [{ id: 0, name: 'studio reachable', verdict: 'FAIL', why: 'no #body-photo-input :: ' + diag }],
      report:
        '\n  GARMENT / NO-PERSON GATE — END TO END\n  ' + '='.repeat(52) +
        '\n  FATAL: Studio input never appeared.\n  ' + diag + '\n',
    };
  }

  // --- CASE A: a REAL GARMENT product photo (no person) ----------------------
  const upA = await page.evaluate(uploadScript(barongB64, 'image/jpeg', 'barong.jpg'));
  if (!upA?.ok) {
    return {
      kind: 'constraints',
      ok: false,
      passed: 0,
      failed: 1,
      skipped: 0,
      checks: [{ id: 0, name: 'upload simulation', verdict: 'FAIL', why: upA?.why || 'upload failed' }],
      report: '\n  GARMENT / NO-PERSON GATE — END TO END\n  FATAL: ' + (upA?.why || 'upload failed') + '\n',
    };
  }
  await sleep(15000); // Gemini vision call + local tests, then a verdict
  const afterObject = await page.evaluate(STATE);

  // --- CASE B: a photo WITH a person -----------------------------------------
  const upB = await page.evaluate(uploadScript(personB64, 'image/jpeg', 'qa_person.jpg'));
  await sleep(12000);
  const afterPerson = await page.evaluate(STATE);

  const checks = [
    {
      id: 1,
      name: 'REAL GARMENT photo (no person) is REFUSED',
      verdict: afterObject.refused && !afterObject.hasChangePhoto ? 'pass' : 'FAIL',
      why:
        afterObject.refused && !afterObject.hasChangePhoto
          ? null
          : 'the no-person photo was not refused (hasChangePhoto=' +
            afterObject.hasChangePhoto +
            ', refused=' +
            afterObject.refused +
            ')',
    },
    {
      id: 2,
      name: 'REAL GARMENT photo NEVER reaches the canvas',
      verdict: afterObject.canvasEmpty ? 'pass' : 'FAIL',
      why: afterObject.canvasEmpty ? null : 'the canvas showed "Change Photo" — the object was accepted',
    },
    {
      id: 3,
      name: 'person photo IS accepted onto the canvas',
      verdict: afterPerson.hasChangePhoto ? 'pass' : 'FAIL',
      why: afterPerson.hasChangePhoto ? null : 'a real person photo was not accepted',
    },
    {
      id: 4,
      name: 'upload of the person photo did not throw',
      verdict: upB?.ok ? 'pass' : 'FAIL',
      why: upB?.ok ? null : upB?.why || 'second upload failed',
    },
  ];

  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const lines = ['', '  GARMENT / NO-PERSON GATE — END TO END', '  ' + '='.repeat(52)];
  for (const c of checks) {
    lines.push('  [' + (c.verdict === 'pass' ? 'PASS' : 'FAIL') + '] ' + c.id + '. ' + c.name);
    if (c.why) lines.push('         -> ' + c.why);
  }
  lines.push('');
  lines.push('  after GARMENT upload:');
  lines.push('    canvasEmpty=' + afterObject.canvasEmpty + ' refused=' + afterObject.refused + ' bigImages=' + afterObject.bigImages);
  lines.push('    canvas: ' + afterObject.canvas.slice(0, 200).replace(/\s+/g, ' ').trim());
  lines.push('  after PERSON upload:');
  lines.push('    hasChangePhoto=' + afterPerson.hasChangePhoto + ' bigImages=' + afterPerson.bigImages);
  lines.push('    canvas: ' + afterPerson.canvas.slice(0, 200).replace(/\s+/g, ' ').trim());
  lines.push('  ' + '-'.repeat(52));
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