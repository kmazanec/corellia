/**
 * Pure budget accounting helpers. Subdivision bounds total tree spend;
 * consumption tracks what has been spent against an allowance.
 */

import type { Budget } from '../contract/goal.js';

/**
 * Subdivide a budget among children according to their fractional shares.
 *
 * tokens / toolCalls / wallClockMs subdivide proportionally so cost tracking
 * stays meaningful (a fan-out's reported spend still ladders down from the root).
 *
 * `attempts` is a RETRY count, not a divisible resource (ADR-030). Dividing it by
 * share floored a node two levels down to 1 attempt — which then forbade it from
 * splitting or retrying at all. So `attempts` is INHERITED, not divided: each
 * child gets the parent's attempt count. attempts no longer caps anything (the
 * fan-out guard that keyed on it is gone); it is a soft retry signal bounded in
 * reality by wall-clock and the dollar ceiling.
 */
export function subdivide(budget: Budget, shares: number[]): Budget[] {
  return shares.map((share) => ({
    attempts: budget.attempts,
    tokens: Math.max(1, Math.floor(budget.tokens * share)),
    toolCalls: Math.max(1, Math.floor(budget.toolCalls * share)),
    wallClockMs: Math.max(1, Math.floor(budget.wallClockMs * share)),
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
