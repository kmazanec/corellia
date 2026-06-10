#!/usr/bin/env node
// Snapshot a single frame of a scene: node snap.js <sceneId> <t> [<t2> ...]
// Writes build/snap-<sceneId>-<t>.png for each time. Fast visual iteration.
const { chromium } = require('playwright-core');
const path = require('path');

const EXEC = '/Users/keith/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

(async () => {
  const [, , sceneId, ...times] = process.argv;
  if (!sceneId || !times.length) { console.error('usage: snap.js <sceneId> <t> [t2 ...]'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('file://' + path.join(__dirname, '..', 'scenes', 'player.html') + `?scene=${sceneId}`);
  await page.evaluate(() => window.ready);
  for (const ts of times) {
    await page.evaluate(t => window.seek(t), +ts);
    const out = path.join(__dirname, '..', 'build', `snap-${sceneId}-${ts}.png`);
    await page.locator('#cv').screenshot({ path: out });
    console.log(out);
  }
  if (errs.length) console.log('PAGE ERRORS:\n' + errs.slice(0, 10).join('\n'));
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
