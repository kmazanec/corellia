// S2 — The factory in sixty seconds. 58.0s. VO (~55.8s) starts at 0.8.
// Beats: goal node appears (1.5-3) · type chips PRD/diff/critique (6.5-15)
// · operation lifecycle on the node: receive pulse (16-17.5), decide chips
// satisfy/split/block (17.5-22.5), split children bud w/ dep arrows
// (19.8-22.5), integrate green dots up (22.5-24), emit artifact chip (24-25.5)
// · camera pulls back (25.5-29): the whole tree pulses, same op everywhere
// · harness card inset snaps onto a node (28.8-40.2) · "design phase" dotted
// region (35-40.3) · three gate icons on the tree (41.5/44/46.5) · tier ladder
// haiku→sonnet→opus→human (49.8-end) · captions per VO · settle + fade (57.3).
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, typed, caption, buildTree, drawTree,
          chip, humanIcon, bg, fadeToBlack, FONT } = window.LIB;

  const lerp = (a, b, k) => a + (b - a) * k;

  // ---- world geometry -------------------------------------------------------
  const RX = W / 2, RY = 400;          // the goal node (and tree root)
  const SCALE = 0.52, RY2 = 300;       // pulled-back transform
  const tree = buildTree(7, 4, RX, RY, { levelGap: 150, spread: 700 });
  const kids = tree.filter(n => n.depth === 1);
  const maxD = Math.max(...tree.map(n => n.depth));
  const gateLeaf = tree.filter(n => n.depth === maxD)
    .reduce((a, b) => (Math.abs(b.x - 1150) < Math.abs(a.x - 1150) ? b : a));
  // left subtree bbox (the "design phase" region)
  const leftSet = new Set([kids[0].id]);
  for (const n of tree) if (n.parent >= 0 && leftSet.has(n.parent)) leftSet.add(n.id);
  const ls = tree.filter(n => leftSet.has(n.id));
  const lbx = (Math.min(...ls.map(n => n.x)) + Math.max(...ls.map(n => n.x))) / 2;
  const lby = (Math.min(...ls.map(n => n.y)) + Math.max(...ls.map(n => n.y))) / 2;
  const lrx = (Math.max(...ls.map(n => n.x)) - Math.min(...ls.map(n => n.x))) / 2 + 60;
  const lry = (Math.max(...ls.map(n => n.y)) - Math.min(...ls.map(n => n.y))) / 2 + 50;
  // world -> screen at the FINAL pulled-back transform (insets appear after pull)
  const toS = (x, y) => [(x - RX) * SCALE + RX, (y - RY) * SCALE + RY2];

  // ---- caption schedule (windows; one at a time) -----------------------------
  const CAPS = [
    ['everything is a typed goal', 7.5, 15.0],
    ['one operation: receive · decide · integrate · emit', 15.5, 28.6],
    ['a goal-type IS a harness', 29.2, 40.2],
    ['three evals', 40.8, 52.6],
    ['humans: last resort', 53.2, 58.1],
  ];

  // ---- small widgets ---------------------------------------------------------
  function gate(ctx, x, y, label, t, t0, labelSide = 1) {
    const a = seg(t, t0, t0 + 0.4);
    if (a <= 0) return;
    const s = 15;
    ctx.globalAlpha = a;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.stroke();
    const ca = seg(t, t0 + 0.6, t0 + 1.0);
    if (ca > 0) {
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 3;
      ctx.globalAlpha = a * ca;
      ctx.beginPath();
      ctx.moveTo(x - 6, y); ctx.lineTo(x - 1.5, y + 5.5); ctx.lineTo(x + 7, y - 6);
      ctx.stroke();
    }
    ctx.globalAlpha = a;
    ctx.font = FONT(22);
    ctx.fillStyle = C.ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = labelSide > 0 ? 'left' : 'right';
    ctx.fillText(label, x + labelSide * (s + 12), y);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  window.SCENES.s02 = {
    duration: 58.0,
    draw(ctx, t) {
      bg(ctx);

      // ================= camera (pull-back 25.5-29) =========================
      const k = easeInOut(seg(t, 25.5, 29.0));
      const sc = lerp(1, SCALE, k);
      ctx.save();
      ctx.translate(RX, lerp(RY, RY2, k));
      ctx.scale(sc, sc);
      ctx.translate(-RX, -RY);

      // ================= stage A: single-node operation =====================
      const aA = (1 - seg(t, 25.5, 27.0));
      if (aA > 0) {
        ctx.globalAlpha = aA;

        // the goal node
        const na = seg(t, 1.5, 2.3);
        if (na > 0) {
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(RX, RY, 26 * easeOut(na), 0, Math.PI * 2);
          ctx.stroke();
          // label fades once children bud
          ctx.globalAlpha = aA * (1 - 0.8 * seg(t, 19.5, 20.5));
          typed(ctx, 'goal', RX, RY + 58, t, 1.9, { size: 30, align: 'center', cursor: false, color: C.ink });
          ctx.globalAlpha = aA;
        }

        // type chips: PRD · diff · critique, with contracts
        const aChips = seg(t, 6.5, 7.2) * (1 - seg(t, 14.2, 15.0));
        if (aChips > 0) {
          const CH = [['PRD', 700], ['diff', 960], ['critique', 1220]];
          CH.forEach(([lab, x], i) => {
            const ai = aChips * seg(t, 6.5 + i * 0.5, 7.1 + i * 0.5);
            if (ai <= 0) return;
            const y = (i === 1 ? 175 : 205) + 5 * Math.sin(t * 1.1 + i * 2.1);
            ctx.globalAlpha = aA * ai * 0.18;
            ctx.strokeStyle = C.dim;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, y + 50); ctx.lineTo(RX, RY - 30); ctx.stroke();
            ctx.globalAlpha = aA * ai;
            chip(ctx, x, y, lab, { size: 28 });
            ctx.font = FONT(18);
            ctx.fillStyle = C.dim;
            ctx.textAlign = 'center';
            ctx.fillText('in → out', x, y + 48);
            ctx.textAlign = 'left';
          });
          ctx.globalAlpha = aA;
        }

        // phase checklist (left)
        if (t > 15.6) {
          const PH = [['receive', 16.0, 17.5], ['decide', 17.5, 22.5], ['integrate', 22.5, 24.0], ['emit', 24.0, 25.7]];
          PH.forEach(([lab, p0, p1], i) => {
            const active = t >= p0 && t < p1;
            typed(ctx, (active ? '▸ ' : '  ') + lab, 200, 330 + i * 56, t, 15.7 + i * 0.18,
              { size: 30, cursor: false, color: active ? C.ink : C.dim });
          });
        }

        // RECEIVE: expanding pulse rings (16-17.8)
        if (t > 16 && t < 18.0) {
          for (let i = 0; i < 2; i++) {
            const f = ((t - 16) * 0.85 + i * 0.5) % 1;
            ctx.globalAlpha = aA * (1 - f) * 0.8;
            ctx.strokeStyle = C.ink;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(RX, RY, 30 + 60 * f, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = aA;
        }

        // DECIDE: three option chips (right), glowing in VO order
        const aDec = seg(t, 17.5, 18.0) * (1 - seg(t, 24.2, 25.2));
        if (aDec > 0) {
          ctx.globalAlpha = aA * aDec * 0.25;
          ctx.strokeStyle = C.dim;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(RX + 30, RY); ctx.lineTo(1395, 410); ctx.stroke();
          const OPT = [['satisfy', 330, 18.2, 19.4], ['split', 410, 19.6, 99], ['block', 490, 21.4, 22.4]];
          for (const [lab, y, g0, g1] of OPT) {
            const hot = t >= g0 && t < g1;
            ctx.globalAlpha = aA * aDec * (hot ? 1 : 0.45);
            if (hot) { ctx.shadowColor = C.ink; ctx.shadowBlur = 14; }
            chip(ctx, 1510, y, lab, { size: 26, color: C.ink });
            ctx.shadowBlur = 0;
          }
          ctx.globalAlpha = aA;
        }

        // SPLIT: children bud below with dependency arrows
        if (t > 19.8) {
          kids.forEach((kd, i) => {
            const a = easeOut(seg(t, 19.8 + i * 0.35, 20.45 + i * 0.35));
            if (a <= 0) return;
            ctx.strokeStyle = `rgba(232,230,224,${0.55 * a * aA})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(RX, RY + 26);
            ctx.lineTo(RX + (kd.x - RX) * a, RY + 26 + (kd.y - RY - 26) * a);
            ctx.stroke();
            ctx.globalAlpha = aA * a;
            ctx.fillStyle = C.ink;
            ctx.beginPath(); ctx.arc(kd.x, kd.y, 14 * a, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = aA;
          });
          // dependency arrow: kids[1] -> kids[2] (chained); kids[0] side-by-side
          const da = seg(t, 21.3, 21.9);
          if (da > 0) {
            const x0 = kids[1].x + 28, x1 = kids[1].x + 28 + (kids[2].x - kids[1].x - 56) * easeOut(da);
            const y = kids[1].y;
            ctx.strokeStyle = `rgba(232,230,224,${0.6 * aA})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
            ctx.fillStyle = `rgba(232,230,224,${0.6 * aA})`;
            ctx.beginPath();
            ctx.moveTo(x1, y); ctx.lineTo(x1 - 12, y - 6); ctx.lineTo(x1 - 12, y + 6);
            ctx.closePath(); ctx.fill();
            ctx.font = FONT(18);
            ctx.fillStyle = C.dim;
            ctx.textAlign = 'center';
            ctx.fillText('dep', (kids[1].x + kids[2].x) / 2, y - 22);
            ctx.textAlign = 'left';
          }
        }

        // INTEGRATE: green results flow up the edges (22.5-24)
        kids.forEach((kd, i) => {
          const f = easeInOut(seg(t, 22.5 + i * 0.18, 23.6 + i * 0.18));
          if (f <= 0 || f >= 1) return;
          ctx.fillStyle = C.green;
          ctx.beginPath();
          ctx.arc(lerp(kd.x, RX, f), lerp(kd.y, RY + 26, f), 7, 0, Math.PI * 2);
          ctx.fill();
        });
        const gf = seg(t, 23.7, 24.0) * (1 - seg(t, 24.5, 25.0));
        if (gf > 0) {
          ctx.strokeStyle = C.green;
          ctx.globalAlpha = aA * gf;
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(RX, RY, 32, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = aA;
        }

        // EMIT: artifact chip pops off the top (24.1-25.4)
        const ef = seg(t, 24.1, 25.2);
        if (ef > 0) {
          const ey = RY - 60 - 150 * easeOut(ef);
          ctx.globalAlpha = aA * seg(t, 24.1, 24.4);
          chip(ctx, RX, ey, 'artifact', { size: 26, color: C.ink });
          ctx.globalAlpha = aA;
        }

        ctx.globalAlpha = 1;
      }

      // ================= stage B: the whole tree, pulsing ====================
      const aB = seg(t, 25.5, 26.3);
      if (aB > 0) {
        const g = 0.3 + 0.7 * easeOut(seg(t, 25.8, 29.2));
        ctx.globalAlpha = aB;
        drawTree(ctx, tree, g, 0, { nodeR: 9, lineW: 2 });
        // every node runs the same operation: staggered pulse rings
        const amp = seg(t, 27.0, 28.5) * (1 - seg(t, 55.5, 57.0));
        if (amp > 0) {
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1.5;
          for (const n of tree) {
            if (g < n.birth + 0.1) continue;
            const f = (t * 0.45 + n.id * 0.137) % 1;
            ctx.globalAlpha = aB * amp * (1 - f) * 0.5;
            ctx.beginPath();
            ctx.arc(n.x, n.y, 13 + 30 * f, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore();
      // ================= insets (screen space, after pull-back) =============

      // harness card (28.8-40.5): five slots, snaps onto a node like a casing
      const aH = seg(t, 28.8, 29.05) * (1 - seg(t, 39.9, 40.5));
      if (aH > 0) {
        const snap = lerp(1.18, 1, easeOut(seg(t, 28.8, 29.1)));
        const cx = 1300, cy = 215, cw = 410, chh = 360;
        ctx.save();
        ctx.globalAlpha = aH;
        ctx.translate(cx + cw / 2, cy + chh / 2);
        ctx.scale(snap, snap);
        ctx.translate(-(cx + cw / 2), -(cy + chh / 2));
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(cx, cy, cw, chh);
        typed(ctx, 'harness', cx + cw / 2, cy + 40, t, 28.9, { size: 32, align: 'center', cursor: false });
        const SLOTS = ['context', 'memory', 'tools', 'evals', 'tier'];
        SLOTS.forEach((s, i) => {
          const sa = seg(t, 29.3 + i * 0.22, 29.6 + i * 0.22);
          if (sa <= 0) return;
          ctx.globalAlpha = aH * sa;
          ctx.strokeStyle = C.dim;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cx + 35, cy + 70 + i * 54, cw - 70, 44);
          typed(ctx, s, cx + 55, cy + 92 + i * 54, t, 29.35 + i * 0.22, { size: 24, cursor: false, color: C.ink });
        });
        ctx.restore();
        // casing bracket on a node + connector
        const [nx, ny] = toS(kids[2].x, kids[2].y);
        ctx.globalAlpha = aH;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2;
        ctx.strokeRect(nx - 18, ny - 18, 36, 36);
        ctx.strokeStyle = C.dim;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(cx, cy + chh / 2); ctx.lineTo(nx + 22, ny); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // "no roles, no org chart" — the design phase is just a region (35-40.3)
      const aR = seg(t, 35.0, 35.7) * (1 - seg(t, 39.8, 40.3));
      if (aR > 0) {
        const [ex, ey] = toS(lbx, lby);
        ctx.globalAlpha = aR * 0.8;
        ctx.strokeStyle = C.dim;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.ellipse(ex, ey, lrx * SCALE + 30, lry * SCALE + 36, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        typed(ctx, '"the design phase"', ex, ey + lry * SCALE + 70, t, 35.4,
          { size: 22, align: 'center', cursor: false, color: C.dim });
        ctx.globalAlpha = 1;
      }

      // three eval gates ON the tree (41.5 / 44 / 46.5)
      if (t > 41) {
        const [g1x, g1y] = toS((RX + kids[1].x) / 2, (RY + kids[1].y) / 2);
        const [g2x, g2y] = toS(gateLeaf.x, gateLeaf.y);
        const [g3x, g3y] = toS(RX, RY);
        gate(ctx, g1x + 60, g1y, 'split', t, 41.5);
        gate(ctx, g2x, g2y + 44, 'type', t, 44.0);
        gate(ctx, g3x, g3y - 52, 'integration', t, 46.5);
      }

      // tier ladder (49.8-end): haiku → sonnet → opus → dimmed human
      const aL = seg(t, 49.8, 50.3);
      if (aL > 0) {
        const lx = 1560;
        const TIERS = [['haiku', 600, 50.4, 51.3], ['sonnet', 510, 51.3, 52.2], ['opus', 420, 52.2, 99]];
        ctx.globalAlpha = aL;
        // rails
        ctx.strokeStyle = C.faint;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lx - 120, 640); ctx.lineTo(lx - 120, 250); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx + 120, 640); ctx.lineTo(lx + 120, 250); ctx.stroke();
        for (const [lab, y, h0, h1] of TIERS) {
          const hot = t >= h0 && t < h1;
          ctx.globalAlpha = aL * (hot ? 1 : 0.45);
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = hot ? 3 : 1.5;
          ctx.strokeRect(lx - 100, y - 26, 200, 52);
          ctx.font = FONT(26);
          ctx.fillStyle = C.ink;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(lab, lx, y + 1);
          ctx.textAlign = 'left';
        }
        // human at the very top, dimmed — brightens at "a human appears"
        const hb = 0.3 + 0.6 * seg(t, 53.4, 54.2);
        ctx.globalAlpha = aL * hb;
        humanIcon(ctx, lx, 310, 56, C.ink);
        if (t > 53.4) {
          ctx.globalAlpha = aL * seg(t, 53.4, 54.0) * 0.7;
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(lx, 308, 52, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // ================= captions ===========================================
      for (const [txt, c0, c1] of CAPS) {
        if (t >= c0 && t < c1) caption(ctx, txt, t, c0);
      }

      fadeToBlack(ctx, t, 57.3, 0.7);
    },
  };
})();
