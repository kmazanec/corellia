/**
 * A goal-type is a harness. Defining a goal-type *is* defining a harness — there
 * is no separate harness object. A type binds context, memory, tools, evals, and
 * a model tier to a name; the library of types is the factory's instruction set.
 */

import type { Goal, Kind, Tier } from './goal.js';
import type { Artifact } from './report.js';
import type { ScriptResult } from './tool.js';
import type { DeclaredCaptures, CaptureRunner } from './capture.js';

/**
 * The runtime context an executing check needs: where the tree's sandbox lives
 * and how to run a repo-declared script in it. Supplied per invocation because a
 * static type definition cannot close over per-tree runtime state. Absent for
 * artifact-only checks, which ignore it.
 */
export interface CheckContext {
  /** The tree's sandbox root — the working directory executing checks run against. */
  sandboxRoot?: string;
  /** Run one repo-declared script by name in the sandbox, returning its result. */
  runScript?: (name: string) => Promise<ScriptResult>;
  /**
   * The captures declared for this tree (ADR-042), parallel to declaredScripts.
   * A `{ capture }` criterion validates its name against this map. Absent for any
   * goal that declares no captures; a `{ capture }` criterion then fails safe.
   */
  declaredCaptures?: DeclaredCaptures;
  /** Run one declared capture by name in the sandbox, returning its result. */
  runCapture?: CaptureRunner;
}

/**
 * One deterministic eval — compile, lint, typecheck, impacted tests, the
 * `diff ⊆ scope` check, a secret-reference scan, a process-language grep. The
 * deterministic gate runs before any judge, always, and intent may never relax
 * it. Anything a linter can enforce belongs here, not in a prompt.
 */
export interface DeterministicCheck {
  /** Identifier for the check, surfaced in verdicts and the event log. */
  name: string;
  /**
   * Run the check against a goal and its (possibly null) artifact, yielding a
   * pass/fail plus a human-readable detail. Takes no `intent` input by
   * construction: deterministic gates are intent-blind. Executing checks read
   * the optional {@link CheckContext} for a sandbox root and a script runner;
   * artifact-only checks ignore it and remain valid unchanged.
   *
   * A check MAY return a `prescription` when its failure is mechanically
   * repairable — i.e. the detail already names the exact correction (e.g. a dive
   * anchor past end-of-file → "fix or drop these anchors"). Most deterministic
   * failures are "you didn't do X" with no recipe and omit it; a check that omits
   * it escalates the tier on failure as before (run live-self-a6963719 escalated
   * the high tier into the same hallucination because the anchor failure carried
   * no prescription). When present, the engine routes the failure through the
   * repair rung (ADR-006, repair-within-attempt) instead of escalating.
   */
  run(
    goal: Goal,
    artifact: Artifact | null,
    ctx?: CheckContext,
  ): Promise<{ ok: boolean; detail: string; prescription?: string }>;
}

/**
 * The definition of one goal-type — the static, lintable shape the constitution
 * checks. Grants and tier ladders are exact and static per type; the only
 * runtime narrowing is scope. Capability is the type; reach is the instance.
 */
