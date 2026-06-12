import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent } from '../checks.js';

export function diagnoseTypes(): GoalTypeDef[] {
  return [
    /**
     * `investigate` — synthesize a root-cause finding with evidence chain from
     * an anomaly or question. Non-leaf: probes are children (`deep-dive-region`,
     * `research-external`, `implement` with `intent: spike`). Budget-bounded:
     * the dependent-chain base case terminates when the confidence threshold
     * is met or the budget is exhausted.
     *
     * Eval: confidence threshold via judge (critique-doc judges the evidence
     * chain quality; the confidence field gates pass/fail).
     *
     * Tier: sonnet → opus.
     * Grants: spawn (its probes are children); retrieval API; read-only on the
     * repo. No write grants — investigation produces a finding, not a change.
     *
     * leaf_only: false — spawns deep-dive, research, and spike children.
     */
    {
      name: 'investigate',
      kind: 'learn',
      family: 'diagnose',
      leafOnly: false,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [artifactPresent],
      judgeType: 'critique-doc',
      grants: ['fs.read', 'retrieval.api', 'spawn'],
    },
  ];
}
