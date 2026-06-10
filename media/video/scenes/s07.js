// S7 — Crossing 2: type memory. 14.5s.
// Beats: panel stamp (0.2) + `· type memory` label (0.6) · three mini-trees
// grow, each with an identical `critique` chip on one leaf (0.8-2.4) ·
// droplets labeled `lesson` drip from each chip into a shared vessel
// `type memory` (2.6-8.4), fill level rises · a pipe draws on from the vessel
// into the `memory` slot of a fresh harness card (8.0-9.2), amber flow dashes
// run through it (9.2+) · the memory slot tints amber (9.6-10.6) · stacked
// outlines behind the card read "every new instance" (9.8) · caption (11.2).
// VO starts 0.8.
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, typed, panel, chip, buildTree, drawTree, bg, FONT } = window.LIB;

  const SEEDS = [41, 52, 63];
  const TREES = SEEDS.map((s, i) => buildTree(s, 2, 440 + i * 360, 260, { levelGap: 92, spread: 230 }));
  // one leaf per tree carries the `critique` chip — the leaf nearest tree center
  const CHIPN = TREES.map((tr, i) => {
    const cx = 440 + i * 360;
    const md = Math.max(...tr.map(n => n.depth));
    return tr.filter(n => n.depth === md).reduce((a, b) => (Math.abs(b.x - cx) < Math.abs(a.x - cx) ? b : a));
  });

  const VESSEL = { x: 700, top: 700, bot: 845, w: 150 };       // open-top container
  const CARD = { x: 1270, y: 520, w: 310, h: 360 };            // harness card
  const SLOTS = ['context', 'memory', 'tools', 'evals', 'tier'];
  const SLOTH = 56, SLOT0 = CARD.y + 80;                       // first slot row top
  const MEMY = SLOT0 + 1 * SLOTH + SLOTH / 2;                  // memory slot center y
  const PIPE = [[VESSEL.x + VESSEL.w / 2, 808], [1140, 808], [1140, MEMY], [CARD.x, MEMY]];

  // droplet schedule: tree i, drop j -> start time
  const DROPS = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++)
      DROPS.push({ i, t0: 2.6 + i * 0.45 + j * 1.35 });
  const FLIGHT = 0.95;

  function pipePoint(p) {
    // position along PIPE polyline at fraction p of total length
    const L = []; let tot = 0;
    for (let i = 1; i < PIPE.length; i++) {
      const d = Math.hypot(PIPE[i][0] - PIPE[i - 1][0], PIPE[i][1] - PIPE[i - 1][1]);
      L.push(d); tot += d;
    }
    let rem = p * tot;
    for (let i = 1; i < PIPE.length; i++) {
      if (rem <= L[i - 1]) {
        const f = rem / L[i - 1];
        return [PIPE[i - 1][0] + (PIPE[i][0] - PIPE[i - 1][0]) * f, PIPE[i - 1][1] + (PIPE[i][1] - PIPE[i - 1][1]) * f];
      }
      rem -= L[i - 1];
    }
    return PIPE[PIPE.length - 1];
  }

  window.SCENES.s07 = {
    duration: 14.5,
    draw(ctx, t) {
      bg(ctx);
      panel(ctx, 2, '', t, 0.2);
      typed(ctx, '· type memory', 215, 125, t, 0.6, { size: 40, color: C.amber, cursor: false, cps: 24 });

      // --- mini-trees with critique chips -----------------------------------
      const g = easeOut(seg(t, 0.8, 2.4));
      for (const tr of TREES) if (g > 0) drawTree(ctx, tr, g, 0, { nodeR: 7, dimmed: 0.7 });
      if (g > 0.7) {
        const ca = seg(g, 0.7, 1);
        ctx.globalAlpha = ca;
        for (const n of CHIPN) chip(ctx, n.x, n.y + 6, 'critique', { color: C.ink, size: 20, pad: 10 });
        ctx.globalAlpha = 1;
      }

      // --- vessel -------------------------------------------------------------
      const va = seg(t, 1.6, 2.4);
      if (va > 0) {
        ctx.globalAlpha = va;
        // fill level (amber)
        const lvl = easeInOut(seg(t, 2.9, 8.6));
        const fh = (VESSEL.bot - VESSEL.top - 14) * 0.85 * lvl;
        ctx.fillStyle = 'rgba(245,166,35,0.40)';
        ctx.fillRect(VESSEL.x - VESSEL.w / 2 + 4, VESSEL.bot - 4 - fh, VESSEL.w - 8, fh);
        // walls: open-top U
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(VESSEL.x - VESSEL.w / 2, VESSEL.top);
        ctx.lineTo(VESSEL.x - VESSEL.w / 2, VESSEL.bot);
        ctx.lineTo(VESSEL.x + VESSEL.w / 2, VESSEL.bot);
        ctx.lineTo(VESSEL.x + VESSEL.w / 2, VESSEL.top);
        ctx.stroke();
        ctx.font = FONT(26);
        ctx.fillStyle = C.amber;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('type memory', VESSEL.x, VESSEL.bot + 36);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }

      // --- droplets ------------------------------------------------------------
      for (const d of DROPS) {
        const p = seg(t, d.t0, d.t0 + FLIGHT);
        if (p <= 0 || p >= 1) continue;
        const n = CHIPN[d.i];
        const x0 = n.x, y0 = n.y + 30;
        const x1 = VESSEL.x + (d.i - 1) * 22, y1 = VESSEL.top + 10;
        const x = x0 + (x1 - x0) * p;
        const y = y0 + (y1 - y0) * p * p; // accelerating fall
        ctx.fillStyle = C.amber;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      // one label on the falling stream
      typed(ctx, 'lesson', 560, 600, t, 3.0, { size: 24, color: C.dim, cursor: false, cps: 30 });

      // --- harness card (with stacked ghosts = every new instance) -------------
      const carda = seg(t, 6.8, 7.6);
      if (carda > 0) {
        ctx.globalAlpha = carda;
        // ghost stack behind
        ctx.strokeStyle = C.faint;
        ctx.lineWidth = 2;
        ctx.strokeRect(CARD.x + 28, CARD.y - 28, CARD.w, CARD.h);
        ctx.strokeRect(CARD.x + 14, CARD.y - 14, CARD.w, CARD.h);
        // front card
        ctx.fillStyle = C.bg;
        ctx.fillRect(CARD.x, CARD.y, CARD.w, CARD.h);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(CARD.x, CARD.y, CARD.w, CARD.h);
        ctx.font = FONT(26);
        ctx.fillStyle = C.ink;
        ctx.textBaseline = 'middle';
        ctx.fillText('harness: critique', CARD.x + 24, CARD.y + 42);
        ctx.strokeStyle = C.faint;
        ctx.beginPath();
        ctx.moveTo(CARD.x, CARD.y + 70);
        ctx.lineTo(CARD.x + CARD.w, CARD.y + 70);
        ctx.stroke();
        // slots
        const tint = easeInOut(seg(t, 9.6, 10.6));
        for (let i = 0; i < SLOTS.length; i++) {
          const yy = SLOT0 + i * SLOTH;
          const isMem = SLOTS[i] === 'memory';
          if (isMem && tint > 0) {
            ctx.fillStyle = `rgba(245,166,35,${0.22 * tint})`;
            ctx.fillRect(CARD.x + 2, yy, CARD.w - 4, SLOTH);
          }
          ctx.font = FONT(24);
          ctx.fillStyle = isMem && tint > 0.5 ? C.amber : C.dim;
          ctx.fillText(SLOTS[i], CARD.x + 24, yy + SLOTH / 2);
          ctx.strokeStyle = C.faint;
          ctx.beginPath();
          ctx.moveTo(CARD.x + 12, yy + SLOTH);
          ctx.lineTo(CARD.x + CARD.w - 12, yy + SLOTH);
          ctx.stroke();
        }
        typed(ctx, 'every new instance', CARD.x + CARD.w / 2, CARD.y + CARD.h + 40, t, 9.8, { size: 24, color: C.dim, align: 'center', cursor: false, cps: 30 });
        ctx.globalAlpha = 1;
      }

      // --- pipe: vessel -> memory slot ------------------------------------------
      const pd = easeInOut(seg(t, 8.0, 9.2)); // draw-on
      if (pd > 0) {
        ctx.strokeStyle = C.amberDim;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(PIPE[0][0], PIPE[0][1]);
        const tip = pipePoint(pd);
        // re-trace up to tip
        const L = []; let tot = 0;
        for (let i = 1; i < PIPE.length; i++) {
          const d = Math.hypot(PIPE[i][0] - PIPE[i - 1][0], PIPE[i][1] - PIPE[i - 1][1]);
          L.push(d); tot += d;
        }
        let rem = pd * tot;
        for (let i = 1; i < PIPE.length && rem > 0; i++) {
          const f = Math.min(1, rem / L[i - 1]);
          ctx.lineTo(PIPE[i - 1][0] + (PIPE[i][0] - PIPE[i - 1][0]) * f, PIPE[i - 1][1] + (PIPE[i][1] - PIPE[i - 1][1]) * f);
          rem -= L[i - 1];
        }
        ctx.stroke();
        // flowing dashes once the pipe is complete
        if (pd >= 1) {
          ctx.strokeStyle = C.amber;
          ctx.lineWidth = 4;
          ctx.setLineDash([18, 26]);
          ctx.lineDashOffset = -t * 110;
          ctx.beginPath();
          ctx.moveTo(PIPE[0][0], PIPE[0][1]);
          for (let i = 1; i < PIPE.length; i++) ctx.lineTo(PIPE[i][0], PIPE[i][1]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      typed(ctx, 'instances rewrite the class', W / 2, H - 80, t, 11.2, { size: 38, align: 'center', cps: 40, cursor: false });
    },
  };
})();
