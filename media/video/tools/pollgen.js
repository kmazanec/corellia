// usage: node pollgen.js <expectedCount> [timeoutMs] — polls node API until N generations exist and prints them
const { chromium } = require('playwright-core');
const PID = 'e4028583-2586-4ae7-96a3-45ce58db184e';
(async () => {
  const expected = +(process.argv[2] || 12);
  const timeoutMs = +(process.argv[3] || 300000);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const p = browser.contexts()[0].pages()[1];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const body = await p.evaluate(async pid => {
      const r = await fetch(`/api/project/${pid}/node?props=type%3Ageneration&since=2023-12-12T16%3A20%3A00.000Z&count=250&include=id%2Cname%2Ccreated_at%2Coutput`);
      return r.json();
    }, PID);
    const done = body.list.filter(it => it.data && it.data.output);
    if (done.length >= expected) {
      done.sort((a,b)=>a.node.created_at.localeCompare(b.node.created_at));
      done.forEach(it => console.log(it.node.created_at, JSON.stringify(it.node.name), it.data.output));
      break;
    }
    await p.waitForTimeout(8000);
  }
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
