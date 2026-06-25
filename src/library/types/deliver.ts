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
      // The root literally cannot satisfy — it has no producing tool. A `satisfy`
      // decision here (e.g. the brain taking the easy exit after a judge-rejected
      // split) is invalid: the engine coerces it to an actionable block instead of
      // looping the attempt loop to an empty-artifact `step-loop:failed` dead-end.
      mustDecompose: true,
      // The milestone loop (ADR-031): the split dispatch arm routes through
      // runMilestone, re-deciding against a frozen acceptance-criteria
      // done-condition each round. maxRounds 50 is a runaway-backstop, NOT a
      // budget proxy (the $15 ceiling and no-progress halt are the real
      // terminators); a commission MAY override it via goal.maxRounds.
      iterative: { maxRounds: 50, acceptanceJudge: 'judge-acceptance' },
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
