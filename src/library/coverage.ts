/**
 * Coverage policy table (ADR-021): maps goal classes to required fresh
 * knowledge categories, and the pure query function that runs the check.
 *
 * This is the named auditable constant that answers "do we have enough
 * information to decompose?" — the split gate's mechanical pre-check. It is
 * deliberately NOT a brain call: the gate stays cheap, deterministic, and
 * traceable. A miss's reason is always "table row X was unmet", not a model
 * judgment.
 *
 * The policy table's strictness is tuned from traces (ADR-021); v1 ships four
 * categories only. Learn-kind goals are exempt (they ARE the coverage).
 */

import type { KnowledgeArtifact, KnowledgeCategory } from '../contract/knowledge.js';

// ── Structural types (structural so tests inject synthetics) ─────────────────

/** The minimal slice of a goal the coverage check needs. Structurally typed
 *  so tests can inject synthetic shapes without coupling to the full Goal. */
export interface CoverageGoal {
  /** The eval-shape class of the goal type (from GoalTypeDef.kind). */
  kind: 'make' | 'learn' | 'judge' | 'evolve';
  /**
   * Whether this goal is a non-leaf split (the root split path requires
   * broader coverage than a leaf). True = this node will spawn children;
   * false = leaf (satisfy directly).
   */
  isRootSplit: boolean;
  /**
   * The file / region scope this goal touches. Used to detect code-emitting
   * scope so the table can require region dives for touched regions.
   */
  scope: string[];
  /**
   * The goal type's name, used to detect code-emitting leaf types (make kind)
   * so the table can decide whether a region dive is needed.
   */
  typeName: string;
  /**
   * Per-region existence: does each scope region correspond to EXISTING tracked
   * code in the repo? Keyed by the normalized region (trailing slash stripped),
   * exactly as the region-dive loop normalizes scope entries.
   *
   * This is the relevance signal (ADR-029 Decision 2): comprehension is "pulled
   * by the split gate, bounded by the regions the goal touches" — and a region
   * that does not yet exist has nothing to comprehend. A region absent from this
   * map defaults to `true` (treat as existing), so callers that do not supply it
   * — and the existing test corpus — behave exactly as before.
   *
   *   - Root split whose scope is non-empty and entirely NEW (every region
   *     present here is `false`): the whole-repo architecture+stack maps are not
   *     pulled — there is no existing structure to comprehend to decompose a
   *     greenfield region. A scope-less root split (whole-repo intent) still
   *     requires them.
   *   - Region dives: only EXISTING regions are dived; a region being created
   *     fresh is never demanded as a deep-dive.
   *
   * The engine computes this from the working tree (it has fs access); the check
   * stays pure by consuming it as data.
   */
  existsByRegion?: Record<string, boolean>;
}

/** The minimal slice of a knowledge artifact the coverage check needs. */
export interface CoverageArtifact {
  category: KnowledgeCategory;
  generatedAtSha: string;
  /** The repo this artifact describes — used for SHA comparison. */
  repoRoot: string;
}

/** A region that has been deep-dived: which repo + region was covered. */
export interface CoverageRegionFact {
  repoRoot: string;
  region: string;
  generatedAtSha: string;
}

/** The knowledge shape the gate consumes. Structurally typed so assembly wires
 *  the real store/scanner implementations and tests inject synthetics. */
export interface KnowledgeForCoverage {
  /** Latest artifact per category (undefined = never generated). */
  artifacts: CoverageArtifact[];
  /** All region dives available for this repo. */
  regionFacts: CoverageRegionFact[];
  /** The repo's current HEAD SHA — used for freshness checks. */
  headSha: string;
}

// ── One missing requirement ──────────────────────────────────────────────────

/** One unsatisfied requirement from the policy table. */
export interface MissingRequirement {
  /** The knowledge category that is absent or stale. */
  category: KnowledgeCategory;
  /** For region-dive requirements: which scope region is uncovered. */
  region?: string;
  /** Human-readable reason (for the gate-checked event's missing[] member). */
  reason: string;
}

