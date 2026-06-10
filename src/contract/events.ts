/**
 * The event log: the substrate under everything. Every receive, decide, split,
 * spawn, eval verdict, escalation, gate, block, memory write, and emission is an
 * event in one append-only log. Every other view of the factory — memory,
 * metrics, the human surfaces, replay — is a projection of this log.
 */

import type { Budget, MemoryPointer, Tier, Goal } from './goal.js';
import type { Decision, DecisionBrief } from './decision.js';
import type { Report } from './report.js';
import type { Verdict } from './verdict.js';
import type { RiskClass } from './risk.js';

/**
 * One thing that happened in the factory. A discriminated union on `type`; every
 * member carries `at` (wall-clock ms) and the `goalId` it concerns, so the log is
 * queryable by goal and by event type without parsing payloads.
 */
export type FactoryEvent =
  /** A goal entered a node and the recursive operation began on it. */
  | { type: 'goal-received'; at: number; goalId: string; goal: Goal }
  /** The split gate's coverage pre-check ran: do we have enough to decompose? */
  | { type: 'gate-checked'; at: number; goalId: string; ok: boolean; missing: string[] }
  /** The node decided: satisfy, split, or block. */
  | { type: 'decided'; at: number; goalId: string; decision: Decision }
  /** A child harness was spawned on a sub-goal, with its hard dependencies. */
  | { type: 'child-spawned'; at: number; goalId: string; childId: string; childType: string; dependsOn: string[] }
  /** The deterministic gate ran (compile, lint, types, impacted tests, scope, secret scan). */
  | { type: 'deterministic-checked'; at: number; goalId: string; verdict: Verdict }
  /** A judge rendered a verdict at the parent's integrate edge, at a given tier. */
  | { type: 'judge-verdict'; at: number; goalId: string; judgeType: string; verdict: Verdict; tier: Tier }
  /** A cheap fixer applied the judge's prescriptions — the repair rung. */
  | { type: 'repair-applied'; at: number; goalId: string; prescriptions: string[] }
  /** The control loop escalated to a higher model tier, carrying the failed attempt. */
  | { type: 'tier-escalated'; at: number; goalId: string; from: Tier; to: Tier }
  /** A human was asked via a decision brief, and how it resolved. */
  | { type: 'blocked'; at: number; goalId: string; brief: DecisionBrief; resolution: 'deny' | 'park' | 'bounce' | 'answered' }
  /** A memory was written to the store through the governed write path. */
  | { type: 'memory-written'; at: number; goalId: string; pointer: MemoryPointer }
  /** A memory actually used was reinforced with the goal's outcome — the decay signal. */
  | { type: 'memory-reinforced'; at: number; goalId: string; memoryId: string; outcome: 'success' | 'failure' }
  /** The goal emitted its typed report upward. */
  | { type: 'emitted'; at: number; goalId: string; report: Report }
  /** A budget dimension ran out — an event, never a hang; it summons the human. */
  | { type: 'budget-exhausted'; at: number; goalId: string; dimension: keyof Budget }
  /** A goal's instance risk was classified before fan-out, against its touched scope. */
  | { type: 'risk-classified'; at: number; goalId: string; risk: RiskClass }
  /** The authority gate resolved for a gated goal: the human granted or denied. */
  | { type: 'gate-decision'; at: number; goalId: string; resolution: 'granted' | 'denied' }
  /** A goal was parked on a brief, holding for an answer up to a TTL. */
  | { type: 'parked'; at: number; goalId: string; brief: DecisionBrief; ttlMs: number }
  /** A parked goal resumed when its question was answered. */
  | { type: 'resumed'; at: number; goalId: string; answer: string }
  /** The split-memo flywheel was consulted for a structural shape and its trust state. */
  | { type: 'pattern-consulted'; at: number; goalId: string; shape: string; status: 'none' | 'provisional' | 'trusted' }
  /** A split's outcome was recorded against its shape — the flywheel's write. */
  | { type: 'pattern-recorded'; at: number; goalId: string; shape: string; outcome: 'success' | 'failure' };

/**
 * The append-only event store. The append is the serialization point — the
 * precondition for contradiction-check-on-write — and the source every read
 * model projects from.
 */
export interface EventStore {
  /** Append one event to the log. The only mutation the store admits. */
  append(e: FactoryEvent): Promise<void>;
  /**
   * Read events back, optionally filtered by the goal they concern and/or their
   * discriminant. With no filter, returns the whole log in append order.
   */
  list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]>;
}
