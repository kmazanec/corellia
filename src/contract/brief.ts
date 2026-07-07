/**
 * The Brief contract: the frozen front-door surface.
 *
 * Before iteration 06 the commission shape and the parked-brief shape were
 * conventions living inside `src/listener/listener.ts`. ADR-026 freezes them as
 * a contract so the daemon, the REPL, the improvement loop, and the assembly
 * all consume one set of types — there is no second source of truth.
 *
 * `CommissionInput` is moved here verbatim from the listener (no fields added in
 * the move — ADR-026). The daemon-facing status and standing-envelope shapes are
 * new with the hosted front door.
 */

import type { Budget, Intent } from './goal.js';
import type { DeclaredScripts } from '../library/script-runner.js';

// ── The commission ────────────────────────────────────────────────────────────

/**
 * A single commission handed to the front door. Moved verbatim from the listener
 * (ADR-026): the listener and the daemon both consume this one shape.
 */
export interface CommissionInput {
  /** Stable identifier for this intent, used to park, resume, and sweep it. */
  id: string;
  /** Human-readable one-liner. */
  title: string;
  /** The typed spec to hand to the root goal. */
  spec: unknown;
  /**
   * Scope prefixes this intent owns. Admission checks prefix-overlap: a new
   * intent that overlaps a running reservation queues until the conflict clears.
   */
  scope: string[];
  budget: Budget;
  /** Judge-strictness dial; defaults to 'production'. */
  intent?: Intent;
  /**
   * Per-commission dollar ceiling for the whole tree. When set, the front door
   * threads it onto the root goal's {@link Goal.spendCeilingUsd}; when absent the
   * engine applies its learning-phase default ($15). Unlike {@link Budget} it is
   * never subdivided — it bounds the tree, not a single goal. Added after the
   * ADR-026 freeze: the commission artifact already declared an intended ceiling
   * (`commissions/<id>.ts` `ceilingUsd`) that previously had no path to the goal.
   */
  spendCeilingUsd?: number;
  /**
   * Optional capability pre-check: when present, the listener verifies that
   * every declared script entry point exists on disk before admitting the
   * commission. Missing entries bounce at receive with zero subtree spend.
   */
  declaredScripts?: DeclaredScripts;
  /** The repo root used for the declared-scripts capability check. */
  repoRoot?: string;
}

// ── Front-door status ──────────────────────────────────────────────────────────

/**
 * A parked brief as the front door reports it: the intent waiting on an answer,
 * the question it is parked on, and the wall-clock deadline at which tick() will
 * sweep it. The internal `Parked` record in the listener carries more (the full
 * input); this is the externally-visible projection.
 */
export interface ParkedBrief {
  intentId: string;
  question: string;
  deadline: number;
}

/** The `GET /status` payload: what the front door is doing right now. */
export interface FrontDoorStatus {
  /** Intent ids with a live reservation (running now). */
  running: string[];
  /** Intent ids admitted but waiting on a scope conflict to clear. */
  queued: string[];
  /** Intents parked on a brief, awaiting an answer or TTL sweep. */
  parked: ParkedBrief[];
  /**
   * Improvement commission ids parked on exhausted envelope or non-empty
   * product queue (ADR-027). Visible here so operators can see when the
   * improvement loop is backed up waiting for headroom or product idle.
   */
  parkedImprovement?: string[];
  /**
   * The improvement loop's USD standing envelope: dollars consumed, the total
   * allowance, and dollars remaining (ADR-027). Present only when an envelope is
   * configured, so operators can see how close the window is to deferring the
   * next improvement root. Absent when the improvement loop is disabled.
   */
  improvementEnvelope?: { consumedUsd: number; allowanceUsd: number; remainingUsd: number };
}

// ── The standing envelope ──────────────────────────────────────────────────────

/**
 * The standing envelope for the improvement loop (ADR-027): the budget and
 * dollar ceiling that improvement commissions draw against. It is operator
 * config — top-up is manual only — and it can never starve product work: the
 * admission gate requires both envelope headroom AND an empty product queue.
 *
 * The envelope is charged in MEASURED USD: on completion each improvement tree
 * adds its actual dollar spend (the same spend stream the per-tree ceiling
 * debits, ADR-017) to the window's consumed total, and admission of a new
 * improvement root checks REMAINING DOLLARS, not remaining slots — so one
 * expensive tree can defer the next, which a count of trees could never express.
 */
export interface StandingEnvelope {
  budget: Budget;
  /** The window's total USD allowance. Consumed by measured tree spend; manual top-up only. */
  spendCeilingUsd: number;
  /**
   * The dollar ceiling a single improvement tree runs under, and the headroom
   * the admission gate reserves before admitting one: a new improvement root is
   * admitted only when the window's remaining dollars are at least this much, and
   * the admitted tree runs bounded by it (never more than the remaining window).
   * Absent → no per-tree reserve: the window admits while any dollars remain
   * (`consumed < allowance`) and a tree runs under the engine default ceiling —
   * the pre-existing behaviour, preserved for configs that set only
   * `spendCeilingUsd`.
   */
  perTreeCeilingUsd?: number;
}
