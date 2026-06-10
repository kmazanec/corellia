// Verify logged-in sessions in Keith's .chrome-claude browser over CDP.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('no default browser context');

  const existing = ctx.pages().map(p => p.url());
  console.log('open tabs:', JSON.stringify(existing, null, 1));

  // Reve
  const reve = await ctx.newPage();
  await reve.goto('https://app.reve.com', { waitUntil: 'networkidle', timeout: 45000 }).catch(e => console.log('reve nav:', e.message));
  await reve.waitForTimeout(3000);
  const reveState = {
    url: reve.url(),
    title: await reve.title(),
    hasSignup: await reve.getByText(/sign up|start creating/i).count().catch(() => -1),
    bodySnippet: (await reve.evaluate(() => document.body.innerText.slice(0, 400))).replace(/\n+/g, ' | '),
  };
  console.log('REVE:', JSON.stringify(reveState, null, 1));
  await reve.screenshot({ path: '../build/check-reve.png' });

  // Flow
  const flow = await ctx.newPage();
  await flow.goto('https://labs.google/fx/tools/flow', { waitUntil: 'networkidle', timeout: 45000 }).catch(e => console.log('flow nav:', e.message));
  await flow.waitForTimeout(3000);
  const flowState = {
    url: flow.url(),
    title: await flow.title(),
    bodySnippet: (await flow.evaluate(() => document.body.innerText.slice(0, 400))).replace(/\n+/g, ' | '),
  };
  console.log('FLOW:', JSON.stringify(flowState, null, 1));
  await flow.screenshot({ path: '../build/check-flow.png' });

  await reve.close();
  await flow.close();
  await browser.close();
})();
