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

/**
 * The minimum wall-clock a COMPREHENSION dive (`map-repo` / `deep-dive-region`)
 * needs to finish a thorough pass. ADR-030 subdivides wall-clock proportionally —
 * correct for most work, but when a deliver-intent root fans out wide (~13
 * children) each dive's proportional share collapses to ~90s, and a thorough
 * deep-dive of even a 14-file region cannot finish in that, so it loops to a
 * `step-loop:failed` timeout (build run live-self-63daa9cf: 5 of 12 dives starved).
 * Comprehension is the read-heavy work whose time-to-complete is governed by the
 * region's content, not by its sibling count — so its wall-clock should not
 * ration below a workable floor. This is the wall-clock analogue of ADR-030's
 * attempts/tokens/toolCalls inheritance: do not starve a work-capacity signal by
 * depth/breadth. The per-tree dollar ceiling remains the real spend bound.
 */
export const COMPREHENSION_WALLCLOCK_FLOOR_MS = 300_000; // 5 min

/**
 * Raise a child budget's wall-clock to at least `floorMs` if it fell below it
 * after proportional subdivision. Returns the budget unchanged when it already
 * meets the floor (or when the floor would exceed the parent's own wall-clock —
 * a child never gets more external time than its parent had).
 */
export function floorWallClock(budget: Budget, floorMs: number, parentWallClockMs: number): Budget {
  const target = Math.min(floorMs, parentWallClockMs);
  if (budget.wallClockMs >= target) return budget;
  return { ...budget, wallClockMs: target };
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
