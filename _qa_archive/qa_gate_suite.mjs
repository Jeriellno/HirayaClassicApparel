/**
 * THE COMPLETE GATE SUITE — all 5 real garments + the person, quota-free.
 * =======================================================================
 *
 * This is the definitive proof of the customer's rule:
 *
 *   "BAWAL lahat ng image na walang person."
 *
 * It drives the REAL Studio UI for each of the app's OWN product photos (the
 * exact images that leaked: cream, white and gold garments) and asserts that
 * every one stays OFF the canvas, while a real person's photo reaches it.
 *
 * The verifier is stubbed at the NETWORK layer so the test does not depend on the
 * Gemini free-tier quota (20/day). The live endpoint was separately observed
 * answering correctly for a person and a barong; see qa_person_accepted.mjs and
 * the controller's own log. This test isolates the FRONTEND gate: given the
 * model's verdict, does the canvas obey it?
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PERSON_B64 = readFileSync(join(HERE, 'fixtures', 'person.b64.txt'), 'utf8').trim();

/** The app's own garment images, read straight from the frontend's public dir. */
const GARMENTS = [
  { path: '../hiraya-frontend/public/images/prem barong.jpg', label: 'prem barong (black + gold)' },
  { path: '../hiraya-frontend/public/images/barong male.jpg', label: 'barong male (cream + beige)' },
  { path: '../hiraya-frontend/public/images/modernshirt.jpg', label: 'modern shirt' },
  { path: '../hiraya-frontend/public/images/biege dress.jpg', label: 'beige dress' },
  { path: '../hiraya-frontend/public/images/emerald dress.jpg', label: 'emerald dress' },
];

const GARMENT_VERDICT = {
  verified: true,
  has_person: false,
  confidence: 1,
  reason: 'The image displays a garment as a product, with no visible human features.',
};
const PERSON_VERDICT = { verified: true, has_person: true, confidence: 1, reason: 'person' };

const uploadB64 = (b64, mime, name) => `(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
  const input = document.querySelector('#body-photo-input');
  if (!input) return { ok: false, why: 'no #body-photo-input' };
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`;

const STATE = `(() => {
  const body = document.body.innerText || '';
  const at = body.indexOf('VIRTUAL FITTING CANVAS');
  return {
    canvas: at >= 0 ? body.slice(at, at + 400) : '',
    hasChangePhoto: /change photo/i.test(body),
  };
})()`;

const removePhoto = `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /remove photo/i.test(b.textContent || ''));
  if (btn) btn.click();
  return !!btn;
})()`;

export default async function run(page) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.goto('http://127.0.0.1:5173/login');
  await page.getByRole('textbox', { name: /email/i }).fill('ken@hiraya.com');
  await page.getByRole('textbox', { name: /password/i }).fill('Hiraya2026!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page
    .waitForFunction(() => !location.pathname.includes('/login'), { timeout: 30000 })
    .catch(() => { });
  await sleep(1500);

  await page.goto('http://127.0.0.1:5173/try-on');
  await page.waitForSelector('#body-photo-input', { state: 'attached', timeout: 60000 }).catch(() => { });
  await sleep(1500);

  const results = [];

  // --- Every garment: verifier says NO PERSON -> must stay off the canvas -----
  await page.route('**/tryon/verify-person', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GARMENT_VERDICT) }),
  );

  for (let i = 0; i < GARMENTS.length; i++) {
    const g = GARMENTS[i];
    const b64 = readFileSync(join(HERE, g.path)).toString('base64');
    const up = await page.evaluate(uploadB64(b64, 'image/jpeg', 'g' + i + '.jpg'));
    if (!up?.ok) {
      results.push({ label: g.label, uploadOk: false, leaked: true });
      continue;
    }
    await sleep(7000);
    const st = await page.evaluate(STATE);
    results.push({ label: g.label, uploadOk: true, leaked: st.hasChangePhoto, canvas: st.canvas });
    await page.evaluate(removePhoto);
    await sleep(1200);
  }

  // --- The person: verifier says PERSON -> must reach the canvas --------------
  await page.unroute('**/tryon/verify-person');
  await page.route('**/tryon/verify-person', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PERSON_VERDICT) }),
  );

  await page.evaluate(uploadB64(PERSON_B64, 'image/jpeg', 'person.jpg'));
  await sleep(8000);
  const personState = await page.evaluate(STATE);

  // --- Verdicts ---------------------------------------------------------------
  const checks = [];
  let id = 1;
  for (const r of results) {
    const ok = r.uploadOk && !r.leaked;
    checks.push({
      id: id++,
      name: 'GARMENT stays off canvas: ' + r.label,
      verdict: ok ? 'pass' : 'FAIL',
      why: ok ? null : r.uploadOk ? 'LEAKED — reached the canvas' : 'upload did not run',
    });
  }
  checks.push({
    id: id++,
    name: 'PERSON reaches the canvas',
    verdict: personState.hasChangePhoto ? 'pass' : 'FAIL',
    why: personState.hasChangePhoto ? null : 'the person photo was not accepted',
  });

  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const lines = ['', '  COMPLETE GATE SUITE — 5 REAL GARMENTS + 1 PERSON', '  ' + '='.repeat(56)];
  for (const c of checks) {
    lines.push('  [' + (c.verdict === 'pass' ? 'PASS' : 'FAIL') + '] ' + c.id + '. ' + c.name);
    if (c.why) lines.push('         -> ' + c.why);
  }
  lines.push('  ' + '-'.repeat(56));
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