// usage: node save.js <imgIndex|alt-regex> <outPath>
const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const [sel, out] = process.argv.slice(2);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const p = browser.contexts()[0].pages()[1];
  const imgs = p.locator('img');
  const n = await imgs.count();
  let src = null, alt = null;
  for (let i = 0; i < n; i++) {
    const s = await imgs.nth(i).getAttribute('src') || '';
    const a = await imgs.nth(i).getAttribute('alt') || '';
    if (!s.includes('/api/project/')) continue;
    if (/^\d+$/.test(sel) ? +sel === i : new RegExp(sel, 'i').test(a)) { src = s; alt = a; break; }
  }
  if (!src) throw new Error('no matching image');
  const full = src.split('?')[0] + '?fit=contain&width=5376&quality=100';
  const b64 = await p.evaluate(async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error('fetch ' + r.status);
    const buf = await r.arrayBuffer();
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, full);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('saved', out, 'alt=', alt, fs.statSync(out).size, 'bytes');
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
