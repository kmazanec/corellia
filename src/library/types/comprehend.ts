import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent } from '../checks.js';
import {
  mapRepoCheck,
  diveAnchorCheck,
} from '../knowledge-checks.js';
import {
  KNOWLEDGE_ARTIFACT_SCHEMA,
  REGION_FACTS_SCHEMA,
} from '../knowledge-schemas.js';

export function comprehendTypes(): GoalTypeDef[] {
  return [
    /**
     * `map-repo` — extract a category of knowledge from a repo and emit a
     * KnowledgeArtifact that the split gate, retrieval API, and regression
     * guard can consume. Four categories shipped in iteration 04:
     * architecture, stack, conventions, test-scaffold.
     *
     * Tier: haiku (mechanical extraction) → sonnet (escalation).
     * Grants: read-only + sandboxed run rights for validation (`test.run_scoped`).
     * Per ADR-019: artifacts are emitted as `knowledge-written` events, never
     * written directly to the product repo.
     *
     * Harness prompt instructs the brain to:
     *   - Read the repo at `spec.repoRoot` (category `spec.category`).
     *   - Build a `KnowledgeArtifact` with pointers-not-bodies, a summary, a
     *     confidence rating, `status: "provisional"`, and `generatedAtSha`
     *     set to the current HEAD SHA.
     *   - Emit the artifact as the goal's text output: a JSON-serialised
     *     KnowledgeArtifact. The deterministic gate validates it before the
     *     engine appends a `knowledge-written` event.
     *   - Discovery loop: probe → learn → next probe; extract pointers, not
     *     file bodies.
     */
    {
      name: 'map-repo',
      kind: 'learn',
      family: 'comprehend',
      outputSchema: KNOWLEDGE_ARTIFACT_SCHEMA,
      leafOnly: true,
      // Live traces (2026-06-11, four mapping runs on a real repo): haiku-tier
      // first attempts burn the shared token budget exploring before the sonnet
      // retry starts — sonnet default is the instrumented call, not a decree.
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [
        artifactPresent,
        mapRepoCheck(async () => []),
      ],
      judgeType: null,
      grants: ['fs.read', 'retrieval.api', 'test.run_scoped'],
    },

    /**
     * `deep-dive-region` — examine a specific region of a repo and produce a
     * set of anchored semantic facts. Facts carry `file:line` anchors at the
     * SHA they were generated against, making every claim verifiable-on-read.
     * Facts enter project memory as provisional and are never trusted
     * automatically.
     *
     * Tier: sonnet (semantic analysis) → opus (escalation for hard regions).
     * Grants: read-only + retrieval API (no sandboxed run rights needed).
     * Per ADR-019: facts are emitted as `knowledge-facts-written` events.
     *
     * Harness prompt instructs the brain to:
     *   - Read the region at `spec.repoRoot`/`spec.region`.
     *   - Produce a `RegionFacts` with one `DiveFact` per claim; each fact
     *     must carry at least one `{ path, line }` anchor valid at
     *     `generatedAtSha`.
     *   - Emit the result as the goal's text output: a JSON-serialised
     *     RegionFacts. The deterministic gate verifies every anchor.
     *   - Discovery loop: read region → form claim → find anchoring evidence
     *     → emit; prefer depth over breadth.
     */
    {
      name: 'deep-dive-region',
      kind: 'learn',
      family: 'comprehend',
      outputSchema: REGION_FACTS_SCHEMA,
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [artifactPresent, diveAnchorCheck()],
      judgeType: null,
      grants: ['fs.read', 'retrieval.api'],
    },
  ];
}
