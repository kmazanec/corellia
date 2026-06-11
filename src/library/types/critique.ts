import type { GoalTypeDef } from '../../contract/goal-type.js';

export function critiqueTypes(): GoalTypeDef[] {
  return [
    {
      name: 'critique-code',
      kind: 'judge',
      family: 'critique',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },
  ];
}
