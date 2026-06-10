/**
 * The outcome of the one place a harness reasons: deciding what to do with the
 * goal it received. Decide has three outcomes, never two.
 */

import type { Intent } from './goal.js';

/**
 * A single child a parent proposes to spawn when it splits a goal. There is only
 * one way to expand a goal — split it into sub-goals — and parallelism is not a
 * mode but an emergent consequence of the dependency structure among children.
 */
export interface ChildPlan {
  /**
   * An id local to this split, unique among siblings. Siblings reference each
   * other through `dependsOn` by this id before any of them have global ids.
   */
  localId: string;
  /** The goal-type to spawn this child as. */
  type: string;
  /** Human-readable one-line summary of the child's purpose. */
  title: string;
  /** The typed input for the child's type. */
  spec: unknown;
  /**
   * The hard dependencies of this child, by sibling `localId`. A real edge means
   * this child needs the sibling's *implemented behavior* — not merely a shared
   * shape they both build against. A child that only consumes a shared shape
   * depends on the `freeze-contract` child that lands it, not on the sibling that
   * introduces it: contract children are named first and depended on by their
   * sharers, so the dependency machinery sequences the freeze before the fan-out.
   * Over-declared edges are the dominant cause of needlessly serial builds.
   */
  dependsOn: string[];
  /** The child's impact set — files/regions it may touch. */
  scope: string[];
  /**
   * The fraction of the parent's budget allotted to this child, in `[0, 1]`.
   * Subdivision is what bounds total tree spend.
   */
  budgetShare: number;
  /** Optional override of the inherited {@link Intent}; absent means inherit. */
  intent?: Intent;
}

/**
 * A typed question to a human when a goal lacks the information to proceed
 * responsibly — never a transcript. Every brief carries a deadline and a safe
 * default, so an unanswered human never hangs or starves a tree. Gate briefs
 * (batched, before fan-out) teach; unforeseeable mid-tree briefs stay lean.
 */
export interface DecisionBrief {
  /** The single decision being asked of the human. */
  question: string;
  /** The discrete choices offered — never an open prompt. */
  options: string[];
  /** Pointers to the evidence the human needs (artifacts, findings, code). */
  links: string[];
  /** Milliseconds before `onTimeout` fires. */
  deadlineMs: number;
  /**
   * The safe default when the deadline passes — required by the schema so a
   * safe default always exists:
   * - `deny`   — proceed as if refused.
   * - `park`   — suspend the tree, release its scope reservation, resume on a TTL.
   * - `bounce` — wind the tree down and return the goal through admission.
   */
  onTimeout: 'deny' | 'park' | 'bounce';
  /**
   * Teaching fields a batched gate brief carries because the human is already
   * sitting down and a better-taught decision is a better decision. Absent on
   * lean mid-tree briefs.
   */
  teaching?: {
    /** The relevant finding driving the question. */
    finding: string;
    /** How confident the factory is in that finding. */
    confidence: string;
    /** What each option buys and costs, here, in this context. */
    costs: string;
    /** The factory's recommendation among the options. */
    recommendation: string;
  };
}

/**
 * The result of a harness's decide step — a discriminated union over the three
 * outcomes. `satisfy` and `split` carve up or complete the work; `block` bounces
 * ambiguity at the boundary instead of inventing. The factory never invents.
 */
export type Decision =
  /** The goal can be satisfied directly at this node, without children. */
  | { kind: 'satisfy' }
  /** The goal is decomposed into sub-goals with a dependency structure. */
  | { kind: 'split'; children: ChildPlan[] }
  /** The goal lacks information to proceed; a human is asked via a decision brief. */
  | { kind: 'block'; brief: DecisionBrief };
