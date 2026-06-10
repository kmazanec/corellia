// Shared rendering library for all Corellia explainer scenes.
// Every scene is a pure function of time: draw(ctx, t) with t in seconds.
// Deterministic — no Date.now(), no Math.random() without a seeded RNG.

'use strict';

const W = 1920, H = 1080;

const C = {
  bg: '#0a0a0c',
  ink: '#e8e6e0',
  dim: '#6b6963',
  faint: '#2a2a2e',
  amber: '#f5a623',
  amberDim: 'rgba(245,166,35,0.35)',
  green: '#4ade80',
  red: '#ef4444',
  paper: '#e9e2d0',
  paperInk: '#2b2620',
};

const FONT = px => `${px}px "SF Mono", Menlo, monospace`;
const SERIF = px => `${px}px Georgia, serif`;

// ---- easing ---------------------------------------------------------------
const clamp01 = x => Math.max(0, Math.min(1, x));
// progress of t through [a,b]
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const easeOut = x => 1 - Math.pow(1 - x, 3);
const easeIn = x => x * x * x;
const easeInOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// seeded RNG (mulberry32) — deterministic across runs
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---- text ------------------------------------------------------------------
// terminal-typed text: reveals chars at cps, with blinking cursor
function typed(ctx, text, x, y, t, t0, { cps = 30, size = 36, color = C.ink, cursor = true, align = 'left' } = {}) {
  if (t < t0) return false;
  const n = Math.min(text.length, Math.floor((t - t0) * cps));
  const shown = text.slice(0, n);
  ctx.font = FONT(size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, x, y);
  if (cursor && n < text.length || (cursor && Math.floor(t * 2.4) % 2 === 0 && n >= text.length)) {
    const w = ctx.measureText(shown).width;
    const cx = align === 'center' ? x + w / 2 : x + w;
    ctx.fillRect(cx + 6, y - size * 0.45, size * 0.55, size * 0.9);
  }
  ctx.textAlign = 'left';
  return n >= text.length;
}

// caption bar at bottom — house style for on-screen text
function caption(ctx, text, t, t0, { y = H - 110, size = 40 } = {}) {
  typed(ctx, text, W / 2, y, t, t0, { size, color: C.ink, align: 'center', cps: 40, cursor: false });
}

// ---- goal tree --------------------------------------------------------------
// Deterministic tree layout. spec: {seed, depth, spread}
// Returns nodes [{x,y,depth,parent,id,birth,resolveAt}] with birth/resolve normalized 0..1
function buildTree(seed = 1, depth = 4, rootX = W / 2, rootY = 230, opts = {}) {
  const r = rng(seed);
  const nodes = [];
  const levelGap = opts.levelGap || 150;
  function add(parent, d, x, frac) {
    const id = nodes.length;
    const birth = d === 0 ? 0 : (nodes[parent].birth + 0.12 + 0.10 * r());
    nodes.push({ id, parent, depth: d, x, y: rootY + d * levelGap, birth: Math.min(birth, 0.85), children: [] });
    if (parent >= 0) nodes[parent].children.push(id);
    if (d < depth) {
      const k = d === 0 ? 3 : (r() < 0.45 ? 1 : (r() < 0.75 ? 2 : 3));
      const span = (opts.spread || 760) / Math.pow(1.9, d);
      for (let i = 0; i < k; i++) {
        const fx = k === 1 ? 0 : (i / (k - 1) - 0.5);
        add(id, d + 1, x + fx * span + (r() - 0.5) * 30, frac);
      }
    }
    return id;
  }
  add(-1, 0, rootX, 0);
  // resolve order: leaves first (deepest), then up
  const maxD = Math.max(...nodes.map(n => n.depth));
  nodes.forEach(n => { n.resolveAt = 1 - (n.depth / (maxD + 1)) * 0.85 - 0.1 * r() * 0; });
  return nodes;
}