// ── The policy table ─────────────────────────────────────────────────────────

/**
 * ADR-021's policy table as a named, auditable constant.
 *
 * Row semantics (evaluated in order per goal class):
 *   1. learn-kind goals → no requirements (they ARE the coverage).
 *   2. root splits (make kind) →
 *        - SCOPED (non-empty scope, brownfield or greenfield): region dives for
 *          the touched EXISTING regions ONLY, no whole-repo map (ADR-029 Dec 2,
 *          amended for a scoped root split — AC-4 run #6).
 *        - SCOPE-LESS (empty scope = genuine whole-repo intent): architecture + stack.
 *   3. code-emitting leaves (make kind) →
 *        - SCOPED (non-empty scope): region dives for the touched regions ONLY,
 *          no whole-repo map (ADR-029 Dec 2, amended for brownfield).
 *        - UNSCOPED (empty scope): architecture + conventions (whole-repo).
 *   4. characterize/test work → architecture + conventions + test-scaffold + region dives.
 *
 * "Fresh" is ADR-019's rule: SHA matches HEAD, or self-validation passes.
 * This table only checks SHA-match; the engine's verify-on-read handles
 * self-validation for stale-but-valid artifacts.
 */
export const COVERAGE_POLICY_TABLE = {
  /**
   * learn-kind goals are always exempt — they are the process that creates
   * knowledge, so requiring knowledge as their precondition would be circular.
   */
  LEARN_EXEMPT: true,

  /**
   * Required fresh categories for root splits (goals that will spawn children
   * to decompose a repo-level intent).
   */
  ROOT_SPLIT_CATEGORIES: ['architecture', 'stack'] as KnowledgeCategory[],

  /**
   * Required fresh categories for code-emitting leaf goals (make kind, leafOnly).
   * Region dives for touched regions are checked separately.
   */
  CODE_LEAF_CATEGORIES: ['architecture', 'conventions'] as KnowledgeCategory[],

  /**
   * Required fresh categories for characterize/test work. Superset of code-leaf.
   */
  CHARACTERIZE_CATEGORIES: ['architecture', 'conventions', 'test-scaffold'] as KnowledgeCategory[],

  /**
   * Goal type names that count as "characterize/test work" for the policy.
   * Aligned with the starter-types library.
   */
  CHARACTERIZE_TYPE_NAMES: ['characterize'] as string[],
} as const;

// ── The pure coverage check ──────────────────────────────────────────────────

/** Result of a coverage check. */
export interface CoverageCheckResult {
  ok: boolean;
  /** Non-empty only when ok is false. */
  missing: MissingRequirement[];
}

/**
 * Run the policy table against the available knowledge and return which
 * requirements are unmet.
 *
 * Pure: no side effects, no I/O, no brain calls. The gate is cheap by design.
 *
 * @param goal   The goal being checked — minimal structural slice.
 * @param knowledge  The available knowledge for the repo.
 * @param validatedCategories  Categories that have been verified as stale-but-valid
 *   by the checkpoint verify-on-read step — these are treated as fresh regardless
 *   of SHA mismatch. This prevents a validated stale artifact from being flagged
 *   again as missing by the coverage check.
 * @returns {ok, missing} — ok:true means the gate passes; ok:false means the
 *   gate records missing[] and the engine should spawn comprehension children.
 */
