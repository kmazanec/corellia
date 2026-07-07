/**
 * Invariant (c) spend monotone and ≤ ceiling: cumulative tree spend, as the log
 * reports it, must never DECREASE, and must never EXCEED the declared dollar
 * ceiling.
 *
 * The log's honest spend signal is the `spentUsd` carried on `round-started` and
 * `ceiling-reached` — these are the events that stamp a measured cumulative
 * figure (per-call `Usage.costUsd` is a separate token-level total the cost
 * projection folds; `round-assessed` carries the round's diff digest but no
 * spend, so it is not a spend checkpoint). Monotonicity is checked across that
 * sequence in append order. The ceiling is read from `ceiling-reached.ceilingUsd`
 * when present (the only event that carries the declared ceiling); each stamped
 * `spentUsd` is compared against it. When no `ceiling-reached` event exists the
 * log does not carry the ceiling, so the ≤-ceiling check is skipped honestly
 * (nothing to compare against) while monotonicity still runs.
 */

import type { FactoryEvent } from '../../contract/events.js';
import type { ConformanceViolation } from './types.js';

interface SpendPoint {
  index: number;
  goalId: string;
  spentUsd: number;
}

export function checkSpend(events: FactoryEvent[]): ConformanceViolation[] {
  const violations: ConformanceViolation[] = [];

  // The declared ceiling, if the log carries one (ceiling-reached is the only
  // event that stamps it). A tree has one ceiling; take the first seen.
  let ceilingUsd: number | undefined;
  let ceilingIdx = -1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'ceiling-reached') {
      ceilingUsd = e.ceilingUsd;
      ceilingIdx = i;
      break;
    }
  }

  const spendPoints: SpendPoint[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'round-started' || e.type === 'ceiling-reached') {
      spendPoints.push({ index: i, goalId: e.goalId, spentUsd: e.spentUsd });
    }
  }

  // Monotonicity: no point may report less than the point before it.
  for (let k = 1; k < spendPoints.length; k++) {
    const prev = spendPoints[k - 1]!;
    const cur = spendPoints[k]!;
    if (cur.spentUsd < prev.spentUsd) {
      violations.push({
        invariant: 'spend-monotone',
        goalId: cur.goalId,
        indices: [prev.index, cur.index],
        detail: `cumulative spend decreased from $${prev.spentUsd} (index ${prev.index}) to $${cur.spentUsd} (index ${cur.index})`,
      });
    }
  }

  // Under ceiling: only checkable when the log carries the declared ceiling.
  if (ceilingUsd !== undefined) {
    for (const point of spendPoints) {
      if (point.spentUsd > ceilingUsd) {
        violations.push({
          invariant: 'spend-under-ceiling',
          goalId: point.goalId,
          indices: ceilingIdx >= 0 ? [point.index, ceilingIdx] : [point.index],
          detail: `spend $${point.spentUsd} (index ${point.index}) exceeds declared ceiling $${ceilingUsd}`,
        });
      }
    }
  }

  return violations;
}
