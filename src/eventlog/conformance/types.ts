/**
 * The conformance vocabulary shared by every invariant check: the violation
 * shape, the invariant keys, and how a check resolves a goal-type name to its
 * kind. Each check module in this folder returns {@link ConformanceViolation}[];
 * the {@link ../conformance.js} index concatenates them.
 */

import type { FactoryEvent } from '../../contract/events.js';
import type { Kind } from '../../contract/goal.js';

/** The invariant a violation belongs to — a stable, greppable discriminant. */
export type ConformanceInvariant =
  | 'deterministic-before-judge'
  | 'no-judge-authored-writes'
  | 'spend-monotone'
  | 'spend-under-ceiling'
  | 'brief-carries-deadline'
  | 'park-carries-ttl'
  | 'worktree-well-nested';

/** One conformance failure: which invariant broke, on which goal, and why. */
export interface ConformanceViolation {
  /** The invariant that was violated — the stable machine-readable key. */
  invariant: ConformanceInvariant;
  /** The goal the violation is attributable to. */
  goalId: string;
  /** The offending event indices in the supplied log (append order). */
  indices: number[];
  /** A human-readable one-line explanation, ready to print or file. */
  detail: string;
}

/**
 * How a conformance check resolves a goal-type NAME to its {@link Kind}. The
 * event log carries only the type name (`goal-received.goal.type`), never the
 * kind, so the caller supplies the mapping — canonically the run's registry.
 * Absent means the kind-dependent invariant (no-judge-authored-writes) falls back
 * to the naming convention.
 */
export type KindResolver = (typeName: string) => Kind | undefined;

/**
 * Build a `goalId → type name` map from the log's `goal-received` events, so a
 * kind-dependent check can attribute a later event to its goal's type.
 */
export function goalTypeIndex(events: FactoryEvent[]): Map<string, string> {
  const goalType = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'goal-received') goalType.set(e.goalId, e.goal.type);
  }
  return goalType;
}
