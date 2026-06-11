import type { GoalTypeDef } from '../../contract/goal-type.js';

export function arbiterTypes(): GoalTypeDef[] {
  return [
    {
      name: 'judge-split',
      kind: 'judge',
      family: 'arbiter',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },

    {
      name: 'judge-integration',
      kind: 'judge',
      family: 'arbiter',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },
  ];
}
