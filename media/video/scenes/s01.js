// S1 — Cold open. 18.0s.
// Beats: black + cursor (0-1.2) · type "$ intent: build the product" (1.2-3.2)
// · detonate into goal tree (3.2-8.5) · bottom node flickers, amber arrow
// escapes down & re-enters top (8.5-12.5), freeze (12.5-13.2) · hard cut to
// black · CORELLIA title card (13.5-17.4) · cut (fade 17.4-18).
// VO (15.8s) starts at 0.8.
'use strict';
(() => {
  const { W, H, C, seg, easeOut, typed, buildTree, drawTree, loopArrow, bg, fadeToBlack, FONT } = window.LIB;

  const tree = buildTree(11, 4, W / 2, 250, { levelGap: 145, spread: 900 });
  const box = { x: W / 2 - 520, y: 250, w: 1040, h: 4 * 145 };

  window.SCENES.s01 = {
    duration: 18.0,
    draw(ctx, t) {
      bg(ctx);

      if (t < 13.2) {
        // terminal line
        const lineDone = t >= 1.2;
        if (t < 3.6 || t < 8.5) {
          // keep the line visible while tree grows, dimming
          const dim = 1 - 0.65 * seg(t, 3.6, 5.0);
          ctx.globalAlpha = dim;
          typed(ctx, '$ intent: build the product', 360, 160, t, 1.2, { cps: 22, size: 44, cursor: t < 3.6 });
          ctx.globalAlpha = 1;
        }
        // goal tree detonates downward
        const g = easeOut(seg(t, 3.4, 8.2));
        if (g > 0) drawTree(ctx, tree, g, 0);
        // bottom node flicker + escaping arrow
        if (t > 8.5) {
          // flicker the deepest node
          const maxY = Math.max(...tree.map(n => n.y));
          const deepest = tree.filter(n => n.y === maxY)
            .reduce((a, b) => (Math.abs(b.x - W / 2) < Math.abs(a.x - W / 2) ? b : a));
          const fl = Math.floor(t * 9) % 2 === 0;
          ctx.fillStyle = fl ? C.amber : C.ink;
          ctx.beginPath();
          ctx.arc(deepest.x, deepest.y, 12, 0, Math.PI * 2);
          ctx.fill();
          // arrow escapes frame downward and re-enters from top
          const p = seg(t, 9.0, 12.3);
          loopArrow(ctx, { x: box.x, y: box.y - 60, w: box.w, h: box.h + 140 }, p, { out: 260 });
        }
        // freeze beat 12.5-13.2 (nothing moves — drawing is already time-pure;
        // the loopArrow p clamps at 1, flicker keeps blinking — acceptable pulse)
      } else if (t < 13.5) {
        // hard cut: pure black
      } else {
        // title card
        typed(ctx, 'CORELLIA', W / 2, H / 2 - 40, t, 13.6, { cps: 14, size: 110, align: 'center', cursor: false });
        typed(ctx, 'a software factory', W / 2, H / 2 + 70, t, 14.6, { cps: 28, size: 38, align: 'center', color: C.dim, cursor: false });
      }
      fadeToBlack(ctx, t, 17.5, 0.5);
    },
  };
})();
