/**
 * The starter set of GoalTypeDef objects: a thin slice of the full type table
 * covering the intent → artifact → judge → memory loop end-to-end.
 *
 * Tier ladders read left-to-right: the first element is the default; subsequent
 * elements are the escalation rungs the control loop climbs on eval failure.
 *
 * Grants are descriptive strings (e.g. 'fs.read'); the engine enforces them at
 * runtime; this definition carries the data shape.
 */

import type { GoalTypeDef } from '../contract/goal-type.js';
import { artifactPresent, filesWithinScope, processClean } from './checks.js';
import {
  mapRepoCheck,
  diveAnchorCheck,
} from './knowledge-checks.js';

/**
 * The ten starter goal-types. Each corresponds directly to a row in the
 * GOAL-TYPES.md kind tables. The two `learn`-kind types (`map-repo` and
 * `deep-dive-region`) are appended after the original eight.
 */
export function starterTypes(): GoalTypeDef[] {
  return [
    // -------------------------------------------------------------------------
    // make / deliver
    // -------------------------------------------------------------------------
    {
      name: 'deliver-intent',
      kind: 'make',
      family: 'deliver',
      leafOnly: false,
      tier: { default: 'opus', ladder: ['opus'] },
      deterministic: [],
      judgeType: 'judge-integration',
      // The root type that commissions intent accepts only spawn + retrieval
      // grants; no code tools, because satisfying intent directly is not its job.
      grants: ['retrieval.api', 'classify_risk', 'spawn'],
    },

    // -------------------------------------------------------------------------
    // make / build
    // -------------------------------------------------------------------------
    {
      name: 'freeze-contract',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'opus', ladder: ['opus'] },
      deterministic: [artifactPresent, filesWithinScope, processClean],
      judgeType: 'critique-code',
      grants: ['fs.read', 'fs.write', 'test.run_scoped'],
    },

    {
      name: 'implement',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [artifactPresent, filesWithinScope, processClean],
      judgeType: 'critique-code',
      grants: [
        'fs.read',
        'fs.write',
        'test.run_impacted',
        'knowledge.find_symbol',
        'knowledge.find_exemplar',
        'knowledge.impact',
        'knowledge.conventions_for',
        'knowledge.stack_versions',
      ],
    },

    {
      name: 'characterize',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [artifactPresent, filesWithinScope],
      judgeType: 'critique-code',
      // Characterize writes only to test directories; no production-code writes.
      grants: ['fs.read', 'fs.write_test_dirs', 'test.run_impacted'],
    },

    // -------------------------------------------------------------------------
    // judge / arbiter
    // -------------------------------------------------------------------------
    {
      name: 'judge-split',
      kind: 'judge',
      family: 'arbiter',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },

    {
      name: 'judge-integration',
      kind: 'judge',
      family: 'arbiter',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },

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

    // -------------------------------------------------------------------------
    // evolve / curate
    // -------------------------------------------------------------------------
    {
      name: 'promote-memory',
      kind: 'evolve',
      family: 'curate',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet'] },
      deterministic: [],
      judgeType: null,
      // The curate family holds the only memory-write grants in the library.
      grants: ['memory.write'],
    },

    // -------------------------------------------------------------------------
    // learn / comprehend
    // -------------------------------------------------------------------------

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
      leafOnly: true,
      tier: { default: 'haiku', ladder: ['haiku', 'sonnet'] },
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
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [artifactPresent, diveAnchorCheck()],
      judgeType: null,
      grants: ['fs.read', 'retrieval.api'],
    },
  ];
}
