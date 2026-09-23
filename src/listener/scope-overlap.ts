/**
 * Scope-disjoint admission's one rule: two scope arrays overlap when any
 * prefix in one is a prefix of (or equal to) any prefix in the other. An empty
 * scope array overlaps everything — a scopeless intent is assumed to touch the
 * whole repo. The listener applies it within one process; the job queue
 * applies it across workers on the same repo (ADR-051).
 */
export function scopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  for (const pa of a) {
    for (const pb of b) {
      if (pa === pb) return true;
      if (pa.startsWith(pb + '/') || pb.startsWith(pa + '/')) return true;
    }
  }
  return false;
}
