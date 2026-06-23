import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent } from '../checks.js';

export function deliverTypes(): GoalTypeDef[] {
  return [
    {
      name: 'deliver-intent',
      kind: 'make',
      family: 'deliver',
      leafOnly: false,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [],
      judgeType: 'judge-integration',
      // The root type that commissions intent accepts only spawn + retrieval
      // grants; no code tools, because satisfying intent directly is not its job.
      grants: ['retrieval.api', 'classify_risk', 'spawn'],
    },

    {
      // `open-pr` — the ship step. The deliver root spawns this leaf LAST
      // (depending on every build child), once the work is written and verified.
      // It holds repo.branch + repo.pr so the broker exposes push_branch /
      // open_pr; its job is to push the tree's branch and open exactly one PR.
      name: 'open-pr',
      kind: 'make',
      family: 'deliver',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [artifactPresent],
      judgeType: null,
      grants: ['repo.branch', 'repo.pr'],
    },
  ];
}
