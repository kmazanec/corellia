/**
 * Pure budget accounting helpers. Subdivision bounds total tree spend;
 * consumption tracks what has been spent against an allowance.
 */

import type { Budget } from '../contract/goal.js';

/**
 * Subdivide a budget among children according to their fractional shares.
 * Each dimension is floored; every child gets at least 1 attempt.
 * Shares need not sum to 1 — each child receives its fraction of the parent.
 */
export function subdivide(budget: Budget, shares: number[]): Budget[] {
  return shares.map((share) => ({
    attempts: Math.max(1, Math.floor(budget.attempts * share)),
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
