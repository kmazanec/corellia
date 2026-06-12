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

    {
      name: 'critique-doc',
      kind: 'judge',
      family: 'critique',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
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
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      // Read screenshot/token files and retrieval API; no browser grant in v1.
      grants: ['fs.read', 'retrieval.api'],
    },
  ];
}
