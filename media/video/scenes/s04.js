// S4 — Hofstadter interlude. 37.0s. THE sanctioned style break: paper/engraving.
// Beats (VO 35.0s starts at 0.8):
//   0–2     paper bleeds in (from s03's wash)
//   2–11    Plate I  — Drawing Hands       (Veo V1 composited over plate in post)
//   11–20   Plate II — rising staircase    (Veo V2)
//   20–27.5 Plate III — arithmetic page    (Veo V3 under; code overlay: digits → sentence)
//   27.5–35.5 ladder-with-escaping-arrow diagram, serif captions
//   35.5–37 paper dissolves to terminal dark; ladder diagram persists, recolors
// Reserved plate rect for post compositing: x=480 y=220 w=960 h=540.
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, rng, SERIF, FONT } = window.LIB;

  const PLATE = { x: 480, y: 220, w: 960, h: 540 };
  const INK = C.paperInk;

  function paper(ctx, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    // grain: deterministic speckles + faint horizontal plate lines
    const r = rng(42);
    ctx.fillStyle = 'rgba(120,100,70,0.05)';
    for (let i = 0; i < 900; i++) {
      ctx.fillRect(r() * W, r() * H, 1.6, 1.6);
    }
    ctx.strokeStyle = 'rgba(60,50,35,0.18)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(70, 60, W - 140, H - 120);
    ctx.strokeRect(82, 72, W - 164, H - 144);
    ctx.globalAlpha = 1;
  }

  function plateFrame(ctx, title) {
    ctx.strokeStyle = 'rgba(43,38,32,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
    ctx.strokeRect(PLATE.x - 8, PLATE.y - 8, PLATE.w + 16, PLATE.h + 16);
    ctx.font = SERIF(30);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, PLATE.y + PLATE.h + 52);
    ctx.textAlign = 'left';
  }

  function serifCaption(ctx, text, y, alpha, size = 40, italic = false) {
    ctx.globalAlpha = alpha;
    ctx.font = (italic ? 'italic ' : '') + SERIF(size);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, y);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  // in-plate placeholder sketches (Veo footage replaces these in post; they
  // keep the scene self-sufficient if a clip falls through)
  function sketchHands(ctx, p) {
    ctx.save();
    ctx.translate(W / 2, PLATE.y + PLATE.h / 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    for (const flip of [1, -1]) {
      ctx.save();
      ctx.scale(flip, flip);
      // stylized hand: palm arc + pen stroke toward the other cuff
      const n = Math.floor(26 * p);
      for (let i = 0; i < n; i++) {
        const a = -0.5 + i * 0.07;
        ctx.beginPath();
        ctx.arc(-160, 60, 100 + i * 3.5, a, a + 0.5);
        ctx.stroke();
      }
      if (p > 0.4) {
        ctx.beginPath();
        ctx.moveTo(-70, 30);
        ctx.lineTo(120 * Math.min(1, (p - 0.4) / 0.5), -60 * Math.min(1, (p - 0.4) / 0.5) + 30);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function sketchStairs(ctx, p) {
    ctx.save();
    ctx.translate(W / 2, PLATE.y + PLATE.h / 2 + 40);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    const steps = Math.floor(22 * p);
    for (let i = 0; i < steps; i++) {
      const ang = i * 0.32;
      const rad = 150 + 28 * Math.sin(i * 0.5);
      const x = Math.cos(ang) * rad, y = -i * 9 + Math.sin(ang) * 44 + 110;
      ctx.strokeRect(x - 34, y, 68, 13);
      if (i % 2 === 0) { ctx.fillStyle = INK; ctx.fillRect(x - 34, y, 30, 13); }
    }
    ctx.restore();
  }

  const SENTENCE = 'THIS STATEMENT IS UNPROVABLE';
  function sketchArithmetic(ctx, t) {
    // rows of digits; over the beat, one row's digits resolve into the sentence
    const r = rng(7);
    ctx.font = FONT(30);
    const morph = seg(t, 22.5, 26.0); // digits -> sentence
    for (let row = 0; row < 9; row++) {
      const y = PLATE.y + 70 + row * 52;
      let line = '';
      for (let k = 0; k < 30; k++) line += String(Math.floor(r() * 10));
      ctx.fillStyle = 'rgba(43,38,32,0.75)';
      if (row === 4) {
        // center row morphs char-by-char into the sentence
        const chars = Math.floor(morph * SENTENCE.length);
        const pad = Math.floor((30 - SENTENCE.length) / 2);
        let out = '';
        for (let k = 0; k < 30; k++) {
          const si = k - pad;
          out += (si >= 0 && si < chars) ? SENTENCE[si] : line[k];
        }
        ctx.fillStyle = INK;
        ctx.font = FONT(30);
        ctx.fillText(out, PLATE.x + 50, y);
        if (morph >= 1) {
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          const w = ctx.measureText(SENTENCE).width;
          ctx.strokeRect(PLATE.x + 50 + ctx.measureText(line.slice(0, pad)).width - 8, y - 26, w + 16, 38);
        }
      } else {
        ctx.fillText(line, PLATE.x + 50, y);
      }
    }
  }

  // the canonical strange-loop diagram: ladder of levels, arrow escapes the
  // bottom rung, curves OUTSIDE the ladder, acts on the top rung.
  function ladderDiagram(ctx, p, inkColor, accent) {
    const lx = W / 2 - 140, ly = 250, lw = 280, gap = 110, rungs = 5;
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 3;
    const vis = Math.min(1, p * 2);
    // rails
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly + gap * (rungs - 1) * vis); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx + lw, ly); ctx.lineTo(lx + lw, ly + gap * (rungs - 1) * vis); ctx.stroke();
    for (let i = 0; i < rungs; i++) {
      if (i / rungs > vis) break;
      const y = ly + i * gap;
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + lw, y); ctx.stroke();
      ctx.font = SERIF(26);
      ctx.fillStyle = inkColor;
      ctx.fillText(['top', '', '', '', 'bottom'][i], lx + lw + 24, y + 8);
    }
    // escaping arrow
    const ap = seg(p, 0.45, 1);
    if (ap > 0) {
      const y0 = ly + gap * (rungs - 1), y1 = ly;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      const steps = Math.floor(60 * ap);
      for (let i = 0; i <= steps; i++) {
        const u = i / 60;
        // leave bottom rung leftward, arc up outside the left rail, into top rung
        const x = lx + 40 - Math.sin(u * Math.PI) * 320;
        const y = y0 + (y1 - y0) * easeInOut(u);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (ap >= 1) {
        // arrowhead pointing into the top rung
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(lx + 44, ly);
        ctx.lineTo(lx + 16, ly - 12);
        ctx.lineTo(lx + 16, ly + 12);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  window.SCENES.s04 = {
    duration: 37.0,
    draw(ctx, t) {
      // background: paper, dissolving to terminal dark in the last 1.5s
      const darken = seg(t, 35.5, 37);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      paper(ctx, (t < 2 ? easeOut(seg(t, 0, 2)) : 1) * (1 - darken));

      const inkNow = darken > 0
        ? `rgba(${43 + (232 - 43) * darken},${38 + (230 - 38) * darken},${32 + (224 - 32) * darken},1)`
        : INK;

      if (t < 11) {
        const p = seg(t, 2.2, 10.2);
        if (t > 2) { plateFrame(ctx, 'Plate I. — the hands draw each other'); sketchHands(ctx, p); }
        serifCaption(ctx, 'strange loop', 150, seg(t, 3.5, 4.5), 46, true);
      } else if (t < 20) {
        plateFrame(ctx, 'Plate II. — the canon climbs home');
        sketchStairs(ctx, seg(t, 11, 19));
        serifCaption(ctx, 'strange loop', 150, 1, 46, true);
      } else if (t < 27.5) {
        plateFrame(ctx, 'Plate III. — the numbers are the sentence');
        sketchArithmetic(ctx, t);
        serifCaption(ctx, 'strange loop', 150, 1, 46, true);
      } else {
        // ladder diagram — survives the style transition
        ladderDiagram(ctx, seg(t, 27.5, 32), inkNow, darken > 0 ? C.amber : '#8a5a18');
        serifCaption(ctx, 'the bottom acts on the top', 880, seg(t, 29, 30) * (1 - darken), 42, true);
        serifCaption(ctx, 'Gödel · Escher · Bach', 950, seg(t, 31.5, 32.5) * (1 - darken), 36, false);
      }
    },
  };
})();