// draw tree at growth g (0..1) and resolution res (0..1). res folds leaves->root green.
function drawTree(ctx, nodes, g, res = 0, { nodeR = 9, lineW = 2, dimmed = 1 } = {}) {
  ctx.lineWidth = lineW;
  for (const n of nodes) {
    if (n.parent < 0) continue;
    const p = nodes[n.parent];
    const a = seg(g, n.birth, n.birth + 0.1);
    if (a <= 0) continue;
    const resolved = res >= n.resolveAt;
    ctx.strokeStyle = resolved ? C.green : `rgba(232,230,224,${0.5 * a * dimmed})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + (n.x - p.x) * a, p.y + (n.y - p.y) * a);
    ctx.stroke();
  }
  for (const n of nodes) {
    const a = seg(g, n.birth, n.birth + 0.08);
    if (a <= 0) continue;
    const resolved = res >= n.resolveAt;
    ctx.fillStyle = resolved ? C.green : `rgba(232,230,224,${(0.35 + 0.65 * a) * dimmed})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, nodeR * (0.5 + 0.5 * a), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- the amber loop arrow ----------------------------------------------------
// the film's signature motif: exits BOTTOM of a hierarchy, travels outside, re-enters TOP.
// p: 0..1 progress of the arrow's travel. box: {x,y,w,h} of the hierarchy region.
function loopArrow(ctx, box, p, { width = 4, out = 140 } = {}) {
  if (p <= 0) return;
  const x0 = box.x + box.w * 0.5, y0 = box.y + box.h;       // bottom exit
  const x1 = box.x + box.w * 0.5, y1 = box.y;               // top entry
  const side = box.x + box.w + out;                          // travel lane (right side)
  // path: down-out, right, up the side, left, into top
  const pts = [
    [x0, y0], [x0 + 40, y0 + 90], [side, y0 + 90],
    [side, y1 - 90], [x1 + 40, y1 - 90], [x1, y1],
  ];
  // total polyline length
  const L = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    L.push(d); total += d;
  }
  let remain = p * total;
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = width;
  ctx.shadowColor = C.amber;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  let tip = pts[0];
  for (let i = 1; i < pts.length && remain > 0; i++) {
    const d = L[i - 1];
    const f = Math.min(1, remain / d);
    tip = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    ctx.lineTo(tip[0], tip[1]);
    remain -= d;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  // arrowhead at tip
  ctx.fillStyle = C.amber;
  ctx.beginPath();
  ctx.arc(tip[0], tip[1], width * 1.8, 0, Math.PI * 2);
  ctx.fill();
}

// ---- panel template (Scenes 6-9, 11) ----------------------------------------
function panel(ctx, num, capText, t, t0, { small = false } = {}) {
  const a = seg(t, t0, t0 + 0.5);
  if (a <= 0) return;
  ctx.globalAlpha = a;
  // number stamp top-left
  const s = small ? 70 : 110;
  ctx.strokeStyle = C.amber;
  ctx.lineWidth = 3;
  ctx.strokeRect(70, 70, s, s);
  ctx.font = FONT(small ? 44 : 68);
  ctx.fillStyle = C.amber;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(String(num), 70 + s / 2, 70 + s / 2 + 4);
  ctx.textAlign = 'left';
  // caption bar bottom
  ctx.font = FONT(small ? 30 : 38);
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'center';
  ctx.fillText(capText, W / 2, H - 80);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

// ---- misc widgets ------------------------------------------------------------
function chip(ctx, x, y, label, { color = C.ink, size = 26, pad = 14 } = {}) {
  ctx.font = FONT(size);
  const w = ctx.measureText(label).width + pad * 2;
  const h = size + pad * 1.4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 1);
  ctx.textAlign = 'left';
  return { w, h };
}

function lockIcon(ctx, x, y, s, color = C.ink) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.strokeRect(x - s / 2, y, s, s * 0.8);
  ctx.beginPath();
  ctx.arc(x, y, s * 0.32, Math.PI, 0);
  ctx.stroke();
}

function humanIcon(ctx, x, y, s, color = C.dim) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.55, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.3, y + s * 0.5);
  ctx.quadraticCurveTo(x, y - s * 0.25, x + s * 0.3, y + s * 0.5);
  ctx.closePath();
  ctx.fill();
}

// substrate strata (S5, S11, S12): four labeled layers below ground line
function strata(ctx, t, { y = 760, thick = 1, labels = true, alpha = 1, current = 0 } = {}) {
  const names = ['type memory', 'trusted patterns', 'harness code', 'event log'];
  const hgt = 56 * thick;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 4; i++) {
    const yy = y + i * (hgt + 8);
    ctx.fillStyle = `rgba(245,166,35,${0.10 + i * 0.015})`;
    ctx.fillRect(160, yy, W - 320, hgt);
    ctx.strokeStyle = C.amberDim;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(160, yy, W - 320, hgt);
    if (labels) {
      ctx.font = FONT(24);
      ctx.fillStyle = C.amber;
      ctx.textBaseline = 'middle';
      ctx.fillText(names[i], 190, yy + hgt / 2);
    }
  }
  // circulating current: dashes flowing along the strata
  if (current > 0) {
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 22]);
    ctx.lineDashOffset = -t * 90;
    ctx.globalAlpha = alpha * current;
    ctx.strokeRect(190, y + 14, W - 380, 4 * (hgt + 8) - 36);
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function fadeToBlack(ctx, t, t0, dur = 0.6) {
  const a = seg(t, t0, t0 + dur);
  if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); }
}

function bg(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
}

window.LIB = { W, H, C, FONT, SERIF, clamp01, seg, easeOut, easeIn, easeInOut, rng, typed, caption, buildTree, drawTree, loopArrow, panel, chip, lockIcon, humanIcon, strata, fadeToBlack, bg };
window.SCENES = window.SCENES || {};
