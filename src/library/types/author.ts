import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent } from '../checks.js';
import { prdShapeCheck, archSectionCheck } from '../pm-checks.js';
import { PRD_SCHEMA } from '../pm-schemas.js';

export function authorTypes(): GoalTypeDef[] {
  return [
    /**
     * `write-prd` — turn typed intent and injected research findings into a
     * numbered, behavior-focused PRD. Every requirement must be traceable to
     * the intent or a finding; acceptance criteria are Given/When/Then
     * near-executable scenarios.
     *
     * Tier: mid (structured interview craft) → high (escalation).
     * Grants: doc read/write in workspace; retrieval API.
     * Per ADR-023: outputSchema drives structured emission so the provider
     * guarantees the JSON envelope; the deterministic gate checks semantics.
     */
    {
      name: 'write-prd',
      kind: 'make',
      family: 'author',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [artifactPresent, prdShapeCheck],
      judgeType: 'critique-doc',
      grants: ['fs.read', 'fs.write', 'retrieval.api'],
      outputSchema: PRD_SCHEMA,
    },

    /**
     * `design-arch` — turn a PRD slice and knowledge artifacts into a design
     * and ADR set. The terraced scan is the default policy: k candidate
     * architectures at a cheap tier compete, critique-doc ranks, the winner
     * is deepened at full tier. Losing candidates become the ADR's
     * "alternatives considered" — the proof artifact falls out of the scan.
     *
     * scan: k=3 by default per DESIGN.md's terraced-scan description for novel
     * shapes. Lenses are the three diversity axes named in DESIGN.md:
     * architect's cut, reuse-maximizing cut, contrarian's cut.
     *
     * Tier: high → human (a bad architecture poisons every sibling).
     * Grants: doc read/write; retrieval API.
     */
    {
      name: 'design-arch',
      kind: 'make',
      family: 'author',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [artifactPresent, archSectionCheck],
      judgeType: 'critique-doc',
      grants: ['fs.read', 'fs.write', 'retrieval.api'],
      scan: { k: 3, lenses: ['architect', 'reuse', 'contrarian'] },
    },
  ];
}