export function coverageCheck(
  goal: CoverageGoal,
  knowledge: KnowledgeForCoverage,
  validatedCategories: Set<KnowledgeCategory> = new Set(),
): CoverageCheckResult {
  // ── 1. learn-kind exemption ──────────────────────────────────────────────
  if (goal.kind === 'learn') {
    return { ok: true, missing: [] };
  }

  // ── 2. judge / evolve — no table entry, exempt ──────────────────────────
  // The table only covers make-kind goals (root splits and code leaves).
  // judge and evolve kinds are exempt by omission.
  if (goal.kind === 'judge' || goal.kind === 'evolve') {
    return { ok: true, missing: [] };
  }

  // ── 3. make kind: determine which row of the table applies ───────────────
  const missing: MissingRequirement[] = [];
  const { headSha } = knowledge;

  // Build an index: category → artifact (latest), for O(1) lookup
  const byCategory = new Map<KnowledgeCategory, CoverageArtifact>();
  for (const artifact of knowledge.artifacts) {
    // Keep the most recently seen (last wins; caller should provide latest)
    byCategory.set(artifact.category, artifact);
  }

  /** Check whether a single category is present and fresh at headSha. */
  function checkCategory(category: KnowledgeCategory): MissingRequirement | null {
    const artifact = byCategory.get(category);
    if (artifact === undefined) {
      return {
        category,
        reason: `No ${category} artifact exists — must be generated before this split can proceed`,
      };
    }
    // A stale artifact that has been verified by checkpoint verify-on-read
    // (stale-validated) is treated as fresh for the purpose of this check.
    if (artifact.generatedAtSha !== headSha && !validatedCategories.has(category)) {
      return {
        category,
        reason: `${category} artifact is stale (generated at ${artifact.generatedAtSha}, HEAD is ${headSha}) — verify-on-read will validate; if invalid a refresh is needed`,
      };
    }
    return null;
  }

  // ── Determine required categories by goal class ──────────────────────────

  let requiredCategories: KnowledgeCategory[];

  /** Normalize a scope entry to a region key (strip trailing slash). Must match
   *  the region-dive loop's normalization so `existsByRegion` keys line up. */
  const regionKey = (scopeEntry: string): string => scopeEntry.replace(/\/$/, '');
  /** A region exists unless explicitly recorded as `false` in existsByRegion. */
  const regionExists = (region: string): boolean =>
    goal.existsByRegion?.[region] !== false;

  // Relevance bound (ADR-029 Decision 2): a root split whose scope is non-empty
  // and points ENTIRELY at new/untracked regions has no existing structure to
  // comprehend, so it does not pull whole-repo architecture+stack maps. A
  // scope-less root split (a genuine whole-repo intent) still requires them.
  const isGreenfieldRootSplit =
    goal.isRootSplit &&
    goal.scope.length > 0 &&
    goal.scope.every((s) => !regionExists(regionKey(s)));

  // Relevance bound (ADR-029 Decision 2, amended for a SCOPED root split —
  // AC-4 cats run #6): a root split whose scope is non-empty is bounded to the
  // regions it touches, exactly like a scoped code leaf. Its comprehension is the
  // deep-dive of those EXISTING regions (checked below), NOT a whole-repo
  // architecture+stack map. The JIT rule ("a region no goal touches is never
  // mapped; no comprehension is ever speculative") applies to the decomposition
  // intent too: a tightly-scoped deliver intent does not need a whole-repo map to
  // place a one-file helper into a known directory — it needs to understand THAT
  // directory. Whole-repo maps stay reserved for a SCOPE-LESS root split (a
  // genuine whole-repo / unscoped intent). Without this, run #6's scoped deliver
  // intent demanded a whole-repo architecture map of cats' 259-file tree, which
  // cannot be built faithfully in a bounded read budget (its anchors fail
  // validation). The greenfield carve-out above is the special case where the
  // touched regions also happen to be new.
  const isScopedRootSplit = goal.isRootSplit && goal.scope.length > 0;

  // Relevance bound, extended (ADR-029 Decision 2, amended for brownfield —
  // AC-4 cats run #3): a code-emitting leaf whose scope is NON-EMPTY is bounded
  // to the regions it touches. Its comprehension is the deep-dive of THOSE
  // regions (checked below), NOT a whole-repo architecture/conventions map. The
  // JIT rule is "a region no goal touches is never mapped; no comprehension is
  // ever speculative" — so a tightly-scoped feature pulls region dives only, and
  // the whole-repo maps are reserved for a SCOPE-LESS leaf (a genuine
  // whole-repo / unscoped edit) where there is no region to bound to. Without
  // this, a one-file add to an existing dir demanded a whole-repo map that times
  // out on a large repo (cats: 259 files). The greenfield carve-out above is now
  // the special case of this where the regions also happen to be new.
  const isScopedCodeLeaf = !goal.isRootSplit && goal.scope.length > 0;

  if (isGreenfieldRootSplit || isScopedRootSplit) {
    // Scoped root split (brownfield or greenfield) — no whole-repo architecture/
    // stack map. A scoped intent is bounded to its touched regions; their dives
    // (checked below) are its comprehension. Greenfield is the case where those
    // regions are also new (so even the dives are skipped per existsByRegion).
    requiredCategories = [];
  } else if (goal.isRootSplit) {
    // Row 2: a SCOPE-LESS root split (a genuine whole-repo intent) — whole-repo
    // architecture + stack maps, since there is no region to bound to.
    requiredCategories = [...COVERAGE_POLICY_TABLE.ROOT_SPLIT_CATEGORIES];
  } else if (COVERAGE_POLICY_TABLE.CHARACTERIZE_TYPE_NAMES.includes(goal.typeName)) {
    // Row 4: characterize/test work. Characterize work genuinely reads the wider
    // codebase to write tests, so it keeps the whole-repo categories even when
    // scoped — only the plain code-emitting leaf narrows to region dives.
    requiredCategories = [...COVERAGE_POLICY_TABLE.CHARACTERIZE_CATEGORIES];
  } else if (isScopedCodeLeaf) {
    // Row 3, scoped: a tightly-scoped code leaf — region dives (below) suffice;
    // no whole-repo architecture/conventions map.
    requiredCategories = [];
  } else {
    // Row 3, unscoped: a code-emitting leaf with NO scope — fall back to the
    // whole-repo categories, since there is no region to bound comprehension to.
    requiredCategories = [...COVERAGE_POLICY_TABLE.CODE_LEAF_CATEGORIES];
  }

  // Check each required category
  for (const category of requiredCategories) {
    const miss = checkCategory(category);
    if (miss !== null) {
      missing.push(miss);
    }
  }

  // ── Region dive check (scoped leaves, characterize, AND scoped root splits) ──
  // A region in the goal's scope that has no deep-dive fact at the current SHA →
  // missing region dive. This now applies to a SCOPED root split too (AC-4 run
  // #6): a scoped deliver intent pulls dives of its touched regions instead of a
  // whole-repo map. A SCOPE-LESS root split (handled above with whole-repo maps)
  // has no scope here, so it pulls no dives — its comprehension is the maps.
  if (goal.scope.length > 0) {
    // Build a set of (region, sha) pairs that are covered
    const coveredRegions = new Set<string>();
    for (const rf of knowledge.regionFacts) {
      if (rf.generatedAtSha === headSha) {
        coveredRegions.add(rf.region);
      }
    }

    // Check each scope entry that looks like a directory/region (not a single
    // file) — the policy applies to touched regions, not individual files.
    // For simplicity in v1: each scope entry is treated as a potential region.
    for (const scopeEntry of goal.scope) {
      // Normalize: strip trailing slash
      const region = regionKey(scopeEntry);
      // Relevance bound (ADR-029 Decision 2): a region being created fresh has
      // nothing to deep-dive — only existing regions are comprehended.
      if (!regionExists(region)) continue;
      if (!coveredRegions.has(region)) {
        missing.push({
          category: 'architecture',  // region dives are architecture-class knowledge
          region,
          reason: `No deep-dive-region artifact for region "${region}" at SHA ${headSha}`,
        });
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}
