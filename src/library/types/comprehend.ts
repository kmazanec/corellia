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
     * Tier: low (mechanical extraction) → mid (escalation).
     * Grants: read-only + sandboxed run rights for validation (`test.run_scoped`).
     * Per ADR-019: artifacts are emitted as `knowledge-written` events, never
     * written directly to the product repo.
     *
     * Harness prompt instructs the brain to:
     *   - Read the repo at `spec.repoRoot` (category `spec.category`).
     *   - DECIDE first (ADR-029): a `map-repo` goal obeys the recursion law like
     *     every other family. If the region (`spec.repoRoot` / `spec.scope`) is
     *     too large to comprehend FAITHFULLY in one node's context — too many
     *     files or subsystems to map without dropping evidence or exhausting the
     *     budget — return a SPLIT. The split partitions the region into DISJOINT
     *     sub-regions whose UNION COVERS the parent (no overlap, no gaps); each
     *     child is itself a `map-repo` goal of the SAME `category` scoped to one
     *     sub-region. Otherwise SATISFY and emit the artifact directly.
     *   - Build a `KnowledgeArtifact` with pointers-not-bodies, a summary, a
     *     confidence rating, `status: "provisional"`, and `generatedAtSha`
     *     set to the current HEAD SHA.
     *   - Emit the artifact as the goal's text output: a JSON-serialised
     *     KnowledgeArtifact. The deterministic gate validates it before the
     *     engine appends a `knowledge-written` event.
     *   - Discovery loop: probe → learn → next probe; extract pointers, not
     *     file bodies.
     *
     * Integrate contract (ADR-029): when this goal splits, its children are
     * sub-region `map-repo` comprehensions. The engine MERGES their child
     * `KnowledgeArtifact`s into ONE parent `KnowledgeArtifact` (union of
     * pointers, merged summary, `status: "provisional"`, `generatedAtSha` = the
     * parent's HEAD SHA, confidence = the conservative min across children) and
     * gates the merged artifact with the same `mapRepoCheck` a leaf passes — a
     * structured merge, never a `\n`-join of JSON blobs.
     */
    {
      name: 'map-repo',
      kind: 'learn',
      family: 'comprehend',
      outputSchema: KNOWLEDGE_ARTIFACT_SCHEMA,
      // ADR-029: comprehension recurses — NOT leafOnly. The brain decides
      // satisfy | split | block; a too-large region splits into sub-region
      // map-repo children whose KnowledgeArtifacts the engine merges at the
      // integrate edge (structured merge, mapRepoCheck-gated).
      leafOnly: false,
      // Live traces (2026-06-11, four mapping runs on a real repo): low-tier
      // first attempts burn the shared token budget exploring before the mid
      // retry starts — mid default is the instrumented call, not a decree.
      tier: { default: 'mid', ladder: ['mid', 'high'] },
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
     * Tier: mid (semantic analysis) → high (escalation for hard regions).
     * Grants: read-only + retrieval API (no sandboxed run rights needed).
     * Per ADR-019: facts are emitted as `knowledge-facts-written` events.
     *
     * Harness prompt instructs the brain to:
     *   - Read the region at `spec.repoRoot`/`spec.region`.
     *   - DECIDE first (ADR-029): a `deep-dive-region` goal obeys the recursion
     *     law. If the region is too large to dive FAITHFULLY in one node — too
     *     much load-bearing behavior to anchor without dropping facts or
     *     exhausting the budget — return a SPLIT. The split partitions the region
     *     into DISJOINT sub-regions whose UNION COVERS the parent (no overlap, no
     *     gaps); each child is itself a `deep-dive-region` goal scoped to one
     *     sub-region. Otherwise SATISFY and emit the facts directly.
     *   - Produce a `RegionFacts` with one `DiveFact` per claim; each fact
     *     must carry at least one `{ path, line }` anchor valid at
     *     `generatedAtSha`.
     *   - Emit the result as the goal's text output: a JSON-serialised
     *     RegionFacts. The deterministic gate verifies every anchor.
     *   - Discovery loop: read region → form claim → find anchoring evidence
     *     → emit; prefer depth over breadth.
     *
     * Integrate contract (ADR-029): when this goal splits, its children are
     * sub-region `deep-dive-region` comprehensions. The engine MERGES their
     * child `RegionFacts` into ONE parent `RegionFacts` (union of anchored facts,
     * every fact's anchors preserved) and gates the merged artifact with the same
     * `diveAnchorCheck` a leaf passes — a structured merge, never a `\n`-join.
     */
    {
      name: 'deep-dive-region',
      kind: 'learn',
      family: 'comprehend',
      outputSchema: REGION_FACTS_SCHEMA,
      // ADR-029: comprehension recurses — NOT leafOnly. A too-large region
      // splits into sub-region deep-dive-region children whose RegionFacts the
      // engine merges at the integrate edge (structured merge, diveAnchor-gated).
      leafOnly: false,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [artifactPresent, diveAnchorCheck()],
      judgeType: null,
      grants: ['fs.read', 'retrieval.api'],
    },
  ];
}
