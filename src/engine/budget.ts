/**
 * Pure budget accounting helpers. Subdivision bounds total tree spend;
 * consumption tracks what has been spent against an allowance.
 */

import type { Budget } from '../contract/goal.js';

/**
 * Subdivide a budget among children according to their fractional shares.
 *
 * toolCalls / wallClockMs subdivide proportionally so cost tracking stays
 * meaningful (a fan-out's reported spend still ladders down from the root).
 *
 * `attempts` and `tokens` are INHERITED, not divided (ADR-030). Dividing them by
 * share floored a node two levels down toward nothing — attempts to 1 (forbidding
 * any further split/retry) and tokens to a fraction-of-a-fraction (starving deep
 * comprehension before it could emit; observed on the cats AC-2 run #3). attempts
 * is a retry COUNT, not a divisible resource; tokens divided-by-share punished
 * depth on no real evidence. Each child now inherits the parent's attempts and
 * tokens. Both remain tracked/reported per node; the REAL bound on token spend is
 * the per-tree dollar ceiling, not an arbitrary count that floors with depth.
 */
export function subdivide(budget: Budget, shares: number[]): Budget[] {
  return shares.map((share) => ({
    attempts: budget.attempts,
    tokens: budget.tokens,
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
