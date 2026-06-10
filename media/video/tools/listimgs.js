const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const p = browser.contexts()[0].pages()[1];
  const imgs = p.locator('img');
  const n = await imgs.count();
  for (let i = 0; i < n; i++) {
    const s = await imgs.nth(i).getAttribute('src') || '';
    if (!s.includes('/api/project/')) continue;
    const a = await imgs.nth(i).getAttribute('alt') || '';
    const el = imgs.nth(i);
    const dims = await el.evaluate(e => e.getAttribute('width') + 'x' + e.getAttribute('height'));
    console.log(i, JSON.stringify(a), dims, s.slice(20, 110));
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
