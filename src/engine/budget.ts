/**
 * Pure budget accounting helpers. Subdivision bounds total tree spend;
 * consumption tracks what has been spent against an allowance.
 */

import type { Budget } from '../contract/goal.js';

/**
 * Subdivide a budget among children according to their fractional shares.
 *
 * Every dimension is INHERITED, not divided. `attempts`, `tokens`, and
 * `toolCalls` inherit per ADR-030 (dividing them by share floored a node toward
 * nothing at depth — starving retries, deep comprehension, and even a directory
 * listing). `wallClockMs` inherits per ADR-046: subdividing it made a wide
 * fan-out ration each child down to ~90s, killing productive leaves that a
 * narrower split would have finished — budget steering the build, which ADR-033
 * forbids. Wall-clock is enforced ONCE, tree-wide, against the root's deadline
 * (see `TreeState.deadline`), so the per-child `wallClockMs` here is only a
 * reported inherited allowance, not a slice that shrinks with breadth. The REAL
 * bounds on a runaway are the per-tree dollar ceiling and the tree deadline.
 */
export function subdivide(budget: Budget, shares: number[]): Budget[] {
  return shares.map(() => ({
    attempts: budget.attempts,
    tokens: budget.tokens,
    toolCalls: budget.toolCalls,
    wallClockMs: budget.wallClockMs,
  }));
}

export type BudgetDimension = keyof Budget;

/**
 * Consume one unit of a budget dimension. Returns the updated budget and
 * whether that dimension has been exhausted (reached zero or below).
 */
export function consume(
  budget: Budget,
  dim: BudgetDimension,
): { budget: Budget; exhausted: boolean } {
  const next: Budget = { ...budget, [dim]: budget[dim] - 1 };
  return { budget: next, exhausted: next[dim] <= 0 };
}

/**
 * Consume N units of a budget dimension at once.
 */
export function consumeN(
  budget: Budget,
  dim: BudgetDimension,
  n: number,
): { budget: Budget; exhausted: boolean } {
  const next: Budget = { ...budget, [dim]: budget[dim] - n };
  return { budget: next, exhausted: next[dim] <= 0 };
}
