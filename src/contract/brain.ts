/**
 * The one brain behind every harness. The central theorem: one brain, many
 * harnesses means one recursive operation, many goal-types. Every harness calls
 * this interface and nothing else — what changes between harnesses is the
 * goal-type bound to the work, never the brain.
 */

import type { Goal, MemoryPointer, Tier } from './goal.js';
import type { Decision } from './decision.js';
import type { Artifact } from './report.js';
import type { Verdict } from './verdict.js';

/**
 * What the brain is given for a single call, beyond the goal itself: the tier it
 * runs at, the spawner-injected memories, and — on a retry — the prior attempt's
 * artifact and verdict, so the factory is not a sphex wasp: attempt N+1 sees
 * attempt N's failure and the verdict whose prescriptions drove the repair.
 */
export interface BrainContext {
  /** The model tier this call runs at; the control loop bumps it on failure. */
  tier: Tier;
  /** The provenance-labeled memory pointers the spawner injected for this goal. */
  memories: MemoryPointer[];
  /**
   * The previous attempt's artifact and verdict, present only on a retry. A
   * re-split is a perturbation of the failed split informed by what was rejected,
   * never an independent roll.
   */
  priorAttempt?: { artifact: Artifact | null; verdict: Verdict };
}

/**
 * The brain interface. The four methods are the four LLM-driven moments of the
 * factory: decide what to do with a goal, produce an artifact, judge an artifact
 * against a rubric, and repair an artifact from prescriptions. Every harness —
 * for every goal-type — performs its work through exactly these.
 */
export interface Brain {
  /**
   * Decide what to do with a goal: satisfy it directly, split it into sub-goals
   * with a dependency structure, or block on a decision brief.
   */
  decide(goal: Goal, ctx: BrainContext): Promise<Decision>;
  /** Produce the goal's artifact directly — the leaf-builder path. */
  produce(goal: Goal, ctx: BrainContext): Promise<Artifact>;
  /**
   * Judge a subject artifact against a rubric, rendering a verdict with findings.
   * A delegated judge carries a different lens than the maker — a second taste.
   */
  judge(goal: Goal, subject: Artifact, rubric: string, ctx: BrainContext): Promise<Verdict>;
  /**
   * Apply a judge's prescriptions to an artifact — the repair rung. The expensive
   * model judges; the cheap model types. Repair is `produce` constrained to the
   * prescribed localized edits, not a fresh attempt.
   */
  repair(goal: Goal, artifact: Artifact, prescriptions: string[], ctx: BrainContext): Promise<Artifact>;
}
