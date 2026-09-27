/**
 * PERSON ACCEPTANCE — PROVEN WITHOUT BURNING QUOTA.
 * =================================================
 *
 * The positive direction ("a real person's photo reaches the canvas") cannot be
 * re-run right now because the Gemini free tier is 20 requests PER DAY and the
 * diagnostic runs above exhausted it. Waiting for it is not a fix, and saying
 * "trust me, it works" is not a proof.
 *
 * So this test proves the WIRING instead: it stubs the network call that
 * `verifyPersonWithVision` makes, in the page, to answer exactly what the real
 * Gemini endpoint answers for a person —
 *
 *   {"verified": true, "has_person": true, "confidence": 1, "reason": "person"}
 *
 * (captured live: "A real human person is clearly visible in the photo.")
 *
 * — and asserts that the SAME photo then reaches the canvas. That isolates the
 * frontend: if the gate logic or the UI were wrong, the stub would still fail.
 *
 * The complementary case is stubbed too (`has_person:false`) to prove a garment
 * is refused by the SAME code path, so both verdicts are exercised.
 *
 * The REAL endpoint is proven separately and was observed working:
 *   PERSON  -> {"verified":true,"has_person":true,"confidence":1}
 *   BARONG  -> {"verified":true,"has_person":false,"confidence":1,
 *               "reason":"The image displays a garment as a product ... no visible
 *                human features."}
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const personB64 = readFileSync(join(HERE, 'fixtures', 'person.b64.txt'), 'utf8').trim();
const barongB64 = readFileSync(join(HERE, 'fixtures', 'barong.b64.txt'), 'utf8').trim();

/**
 * Install a fetch/axios interceptor in the page that answers the verification
 * route with a chosen verdict. Everything else is untouched.
 */
const stubVerdict = (json) => `(() => {
  const VERDICT = ${JSON.stringify(json)};
  if (!window.__origFetchForGate) window.__origFetchForGate = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/tryon/verify-person')) {
      return new Response(JSON.stringify(VERDICT), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return window.__origFetchForGate(input, init);
  };
  // axios uses XHR in the browser; cover both transports.
  if (!window.__origXhrOpenForGate) {
    window.__origXhrOpenForGate = XMLHttpRequest.prototype.open;
    window.__origXhrSendForGate = XMLHttpRequest.prototype.send;
  }
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gateUrl = String(url || '');
    return window.__origXhrOpenForGate.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__gateUrl && this.__gateUrl.includes('/tryon/verify-person')) {
      const self = this;
      setTimeout(() => {
        Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(self, 'status', { value: 200, configurable: true });
        Object.defineProperty(self, 'responseText', { value: JSON.stringify(VERDICT), configurable: true });
        Object.defineProperty(self, 'response', { value: JSON.stringify(VERDICT), configurable: true });
        self.getAllResponseHeaders = () => 'content-type: application/json';
        if (self.onreadystatechange) self.onreadystatechange();
        if (self.onload) self.onload();
      }, 30);
      return;
    }
    return window.__origXhrSendForGate.apply(this, arguments);
  };
  return true;
})()`;

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
  const canvas = at >= 0 ? body.slice(at, at + 500) : '';
  return { canvas, hasChangePhoto: /change photo/i.test(body) };
})()`;

const PERSON_VERDICT = { verified: true, has_person: true, confidence: 1, reason: 'person' };
const GARMENT_VERDICT = {
  verified: true,
  has_person: false,
  confidence: 1,
  reason: 'The image displays a garment as a product, no visible human features.',
};

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

  // --- CASE 1: verifier says PERSON -> the person photo must be ACCEPTED -----
  /*
   * Intercept at the NETWORK layer with Playwright, not by patching fetch/XHR in
   * the page. axios 1.x captures its transport at module load, so patching the
   * prototypes after the app has booted does not reliably take effect — but
   * page.route intercepts the HTTP request itself, below all of that.
   */
  await page.route('**/tryon/verify-person', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PERSON_VERDICT),
    }),
  );
  await page.evaluate(uploadScript(personB64, 'image/jpeg', 'person.jpg'));
  await sleep(9000);
  const personState = await page.evaluate(STATE);

  // Remove it so the next upload starts clean.
  await page.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /remove photo/i.test(b.textContent || ''));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(1500);

  // --- CASE 2: verifier says GARMENT -> the garment must be REFUSED ----------
  await page.unroute('**/tryon/verify-person');
  await page.route('**/tryon/verify-person', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(GARMENT_VERDICT),
    }),
  );
  await page.evaluate(uploadScript(barongB64, 'image/jpeg', 'barong.jpg'));
  await sleep(9000);
  const garmentState = await page.evaluate(STATE);

  const checks = [
    {
      id: 1,
      name: 'verifier says PERSON -> person photo reaches the canvas',
      verdict: personState.hasChangePhoto ? 'pass' : 'FAIL',
      why: personState.hasChangePhoto
        ? null
        : 'canvas did not show the photo: ' + personState.canvas.slice(0, 160).replace(/\s+/g, ' ').trim(),
    },
    {
      id: 2,
      name: 'verifier says GARMENT -> garment stays OFF the canvas',
      verdict: !garmentState.hasChangePhoto ? 'pass' : 'FAIL',
      why: garmentState.hasChangePhoto ? 'the garment reached the canvas' : null,
    },
  ];

  const failures = checks.filter((c) => c.verdict === 'FAIL');
  const lines = ['', '  PERSON ACCEPTANCE — WIRING PROOF (stubbed verifier)', '  ' + '='.repeat(58)];
  for (const c of checks) {
    lines.push('  [' + (c.verdict === 'pass' ? 'PASS' : 'FAIL') + '] ' + c.id + '. ' + c.name);
    if (c.why) lines.push('         -> ' + c.why);
  }
  lines.push('');
  lines.push('  person  -> hasChangePhoto=' + personState.hasChangePhoto);
  lines.push('  garment -> hasChangePhoto=' + garmentState.hasChangePhoto);
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