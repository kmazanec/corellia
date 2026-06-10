// S9 — Crossing 4: the event log as self-symbol. 17.0s.
// Beats: panel stamp (0.2) + `· the event log` label (0.6) · append-only log
// ticks upward on the left (0.8+): goal.emitted ink · eval.pass green ·
// escalation amber · authority gate bar + lock fade in top-right (2.0), label
// (2.6) · log lines emit particles that converge into the mirror glyph
// (3.6-11) · glyph outline (3.5), amber sheen builds with arrivals, label
// `track record` (6.5) · dotted sight-line from gate down to the glyph
// (10.5-11.5) · the shackle rotates open ~25° and the right bar segment slides
// (12.0-13.5) · caption (13.8) · all motion freezes at 15.5 for the tile-out.
// VO starts 0.8.
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, typed, panel, bg, FONT, rng } = window.LIB;

  // --- deterministic log sequence -------------------------------------------
  const EVENTS = [];
  {
    const head = ['goal.emitted', 'eval.pass', 'eval.pass', 'escalation', 'eval.pass'];
    const r = rng(91);
    for (let k = 0; k < 64; k++) {
      let ev;
      if (k < head.length) ev = head[k];
      else {
        const u = r();
        ev = u < 0.18 ? 'goal.emitted' : (u < 0.82 ? 'eval.pass' : 'escalation');
      }
      EVENTS.push(ev);
    }
  }
  const EVCOL = ev => ev === 'eval.pass' ? C.green : (ev === 'escalation' ? C.amber : C.ink);

  const LOG = { x: 380, top: 270, bot: 870 };
  const LINEH = 52, SPEED = 80, PERIOD = LINEH / SPEED; // 0.65s per line
  const MIR = { x: 1180, y: 620, w: 170, h: 240, r: 26 };
  const GATE = { y: 320, x0: 950, x1: 1410, cx: 1180 };
  const FREEZE = 15.5; // end beat: hold composition still

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.SCENES.s09 = {
    duration: 17.0,
    draw(ctx, t) {
      const ta = Math.min(t, FREEZE); // animation clock — freezes for the end beat
      bg(ctx);
      panel(ctx, 4, '', t, 0.2);
      typed(ctx, '· the event log', 215, 125, t, 0.6, { size: 40, color: C.amber, cursor: false, cps: 24 });

      // --- scrolling append-only log ------------------------------------------
      ctx.save();
      ctx.beginPath();
      ctx.rect(LOG.x - 30, LOG.top, 520, LOG.bot - LOG.top);
      ctx.clip();
      ctx.font = FONT(30);
      ctx.textBaseline = 'middle';
      for (let k = 0; k < EVENTS.length; k++) {
        const enter = 0.8 + k * PERIOD;
        if (ta < enter) break;
        const y = LOG.bot - 20 - (ta - enter) * SPEED;
        if (y < LOG.top - 30) continue;
        ctx.fillStyle = C.faint;
        ctx.fillText(String(2400 + k), LOG.x, y);
        ctx.fillStyle = EVCOL(EVENTS[k]);
        ctx.fillText(EVENTS[k], LOG.x + 130, y);
      }
      ctx.restore();
      // fade the log's top and bottom edges into the background
      let gr = ctx.createLinearGradient(0, LOG.top, 0, LOG.top + 90);
      gr.addColorStop(0, C.bg); gr.addColorStop(1, 'rgba(10,10,12,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(LOG.x - 30, LOG.top, 520, 90);
      gr = ctx.createLinearGradient(0, LOG.bot - 60, 0, LOG.bot);
      gr.addColorStop(0, 'rgba(10,10,12,0)'); gr.addColorStop(1, C.bg);
      ctx.fillStyle = gr;
      ctx.fillRect(LOG.x - 30, LOG.bot - 60, 520, 60);

      // --- particles: log lines converge into the mirror ------------------------
      // line k crosses y=560 at tk = enter + (bot-20-560)/SPEED; flies 0.9s to MIR
      for (let k = 0; k < EVENTS.length; k++) {
        const tk = 0.8 + k * PERIOD + (LOG.bot - 20 - 560) / SPEED;
        if (tk < 3.4 || tk > 10.6) continue;
        const p = seg(ta, tk, tk + 0.9);
        if (p <= 0 || p >= 1) continue;
        const x0 = LOG.x + 360, y0 = 560;
        const x1 = MIR.x, y1 = MIR.y;
        const pt = q => {
          const e = easeInOut(q);
          return [x0 + (x1 - x0) * e, y0 + (y1 - y0) * e - Math.sin(e * Math.PI) * 60];
        };
        const [x, y] = pt(p);
        const [tx, ty] = pt(Math.max(0, p - 0.14));
        const a = 0.85 * Math.sin(p * Math.PI);
        const col = EVCOL(EVENTS[k]);
        ctx.globalAlpha = a * 0.45;
        ctx.strokeStyle = col;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // --- mirror glyph: track record --------------------------------------------
      const ma = easeOut(seg(t, 3.5, 4.3));
      if (ma > 0) {
        const build = seg(t, 4.5, 10.5); // sheen accumulates with arrivals
        ctx.globalAlpha = ma;
        // amber sheen fill
        const gx = MIR.x - MIR.w / 2, gy = MIR.y - MIR.h / 2;
        const sh = ctx.createLinearGradient(gx, gy, gx + MIR.w, gy + MIR.h);
        sh.addColorStop(0, `rgba(245,166,35,${0.30 * build})`);
        sh.addColorStop(0.5, `rgba(245,166,35,${0.10 * build})`);
        sh.addColorStop(1, `rgba(245,166,35,${0.26 * build})`);
        roundRect(ctx, gx, gy, MIR.w, MIR.h, MIR.r);
        ctx.fillStyle = sh;
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 3;
        ctx.stroke();
        // diagonal mirror highlight
        ctx.strokeStyle = `rgba(245,166,35,${0.25 + 0.45 * build})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(gx + MIR.w * 0.62, gy + 22);
        ctx.lineTo(gx + MIR.w * 0.30, gy + MIR.h * 0.46);
        ctx.stroke();
        ctx.globalAlpha = 1;
        typed(ctx, 'track record', MIR.x, gy + MIR.h + 42, t, 6.5, { size: 26, color: C.amber, align: 'center', cursor: false, cps: 30 });
      }

      // --- authority gate ----------------------------------------------------------
      const ga = easeOut(seg(t, 2.0, 2.8));
      if (ga > 0) {
        const open = easeInOut(seg(t, 12.0, 13.5)); // the lock loosens one notch
        const shift = 34 * open;                     // right bar segment slides
        ctx.globalAlpha = ga;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(GATE.x0, GATE.y);
        ctx.lineTo(GATE.cx - 44, GATE.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(GATE.cx + 44 + shift, GATE.y);
        ctx.lineTo(GATE.x1 + shift, GATE.y);
        ctx.stroke();
        typed(ctx, 'authority gate', GATE.cx, GATE.y - 70, t, 2.6, { size: 26, color: C.dim, align: 'center', cursor: false, cps: 30 });

        // lock: body + rotatable shackle (pivot at left leg)
        const bx = GATE.cx, btop = GATE.y - 6;
        ctx.fillStyle = C.bg;
        ctx.fillRect(bx - 30, btop, 60, 54);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 4.5;
        ctx.strokeRect(bx - 30, btop, 60, 54);
        // shackle
        const drawShackle = (color, alpha) => {
          ctx.save();
          ctx.translate(bx - 20, btop);
          ctx.rotate(-open * 25 * Math.PI / 180);
          ctx.translate(-(bx - 20), -btop);
          ctx.strokeStyle = color;
          ctx.globalAlpha = alpha * ga;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(bx - 20, btop);
          ctx.lineTo(bx - 20, btop - 8);
          ctx.arc(bx, btop - 8, 20, Math.PI, 0);
          ctx.lineTo(bx + 20, btop);
          ctx.stroke();
          ctx.restore();
        };
        drawShackle(C.ink, 1);
        if (open > 0) drawShackle(C.amber, open * 0.9);
        ctx.globalAlpha = 1;
      }

      // --- dotted sight-line: gate reads the glyph ----------------------------------
      const sl = easeInOut(seg(t, 10.5, 11.5));
      if (sl > 0) {
        const y0 = GATE.y + 58, y1 = MIR.y - MIR.h / 2 - 14;
        ctx.strokeStyle = 'rgba(232,230,224,0.6)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 12]);
        ctx.lineDashOffset = -ta * 30;
        ctx.beginPath();
        ctx.moveTo(GATE.cx, y0);
        ctx.lineTo(GATE.cx, y0 + (y1 - y0) * sl);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      typed(ctx, 'a self-symbol that acts', W / 2, H - 80, t, 13.8, { size: 38, align: 'center', cps: 40, cursor: false });
    },
  };
})();
