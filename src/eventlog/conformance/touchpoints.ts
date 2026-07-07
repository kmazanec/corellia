/**
 * Invariant (d) briefs carry deadlines; parks carry ttls: every human touchpoint
 * must fail safe. A `blocked` brief must carry a positive `deadlineMs` (so an
 * unanswered human never hangs the tree), and a `parked` goal must carry a
 * positive `ttlMs` (so a park always resumes or times out). The DecisionBrief
 * schema requires the field's presence at the type level; this is the runtime
 * dual that the value is actually a usable positive duration, not a zero/negative
 * sentinel a producer left unset.
 */

import type { FactoryEvent } from '../../contract/events.js';
import type { ConformanceViolation } from './types.js';

export function checkTouchpoints(events: FactoryEvent[]): ConformanceViolation[] {
  const violations: ConformanceViolation[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'blocked') {
      if (!(typeof e.brief.deadlineMs === 'number' && e.brief.deadlineMs > 0)) {
        violations.push({
          invariant: 'brief-carries-deadline',
          goalId: e.goalId,
          indices: [i],
          detail: `blocked brief for goal "${e.goalId}" (index ${i}) has no positive deadlineMs (got ${String(e.brief.deadlineMs)})`,
        });
      }
    } else if (e.type === 'parked') {
      if (!(typeof e.ttlMs === 'number' && e.ttlMs > 0)) {
        violations.push({
          invariant: 'park-carries-ttl',
          goalId: e.goalId,
          indices: [i],
          detail: `parked goal "${e.goalId}" (index ${i}) has no positive ttlMs (got ${String(e.ttlMs)})`,
        });
      }
    }
  }
  return violations;
}
