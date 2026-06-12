import type { GoalTypeDef } from '../../contract/goal-type.js';

export function improveTypes(): GoalTypeDef[] {
  return [
    /**
     * `propose-pattern` — abstract a recurrence cluster from the event log into
     * a provisional split memo. Reads the event log to locate goals that share a
     * structural shape with similar runtime splits, drafts a split-memo for that
     * shape, and writes it to the pattern store as `provisional` only. The engine
     * never self-trusts: promotion to `trusted` requires the human signoff — the
     * authority gap the machine cannot close on its own.
     *
     * Grants: event-log.read + pattern-store.write-provisional only. No product
     * repo access. No memory-store writes.
     *
     * Tier: high (weighing alternatives — which shape to abstract, how general
     * to make the memo). Escalates to human when the cluster is ambiguous or
     * when the proposed shape would subsume an existing trusted memo.
     *
     * Deep harness content (cluster-detection heuristics, generality threshold,
     * memo-format guidance) is iteration 6 work — the current harness section
     * carries the family skill plus the minimal type card.
     */
    {
      name: 'propose-pattern',
      kind: 'evolve',
      family: 'improve',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [],
      judgeType: null,
      grants: ['event-log.read', 'pattern-store.write-provisional'],
    },

    /**
     * `improve-factory` — translate blocker reports and stated rejection reasons
     * that implicate the harness into a factory-repo PR: prompts, skills,
     * scripts, eval sets, or new type definitions. Route by generality: lessons
     * specific to one project re-route to `promote-memory`; general harness
     * failures land here. May spawn children (investigate, draft, test).
     *
     * Grants: branch + PR on the bound repo (repo.branch, repo.pr) — the same
     * brokered boundary tools product runs use; here the bound repo is the
     * factory's own repo.
     * May spawn. No product-repo write capability. No merge or approval grant.
     *
     * Tier: high (bad harness output poisons every run beneath or after it).
     * Terminates at a factory-maintainer-reviewed PR — the human gate is the
     * proof of non-self-approval.
     *
     * Deep harness content (routing logic, generality threshold, eval-set
     * authoring guidance) is iteration 6 work — the current harness section
     * carries the family skill plus the minimal type card.
     */
    {
      name: 'improve-factory',
      kind: 'evolve',
      family: 'improve',
      leafOnly: false,
      // Tier: high is the default (bad harness output poisons every run beneath
      // it). The ladder allows escalation to a higher-capability model when the
      // generality judgment is uncertain — "am I looking at a repo-specific
      // lesson or a general harness gap?" is exactly the question where a richer
      // context window and stronger reasoning pays. ADR-027.
      tier: { default: 'high', ladder: ['high', 'high'] },
      deterministic: [],
      judgeType: null,
      grants: ['event-log.read', 'repo.branch', 'repo.pr'],
    },
  ];
}
