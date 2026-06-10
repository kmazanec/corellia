// S3 — The tame hierarchy. 30.0s. VO (~28s) starts at 0.8.
// Beats: cycle 1 grow+resolve+fold (1-10) · cycle 2, quicker (10-17) ·
// annotations as VO names them: shrinking bracket "splits shrink the goal"
// (3.5) · counter "attempts: 3 → 2 → 1" (8.0) · downward-only verify arrow
// (10.5) · padlocked "factory code" box outside the tree (13.5) ·
// "well-founded" (18.0) · "every tree terminates" (19.6) · everything dims,
// "yet." alone (27.0-27.6) · paper wash bleeds in over the last 1.0s (29-30).
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, typed, buildTree, chip, lockIcon,
          bg, FONT } = window.LIB;

  const lerp = (a, b, k) => a + (b - a) * k;

  const ROOT = { x: W / 2, y: 250 };
  const treeA = buildTree(21, 4, ROOT.x, ROOT.y, { levelGap: 130, spread: 760 });
  const treeB = buildTree(33, 4, ROOT.x, ROOT.y, { levelGap: 130, spread: 760 });

  // grow + resolve + fold-up: branches collapse toward parents as res -> 1
  function foldTree(ctx, nodes, g, res, alpha) {
    if (alpha <= 0) return;
    const pos = new Array(nodes.length);
    for (const n of nodes) {
      if (n.parent < 0) { pos[n.id] = [n.x, n.y]; continue; }
      // resolve first (turn green, hold), then fold toward the parent late
      const f = easeInOut(seg(res, n.resolveAt + (1 - n.resolveAt) * 0.55, 1 + 1e-4));
      const pp = pos[n.parent];
      pos[n.id] = [lerp(n.x, pp[0], f), lerp(n.y, pp[1], f)];
    }
    ctx.lineWidth = 2;
    for (const n of nodes) {
      if (n.parent < 0) continue;
      const a = seg(g, n.birth, n.birth + 0.1);
      if (a <= 0) continue;
      const resolved = res >= n.resolveAt;
      const pp = pos[n.parent], np = pos[n.id];
      ctx.strokeStyle = resolved ? C.green : C.ink;
      ctx.globalAlpha = alpha * (resolved ? 0.9 : 0.5 * a);
      ctx.beginPath();
      ctx.moveTo(pp[0], pp[1]);
      ctx.lineTo(pp[0] + (np[0] - pp[0]) * a, pp[1] + (np[1] - pp[1]) * a);
      ctx.stroke();
    }
    for (const n of nodes) {
      const a = seg(g, n.birth, n.birth + 0.08);
      if (a <= 0) continue;
      const resolved = res >= n.resolveAt;
      const np = pos[n.id];
      ctx.fillStyle = resolved ? C.green : C.ink;
      ctx.globalAlpha = alpha * (resolved ? 1 : 0.35 + 0.65 * a);
      ctx.beginPath();
      ctx.arc(np[0], np[1], (n.parent < 0 ? 11 : 8) * (0.5 + 0.5 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    // completed artifact at the root
    const fa = seg(res, 0.96, 1);
    if (fa > 0) {
      ctx.globalAlpha = alpha * fa;
      chip(ctx, ROOT.x, ROOT.y - 64, 'artifact ✓', { color: C.green, size: 28 });
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ROOT.x, ROOT.y, 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // one machine cycle: grow over 42%, resolve 45%..95%
  function cyclePhases(t, t0, t1) {
    const d = t1 - t0;
    return {
      g: easeOut(seg(t, t0, t0 + 0.42 * d)),
      res: easeInOut(seg(t, t0 + 0.45 * d, t0 + 0.95 * d)),
    };
  }

  function bracket(ctx, t, t0, alpha) {
    const a = seg(t, t0, t0 + 0.5) * alpha;
    if (a <= 0) return;
    const cx = 330, y = 360;
    const hw = lerp(180, 80, easeInOut(seg(t, t0 + 0.7, t0 + 3.2)));
    ctx.globalAlpha = a;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y + 14); ctx.lineTo(cx - hw, y);
    ctx.lineTo(cx + hw, y); ctx.lineTo(cx + hw, y + 14);
    ctx.stroke();
    typed(ctx, 'splits shrink the goal', cx, y + 52, t, t0 + 0.3,
      { size: 24, align: 'center', cursor: false, color: C.dim });
    ctx.globalAlpha = 1;
  }

  window.SCENES.s03 = {
    duration: 30.0,
    draw(ctx, t) {
      bg(ctx);

      // master dim: everything but "yet." fades way down at 27.0
      const dim = 1 - 0.88 * seg(t, 27.0, 27.6);

      // ---- the machine cycling: two grow+resolve+fold cycles ----------------
      {
        const a1 = (1 - seg(t, 9.6, 10.0)) * dim;
        if (t < 10.0 && a1 > 0) {
          const { g, res } = cyclePhases(t, 1.0, 10.0);
          foldTree(ctx, treeA, g, res, a1);
        }
        if (t >= 10.0) {
          const { g, res } = cyclePhases(t, 10.0, 17.0);
          foldTree(ctx, treeB, g, res, dim);
        }
      }

      // ---- annotations, as the VO names each discipline ---------------------
      ctx.globalAlpha = dim;
      bracket(ctx, t, 3.5, dim);

      // attempts counter (top right)
      ctx.globalAlpha = dim;
      typed(ctx, 'attempts: 3 → 2 → 1', 1330, 330, t, 8.0,
        { size: 28, cursor: false, cps: 8, color: C.ink });

      // downward-only verify arrow (top right, clear of the tree)
      const va = seg(t, 10.5, 11.2);
      if (va > 0) {
        const x = 1700, y0 = 390, y1 = lerp(y0, 520, easeOut(va));
        ctx.globalAlpha = dim;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        if (va >= 1) {
          ctx.fillStyle = C.ink;
          ctx.beginPath();
          ctx.moveTo(x, 534); ctx.lineTo(x - 9, 516); ctx.lineTo(x + 9, 516);
          ctx.closePath(); ctx.fill();
        }
        typed(ctx, 'parents verify children', x, 574, t, 11.0, { size: 22, align: 'center', cursor: false, color: C.dim });
        typed(ctx, '— never the reverse', x, 608, t, 11.8, { size: 22, align: 'center', cursor: false, color: C.dim });
      }

      // padlocked factory code box, OUTSIDE the tree (bottom left)
      const pa = seg(t, 13.5, 14.2);
      if (pa > 0) {
        ctx.globalAlpha = dim * pa;
        ctx.strokeStyle = C.dim;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(115, 855, 250, 88);
        lockIcon(ctx, 240, 812, 38, C.ink);
        ctx.font = FONT(24);
        ctx.fillStyle = C.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('factory code', 240, 901);
        ctx.textAlign = 'left';
        ctx.globalAlpha = dim;
      }

      // ---- end text ----------------------------------------------------------
      typed(ctx, 'well-founded', W / 2, 870, t, 18.0, { size: 44, align: 'center', cursor: false });
      typed(ctx, 'every tree terminates', W / 2, 932, t, 19.6, { size: 28, align: 'center', cursor: false, color: C.dim });
      ctx.globalAlpha = 1;

      // alone for the final beat
      if (t >= 27.4) {
        typed(ctx, 'yet.', W / 2, H / 2 - 20, t, 27.5, { size: 72, align: 'center', cps: 8 });
      }

      // paper wash — leaving the machine for a book
      const wash = easeInOut(seg(t, 29.0, 30.0));
      if (wash > 0) {
        ctx.globalAlpha = 0.9 * wash;
        ctx.fillStyle = C.paper;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = wash;
        typed(ctx, 'yet.', W / 2, H / 2 - 20, t, 27.5, { size: 72, align: 'center', cursor: false, color: C.paperInk });
        ctx.globalAlpha = 1;
      }
    },
  };
})();
