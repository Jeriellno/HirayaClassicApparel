// Reproduce the heart-click bug: does clicking the heart twice add then remove,
// or add twice?
export default async function run(page, ui) {
  const out = { cartCalls: [], consoleErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text()); });
  page.on('response', (res) => {
    const u = res.url();
    if (/\/api\/cart/.test(u)) {
      out.cartCalls.push({ method: res.request().method(), url: u.replace(/^https?:\/\/[^/]+/, ''), status: res.status() });
    }
  });

  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  let snap = await ui.snapshot();
  await ui.fill(snap.match(/@(e\d+)\s+textbox[^\n]*[Ee]mail/)?.[1], 'aya@hiraya.com');
  await ui.fill(snap.match(/@(e\d+)\s+textbox[^\n]*[Pp]assword/)?.[1], 'password123');
  snap = await ui.snapshot();
  await ui.click(snap.match(/@(e\d+)\s+button[^\n]*SIGN IN/i)?.[1]);
  await page.waitForTimeout(9000);

  // Start from a known state: clear the bag.
  await page.evaluate(async () => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    await fetch('http://127.0.0.1:8000/api/cart', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  });
  await page.waitForTimeout(2500);

  await page.goto('http://localhost:5173/shop', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 50; i++) {
    const ok = await page.evaluate(() => document.querySelectorAll('img').length > 2);
    if (ok) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Find the FIRST wishlist heart on a card.
  const heartInfo = await page.evaluate(() => {
    const hearts = [...document.querySelectorAll('button[aria-label*="wishlist" i]')];
    return { count: hearts.length, firstLabel: hearts[0]?.getAttribute('aria-label') || null };
  });
  out.heartsOnPage = heartInfo;

  const heart = page.locator('button[aria-label*="wishlist" i]').first();
  if (await heart.count()) {
    // CLICK 1 — should ADD.
    out.cartCalls.length = 0;
    await heart.click();
    await page.waitForTimeout(4000);
    out.afterClick1 = { calls: [...out.cartCalls] };

    // CLICK 2 — should REMOVE (a toggle).
    out.cartCalls.length = 0;
    await heart.click();
    await page.waitForTimeout(4000);
    out.afterClick2 = { calls: [...out.cartCalls] };

    // What is in the bag now?
    out.bagAfter = await page.evaluate(async () => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const r = await fetch('http://127.0.0.1:8000/api/cart', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const j = await r.json();
      return { count: j.count, rows: (j.items || []).map((i) => ({ pid: i.product_id, size: i.selected_size, qty: i.quantity })) };
    });
  }

  return out;
}
