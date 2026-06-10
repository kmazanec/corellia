// S12 — The self. 19.5s
// Wide time-lapse: four overlapping generations of small trees bloom, resolve
// green, and vanish above; the substrate glows steadily and visibly thickens
// with each passing generation (1 -> 1.6); the circulating amber current is
// permanent, feeding each new root via a thin feeder tendril. The last
// generation is faint (blurred); the loop remains.
// Captions (top): `trees are thoughts` · `the loop is the thinker`.
// VO (~16.6s) starts at 0.8.
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, typed, strata, bg, fadeToBlack,
          buildTree, drawTree } = window.LIB;

  // generations: [start, [rootXs], seedBase]
  const GENS = [
    [0.6,  [480, 1340], 211],
    [5.0,  [820, 1560], 223],
    [9.4,  [320, 1080], 237],
    [13.4, [700, 1420], 251],
  ];
  const TREES = GENS.map(([start, xs, seed], gi) =>
    xs.map((x, i) => buildTree(seed + i * 17, 3, x, 196, { levelGap: 82, spread: 330 })));

  const STRATA_Y = 620;

  // partial quadratic curve from substrate top up to the tree root
  function feeder(ctx, rootX, p, alpha) {
    if (p <= 0 || alpha <= 0) return;
    const x0 = rootX + 200, y0 = STRATA_Y + 8;     // out of the strata
    const cx = rootX + 250, cy = 330;               // bows outward
    const x1 = rootX, y1 = 188;                     // into the root, from above
    ctx.strokeStyle = C.amber;
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2;
    ctx.shadowColor = C.amber;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const n = Math.ceil(30 * p);
    for (let i = 1; i <= n; i++) {
      const u = (i / 30) * Math.min(1, p);
      const a0 = (1 - u) * (1 - u), a1 = 2 * u * (1 - u), a2 = u * u;
      ctx.lineTo(a0 * x0 + a1 * cx + a2 * x1, a0 * y0 + a1 * cy + a2 * y1);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  window.SCENES.s12 = {
    duration: 19.5,
    draw(ctx, t) {
      bg(ctx);

      // the substrate thickens as each generation passes
      let thick = 1;
      for (const [start] of GENS) thick += 0.15 * easeInOut(seg(t, start + 3.6, start + 5.4));
      strata(ctx, t, { y: STRATA_Y, thick, labels: true, alpha: 1, current: 0.25 + 0.55 * easeOut(seg(t, 0.8, 2.8)) });

      // generations of trees: bloom, resolve, vanish
      GENS.forEach(([start, xs], gi) => {
        const u = t - start;
        if (u <= 0) return;
        const grow = easeOut(seg(u, 0, 2.6));
        const res = seg(u, 2.8, 4.6);
        const fade = 1 - seg(u, 4.8, 6.4);
        if (fade <= 0) return;
        const last = gi === GENS.length - 1;
        const cap = last ? 0.42 : 1;               // final generation: a blur
        if (last) { ctx.shadowColor = 'rgba(232,230,224,0.8)'; ctx.shadowBlur = 7; }
        xs.forEach((x, i) => {
          feeder(ctx, x, seg(u, 0, 1.1), fade * cap * (0.4 + 0.6 * (1 - res)));
          ctx.globalAlpha = cap;
          drawTree(ctx, TREES[gi][i], grow, res, { nodeR: 6, lineW: 1.6, dimmed: fade });
          ctx.globalAlpha = 1;
        });
        ctx.shadowBlur = 0;
      });

      // captions, top — the strata owns the lower frame
      typed(ctx, 'trees are thoughts', W / 2, 92, t, 10.8, { size: 40, align: 'center', cps: 40, cursor: false });
      typed(ctx, 'the loop is the thinker', W / 2, 158, t, 13.6, { size: 40, align: 'center', cps: 40, cursor: false });

      fadeToBlack(ctx, t, 18.9, 0.6);
    },
  };
})();
