/**
 * In-memory pattern store. The canonical reference implementation of PatternStore:
 * no I/O, no side effects, safe for tests and the flywheel feature's fast path.
 *
 * Shares the same semantics as PgPatternStore: first record of an unknown shape
 * inserts as `provisional`; subsequent records accumulate uses/successes/failures.
 * Promotion requires an explicit call — nothing auto-trusts.
 */

import type { PatternStore, SplitMemo } from '../contract/pattern.js';
import type { Decision } from '../contract/decision.js';

export class InMemoryPatternStore implements PatternStore {
  readonly #memos = new Map<string, SplitMemo>();

  async match(shape: string): Promise<SplitMemo | null> {
    return this.#memos.get(shape) ?? null;
  }

  async record(
    shape: string,
    decision: Extract<Decision, { kind: 'split' }>,
    outcome: 'success' | 'failure',
  ): Promise<void> {
    const existing = this.#memos.get(shape);

    if (existing === undefined) {
      this.#memos.set(shape, {
        shape,
        decision,
        status: 'provisional',
        uses: 1,
        successes: outcome === 'success' ? 1 : 0,
        failures: outcome === 'failure' ? 1 : 0,
      });
    } else {
      this.#memos.set(shape, {
        ...existing,
        uses: existing.uses + 1,
        successes: existing.successes + (outcome === 'success' ? 1 : 0),
        failures: existing.failures + (outcome === 'failure' ? 1 : 0),
      });
    }
  }

  /**
   * Move a shape's memo to a trust plane.
   *
   * Promotion to `trusted` is a human-signoff step — the authority gap the
   * machine cannot close on its own. This method is the API that ceremony
   * calls; nothing in the engine calls it directly.
   */
  async promote(shape: string, to: 'provisional' | 'trusted'): Promise<void> {
    const existing = this.#memos.get(shape);
    if (existing !== undefined) {
      this.#memos.set(shape, { ...existing, status: to });
    }
  }

  async list(): Promise<SplitMemo[]> {
    return Array.from(this.#memos.values());
  }
}
