// S5 — The twist. 19.0s. VO (~17.6s) starts at 0.8.
// Beats: trees bloom and die in time-lapse (0.3-end) · caption "within a run:
// well-founded" (2.2) · camera tilts down (5.8-8.8) revealing the substrate
// strata · amber arrow escapes a dying tree's leaf, dives through the strata,
// curves back up to the NEXT tree's forming root (9.3-12.9) · circulating
// current stays on (12.9+) · caption "across runs: a strange loop" (13.5) ·
// big amber boxed `4` stamps on (16.3) · caption "4 level-crossings" (16.8).
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, caption, buildTree, drawTree,
          strata, bg, FONT } = window.LIB;

  const lerp = (a, b, k) => a + (b - a) * k;

  // ---- time-lapse tree schedule (world: roots y=380, leaves ~y=644) ---------
  const SPECS = [
    { t0: 0.3,  x: 960,  seed: 41, spread: 470, life: 3.4 },
    { t0: 2.1,  x: 540,  seed: 42, spread: 380, life: 2.8 },
    { t0: 3.5,  x: 1380, seed: 43, spread: 380, life: 2.8 },
    { t0: 5.1,  x: 760,  seed: 44, spread: 360, life: 2.7 },
    { t0: 6.5,  x: 1180, seed: 45, spread: 360, life: 2.7 },
    { t0: 7.8,  x: 460,  seed: 46, spread: 380, life: 3.2 },  // arrow source
    { t0: 9.6,  x: 1320, seed: 47, spread: 360, life: 2.8 },
    { t0: 12.5, x: 860,  seed: 48, spread: 400, life: 3.4 },  // arrow target
    { t0: 14.6, x: 1280, seed: 49, spread: 360, life: 2.8 },
    { t0: 16.1, x: 540,  seed: 50, spread: 360, life: 2.8 },
  ];
  const TREES = SPECS.map(s => ({
    ...s,
    nodes: buildTree(s.seed, 3, s.x, 380, { levelGap: 88, spread: s.spread }),
  }));

  // arrow source: a deep leaf of the dying tree #5; target: tree #7 root
  const srcTree = TREES[5], dstTree = TREES[7];
  const srcLeaf = srcTree.nodes.filter(n => n.depth === 3)
    .reduce((a, b) => (Math.abs(b.x - srcTree.x) < Math.abs(a.x - srcTree.x) ? b : a));

  // ---- amber loop path: leaf -> down through strata -> up to next root ------
  function sampleBez(p0, p1, p2, p3, n, out) {
    for (let i = 1; i <= n; i++) {
      const u = i / n, v = 1 - u;
      out.push([
        v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
        v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
      ]);
    }
  }
  const PATH = [[srcLeaf.x, srcLeaf.y]];
  sampleBez([srcLeaf.x, srcLeaf.y], [srcLeaf.x - 60, 860], [srcLeaf.x - 10, 1100], [640, 1140], 30, PATH);
  sampleBez([640, 1140], [720, 1155], [790, 1155], [880, 1110], 16, PATH);
  sampleBez([880, 1110], [990, 1050], [930, 560], [dstTree.x, 396], 30, PATH);
  const SEGL = [];
  let PATHLEN = 0;
  for (let i = 1; i < PATH.length; i++) {
    const d = Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]);
    SEGL.push(d); PATHLEN += d;
  }
  function drawLoopPath(ctx, p) {
    if (p <= 0) return;
    let remain = p * PATHLEN;
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 5;
    ctx.shadowColor = C.amber;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(PATH[0][0], PATH[0][1]);
    let tip = PATH[0];
    for (let i = 1; i < PATH.length && remain > 0; i++) {
      const d = SEGL[i - 1];
      const f = Math.min(1, remain / d);
      tip = [PATH[i - 1][0] + (PATH[i][0] - PATH[i - 1][0]) * f,
             PATH[i - 1][1] + (PATH[i][1] - PATH[i - 1][1]) * f];
      ctx.lineTo(tip[0], tip[1]);
      remain -= d;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], 9, 0, Math.PI * 2);
    ctx.fill();
  }

  window.SCENES.s05 = {
    duration: 19.0,
    draw(ctx, t) {
      bg(ctx);

      // ---- camera tilt: translate world up, revealing the substrate ---------
      const ty = -300 * easeInOut(seg(t, 5.8, 8.8));
      ctx.save();
      ctx.translate(0, ty);

      // ground line (revealed by the tilt)
      const ga = seg(t, 6.2, 7.2);
      if (ga > 0) {
        ctx.strokeStyle = `rgba(107,105,99,${0.7 * ga})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(140, 980); ctx.lineTo(W - 140, 980); ctx.stroke();
      }

      // persistent substrate: four faint labeled strata + circulating current
      const sa = seg(t, 6.5, 8.2);
      if (sa > 0) {
        strata(ctx, t, { y: 1000, alpha: 0.9 * sa, labels: true, current: 0.9 * seg(t, 12.9, 14.5) });
      }

      // ---- trees blooming and dying like seasons ----------------------------
      for (const tr of TREES) {
        const a = seg(t, tr.t0, tr.t0 + 0.15) * (1 - seg(t, tr.t0 + 0.88 * tr.life, tr.t0 + tr.life));
        if (a <= 0) continue;
        const g = easeOut(seg(t, tr.t0, tr.t0 + 0.5 * tr.life));
        const res = easeInOut(seg(t, tr.t0 + 0.5 * tr.life, tr.t0 + 0.86 * tr.life));
        ctx.globalAlpha = a;
        drawTree(ctx, tr.nodes, g, res, { nodeR: 6, lineW: 1.6 });
        ctx.globalAlpha = 1;
      }

      // dying leaf flickers amber just before the arrow escapes
      if (t > 8.9 && t < 9.7) {
        ctx.fillStyle = Math.floor(t * 9) % 2 === 0 ? C.amber : C.ink;
        ctx.beginPath();
        ctx.arc(srcLeaf.x, srcLeaf.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      // the amber arrow: out the bottom, through the substrate, up to the
      // next tree's forming root (dims a little once the stamp takes over)
      ctx.globalAlpha = 1 - 0.55 * seg(t, 15.8, 17.0);
      drawLoopPath(ctx, easeInOut(seg(t, 9.3, 12.9)));
      ctx.globalAlpha = 1;

      ctx.restore();

      // ---- the big `4` stamp -------------------------------------------------
      const st = seg(t, 16.3, 16.55);
      if (st > 0) {
        const sc = lerp(1.6, 1, easeOut(st));
        ctx.save();
        ctx.translate(960, 420);
        ctx.scale(sc, sc);
        ctx.globalAlpha = Math.min(1, st * 1.4);
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 7;
        ctx.shadowColor = C.amber;
        ctx.shadowBlur = 26;
        ctx.strokeRect(-115, -115, 230, 230);
        ctx.shadowBlur = 0;
        ctx.font = FONT(150);
        ctx.fillStyle = C.amber;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('4', 0, 10);
        ctx.textAlign = 'left';
        ctx.restore();
      }

      // ---- captions ----------------------------------------------------------
      if (t >= 2.2 && t < 6.5) caption(ctx, 'within a run: well-founded', t, 2.2, { y: 1014, size: 34 });
      if (t >= 13.5 && t < 16.6) caption(ctx, 'across runs: a strange loop', t, 13.5, { y: 1014, size: 34 });
      if (t >= 16.8) caption(ctx, '4 level-crossings', t, 16.8, { y: 1014, size: 34 });
    },
  };
})();
