import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent, criteriaWellFormed } from '../checks.js';
import { prdShapeCheck, archSectionCheck } from '../pm-checks.js';
import { PRD_SCHEMA } from '../pm-schemas.js';
import { ACCEPTANCE_CRITERIA_SCHEMA } from '../acceptance-schemas.js';

export function authorTypes(): GoalTypeDef[] {
  return [
    /**
     * `author-acceptance-criteria` — the milestone loop's done-condition
     * minter (ADR-032 §1). `deliver-intent`'s first mandatory round-0 child;
     * every other child `dependsOn` it. It reads the deliver-intent free text
     * and emits the SHA-anchored, ordered acceptance checklist, persisted as a
     * verify-on-read KnowledgeArtifact. `criteriaWellFormed` is the deterministic
     * floor: it rejects any criterion whose check is a prose rubric line rather
     * than a sandbox-runnable predicate, so the loop always has a script-backed
     * boolean per criterion.
     *
     * Tier: high (the target the whole loop converges against must be right).
     * Grants: retrieval API only — it authors a checklist, it does not build.
     * Per ADR-023: outputSchema drives structured emission; criteriaWellFormed
     * is the semantic gate.
     */
    {
      name: 'author-acceptance-criteria',
      kind: 'make',
      family: 'author',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [criteriaWellFormed()],
      judgeType: null,
      grants: ['retrieval.api'],
      outputSchema: ACCEPTANCE_CRITERIA_SCHEMA,
      // The criteria characterize "done" for a specific region of work — an empty
      // scope is what left this leaf with no anchor and let it read 140 files of the
      // whole repo (run 9e035402; ADR-039).
      requiresScope: true,
    },

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
