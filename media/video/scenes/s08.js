// S8 — Crossing 3: the pattern flywheel. 17.5s.
// Beats: panel stamp (0.2) + `· patterns` label (0.6) · three game boards
// appear (0.8/1.4/2.0) · the same L-move plays on each, staggered (1.6-5.4),
// leaving a faint printed path · after each move a small move-card pops and
// slides to a stack (3.2-6.2), tally `×3` (6.2) · the stack slides off the
// boards into the `rulebook` (6.8-8.2) · `trusted` stamp slams on w/ signature
// squiggle + human silhouette (8.8-9.6) · two new boards open with the move
// pre-printed in dim amber (11.0/11.8) · caption `moves → rules` (13.2).
// VO starts 0.8.
'use strict';
(() => {
  const { W, H, C, seg, easeOut, easeInOut, typed, panel, humanIcon, bg, FONT } = window.LIB;

  const BS = 220, NC = 4, CELL = BS / NC;
  const BOARDS = [{ x: 420, y: 240 }, { x: 790, y: 240 }, { x: 1160, y: 240 }];
  const NEWB = [{ x: 420, y: 600 }, { x: 790, y: 600 }];
  // the recurring move: an L-path in cell coords
  const MOVE = [[0.5, 3.5], [0.5, 1.5], [2.5, 1.5]];
  const MOVET = [1.6, 2.9, 4.2];           // move start per board
  const MOVED = 1.3;                        // move duration
  const STACK = { x: 760, y: 620 };         // where move-cards pile up
  const BOOK = { x: 1200, y: 510, w: 340, h: 340 };
  const CARDAT = { x: BOOK.x + BOOK.w / 2, y: BOOK.y + 218 };  // card home in rulebook
  const CW = 96, CH = 118;                  // move-card size

  function movePt(p) {
    // point along MOVE at fraction p (two equal-length legs)
    const leg = p < 0.5 ? 0 : 1;
    const f = leg === 0 ? p * 2 : (p - 0.5) * 2;
    const a = MOVE[leg], b = MOVE[leg + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  function drawBoard(ctx, bx, by, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgba(232,230,224,0.35)`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= NC; i++) {
      ctx.beginPath(); ctx.moveTo(bx + i * CELL, by); ctx.lineTo(bx + i * CELL, by + BS); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by + i * CELL); ctx.lineTo(bx + BS, by + i * CELL); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function strokeMove(ctx, bx, by, upTo, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const [sx, sy] = MOVE[0];
    ctx.moveTo(bx + sx * CELL, by + sy * CELL);
    if (upTo >= 0.5) {
      ctx.lineTo(bx + MOVE[1][0] * CELL, by + MOVE[1][1] * CELL);
      const [tx, ty] = movePt(upTo);
      ctx.lineTo(bx + tx * CELL, by + ty * CELL);
    } else {
      const [tx, ty] = movePt(upTo);
      ctx.lineTo(bx + tx * CELL, by + ty * CELL);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function moveCard(ctx, x, y, alpha, scale = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.bg;
    ctx.fillRect(x - CW / 2 * scale, y - CH / 2 * scale, CW * scale, CH * scale);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - CW / 2 * scale, y - CH / 2 * scale, CW * scale, CH * scale);
    // mini L-glyph inside
    const mc = 22 * scale;
    const ox = x - 1.5 * mc, oy = y - 2.5 * mc;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ox + MOVE[0][0] * mc, oy + MOVE[0][1] * mc);
    ctx.lineTo(ox + MOVE[1][0] * mc, oy + MOVE[1][1] * mc);
    ctx.lineTo(ox + MOVE[2][0] * mc, oy + MOVE[2][1] * mc);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  window.SCENES.s08 = {
    duration: 17.5,
    draw(ctx, t) {
      bg(ctx);
      panel(ctx, 3, '', t, 0.2);
      typed(ctx, '· patterns', 215, 125, t, 0.6, { size: 40, color: C.amber, cursor: false, cps: 24 });

      // --- three boards + recurring move -------------------------------------
      BOARDS.forEach((b, i) => {
        const ba = easeOut(seg(t, 0.8 + i * 0.6, 1.4 + i * 0.6));
        if (ba <= 0) return;
        drawBoard(ctx, b.x, b.y, ba);
        const mp = easeInOut(seg(t, MOVET[i], MOVET[i] + MOVED));
        if (mp > 0) {
          // printed path so far (stays after the move)
          strokeMove(ctx, b.x, b.y, mp, 'rgba(232,230,224,0.35)', 3);
          if (mp < 1) {
            // glowing sliding piece + bright trail tail
            const [tx, ty] = movePt(mp);
            strokeMove(ctx, b.x, b.y, mp, 'rgba(232,230,224,0.7)', 4);
            ctx.fillStyle = C.ink;
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 16;
            ctx.beginPath();
            ctx.arc(b.x + tx * CELL, b.y + ty * CELL, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      });

      // --- move-cards pop and stack, then ride to the rulebook ----------------
      const ride = easeInOut(seg(t, 6.8, 8.2)); // stack -> rulebook
      for (let i = 0; i < 3; i++) {
        const tPop = MOVET[i] + MOVED + 0.2;
        const sl = easeInOut(seg(t, tPop, tPop + 0.9)); // board -> stack
        if (sl <= 0) continue;
        const b = BOARDS[i];
        const x0 = b.x + BS / 2, y0 = b.y + BS + 60;
        const sx = STACK.x + i * 8, sy = STACK.y - i * 7;
        let x = x0 + (sx - x0) * sl, y = y0 + (sy - y0) * sl;
        if (ride > 0) {
          x = sx + (CARDAT.x + i * 8 - sx) * ride;
          y = sy + (CARDAT.y - i * 7 - sy) * ride;
        }
        moveCard(ctx, x, y, Math.min(1, sl * 1.5));
      }
      // tally
      const tallyA = seg(t, 6.2, 6.6) * (1 - seg(t, 6.8, 7.4));
      if (tallyA > 0) {
        ctx.globalAlpha = tallyA;
        ctx.font = FONT(40);
        ctx.fillStyle = C.ink;
        ctx.textBaseline = 'middle';
        ctx.fillText('×3', STACK.x + 78, STACK.y - 10);
        ctx.globalAlpha = 1;
      }

      // --- rulebook -------------------------------------------------------------
      const bka = easeOut(seg(t, 5.8, 6.6));
      if (bka > 0) {
        ctx.globalAlpha = bka;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(BOOK.x, BOOK.y, BOOK.w, BOOK.h);
        ctx.font = FONT(28);
        ctx.fillStyle = C.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('rulebook', BOOK.x + BOOK.w / 2, BOOK.y + 38);
        // existing rule lines
        ctx.strokeStyle = C.faint;
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(BOOK.x + 30, BOOK.y + 80 + i * 26);
          ctx.lineTo(BOOK.x + BOOK.w - 30 - (i === 2 ? 90 : 0), BOOK.y + 80 + i * 26);
          ctx.stroke();
        }
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }

      // --- trusted stamp ----------------------------------------------------------
      const st = seg(t, 8.8, 9.2);
      if (st > 0) {
        const sc = 1.6 - 0.6 * easeOut(st); // slams in
        ctx.save();
        ctx.translate(CARDAT.x, CARDAT.y - 8);
        ctx.rotate(-0.12);
        ctx.scale(sc, sc);
        ctx.globalAlpha = Math.min(1, st * 2);
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 3;
        ctx.strokeRect(-86, -30, 172, 60);
        ctx.font = FONT(32);
        ctx.fillStyle = C.amber;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('trusted', 0, 0);
        ctx.textAlign = 'left';
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      // signature squiggle + human silhouette beneath the stamp
      const sig = seg(t, 9.4, 10.2);
      if (sig > 0) {
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const sx0 = CARDAT.x - 60, sy0 = CARDAT.y + 52;
        ctx.moveTo(sx0, sy0);
        const n = Math.floor(40 * sig);
        for (let i = 1; i <= n; i++) {
          const u = i / 40;
          ctx.lineTo(sx0 + u * 96, sy0 + Math.sin(u * Math.PI * 5) * 7 - u * 4);
        }
        ctx.stroke();
        humanIcon(ctx, CARDAT.x + 72, CARDAT.y + 52, 34, C.dim);
      }

      // --- new boards open with the move pre-printed -----------------------------
      NEWB.forEach((b, i) => {
        const na = easeOut(seg(t, 11.0 + i * 0.8, 11.8 + i * 0.8));
        if (na <= 0) return;
        drawBoard(ctx, b.x, b.y, na);
        // pre-printed move, dim amber
        ctx.globalAlpha = na;
        strokeMove(ctx, b.x, b.y, 1, 'rgba(245,166,35,0.45)', 3);
        ctx.fillStyle = 'rgba(245,166,35,0.55)';
        ctx.beginPath();
        ctx.arc(b.x + MOVE[0][0] * CELL, b.y + MOVE[0][1] * CELL, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = FONT(22);
        ctx.fillStyle = C.dim;
        ctx.textAlign = 'center';
        ctx.fillText('new game', b.x + BS / 2, b.y + BS + 34);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      });

      typed(ctx, 'moves → rules', W / 2, H - 80, t, 13.2, { size: 38, align: 'center', cps: 40, cursor: false });
    },
  };
})();
