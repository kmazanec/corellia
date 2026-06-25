import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent } from '../checks.js';

export function diagnoseTypes(): GoalTypeDef[] {
  return [
    /**
     * `investigate` — synthesize a root-cause finding with evidence chain from
     * an anomaly or question. Non-leaf: probes are children (`deep-dive-region`,
     * `research-external`, `implement` with `intent: spike`). The dependent-chain
     * base case is CONFIDENCE: it terminates when the confidence threshold is met
     * (or the wall-clock runs out, the only hard bound — ADR-033).
     *
     * Eval: confidence threshold via judge (critique-doc judges the evidence
     * chain quality; the confidence field gates pass/fail).
     *
     * Tier: mid → high.
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
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [artifactPresent],
      judgeType: 'critique-doc',
      // docs.issues.write (ADR-034): investigate is the natural place to surface
      // deferred work — when a probe finds a real but out-of-scope problem, it can
      // file an OKF issue via the brokered file_issue tool. ADR-034 also named
      // deliver-intent, but that type is mustDecompose (no producing grant — see the
      // constitution lint), so the capability lands on investigate only.
      grants: ['fs.read', 'retrieval.api', 'spawn', 'docs.issues.write'],
    },
  ];
}