export interface GoalTypeDef {
  /** The type's unique name, e.g. `implement`, `judge-split`, `map-repo`. */
  name: string;
  /** The locked eval-shape class this type belongs to; its grant must fit the kind's ceiling. */
  kind: Kind;
  /**
   * The skill-bundle key (ADR-022): the family whose markdown skill file and
   * per-type section the loader resolves and the engine injects into this type's
   * harness. Families are defined in GOAL-TYPES.md (the name in parentheses on
   * each type row, e.g. `build`, `arbiter`, `critique`, `curate`, `comprehend`).
   * A registered type whose family file is missing fails the constitution lint.
   */
  family: string;
  /**
   * Whether this type may never spawn children — a guaranteed structural base
   * case. Judge types are always `leaf_only`; decomposing a judgment is the
   * parent's job, not the judge's.
   */
  leafOnly: boolean;
  /**
   * The model tier policy: the default tier this type runs at, plus the ladder
   * the control loop climbs on eval failure. Ladders are instrumented per type.
   */
  tier: { default: Tier; ladder: Tier[] };
  /** The deterministic gate, run before any judge. */
  deterministic: DeterministicCheck[];
  /**
   * The judge-kind type name that renders this type's judge verdict, or null when
   * the type has no judge (its eval is purely deterministic, or it is itself a judge).
   */
  judgeType: string | null;
  /** The exact, static tool grants — the contract is the capability, readable as blast radius. */
  grants: string[];
  /**
   * When true, this type CANNOT satisfy directly — it has no producing tool and
   * its only legitimate decisions are split or block (canonically `deliver-intent`,
   * the composite root: grants are retrieval/classify/spawn, with no way to emit a
   * product). The engine enforces this: a `satisfy` decision from a `mustDecompose`
   * type is coerced to an actionable block rather than run through the (futile)
   * attempt loop, which would emit an empty artifact and dead-end at a
   * `step-loop:failed` block. Declared on the type so the invariant is lintable —
   * "capability is the type" (GOAL-TYPES.md) — not inferred from grant-sniffing.
   */
  mustDecompose?: boolean;
  /**
   * Whether this type carries a type-level authority gate: goals of this type
   * route through a human grant/deny decision before their children spawn,
   * regardless of instance risk. Capability-level authority, not reach.
   */
  gated?: boolean;
  /**
   * The terraced-scan policy for novel shapes this type may encounter: produce
   * `k` candidate approaches across the named `lenses` (diversity axes) and grade
   * them before committing, instead of a single roll on an unfamiliar shape.
   */
  scan?: { k: number; lenses: string[] };
  /**
   * A JSON-Schema object describing this type's artifact (ADR-023). Its presence
   * switches the leaf to explore-then-emit: the engine runs the tool loop to
   * explore, then makes one dedicated emit call with {@link BrainContext.outputSchema}
   * set so well-formedness is the provider's guarantee. Types without it behave
   * exactly as today — the deterministic gate remains the semantic check either way.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Whether a goal of this type MUST be spawned with a non-empty `scope` (ADR-039).
   * Scope is load-bearing for a region-anchored producing leaf: it is the region the
   * leaf is here to touch/characterize, the anchor that bounds its exploration, and
   * (via `diff ⊆ scope`) the gate on its writes. A type that declares this is
   * rejected at `validateSplit` when its child carries an empty scope — empty scope
   * means "no region", which leaves the leaf unbounded (no "I've read enough" anchor;
   * `isInScope` treats empty scope as allow-all). Declared per type, not a universal
   * rule: a whole-repo `map-repo`, a planner that refines scope downward, or a judge
   * legitimately has no single region and does NOT set this. "Capability is the type"
   * (GOAL-TYPES.md) — the scope contract is a property of the type, like `leafOnly`
   * and `mustDecompose`, not engine-side grant-sniffing.
   */
  requiresScope?: boolean;
  /**
   * When present, this type's SPLIT dispatch arm routes through the milestone
   * loop (`runMilestone`) instead of the single-pass `runSplit` (ADR-031). The
   * type re-decides against a frozen acceptance-criteria done-condition each
   * round. Constitution-enforced: MUST be `kind:'make'`; `maxRounds >= 1`;
   * `acceptanceJudge` must name a registered `kind:'judge'` type.
   *
   * `maxRounds` is a runaway-BACKSTOP, not a budget proxy: the type sets a
   * generous default (`deliver-intent` uses 50) and a commission MAY override it
   * via {@link import('./goal.js').Goal.maxRounds}. The real terminators are the
   * per-tree dollar ceiling and the no-progress halt.
   */
  iterative?: { maxRounds: number; acceptanceJudge: string };
}

/**
 * The library of goal-types, looked up by name. The registry walker and the
 * parent node consume types through this same interface at every depth.
 */
export interface Registry {
  /** Resolve a type definition by name; throws if absent. */
  get(name: string): GoalTypeDef;
  /** Whether a type of this name exists. */
  has(name: string): boolean;
  /** Every registered type name. */
  names(): string[];
}
