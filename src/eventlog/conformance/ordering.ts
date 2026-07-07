/**
 * Invariant (a) deterministic-before-judge: within one goal, the deterministic
 * gate must run before the judge renders its verdict — the gate is intent-blind
 * and always precedes any judge (GOAL-TYPES.md; greeting e2e asserts this once
 * for a scripted tree).
 *
 * Checkable directly: for each goal that has BOTH a `deterministic-checked` and a
 * `judge-verdict`, the first `deterministic-checked` must precede the first
 * `judge-verdict`. A goal with a judge-verdict but no deterministic-checked at
 * all is NOT flagged: some judged edges (a split judged at the parent) have no
 * per-goal deterministic gate in the log, so absence is not evidence of
 * reordering. Only a gate that ran AFTER the verdict is a real ordering
 * violation.
 */

import type { FactoryEvent } from '../../contract/events.js';
import type { ConformanceViolation } from './types.js';

export function checkDeterministicBeforeJudge(events: FactoryEvent[]): ConformanceViolation[] {
  const firstDet = new Map<string, number>();
  const firstJudge = new Map<string, number>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'deterministic-checked' && !firstDet.has(e.goalId)) {
      firstDet.set(e.goalId, i);
    } else if (e.type === 'judge-verdict' && !firstJudge.has(e.goalId)) {
      firstJudge.set(e.goalId, i);
    }
  }

  const violations: ConformanceViolation[] = [];
  for (const [goalId, judgeIdx] of firstJudge) {
    const detIdx = firstDet.get(goalId);
    if (detIdx !== undefined && detIdx > judgeIdx) {
      violations.push({
        invariant: 'deterministic-before-judge',
        goalId,
        indices: [detIdx, judgeIdx],
        detail: `deterministic-checked (index ${detIdx}) ran after judge-verdict (index ${judgeIdx}) for goal "${goalId}"`,
      });
    }
  }
  return violations;
}
