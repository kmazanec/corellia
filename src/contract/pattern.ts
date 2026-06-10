/**
 * The split-memo flywheel: the factory's record of which decompositions work.
 * A SplitMemo binds a structural shape to a split decision that resolved it,
 * scored by use and outcome so good splits compound into reusable suggestions.
 *
 * Two trust planes meet here. Facts decay — a project memory dies with its
 * artifact and is evicted on repeated failure. Structure versions — a split
 * shape that worked is not discarded when it later fails; it is a candidate the
 * factory weighs. So a memo's `status` is not earned by raw success count alone:
 * promotion to `trusted` is a human signoff, the authority gap the machine
 * cannot close on its own. The factory may surface a `provisional` memo as a
 * suggestion; only a human marks one `trusted` to rely on.
 */

import type { Decision } from './decision.js';

/**
 * One learned decomposition: a structural shape and the split that resolved it,
 * with its track record. `successes`/`failures` accumulate across `uses`; they
 * inform — but do not by themselves grant — promotion.
 */
export interface SplitMemo {
  /** The structural shape this memo keys on — what kind of goal it matched. */
  shape: string;
  /** The split decision recorded for this shape; always a `split` Decision. */
  decision: Extract<Decision, { kind: 'split' }>;
  /**
   * Trust plane:
   * - `provisional` — surfaced as a suggestion to weigh, never a command.
   * - `trusted`     — human-signed-off; relied on. The authority gap.
   */
  status: 'provisional' | 'trusted';
  /** How many times this memo has been consulted for a matching shape. */
  uses: number;
  /** How many consulting goals went on to succeed. */
  successes: number;
  /** How many consulting goals went on to fail. */
  failures: number;
}

/**
 * The store of split memos — read on decide to suggest a known-good split, and
 * written on outcome to score the shapes the factory has tried. Promotion is a
 * separate, human-gated operation: structure versions rather than decays.
 */
export interface PatternStore {
  /** Find the memo for a structural shape, or null if none is recorded. */
  match(shape: string): Promise<SplitMemo | null>;
  /**
   * Record the outcome of a split for a shape, creating the memo on first sight
   * and updating its use/success/failure tally thereafter.
   */
  record(
    shape: string,
    decision: Extract<Decision, { kind: 'split' }>,
    outcome: 'success' | 'failure',
  ): Promise<void>;
  /** Move a shape's memo to a trust plane — the human-signoff promotion path. */
  promote(shape: string, to: 'provisional' | 'trusted'): Promise<void>;
  /** Every recorded memo, for surfacing and audit. */
  list(): Promise<SplitMemo[]>;
}
