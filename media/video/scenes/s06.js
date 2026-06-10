// S6 — Crossing 1: the evolve kind. 15.0s.
// Beats: panel stamp (0.2) + `· evolve` label (0.6) · small tree grows
// (0.8-2.4) · rightmost deep leaf hits red `friction` wall (2.4) · emits
// `blocker report` chip (3.4) · chip descends out of the tree into the
// substrate band (3.9-6.1) · morphs into amber `PR` chip (6.0-6.6) · rides the
// band right, passing human-review stamp w/ green check (~7.9) · lands on
// `harness code` box (9.4) which recolors ink→amber (9.6-10.6) · amber arrow
// climbs from the box to the next root (10.6-11.4) · second tree grows with
// amber-tinted leaves (11.2-13.6) · caption types at 11.8. VO starts 0.8.
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, typed, panel, chip, humanIcon, buildTree, drawTree, bg, FONT } = window.LIB;

  const TREE1 = buildTree(21, 3, 560, 250, { levelGap: 105, spread: 460 });
  const MAXD1 = Math.max(...TREE1.map(n => n.depth));
  const LEAF = TREE1.filter(n => n.depth === MAXD1).reduce((a, b) => (b.x > a.x ? b : a));
  const TREE2 = buildTree(33, 3, 1360, 250, { levelGap: 105, spread: 340 });
  const MAXD2 = Math.max(...TREE2.map(n => n.depth));

  const BAND = { x: 320, y: 735, w: 1280, h: 95 };
  const BANDY = BAND.y + BAND.h / 2;
  const BOXC = { x: 1360, y: BANDY, w: 220, h: 76 };
  const HUMANX = 1100;
  const RIDE_END = BOXC.x - BOXC.w / 2 - 38; // stop at the box's left edge
  const WALLX = LEAF.x + 55;

  function stampLabel(ctx, t) {
    typed(ctx, '· evolve', 215, 125, t, 0.6, { size: 40, color: C.amber, cursor: false, cps: 24 });
  }
  function capText(ctx, t) {
    typed(ctx, 'leaf → blocker → PR → harness', W / 2, H - 80, t, 11.8, { size: 38, align: 'center', cps: 40, cursor: false });
  }

  window.SCENES.s06 = {
    duration: 15.0,
    draw(ctx, t) {
      bg(ctx);
      panel(ctx, 1, '', t, 0.2);
      stampLabel(ctx, t);

      // --- substrate band + harness box (fade in as the chip heads down) ----
      const bandA = seg(t, 4.0, 4.8);
      if (bandA > 0) {
        ctx.globalAlpha = bandA;
        ctx.fillStyle = 'rgba(245,166,35,0.10)';
        ctx.fillRect(BAND.x, BAND.y, BAND.w, BAND.h);
        ctx.strokeStyle = C.amberDim;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(BAND.x, BAND.y, BAND.w, BAND.h);
        ctx.font = FONT(22);
        ctx.fillStyle = C.amberDim;
        ctx.textBaseline = 'middle';
        ctx.fillText('substrate', BAND.x + 22, BAND.y + 28);
        // harness code box on the band
        const re = easeInOut(seg(t, 9.6, 10.6)); // recolor ink -> amber
        const col = re > 0.5 ? C.amber : C.ink;
        if (re > 0) {
          ctx.fillStyle = `rgba(245,166,35,${0.18 * re})`;
          ctx.fillRect(BOXC.x - BOXC.w / 2, BOXC.y - BOXC.h / 2, BOXC.w, BOXC.h);
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(BOXC.x - BOXC.w / 2, BOXC.y - BOXC.h / 2, BOXC.w, BOXC.h);
        ctx.font = FONT(26);
        ctx.fillStyle = col;
        ctx.textAlign = 'center';
        ctx.fillText('harness code', BOXC.x, BOXC.y + 1);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }

      // --- amber arrow from harness box up to the next tree's root ----------
      const ap = easeInOut(seg(t, 10.6, 11.4));
      if (ap > 0) {
        const y0 = BAND.y - 6, y1 = 290;
        const yTip = y0 + (y1 - y0) * ap;
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 3.5;
        ctx.shadowColor = C.amber;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(BOXC.x, y0);
        ctx.lineTo(BOXC.x, yTip);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = C.amber;
        ctx.beginPath();
        ctx.moveTo(BOXC.x, yTip - 16);
        ctx.lineTo(BOXC.x - 10, yTip + 2);
        ctx.lineTo(BOXC.x + 10, yTip + 2);
        ctx.closePath();
        ctx.fill();
      }

      // --- tree 1 ------------------------------------------------------------
      const g1 = easeOut(seg(t, 0.8, 2.4));
      if (g1 > 0) drawTree(ctx, TREE1, g1, 0, { dimmed: 0.9 });

      // friction wall + leaf distress
      const wallA = easeOut(seg(t, 2.2, 2.7));
      if (wallA > 0) {
        ctx.globalAlpha = wallA;
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(WALLX, LEAF.y - 80);
        ctx.lineTo(WALLX, LEAF.y + 30);
        ctx.stroke();
        typed(ctx, 'friction', WALLX + 20, LEAF.y - 62, t, 2.5, { size: 26, color: C.red, cursor: false, cps: 30 });
        ctx.globalAlpha = 1;
        // leaf flickers red, then stays red
        const flick = t < 3.4 ? Math.floor(t * 9) % 2 === 0 : true;
        ctx.fillStyle = flick ? C.red : C.ink;
        ctx.beginPath();
        ctx.arc(LEAF.x, LEAF.y, 11, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- tree 2 (amber-tinted leaves) ---------------------------------------
      const g2 = easeOut(seg(t, 11.2, 13.6));
      if (g2 > 0) {
        drawTree(ctx, TREE2, g2, 0, { dimmed: 0.9 });
        for (const n of TREE2) {
          if (n.depth !== MAXD2) continue;
          const a = seg(g2, n.birth, n.birth + 0.08);
          if (a <= 0) continue;
          ctx.fillStyle = `rgba(245,166,35,${0.6 * a})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- human-review station on the band -----------------------------------
      if (bandA > 0) {
        ctx.globalAlpha = bandA;
        humanIcon(ctx, HUMANX, BAND.y - 55, 52, C.dim);
        ctx.font = FONT(22);
        ctx.fillStyle = C.dim;
        ctx.textAlign = 'center';
        ctx.fillText('review', HUMANX, BAND.y - 14);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }

      // --- the chip: blocker report -> PR --------------------------------------
      const pA = easeInOut(seg(t, 3.9, 6.1));         // descent
      const pB = easeInOut(seg(t, 6.3, 9.4));         // ride the band right
      const land = seg(t, 9.4, 9.8);                  // absorbed into box
      const DESCX = LEAF.x - 70; // descent drifts left, clear of the review station
      let chipX = LEAF.x, chipY = LEAF.y + 40;
      if (pA > 0) { chipY = LEAF.y + 40 + (BANDY - LEAF.y - 40) * pA; chipX = LEAF.x + (DESCX - LEAF.x) * pA; }
      if (pB > 0) chipX = DESCX + (RIDE_END - DESCX) * pB;
      const morph = seg(t, 6.0, 6.6);                 // blocker -> PR crossfade
      if (t >= 3.4 && land < 1) {
        const popA = easeOut(seg(t, 3.4, 3.8));
        ctx.globalAlpha = popA * (1 - land);
        if (morph < 1) {
          ctx.globalAlpha = popA * (1 - morph) * (1 - land);
          chip(ctx, chipX, chipY, 'blocker report', { color: C.ink, size: 24 });
        }
        if (morph > 0) {
          ctx.globalAlpha = morph * (1 - land);
          chip(ctx, chipX, chipY, 'PR', { color: C.amber, size: 26 });
        }
        ctx.globalAlpha = 1;
      }
      // green check once the PR has passed review
      const passed = pB > 0 && chipX >= HUMANX;
      if (passed) {
        ctx.strokeStyle = C.green;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(HUMANX + 36, BAND.y - 72);
        ctx.lineTo(HUMANX + 48, BAND.y - 58);
        ctx.lineTo(HUMANX + 72, BAND.y - 92);
        ctx.stroke();
      }
      // landing pulse on the box
      if (land > 0 && land < 1) {
        ctx.strokeStyle = `rgba(245,166,35,${1 - land})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(BOXC.x - BOXC.w / 2 - 14 * land, BOXC.y - BOXC.h / 2 - 14 * land,
          BOXC.w + 28 * land, BOXC.h + 28 * land);
      }

      capText(ctx, t);
    },
  };
})();
