#!/usr/bin/env node
// Assemble the final master from timeline.json:
//   1. composite Veo overlay clips onto their scenes (build/sNN.mp4 -> build/sNN-comp.mp4)
//   2. concat all scene videos
//   3. mix VO + music stems at global offsets, mux, light grade
// Usage: node assemble.js [--skip-overlays]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TL = JSON.parse(fs.readFileSync(path.join(__dirname, 'timeline.json'), 'utf8'));
const BUILD = path.join(__dirname, '..', 'build');
const VO = path.join(__dirname, '..', 'assets', 'vo');
const MUSIC = path.join(__dirname, '..', 'assets', 'music');
const CLIPS = path.join(__dirname, '..', 'assets', 'clips');

const ff = args => {
  console.log('ffmpeg', args.join(' ').slice(0, 220), '...');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
};

// global start time of each scene
const starts = {};
let acc = 0;
for (const s of TL.scenes) { starts[s.id] = acc; acc += s.duration; }
const TOTAL = acc;
console.log(`timeline: ${TL.scenes.length} scenes, ${TOTAL.toFixed(1)}s`);

// ---- 1. overlays -----------------------------------------------------------
const skipOverlays = process.argv.includes('--skip-overlays');
const sceneFile = {};
for (const s of TL.scenes) sceneFile[s.id] = path.join(BUILD, `${s.id}.mp4`);

if (!skipOverlays) {
  const bySceneOv = {};
  for (const ov of TL.overlays) (bySceneOv[ov.scene] ||= []).push(ov);
  for (const [scene, ovs] of Object.entries(bySceneOv)) {
    const usable = ovs.filter(ov => fs.existsSync(path.join(CLIPS, ov.clip)));
    for (const ov of ovs) if (!usable.includes(ov)) console.warn(`MISSING clip ${ov.clip} — scene ${scene} keeps its placeholder for that beat`);
    if (!usable.length) continue;
    const out = path.join(BUILD, `${scene}-comp.mp4`);
    const inputs = ['-i', sceneFile[scene]];
    for (const ov of usable) inputs.push('-i', path.join(CLIPS, ov.clip));
    let fc = '';
    let cur = '[0:v]';
    usable.forEach((ov, i) => {
      const idx = i + 1;
      const { x, y, w, h } = ov.rect;
      const dur = ov.to - ov.from;
      const f = ov.fade ?? 0.4;
      // scale, loop the clip if shorter than window, fade alpha in/out, shift PTS to window start
      fc += `[${idx}:v]scale=${w}:${h},loop=loop=-1:size=32767,trim=0:${dur},` +
            `format=yuva420p,fade=t=in:st=0:d=${f}:alpha=1,fade=t=out:st=${(dur - f).toFixed(2)}:d=${f}:alpha=1,` +
            `setpts=PTS+${ov.from}/TB[ov${idx}];`;
      const next = i === usable.length - 1 ? '[vout]' : `[tmp${idx}]`;
      fc += `${cur}[ov${idx}]overlay=${x}:${y}:enable='between(t,${ov.from},${ov.to})'${next};`;
      cur = `[tmp${idx}]`;
    });
    fc = fc.replace(/;$/, '');
    ff([...inputs, '-filter_complex', fc, '-map', '[vout]', '-an',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(TL.fps), out]);
    sceneFile[scene] = out;
  }
}

// ---- 2. concat video --------------------------------------------------------
for (const s of TL.scenes) {
  if (!fs.existsSync(sceneFile[s.id])) { console.error(`MISSING scene video ${sceneFile[s.id]}`); process.exit(1); }
}
const listFile = path.join(BUILD, 'concat.txt');
fs.writeFileSync(listFile, TL.scenes.map(s => `file '${sceneFile[s.id]}'`).join('\n') + '\n');
const vConcat = path.join(BUILD, 'video-concat.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', vConcat]);

// ---- 3. audio mix ------------------------------------------------------------
const audioInputs = [];
const labels = [];
let fc = '';
let n = 0;
function addAudio(file, atSec, gainDb, extra = '') {
  audioInputs.push('-i', file);
  const lbl = `a${n}`;
  // input 0 is the concatenated video; audio inputs start at ffmpeg index 1
  fc += `[${n + 1}:a]${extra}volume=${gainDb}dB,adelay=${Math.round(atSec * 1000)}|${Math.round(atSec * 1000)}[${lbl}];`;
  labels.push(`[${lbl}]`);
  n++;
}

// VO
for (const s of TL.scenes) addAudio(path.join(VO, s.vo), starts[s.id] + TL.voStartOffset, 0);

// music
for (const m of TL.music) {
  const file = path.join(MUSIC, m.stem);
  if (!fs.existsSync(file)) { console.warn('missing stem', m.stem); continue; }
  const at = starts[m.atScene] + (m.at || 0);
  let extra = '';
  if (m.spanScenes) {
    const end = m.spanScenes.reduce((e, id) => Math.max(e, starts[id] + TL.scenes.find(s => s.id === id).duration), 0);
    const span = end - at;
    // loop stem to span, fade out at end
    extra = `aloop=loop=-1:size=2147483647,atrim=0:${span.toFixed(2)},afade=t=out:st=${(span - 2).toFixed(2)}:d=2,`;
  } else if (m.cutAtSceneEnd) {
    const sc = TL.scenes.find(s => s.id === m.atScene);
    const span = sc.duration - (m.at || 0);
    extra = `atrim=0:${span.toFixed(2)},`;  // hard cut (shepard: unresolved)
  } else if (m.fadeOutAt) {
    extra = `atrim=0:${m.fadeOutAt},afade=t=out:st=${m.fadeOutAt - 3}:d=3,`;
  }
  addAudio(file, at, m.gainDb, extra);
}

fc += labels.join('') + `amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter=limit=0.92,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;

const master = path.join(BUILD, 'corellia-strange-loop-v1.mp4');
ff(['-i', vConcat, ...audioInputs, '-filter_complex', fc,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(TOTAL), master]);
console.log('MASTER:', master);
