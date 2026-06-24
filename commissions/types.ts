/**
 * The reviewed-commission artifact shape. A `commissions/<id>.ts` file
 * `export default`s a `CommissionDoc`: the frozen front-door `CommissionInput`
 * (ADR-026) plus review-time metadata (ceiling, repo root, a human note) that the
 * factory does not consume but a reviewer / runner does. See `commissions/README.md`.
 */
import type { CommissionInput } from '../src/contract/brief.js';

export interface CommissionDoc {
  /** The frozen front-door input the factory consumes (`brief.ts:23`). */
  commission: CommissionInput;
  /**
   * Per-tree dollar ceiling — the PRIMARY budget bound. The listener mints the
   * root goal without a ceiling today (`listener.ts` runIntent), so a run through
   * the real front door uses the engine default ($15, `engine.ts:56`). Record the
   * intended ceiling here for review; the runner warns when it differs from the
   * effective default. A per-commission ceiling override is a separate
   * engine/listener feature (not yet built).
   */
  ceilingUsd: number;
  /** Repo root for the declared-scripts capability check, if used. */
  repoRoot?: string;
  /** One-line human note for the review gate; not consumed by the factory. */
  note?: string;
}
