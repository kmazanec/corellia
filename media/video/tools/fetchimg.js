// usage: node fetchimg.js <imageId> <outPath>
const { chromium } = require('playwright-core');
const fs = require('fs');
const PID = 'e4028583-2586-4ae7-96a3-45ce58db184e';
(async () => {
  const [id, out] = process.argv.slice(2);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const p = browser.contexts()[0].pages()[1];
  const url = `/api/project/${PID}/image/${id}/url/filename/${id}?fit=contain&width=5376&quality=100`;
  const b64 = await p.evaluate(async u => {
    const r = await fetch(u);
    if (!r.ok) throw new Error('fetch ' + r.status);
    const buf = await r.arrayBuffer();
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, url);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('saved', out, fs.statSync(out).size, 'bytes');
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
