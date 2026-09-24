// Look at My Bag as a real signed-in customer sees it.
export default async function run(page, ui) {
  const out = { consoleErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text()); });

  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  let snap = await ui.snapshot();
  await ui.fill(snap.match(/@(e\d+)\s+textbox[^\n]*[Ee]mail/)?.[1], 'aya@hiraya.com');
  await ui.fill(snap.match(/@(e\d+)\s+textbox[^\n]*[Pp]assword/)?.[1], 'password123');
  snap = await ui.snapshot();
  await ui.click(snap.match(/@(e\d+)\s+button[^\n]*SIGN IN/i)?.[1]);
  await page.waitForTimeout(9000);

  await page.goto('http://localhost:5173/cart', { waitUntil: 'domcontentloaded' });
  // "LOADING YOUR BAG..." persists until the cart query settles, so wait for the
  // real content markers instead of a fixed delay.
  for (let i = 0; i < 60; i++) {
    const ready = await page.evaluate(() =>
      /ITEM(S)?\s+SELECTED|YOUR BAG IS EMPTY|ORDER SUMMARY/i.test(document.body.innerText));
    if (ready) break;
    await page.waitForTimeout(1000);
  }
  out.loadedAfterMs = await page.evaluate(() => null);

  out.summary = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      heading: (t.match(/MY BAG/i) || [])[0] || null,
      itemLine: (t.match(/\d+\s+ITEM(S)?\s+SELECTED/i) || [])[0] || null,
      hasStyleStack: /STYLE STACK/i.test(t),
      hasOrderSummary: /ORDER SUMMARY/i.test(t),
      hasProceed: /PROCEED TO CHECKOUT/i.test(t),
      isEmpty: /YOUR BAG IS EMPTY/i.test(t),
      mentionsSaved: /SAVED/i.test(t),
      bodySnippet: t.slice(0, 800),
    };
  });

  return out;
}
