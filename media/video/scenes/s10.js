// S10 — Domestication, and the hard hat. 36.0s
// Phase 1 (0-17): four-crossing diagram — trees above, substrate below, four
//   amber arrows crossing down-and-back-up, a human at each crossing; controls
//   appear as the VO names them (stamp / padlock / signature / quarantine),
//   then the crossed-out factory-factory.
// Phase 2 (17-30): clear to near-black; Gödel formula Con(F) ⊬_F chalk-style;
//   a yellow hard hat drops and lands on it (~29, "wearing a hard hat").
// Phase 3 (30-36): caption `the authority gap`; hold; fade.
// VO (34.1s) starts at 0.8.
'use strict';
(() => {
  const { W, H, C, FONT, seg, easeOut, easeIn, easeInOut, typed, caption,
          strata, humanIcon, lockIcon, bg, fadeToBlack, buildTree, drawTree } = window.LIB;

  // ---- phase 1 layout -------------------------------------------------------
  const CX = [340, 660, 980, 1300];           // the four crossings
  const FFX = 1610;                            // fifth station: no factory-factory
  const trees = CX.map((x, i) => buildTree(31 + i * 7, 2, x, 150, { levelGap: 92, spread: 230 }));
  const STRATA_Y = 600, A_TOP = 376, A_BOT = 690;
  const G_T = [4.0, 6.2, 8.6, 11.2];          // glyph reveals, VO-paced
  const FF_T = 13.6;

  function crossArrow(ctx, x, n, t, t0) {
    const p = easeOut(seg(t, t0, t0 + 1.1));
    if (p <= 0) return;
    const total = (A_BOT - A_TOP) * 2 + 52;
    let remain = p * total;
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = C.amber;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x - 26, A_TOP);
    const d1 = Math.min(remain, A_BOT - A_TOP);
    ctx.lineTo(x - 26, A_TOP + d1); remain -= d1;
    if (remain > 0) { const d2 = Math.min(remain, 52); ctx.lineTo(x - 26 + d2, A_BOT); remain -= d2; }
    if (remain > 0) { const d3 = Math.min(remain, A_BOT - A_TOP); ctx.lineTo(x + 26, A_BOT - d3); }
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (p >= 1) {
      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.moveTo(x + 26, A_TOP - 14);
      ctx.lineTo(x + 15, A_TOP + 8);
      ctx.lineTo(x + 37, A_TOP + 8);
      ctx.closePath();
      ctx.fill();
    }
    // number stamp beside the down-leg
    const na = seg(t, t0 + 0.6, t0 + 1.0);
    if (na > 0) {
      ctx.globalAlpha = na;
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 108, A_TOP + 8, 36, 36);
      ctx.font = FONT(24);
      ctx.fillStyle = C.amber;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), x - 90, A_TOP + 27);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }

  // control glyphs -- ink/dim except the review stamp (a stamp: amber allowed)
  function reviewStamp(ctx, x, y, a) {           // check in a box
    ctx.globalAlpha = a;
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 26, y - 26, 52, 52);
    ctx.beginPath();
    ctx.moveTo(x - 13, y + 2);
    ctx.lineTo(x - 3, y + 13);
    ctx.lineTo(x + 16, y - 12);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function archLock(ctx, x, y, a) {              // padlock on a box `architecture`
    ctx.globalAlpha = a;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 70, y - 2, 140, 44);
    ctx.font = FONT(17);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('architecture', x, y + 21);
    ctx.textAlign = 'left';
    lockIcon(ctx, x, y - 36, 30, C.ink);
    ctx.globalAlpha = 1;
  }
  function signature(ctx, x, y, a) {             // signature squiggle over a line
    if (a <= 0) return;
    ctx.globalAlpha = Math.min(1, a * 1.4);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const n = Math.floor(40 * a);                // squiggle draws on
    for (let i = 0; i <= n; i++) {
      const u = i / 40;
      const sx = x - 52 + u * 104;
      const sy = y - 14 * Math.sin(u * Math.PI * 4.4) * (1 - u * 0.5) - 8 * Math.sin(u * 9.1);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.dim;
    ctx.beginPath();
    ctx.moveTo(x - 58, y + 18);
    ctx.lineTo(x + 58, y + 18);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function quarantine(ctx, x, y, a, t) {         // dotted box around `mem write`
    ctx.globalAlpha = a;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.strokeRect(x - 66, y - 32, 132, 64);
    ctx.setLineDash([]);
    ctx.font = FONT(17);
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('mem write', x, y);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
  function factoryShape(ctx, x, y, w, h, prog) { // rect + sawtooth roof, draw-on
    if (prog <= 0) return;
    ctx.beginPath();
    const pts = [
      [x - w / 2, y + h / 2], [x - w / 2, y - h / 2],            // left wall up
      [x - w / 2 + w / 3, y - h / 2 - h * 0.45], [x - w / 2 + w / 3, y - h / 2],
      [x - w / 2 + 2 * w / 3, y - h / 2 - h * 0.45], [x - w / 2 + 2 * w / 3, y - h / 2],
      [x + w / 2, y - h / 2 - h * 0.45], [x + w / 2, y + h / 2],
      [x - w / 2, y + h / 2],
    ];
    let L = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segs.push(d); L += d;
    }
    let remain = prog * L;
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && remain > 0; i++) {
      const f = Math.min(1, remain / segs[i - 1]);
      ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
                 pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f);
      remain -= segs[i - 1];
    }
    ctx.stroke();
  }

  // ---- phase 2: formula + hard hat ------------------------------------------
  function formula(ctx, t) {
    const a = easeInOut(seg(t, 18.4, 19.6));
    if (a <= 0) return;
    const y = 490;
    ctx.textBaseline = 'middle';
    ctx.font = FONT(90);
    const main = 'Con(F) ⊬';                 // ⊬ "does not prove"
    const w1 = ctx.measureText(main).width;
    ctx.font = FONT(58);
    const w2 = ctx.measureText('F').width;
    const x0 = W / 2 - (w1 + 8 + w2) / 2;
    // chalk: two passes, tiny offset
    for (const [dx, dy, aa] of [[0, 0, 0.92], [2.2, 1.6, 0.38]]) {
      ctx.globalAlpha = a * aa;
      ctx.fillStyle = '#e2e0d8';
      ctx.font = FONT(90);
      ctx.fillText(main, x0 + dx, y + dy);
      ctx.font = FONT(58);
      ctx.fillText('F', x0 + w1 + 8 + dx, y + 30 + dy);   // subscript F
    }
    ctx.globalAlpha = 1;
  }

  function hardHat(ctx, t) {
    if (t < 27.4) return;
    const yLand = 408;
    const drop = easeIn(seg(t, 27.5, 29.0));                 // accelerating fall
    const settle = easeOut(seg(t, 29.0, 29.65));
    const y = t < 29.0 ? -360 + (yLand + 28 + 360) * drop    // 6% overshoot
                       : yLand + 28 - 28 * settle;
    const tilt = (7 * Math.PI / 180) * easeOut(seg(t, 29.0, 29.8));
    const img = window.ASSETS && window.ASSETS.hardhat;
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.rotate(tilt);
    if (img) {
      const w = 340, h = w * img.height / img.width;
      ctx.drawImage(img, -w / 2, -h + 24, w, h);
    } else {
      // vector hard hat: dome + center ridge + brim. Origin = brim center.
      const Y = '#f6c915', Yd = '#d9a90f', Ydd = 'rgba(120,90,8,0.55)';
      // dome
      ctx.fillStyle = Y;
      ctx.beginPath();
      ctx.ellipse(0, -13, 118, 104, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = Ydd;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, -13, 118, 104, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      // shade band at dome base
      ctx.fillStyle = 'rgba(150,110,10,0.30)';
      ctx.beginPath();
      ctx.ellipse(0, -13, 118, 104, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.fillRect(-120, -34, 240, 22);
      ctx.restore();
      // center ridge
      ctx.strokeStyle = Yd;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.ellipse(0, -12, 36, 108, 0, Math.PI * 1.04, Math.PI * 1.96);
      ctx.stroke();
      ctx.strokeStyle = '#ffe565';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -12, 30, 102, 0, Math.PI * 1.06, Math.PI * 1.94);
      ctx.stroke();
      // brim
      const bw = 360, bh = 30, r = 15;
      ctx.fillStyle = Y;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, r);
      ctx.fill();
      ctx.strokeStyle = Ydd;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(150,110,10,0.30)';
      ctx.beginPath();
      ctx.roundRect(-bw / 2, 2, bw, bh / 2 - 2, [0, 0, r, r]);
      ctx.fill();
    }
    ctx.restore();
  }

  window.SCENES.s10 = {
    duration: 36.0,
    assets: { hardhat: '../assets/stills/r4-hard-hat-cutout.png' },
    draw(ctx, t) {
      bg(ctx);

      // ---------------- phase 1: the domesticated diagram --------------------
      const p1a = 1 - seg(t, 16.5, 17.5);
      if (p1a > 0 && t < 17.5) {
        ctx.globalAlpha = p1a;
        ctx.save();
        // trees row
        const g = easeOut(seg(t, 0.2, 1.6));
        trees.forEach(nodes => drawTree(ctx, nodes, g, 0, { nodeR: 6, lineW: 1.6, dimmed: 0.85 }));
        // substrate band
        strata(ctx, t, { y: STRATA_Y, thick: 0.8, labels: true, alpha: p1a });
        ctx.globalAlpha = p1a;                 // strata resets globalAlpha
        // four crossings
        CX.forEach((x, i) => crossArrow(ctx, x, i + 1, t, 0.7 + i * 0.25));
        // a human at every crossing
        CX.forEach((x, i) => {
          const ha = seg(t, 1.8 + i * 0.2, 2.4 + i * 0.2);
          if (ha > 0) {
            ctx.globalAlpha = p1a * ha;
            humanIcon(ctx, x - 90, A_TOP + 128, 56, C.ink);
            ctx.globalAlpha = p1a;
          }
        });
        // control glyphs, as the VO names them
        const gx = CX.map(x => x + 96), gy = A_TOP + 110;
        const ga = G_T.map(t0 => easeOut(seg(t, t0, t0 + 0.7)));
        if (ga[0] > 0) reviewStamp(ctx, gx[0], gy, p1a * ga[0]);
        if (ga[1] > 0) archLock(ctx, gx[1], gy - 14, p1a * ga[1]);
        if (ga[2] > 0) signature(ctx, gx[2], gy, p1a * ga[2]);
        if (ga[3] > 0) quarantine(ctx, gx[3], gy, p1a * ga[3], t);
        // fifth: no factory-factory
        const fa = seg(t, FF_T, FF_T + 0.4);
        if (fa > 0) {
          ctx.globalAlpha = p1a * fa;
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 2.5;
          factoryShape(ctx, FFX - 55, A_TOP + 96, 104, 60, seg(t, FF_T, FF_T + 0.9));
          // the factory's pen-arm drawing the smaller one
          const arm = seg(t, FF_T + 0.5, FF_T + 0.9);
          if (arm > 0) {
            ctx.lineWidth = 1.8;
            ctx.strokeStyle = C.dim;
            ctx.beginPath();
            ctx.moveTo(FFX - 4, A_TOP + 86);
            ctx.lineTo(FFX - 4 + 42 * arm, A_TOP + 86 + 26 * arm);
            ctx.stroke();
          }
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 2;
          factoryShape(ctx, FFX + 62, A_TOP + 124, 58, 34, seg(t, FF_T + 0.8, FF_T + 1.5));
          // red strike
          const st = easeOut(seg(t, FF_T + 1.6, FF_T + 2.0));
          if (st > 0) {
            ctx.strokeStyle = C.red;
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(FFX - 122, A_TOP + 30);
            ctx.lineTo(FFX - 122 + 244 * st, A_TOP + 30 + 138 * st);
            ctx.stroke();
          }
          if (t > FF_T + 1.8) {
            ctx.font = FONT(20);
            ctx.fillStyle = C.ink;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('no factory-factory', FFX, A_TOP + 188);
            ctx.textAlign = 'left';
          }
          ctx.globalAlpha = p1a;
        }
        ctx.restore();
        // on-screen text, phase 1
        ctx.globalAlpha = p1a;
        if (t < 13.4) caption(ctx, 'a human at every crossing', t, 2.6);
        else caption(ctx, 'no factory-factory', t, 13.8);
        ctx.globalAlpha = 1;
      }

      // ---------------- phase 2: the formula + the hat ------------------------
      if (t >= 17.5) {
        formula(ctx, t);
        hardHat(ctx, t);
        // ---------------- phase 3: the verdict --------------------------------
        caption(ctx, 'the authority gap', t, 29.9);
      }

      fadeToBlack(ctx, t, 35.2, 0.8);
    },
  };
})();
