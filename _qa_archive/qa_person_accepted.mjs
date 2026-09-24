/**
 * PERSON ACCEPTANCE — the positive half of the gate.
 * ==================================================
 *
 * The garment refusal is proven by `qa_garment_gate_e2e.mjs`. This proves the
 * OTHER direction on its own, so a Gemini quota window is spent on ONE call:
 * a real person's photo MUST reach the canvas ("Change Photo" appears).
 *
 * Run this on its own when the garment test said "person photo was not accepted"
 * — that failure is almost always the free-tier quota (429), not the gate.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const personB64 = readFileSync(join(HERE, 'fixtures', 'person.b64.txt'), 'utf8').trim();

const uploadScript = (b64, mime, name) => `(async () => {
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
  const canvas = at >= 0 ? body.slice(at, at + 600) : '';
  return {
    canvas,
    hasChangePhoto: /change photo/i.test(body),
    refused: /not accepted|not a person|no person|could not be verified|re-upload|try another/i.test(body),
  };
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

  const up = await page.evaluate(uploadScript(personB64, 'image/jpeg', 'qa_person.jpg'));
  if (!up?.ok) {
    return {
      kind: 'constraints', ok: false, passed: 0, failed: 1, skipped: 0,
      checks: [{ id: 1, name: 'upload', verdict: 'FAIL', why: up?.why || 'upload failed' }],
      report: '\n  PERSON ACCEPTANCE\n  FATAL: ' + (up?.why || 'upload failed') + '\n',
    };
  }

  await sleep(16000); // allow the Gemini vision call
  const after = await page.evaluate(STATE);

  const accepted = after.hasChangePhoto === true;
  const checks = [
    {
      id: 1,
      name: 'a real person photo IS accepted onto the canvas',
      verdict: accepted ? 'pass' : 'FAIL',
      why: accepted ? null : 'not accepted — canvas said: ' + after.canvas.slice(0, 200).replace(/\s+/g, ' ').trim(),
    },
  ];

  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const lines = ['', '  PERSON ACCEPTANCE', '  ' + '='.repeat(52)];
  for (const c of checks) {
    lines.push('  [' + (c.verdict === 'pass' ? 'PASS' : 'FAIL') + '] ' + c.id + '. ' + c.name);
    if (c.why) lines.push('         -> ' + c.why);
  }
  lines.push('');
  lines.push('  hasChangePhoto=' + after.hasChangePhoto + ' refused=' + after.refused);
  lines.push('  canvas: ' + after.canvas.slice(0, 220).replace(/\s+/g, ' ').trim());
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