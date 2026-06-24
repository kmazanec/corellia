import type { GoalTypeDef } from '../../contract/goal-type.js';

export function critiqueTypes(): GoalTypeDef[] {
  return [
    {
      name: 'critique-code',
      kind: 'judge',
      family: 'critique',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },

    {
      name: 'critique-doc',
      kind: 'judge',
      family: 'critique',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [],
      judgeType: null,
      // Read docs and retrieval API; no write tools (judge-kind ceiling).
      grants: ['fs.read', 'retrieval.api'],
    },

    {
      // v1: judges UI artifacts and screenshot/design-system POINTERS.
      // No browser grant exists in v1 — deferred (no live-drive capability yet).
      // The skill section notes this explicitly so a future speciation can add it.
      name: 'critique-ui',
      kind: 'judge',
      family: 'critique',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [],
      judgeType: null,
      // Read screenshot/token files and retrieval API; no browser grant in v1.
      grants: ['fs.read', 'retrieval.api'],
    },

    {
      // `judge-acceptance` — the milestone loop's ship-gate judge (ADR-031
      // decision 1, ADR-032 §3). Reads the cumulative merged artifact + the
      // frozen acceptance criteria + this round's deterministic check RESULTS,
      // and renders a gating Verdict (`pass` is load-bearing in the ship gate)
      // plus quality findings that become next-round decide hints. Distinct from
      // judge-integration (cohesion): acceptance asks "are the frozen criteria
      // satisfied to a shippable bar." kind:'judge' ⇒ leafOnly:true (a judge
      // never recurses); no writes, no dangerous grant.
      name: 'judge-acceptance',
      kind: 'judge',
      family: 'critique',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },
  ];
}
