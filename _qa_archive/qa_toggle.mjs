// The heart must behave as a real TOGGLE: click 1 adds, click 2 removes.
// This is the "added then vanished / quantity climbed to 11" bug.
export default async function run(page, ui) {
  const out = { cartCalls: [], consoleErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text()); });
  page.on('response', (res) => {
    const u = res.url();
    if (/\/api\/cart/.test(u)) {
      out.cartCalls.push({ method: res.request().method(), url: u.replace(/^https?:\/\/[^/]+/, ''), status: res.status() });
    }
  });

  const tokenOf = () => page.evaluate(() => localStorage.getItem('token') || sessionStorage.getItem('token'));
  const bagOf = async () => {
    const token = await tokenOf();
    return page.evaluate(async (t) => {
      const r = await fetch('http://127.0.0.1:8000/api/cart', {
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
      });
      const j = await r.json();
      return { count: j.count, rows: (j.items || []).map((i) => ({ pid: i.product_id, size: i.selected_size, qty: i.quantity })) };
    }, token);
  };

  // Log in. The app gates every route behind `useMaintenanceMode()`, a Supabase
  // query that can take ~50s to settle here, so wait for the FORM to exist.
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 90; i++) {
    const ready = await page.evaluate(() => /SIGN IN/i.test(document.body.innerText) && document.querySelectorAll('input').length >= 2);
    if (ready) break;
    await page.waitForTimeout(1000);
  }
  let snap = await ui.snapshot();
  await ui.fill(snap.match(/@(e\d+)\s+textbox[^\n]*[Ee]mail/)?.[1], 'aya@hiraya.com');
  await ui.fill(snap.match(/@(e\d+)\s+textbox[^\n]*[Pp]assword/)?.[1], 'password123');
  snap = await ui.snapshot();
  await ui.click(snap.match(/@(e\d+)\s+button[^\n]*SIGN IN/i)?.[1]);
  await page.waitForTimeout(9000);

  // Start clean.
  const token = await tokenOf();
  await page.evaluate(async (t) => {
    await fetch('http://127.0.0.1:8000/api/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
    });
  }, token);
  await page.waitForTimeout(2500);
  out.bagStart = await bagOf();

  // Go to the shop and find a heart.
  await page.goto('http://localhost:5173/shop', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => document.querySelectorAll('button[aria-label*="wishlist" i]').length > 0)) break;
    await page.waitForTimeout(1000);
  }
  out.heartsFound = await page.evaluate(() => document.querySelectorAll('button[aria-label*="wishlist" i]').length);

  // Click 1: ADD
  await page.evaluate(() => document.querySelector('button[aria-label*="wishlist" i]').click());
  await page.waitForTimeout(5000);
  out.afterClick1 = await bagOf();
  out.calls1 = out.cartCalls.map((c) => `${c.method} ${c.url} -> ${c.status}`);

  // Click 2: REMOVE
  out.cartCalls.length = 0;
  await page.evaluate(() => document.querySelector('button[aria-label*="wishlist" i]').click());
  await page.waitForTimeout(5000);
  out.afterClick2 = await bagOf();
  out.calls2 = out.cartCalls.map((c) => `${c.method} ${c.url} -> ${c.status}`);

  // Verdict
  out.toggleWorks =
    out.afterClick1.rows.length === 1 &&
    out.afterClick2.rows.length === 0;

  return out;
}
