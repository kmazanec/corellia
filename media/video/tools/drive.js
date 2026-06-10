#!/usr/bin/env node
// Minimal CDP driver for Keith's .chrome-claude browser (port 9222).
// Usage: node drive.js <cmd> [args...]
//   tabs                                  list open tabs
//   goto <url> [tabIdx]                   navigate (new tab if no idx)
//   shot <out.png> [tabIdx]               viewport screenshot
//   aria [tabIdx] [maxChars]              aria snapshot of the page
//   text [tabIdx]                         body innerText (first 4000 chars)
//   click <selectorOrText> [tabIdx]       click element (CSS selector, or text=...)
//   type <selector> <text...> [--tab=N]   fill input
//   key <key> [tabIdx]                    press key (Enter, Escape, ...)
//   eval <js> [tabIdx]                    evaluate JS in page, print result
//   upload <selector> <file> [tabIdx]     set file on <input type=file>
//   waitdl <out-dir> <timeoutMs> [tabIdx] wait for next download, save it
//
// tabIdx refers to ctx.pages() order from `tabs`.
const { chromium } = require('playwright-core');

(async () => {
  const [, , cmd, ...args] = process.argv;
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const tabArg = (def => {
    const i = args.findIndex(a => /^--tab=\d+$/.test(a));
    if (i >= 0) { const v = +args[i].split('=')[1]; args.splice(i, 1); return v; }
    return def;
  });

  const pick = idx => {
    const p = pages[idx];
    if (!p) throw new Error(`no tab ${idx}; have ${pages.length}`);
    return p;
  };

  try {
    switch (cmd) {
      case 'tabs': {
        pages.forEach((p, i) => console.log(`${i}: ${p.url()}`));
        break;
      }
      case 'goto': {
        const idx = args[1] !== undefined ? +args[1] : -1;
        const p = idx >= 0 ? pick(idx) : await ctx.newPage();
        await p.goto(args[0], { waitUntil: 'domcontentloaded', timeout: 60000 });
        await p.waitForTimeout(2500);
        console.log('at', p.url());
        break;
      }
      case 'shot': {
        const p = pick(+(args[1] ?? 0));
        await p.screenshot({ path: args[0] });
        console.log('saved', args[0]);
        break;
      }
      case 'aria': {
        const p = pick(+(args[0] ?? 0));
        const max = +(args[1] ?? 6000);
        const snap = await p.locator('body').ariaSnapshot();
        console.log(snap.slice(0, max));
        break;
      }
      case 'text': {
        const p = pick(+(args[0] ?? 0));
        console.log((await p.evaluate(() => document.body.innerText)).slice(0, 4000));
        break;
      }
      case 'click': {
        const idx = tabArg(0);
        const sel = args[0];
        const p = pick(idx);
        const loc = sel.startsWith('text=')
          ? p.getByText(new RegExp(sel.slice(5), 'i')).first()
          : p.locator(sel).first();
        await loc.click({ timeout: 10000 });
        await p.waitForTimeout(1500);
        console.log('clicked', sel);
        break;
      }
      case 'type': {
        const idx = tabArg(0);
        const p = pick(idx);
        const sel = args.shift();
        const text = args.join(' ');
        const loc = p.locator(sel).first();
        await loc.click({ timeout: 10000 });
        await loc.fill(text).catch(async () => {
          await p.keyboard.type(text, { delay: 10 });
        });
        console.log('typed into', sel);
        break;
      }
      case 'key': {
        const p = pick(+(args[1] ?? 0));
        await p.keyboard.press(args[0]);
        await p.waitForTimeout(1000);
        console.log('pressed', args[0]);
        break;
      }
      case 'eval': {
        const p = pick(+(args[1] ?? 0));
        const r = await p.evaluate(args[0]);
        console.log(JSON.stringify(r, null, 1)?.slice(0, 6000));
        break;
      }
      case 'upload': {
        const p = pick(+(args[2] ?? 0));
        await p.locator(args[0]).first().setInputFiles(args[1]);
        console.log('uploaded', args[1]);
        break;
      }
      case 'waitdl': {
        const p = pick(+(args[2] ?? 0));
        const dl = await p.waitForEvent('download', { timeout: +(args[1] ?? 60000) });
        const out = `${args[0]}/${dl.suggestedFilename()}`;
        await dl.saveAs(out);
        console.log('downloaded', out);
        break;
      }
      default:
        throw new Error(`unknown cmd ${cmd}`);
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
