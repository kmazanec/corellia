import type { GoalTypeDef } from '../../contract/goal-type.js';

export function curateTypes(): GoalTypeDef[] {
  return [
    {
      name: 'promote-memory',
      kind: 'evolve',
      family: 'curate',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet'] },
      deterministic: [],
      judgeType: null,
      // The curate family holds the only memory-write grants in the library.
      grants: ['memory.write'],
    },
  ];
}
