// usage: node gen.js "<prompt>"
const { chromium } = require('playwright-core');
(async () => {
  const prompt = process.argv[2];
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const p = browser.contexts()[0].pages()[1];
  const box = p.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill(prompt);
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Send' }).click();
  await p.waitForTimeout(2000);
  console.log('sent');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
