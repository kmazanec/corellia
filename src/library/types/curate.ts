import type { GoalTypeDef } from '../../contract/goal-type.js';

export function curateTypes(): GoalTypeDef[] {
  return [
    {
      name: 'promote-memory',
      kind: 'evolve',
      family: 'curate',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid'] },
      deterministic: [],
      judgeType: null,
      // The curate family holds the only memory-write grants in the library.
      grants: ['memory.write'],
    },

    /**
     * `consolidate-memory` — scheduled distillation pass over a namespace's
     * episode history. Reads the full event log for the namespace, distils the
     * durable semantic signal into a smaller set of memory entries, and surfaces
     * eviction candidates for maintainer review. It never permanently deletes —
     * that authority is not delegated.
     *
     * Grants: memory.write (curate family) + event-log.read only. No product
     * repo access, no pattern-store access.
     *
     * Tier: mid (distillation is specified well enough). Escalates to high
     * when the namespace has contradictory or unusually dense episodes.
     *
     * Deep harness content (distillation heuristics, eviction thresholds,
     * contradiction-resolution policy) is iteration 6 work — the current
     * harness section carries the family skill plus the minimal type card.
     */
    {
      name: 'consolidate-memory',
      kind: 'evolve',
      family: 'curate',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [],
      judgeType: null,
      grants: ['memory.write', 'event-log.read'],
    },
  ];
}
