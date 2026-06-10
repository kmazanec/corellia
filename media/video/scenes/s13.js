// S13 — Outro card. 10.0s
// 0-2    : a contracting amber ring shrinks to small, centered, then fades;
// 2.5    : it resolves into the typed terminal line `$ CORELLIA`, cursor blinking;
// 4/5.3/6.6 : three lines type themselves, one per VO phrase;
// 8-9.5  : the cursor blinks alone; fade to black 9.5-10.
// VO (6.1s) starts at 0.8.
'use strict';
(() => {
  const { W, H, C, seg, easeInOut, typed, bg, fadeToBlack } = window.LIB;

  window.SCENES.s13 = {
    duration: 10.0,
    draw(ctx, t) {
      bg(ctx);

      // the loop, contracted to a ring — then it lets go
      const ringA = 1 - seg(t, 2.0, 2.6);
      if (ringA > 0) {
        const r = 26 + 470 * (1 - easeInOut(seg(t, 0, 1.9)));
        ctx.strokeStyle = C.amber;
        ctx.globalAlpha = ringA;
        ctx.lineWidth = 5;
        ctx.shadowColor = C.amber;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(W / 2, 400, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // the ring resolves into the terminal line (cursor keeps blinking to the end)
      typed(ctx, '$ CORELLIA', W / 2, 400, t, 2.5, { size: 84, align: 'center', cps: 16 });

      // three lines, one per VO phrase
      typed(ctx, 'one operation, recursing', W / 2, 560, t, 4.0, { size: 38, color: C.dim, align: 'center', cps: 44, cursor: false });
      typed(ctx, 'one loop, supervised', W / 2, 628, t, 5.3, { size: 38, color: C.dim, align: 'center', cps: 44, cursor: false });
      typed(ctx, 'a factory that remembers being built', W / 2, 696, t, 6.6, { size: 38, color: C.dim, align: 'center', cps: 44, cursor: false });

      fadeToBlack(ctx, t, 9.5, 0.5);
    },
  };
})();
