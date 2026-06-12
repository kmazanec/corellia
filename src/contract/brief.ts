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
}

// ── The standing envelope ──────────────────────────────────────────────────────

/**
 * The standing envelope for the improvement loop (ADR-027): the budget and
 * dollar ceiling that improvement commissions draw against. It is operator
 * config — top-up is manual only — and it can never starve product work: the
 * admission gate requires both envelope headroom AND an empty product queue.
 */
export interface StandingEnvelope {
  budget: Budget;
  spendCeilingUsd: number;
}
