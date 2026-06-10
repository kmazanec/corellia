#!/usr/bin/env node
// Render a code scene to mp4: headless Chromium steps window.seek(t) at 30fps,
// screenshots are piped straight into ffmpeg (no intermediate files).
// Usage: node record-scene.js <sceneId> [--fps=30]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');

const EXEC = '/Users/keith/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const SCENES_DIR = path.join(__dirname, '..', 'scenes');
const BUILD = path.join(__dirname, '..', 'build');

(async () => {
  const sceneId = process.argv[2];
  if (!sceneId) { console.error('usage: record-scene.js <sceneId>'); process.exit(1); }
  const fps = +((process.argv.find(a => a.startsWith('--fps=')) || '').split('=')[1] || 30);

  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto('file://' + path.join(SCENES_DIR, 'player.html') + `?scene=${sceneId}`);
  const meta = await page.evaluate(() => window.ready);
  const frames = Math.ceil(meta.duration * fps);
  console.log(`${sceneId}: ${meta.duration}s -> ${frames} frames @ ${fps}fps`);

  const out = path.join(BUILD, `${sceneId}.mp4`);
  const ff = spawn('ffmpeg', [
    '-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-r', String(fps), out,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', d => { ffErr += d; if (ffErr.length > 40000) ffErr = ffErr.slice(-20000); });
  const ffDone = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c + '\n' + ffErr.slice(-2000))))));

  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate(t => window.seek(t), i / fps);
    const buf = await page.locator('#cv').screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`  frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }
  ff.stdin.end();
  await ffDone;
  await browser.close();
  console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
