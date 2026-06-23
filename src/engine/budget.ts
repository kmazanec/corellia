/**
 * Pure budget accounting helpers. Subdivision bounds total tree spend;
 * consumption tracks what has been spent against an allowance.
 */

import type { Budget } from '../contract/goal.js';

/**
 * Subdivide a budget among children according to their fractional shares.
 *
 * `wallClockMs` subdivides proportionally (a real external-time bound that should
 * ladder down). `attempts`, `tokens`, and `toolCalls` are INHERITED, not divided
 * (ADR-030). Dividing them by share floored a node toward nothing at depth —
 * attempts to 1 (forbidding any further split/retry, run #1), tokens to a
 * fraction-of-a-fraction (starving deep comprehension, run #3), and toolCalls
 * likewise (a deep map-repo could not afford even a directory listing, run #4).
 * These are work-capacity signals, not divisible resources to ration by depth.
 * Each child inherits the parent's attempts/tokens/toolCalls; all remain
 * tracked/reported per node. The REAL bound on spend is the per-tree dollar
 * ceiling (and wall-clock), not arbitrary counts that floor with depth.
 */
export function subdivide(budget: Budget, shares: number[]): Budget[] {
  return shares.map((share) => ({
    attempts: budget.attempts,
    tokens: budget.tokens,
    toolCalls: budget.toolCalls,
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
