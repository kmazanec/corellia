// S11 — The loop fed back. 56.0s
// 0-6    : simplified four-crossing diagram; chip `this analysis` slides in
//          from outside the frame and drops into the substrate.
// 6-20   : BEAT 1, the wasp. Left half = reserved plate for the Veo engraving
//          clip (frame x120 y240 w780 h600, composited in post). Right half:
//          attempt N+1 with attempt N's failure pinned inside its frame, the
//          re-split warping away, and the sideways ladder vault.
// 20-28  : BEAT 2, quoted never obeyed. Single shot.
// 28-43  : BEAT 3, the terraced scan (longest). k ghost trees, judge sweep,
//          winner deepens, losers slide into the ADR.
// 43-50  : BEAT 4, the regress cut. Judge tower grounded from outside.
// 50-56  : finale — four new seams in the strata; `the loop fed back`.
// VO (~54s) starts at 0.8.
'use strict';
(() => {
  const { W, H, C, FONT, seg, easeOut, easeIn, easeInOut, typed, caption, panel,
          chip, strata, bg, fadeToBlack, buildTree, drawTree, rng } = window.LIB;

  // ---- shared bits ----------------------------------------------------------
  function judge(ctx, x, y, s, color = C.ink, alpha = 1) {
    // a small balance: pointer ▼, beam, post, two pans
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();                       // beam
    ctx.moveTo(x - s / 2, y);
    ctx.lineTo(x + s / 2, y);
    ctx.stroke();
    ctx.beginPath();                       // post
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + s * 0.55);
    ctx.stroke();
    for (const sx of [x - s / 2, x + s / 2]) {   // pans
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + s * 0.22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - s * 0.13, y + s * 0.22);
      ctx.lineTo(sx + s * 0.13, y + s * 0.22);
      ctx.stroke();
    }
    ctx.beginPath();                       // ▼ pointer above center
    ctx.moveTo(x - s * 0.12, y - s * 0.28);
    ctx.lineTo(x + s * 0.12, y - s * 0.28);
    ctx.lineTo(x, y - s * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- opening: the diagram + `this analysis` -------------------------------
  const DCX = [480, 800, 1120, 1440];
  function miniDiagram(ctx, t, alpha) {
    if (alpha <= 0) return;
    strata(ctx, t, { y: 700, thick: 0.6, labels: false, alpha: alpha * 0.9, current: 0.35 * alpha });
    ctx.globalAlpha = alpha;
    // tree marks above (root + two leaves), tiny
    for (const x of DCX) {
      ctx.strokeStyle = 'rgba(232,230,224,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 60, 460); ctx.lineTo(x, 396); ctx.lineTo(x + 60, 460);
      ctx.stroke();
      ctx.fillStyle = 'rgba(232,230,224,0.6)';
      for (const [px, py] of [[x, 396], [x - 60, 460], [x + 60, 460]]) {
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // four small crossing arrows
    for (const x of DCX) {
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 18, 492);
      ctx.lineTo(x - 18, 762);
      ctx.lineTo(x + 18, 762);
      ctx.lineTo(x + 18, 492);
      ctx.stroke();
      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.moveTo(x + 18, 482); ctx.lineTo(x + 10, 498); ctx.lineTo(x + 26, 498);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function analysisChip(ctx, t, alpha) {
    // slides in from the right frame edge, then drops into the substrate
    const slide = easeOut(seg(t, 0.9, 2.3));
    if (slide <= 0) return;
    const drop = easeIn(seg(t, 2.9, 4.1));
    const x = W + 200 + (1625 - (W + 200)) * slide;
    const y = 330 + (740 - 330) * drop;
    ctx.globalAlpha = alpha;
    // film-frame border: double rect + sprocket ticks
    ctx.font = FONT(26);
    const w = ctx.measureText('this analysis').width + 36, h = 64;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeRect(x - w / 2 - 8, y - h / 2 - 8, w + 16, h + 16);
    ctx.fillStyle = C.ink;
    for (let i = 0; i < 6; i++) {                       // sprockets top + bottom
      const sx = x - w / 2 + 10 + i * (w - 20) / 5;
      ctx.fillRect(sx - 2.5, y - h / 2 - 6, 5, 4);
      ctx.fillRect(sx - 2.5, y + h / 2 + 2, 5, 4);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('this analysis', x, y + 1);
    ctx.textAlign = 'left';
    // landing pulse in the substrate
    const pulse = seg(t, 4.1, 4.9);
    if (pulse > 0 && pulse < 1) {
      ctx.strokeStyle = C.amber;
      ctx.globalAlpha = alpha * (1 - pulse);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(1625, 770, 60 + 90 * pulse, 18 + 26 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- beat 1: the wasp ------------------------------------------------------
  const PLATE = { x: 120, y: 240, w: 780, h: 600 };     // reserved for Veo clip
  function beat1(ctx, t) {
    panel(ctx, 1, 'not a sphex wasp', t, 6.3, { small: true });
    const a = seg(t, 6.3, 6.9);
    ctx.globalAlpha = a;
    // the engraving flickers back (Veo credits ran dry — in-code sphex vignette
    // on the Reve paper plate; the repetition, not the anatomy, is the argument)
    ctx.fillStyle = '#060607';
    ctx.fillRect(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
    const paper = window.ASSETS && window.ASSETS.paper;
    if (paper) {
      // flicker-in like an old print finding its register
      const flick = t < 7.5 ? (Math.floor(t * 14) % 2 === 0 ? 0.75 : 1) : 1;
      ctx.save();
      ctx.globalAlpha = a * flick;
      ctx.beginPath();
      ctx.rect(PLATE.x, PLATE.y, PLATE.w, PLATE.h);
      ctx.clip();
      // cover-crop the paper still into the plate
      const s = Math.max(PLATE.w / paper.width, PLATE.h / paper.height);
      const dw = paper.width * s, dh = paper.height * s;
      ctx.drawImage(paper, PLATE.x + (PLATE.w - dw) / 2, PLATE.y + (PLATE.h - dh) / 2, dw, dh);
      // the worn circuit: closed loop, drawn as repeated faint ink passes
      const cx = PLATE.x + PLATE.w / 2, cy = PLATE.y + PLATE.h / 2 + 30;
      const loopPt = u => {
        const ang = u * Math.PI * 2;
        return [
          cx + 230 * Math.cos(ang) + 36 * Math.cos(2 * ang),
          cy + 140 * Math.sin(ang) + 22 * Math.sin(3 * ang),
        ];
      };
      ctx.strokeStyle = 'rgba(43,38,32,0.55)';
      ctx.lineWidth = 5;
      ctx.setLineDash([7, 9]);
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const [px, py] = loopPt(i / 90);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // burrow at the start of the circuit
      const [bx, by] = loopPt(0);
      ctx.fillStyle = 'rgba(43,38,32,0.85)';
      ctx.beginPath();
      ctx.ellipse(bx + 14, by, 22, 13, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // the wasp: small ink glyph walking the circuit, identical lap after lap
      const lapT = seg(t, 7.2, 19.4) * 3;             // three identical laps
      const u = lapT % 1;
      const [wx, wy] = loopPt(u);
      const [ax, ay] = loopPt((u + 0.012) % 1);       // heading
      const ang = Math.atan2(ay - wy, ax - wx);
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(ang);
      ctx.fillStyle = '#2b2620';
      ctx.strokeStyle = '#2b2620';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(-10, 0, 13, 6, 0, 0, Math.PI * 2); ctx.fill();   // abdomen
      ctx.beginPath(); ctx.ellipse(3, 0, 6, 4.5, 0, 0, Math.PI * 2); ctx.fill();     // thorax
      ctx.beginPath(); ctx.arc(11, 0, 3.4, 0, Math.PI * 2); ctx.fill();              // head
      const gait = Math.sin(u * 240);                                                // leg scissor
      for (const s1 of [-1, 1]) {
        for (const lx of [-4, 1, 6]) {
          ctx.beginPath();
          ctx.moveTo(lx, 0);
          ctx.lineTo(lx + 3 * gait * s1, s1 * 9);
          ctx.stroke();
        }
      }
      // wing hint
      ctx.strokeStyle = 'rgba(43,38,32,0.5)';
      ctx.beginPath(); ctx.ellipse(-6, -4, 10, 3.4, -0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // lap counter, engraved-caption style: the sameness is the point
      ctx.font = '24px Georgia, serif';
      ctx.fillStyle = 'rgba(43,38,32,0.8)';
      ctx.textAlign = 'center';
      ctx.fillText(`circuit ${Math.min(3, Math.floor(lapT) + 1)} — identical`, cx, PLATE.y + PLATE.h - 78);
      ctx.textAlign = 'left';
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(232,230,224,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(PLATE.x, PLATE.y, PLATE.w, PLATE.h);

    // node frame, attempt N+1
    ctx.strokeStyle = 'rgba(232,230,224,0.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1010, 280, 790, 220);
    ctx.font = FONT(24);
    ctx.fillStyle = C.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText('attempt N+1', 1036, 314);
    const node = [1130, 420];
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(node[0], node[1], 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // attempt N's failed artifact, pinned INSIDE the frame
    const pin = easeOut(seg(t, 7.6, 8.4));
    if (pin > 0) {
      ctx.globalAlpha = pin;
      ctx.strokeStyle = 'rgba(239,68,68,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(node[0] + 15, node[1] - 5);
      ctx.lineTo(1448, 392);
      ctx.stroke();
      chip(ctx, 1570, 392, 'attempt N: failed', { color: C.red, size: 20 });
      ctx.globalAlpha = 1;
    }

    // re-split: old fan (red-dim) vs new fan bending away
    const oldA = seg(t, 9.4, 10.2);
    if (oldA > 0) {
      ctx.globalAlpha = oldA * 0.30;
      ctx.strokeStyle = C.red;
      ctx.fillStyle = C.red;
      ctx.lineWidth = 1.5;
      for (const [ex, ey] of [[1020, 640], [1100, 668], [1185, 650]]) {
        ctx.beginPath(); ctx.moveTo(node[0], node[1]); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const warp = easeOut(seg(t, 10.6, 12.4));
    if (warp > 0) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = C.ink;
      ctx.fillStyle = C.ink;
      ctx.lineWidth = 2;
      // endpoints bend away (rightward) from the failed shape
      const ends = [[1070, 645, 1235, 655], [1150, 672, 1310, 645], [1235, 652, 1380, 612]];
      for (const [x0, y0, x1, y1] of ends) {
        const ex = x0 + (x1 - x0) * warp, ey = y0 + (y1 - y0) * warp;
        ctx.beginPath();
        ctx.moveTo(node[0], node[1]);
        ctx.quadraticCurveTo(node[0] + 60 * warp, (node[1] + ey) / 2 + 20, ex, ey);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // tier ladder + sideways vault
    const lad = seg(t, 13.2, 14.0);
    if (lad > 0) {
      ctx.globalAlpha = lad;
      const cx = 1560, railL = cx - 60, railR = cx + 60;
      const rungs = [[840, 'haiku'], [750, 'sonnet'], [660, 'opus']];
      ctx.strokeStyle = 'rgba(232,230,224,0.6)';
      ctx.lineWidth = 2;
      for (const rx of [railL, railR]) {
        ctx.beginPath(); ctx.moveTo(rx, 880); ctx.lineTo(rx, 625); ctx.stroke();
      }
      ctx.font = FONT(20);
      ctx.fillStyle = C.dim;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const [ry, name] of rungs) {
        ctx.beginPath(); ctx.moveTo(railL, ry); ctx.lineTo(railR, ry); ctx.stroke();
        ctx.fillText(name, railL - 16, ry);
      }
      ctx.textAlign = 'left';
      // the amber dot: appears on haiku, then VAULTS SIDEWAYS off the ladder
      const show = seg(t, 14.2, 14.6);
      if (show > 0) {
        const v = easeInOut(seg(t, 16.2, 17.6));
        const dx = cx + (1800 - cx) * v;
        const dy = 840 - 320 * v * (1 - v) * 2 - (660 - 840) * 0 + (660 - 840) * v;  // arc
        ctx.fillStyle = C.amber;
        ctx.shadowColor = C.amber;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(dx, dy, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // dashed trail of the vault
        if (v > 0) {
          ctx.strokeStyle = C.amber;
          ctx.globalAlpha = lad * 0.5;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([7, 7]);
          ctx.beginPath();
          ctx.moveTo(cx, 840);
          const n = Math.ceil(24 * v);
          for (let i = 1; i <= n; i++) {
            const u = (i / n) * v;                  // param along arc so far
            const ux = cx + (1800 - cx) * u;
            const uy = 840 - 640 * u * (1 - u) + (660 - 840) * u;
            ctx.lineTo(ux, uy);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = lad;
        }
        // landing tick, off-rail
        if (v >= 1) {
          ctx.strokeStyle = C.amber;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(1770, 676);
          ctx.lineTo(1830, 676);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- beat 2: quoted, never obeyed (single shot) ----------------------------
  function beat2(ctx, t) {
    panel(ctx, 2, 'mentioned, never obeyed', t, 20.3, { small: true });
    const a = seg(t, 20.3, 20.9);
    ctx.globalAlpha = a;
    // oversized typed quotation marks
    ctx.font = FONT(200);
    ctx.fillStyle = 'rgba(232,230,224,0.75)';
    ctx.textBaseline = 'middle';
    ctx.fillText('“', 600, 420);
    ctx.fillText('”', 1150, 420);
    // memory chip between them, slotting down into the evidence tray
    const slot = easeInOut(seg(t, 22.6, 24.1));
    const cy = 400 + (690 - 400) * slot;
    chip(ctx, 935, cy, 'memory', { color: C.ink, size: 28 });
    // tray (open top), labeled evidence
    ctx.strokeStyle = 'rgba(232,230,224,0.6)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(745, 630); ctx.lineTo(745, 752); ctx.lineTo(1125, 752); ctx.lineTo(1125, 630);
    ctx.stroke();
    ctx.font = FONT(24);
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.fillText('evidence', 935, 792);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    // the wall
    const wall = easeOut(seg(t, 24.5, 25.2));
    if (wall > 0) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(232,230,224,0.85)';
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(1400, 560 - 270 * wall);
      ctx.lineTo(1400, 560 + 270 * wall);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // the instructions block, on the far side
    const ins = seg(t, 25.1, 25.7);
    if (ins > 0) {
      ctx.globalAlpha = ins;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(1500, 460, 320, 170);
      ctx.font = FONT(26);
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('instructions', 1660, 545);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }

  // ---- beat 3: the terraced scan ---------------------------------------------
  const GX = [330, 645, 960, 1275, 1590];
  const ghosts = GX.map((x, i) => buildTree(101 + i * 13, 2, x, 440, { levelGap: 75, spread: 230 }));
  const winnerDeep = buildTree(137, 3, 960, 430, { levelGap: 78, spread: 300 });
  const WIN = 2;                                   // center tree wins
  const ADR = { x: 1305, y: 720, w: 495, h: 200 };

  function beat3(ctx, t) {
    panel(ctx, 3, 'k candidates · one winner', t, 28.3, { small: true });
    const a = seg(t, 28.3, 28.9);
    // a node meets a novel-shaped goal
    ctx.globalAlpha = a;
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(330, 290, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const meet = easeOut(seg(t, 28.7, 29.7));
    if (meet > 0) {
      const nx = -160 + (520 - -160) * meet;
      ctx.globalAlpha = a;
      chip(ctx, nx, 290, 'novel', { color: C.ink, size: 26 });
      ctx.strokeStyle = C.dim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(344, 290);
      ctx.lineTo(nx - 60, 290);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const sweepP = easeInOut(seg(t, 33.0, 35.6));
    const sweepX = 240 + (1680 - 240) * sweepP;
    const winnerUp = seg(t, 36.0, 38.4);

    // five ghost candidates, sketchy and cheap
    for (let i = 0; i < 5; i++) {
      const g = easeOut(seg(t, 30.2 + i * 0.35, 31.0 + i * 0.35));
      if (g <= 0) continue;
      // highlight as the judge passes; winner brightens, losers fade + slide
      const near = Math.max(0, 1 - Math.abs(sweepX - GX[i]) / 200) * (sweepP > 0 && sweepP < 1 ? 1 : 0);
      let dim = 0.26 + near * 0.5;
      let shift = 0, scale = 1, drop = 0;
      if (i === WIN) {
        dim = 0.26 + near * 0.5 + 0.74 * winnerUp;
        if (winnerUp > 0.4) dim = 0;               // hand off to the deep tree
      } else {
        const sl = easeInOut(seg(t, 37.6 + i * 0.25, 39.8 + i * 0.25));
        dim *= (1 - 0.65 * sl);
        shift = sl;
        scale = 1 - 0.72 * sl;
      }
      ctx.save();
      if (shift > 0) {
        const tx = GX[i] + (ADR.x + ADR.w / 2 - GX[i]) * shift;
        const ty = 520 + (ADR.y + 120 - 520) * shift;
        ctx.translate(tx, ty);
        ctx.scale(scale, scale);
        ctx.translate(-GX[i], -520);
      }
      drawTree(ctx, ghosts[i], g, 0, { nodeR: 4, lineW: 1, dimmed: dim });
      ctx.restore();
    }
    // the winner deepens into full fidelity
    if (winnerUp > 0.2) {
      const g = easeOut(seg(winnerUp, 0.2, 1));
      drawTree(ctx, winnerDeep, 0.35 + 0.65 * g, 0, { nodeR: 6, lineW: 1.8, dimmed: 0.5 + 0.5 * g });
    }
    // judge sweep, then settles above the winner
    if (sweepP > 0) {
      const jx = sweepP < 1 ? sweepX : 960;
      judge(ctx, jx, 372, 46, C.ink, sweepP < 1 ? 0.9 : 0.65);
    }
    // ADR document: losers archived, for free
    const da = seg(t, 37.2, 37.9);
    if (da > 0) {
      ctx.globalAlpha = da;
      ctx.strokeStyle = 'rgba(232,230,224,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(ADR.x, ADR.y, ADR.w, ADR.h);
      ctx.font = FONT(20);
      ctx.fillStyle = C.ink;
      ctx.textBaseline = 'middle';
      ctx.fillText('ADR — alternatives considered', ADR.x + 22, ADR.y + 32);
      ctx.strokeStyle = 'rgba(232,230,224,0.25)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(ADR.x + 22, ADR.y + 66 + i * 24);
        ctx.lineTo(ADR.x + ADR.w - 22 - i * 60, ADR.y + 66 + i * 24);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- beat 4: the regress, cut (single shot) --------------------------------
  function beat4(ctx, t) {
    panel(ctx, 4, 'ground truth is exogenous', t, 43.3, { small: true });
    const a = seg(t, 43.3, 43.9);
    // dotted system boundary
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(232,230,224,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(520, 230, 880, 590);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // the tower: an eval evaluating an eval evaluating an eval...
    const sizes = [78, 64, 52, 42];
    const t0s = [43.7, 44.5, 45.3, 46.0];
    let yy = 740;
    for (let i = 0; i < 4; i++) {
      const ja = easeOut(seg(t, t0s[i], t0s[i] + 0.5));
      if (ja > 0) judge(ctx, 900, yy, sizes[i], C.ink, ja * (1 - i * 0.12));
      yy -= sizes[i] * 0.95;
    }
    // the fifth, ghost — cancelled when the arrow lands
    const g5 = seg(t, 46.6, 47.1) * (1 - seg(t, 47.3, 47.7));
    if (g5 > 0) judge(ctx, 900, yy, 34, C.dim, g5 * 0.5);
    // the exogenous arrow stabs in from OUTSIDE the boundary
    const arrow = easeOut(seg(t, 46.8, 47.5));
    if (arrow > 0) {
      const tipX = 1850 + (965 - 1850) * arrow;
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 5;
      ctx.shadowColor = C.amber;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(1850, 560);
      ctx.lineTo(tipX, 560);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.moveTo(tipX - 2, 560);
      ctx.lineTo(tipX + 22, 548);
      ctx.lineTo(tipX + 22, 572);
      ctx.closePath();
      ctx.fill();
      ctx.font = FONT(21);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('merged PRs · production · human verdicts', 1882, 506);
      ctx.textAlign = 'left';
    }
    // grounded: the baseline bar
    const bar = easeOut(seg(t, 47.8, 48.4));
    if (bar > 0) {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 6;
      ctx.globalAlpha = bar;
      ctx.beginPath();
      ctx.moveTo(900 - 240 * bar, 800);
      ctx.lineTo(900 + 240 * bar, 800);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ---- finale: four new seams ------------------------------------------------
  function finale(ctx, t) {
    const a = easeOut(seg(t, 50.0, 51.0));
    const drift = -14 * seg(t, 50, 56);
    ctx.save();
    ctx.translate(0, drift);
    strata(ctx, t, { y: 620, thick: 0.75, labels: true, alpha: a, current: 0.5 * a });
    // four faint new seams, one per beat
    const hgt = 56 * 0.75;
    for (let i = 0; i < 4; i++) {
      const sa = easeOut(seg(t, 50.6 + i * 0.35, 51.5 + i * 0.35));
      if (sa <= 0) continue;
      const yy = 620 + i * (hgt + 8) + hgt * 0.72;
      ctx.strokeStyle = C.amber;
      ctx.globalAlpha = 0.42 * sa * a;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(220, yy);
      ctx.lineTo(220 + (W - 440) * sa, yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    caption(ctx, 'the loop fed back', t, 51.8, { y: 380 });
  }

  window.SCENES.s11 = {
    duration: 56.0,
    assets: { paper: '../assets/stills/r1-paper-plate.png' },
    draw(ctx, t) {
      bg(ctx);
      if (t < 6) {
        const a = 1 - seg(t, 5.3, 6.0);
        miniDiagram(ctx, t, a);
        analysisChip(ctx, t, a);
      } else if (t < 20) {
        beat1(ctx, t);
      } else if (t < 28) {
        beat2(ctx, t);
      } else if (t < 43) {
        beat3(ctx, t);
      } else if (t < 50) {
        beat4(ctx, t);
      } else {
        finale(ctx, t);
      }
      fadeToBlack(ctx, t, 55.2, 0.8);
    },
  };
})();
