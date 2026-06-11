import type { GoalTypeDef } from '../../contract/goal-type.js';

export function deliverTypes(): GoalTypeDef[] {
  return [
    {
      name: 'deliver-intent',
      kind: 'make',
      family: 'deliver',
      leafOnly: false,
      tier: { default: 'opus', ladder: ['opus'] },
      deterministic: [],
      judgeType: 'judge-integration',
      // The root type that commissions intent accepts only spawn + retrieval
      // grants; no code tools, because satisfying intent directly is not its job.
      grants: ['retrieval.api', 'classify_risk', 'spawn'],
    },
  ];
}
