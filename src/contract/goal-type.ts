/**
 * A goal-type is a harness. Defining a goal-type *is* defining a harness — there
 * is no separate harness object. A type binds context, memory, tools, evals, and
 * a model tier to a name; the library of types is the factory's instruction set.
 */

import type { Goal, Kind, Tier } from './goal.js';
import type { Artifact } from './report.js';

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
   * construction: deterministic gates are intent-blind.
   */
  run(goal: Goal, artifact: Artifact | null): Promise<{ ok: boolean; detail: string }>;
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
  /** The code-reuse family in the factory repo whose skeleton and skills this type includes. */
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
