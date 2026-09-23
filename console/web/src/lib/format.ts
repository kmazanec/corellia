/** Figures in the Plate's voice: mono, exact, unadorned. */

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === 0) return '$0';
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(v < 10 ? 3 : 2)}`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export function ago(ms: number, now: number): string {
  return `${duration(now - ms)} ago`;
}

export function count(n: number): string {
  return n.toLocaleString('en-US');
}
