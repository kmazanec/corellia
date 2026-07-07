/**
 * The event log: the substrate under everything. Every receive, decide, split,
 * spawn, eval verdict, escalation, gate, block, memory write, and emission is an
 * event in one append-only log. Every other view of the factory — memory,
 * metrics, the human surfaces, replay — is a projection of this log.
 */

import type { Budget, MemoryPointer, Tier, Goal, Usage } from './goal.js';
import type { Decision, DecisionBrief } from './decision.js';
import type { Report } from './report.js';
import type { Verdict } from './verdict.js';
import type { RiskClass } from './risk.js';
import type { KnowledgeArtifact, KnowledgeCategory, RegionFacts } from './knowledge.js';

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
  | { type: 'decided'; at: number; goalId: string; decision: Decision; usage?: Usage }
  /** A child harness was spawned on a sub-goal, with its hard dependencies. */
  | { type: 'child-spawned'; at: number; goalId: string; childId: string; childType: string; dependsOn: string[] }
  /** The deterministic gate ran (compile, lint, types, impacted tests, scope, secret scan). */
  | { type: 'deterministic-checked'; at: number; goalId: string; verdict: Verdict }
  /** A judge rendered a verdict at the parent's integrate edge, at a given tier. */
  | { type: 'judge-verdict'; at: number; goalId: string; judgeType: string; verdict: Verdict; tier: Tier; usage?: Usage }
  /** A cheap fixer applied the judge's prescriptions — the repair rung. */
  | { type: 'repair-applied'; at: number; goalId: string; prescriptions: string[]; usage?: Usage }
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
  | { type: 'pattern-recorded'; at: number; goalId: string; shape: string; outcome: 'success' | 'failure' }
  /** A human-signoff changed a split memo's trust plane; replayable authority-gap ceremony. */
  | { type: 'pattern-trust-signed'; at: number; goalId: string; shape: string; from: 'provisional' | 'trusted'; to: 'provisional' | 'trusted'; signer: string; rationale: string }
  /**
   * The broker mediated a tool call: it ran, or it was refused with a reason.
   * `args` is a bounded, structured summary of the salient call arguments (path,
   * pattern, target, offset, …) for observability — never the bulk payload, which
   * is reduced to a length attribute (e.g. `content_len`).
   */
  | { type: 'tool-call'; at: number; goalId: string; tool: string; callId: string; outcome: 'ran' | 'refused'; reason?: string; args?: Record<string, string | number> }
  /** One step of the engine-owned tool loop resolved to tool calls or an artifact. */
  | { type: 'step'; at: number; goalId: string; index: number; outputKind: 'tool-calls' | 'artifact'; usage?: Usage }
  /** A repo-declared script ran in the tree's sandbox; output retained by ref. */
  | { type: 'script-ran'; at: number; goalId: string; command: string; exitStatus: number | null; durationMs: number; outputRef: string }
  /** A declared runtime/visual capture ran in the tree's sandbox (ADR-042); ok is the deterministic floor. */
  | { type: 'capture-ran'; at: number; goalId: string; captureName: string; kind: string; ok: boolean; durationMs: number; outputRef?: string }
  /** A per-tree worktree was created for sandboxed execution. */
  | { type: 'worktree-created'; at: number; goalId: string; treeId: string; branch: string; path: string }
  /** A tree's worktree was collected — its commits folded back — and torn down. */
  | { type: 'worktree-collected'; at: number; goalId: string; treeId: string; branch: string; commits: string[] }
  /** A tree's worktree was preserved (not torn down) for the stated reason. */
  | { type: 'worktree-preserved'; at: number; goalId: string; treeId: string; branch: string; path: string; reason: string }
  /**
   * A stale tree worktree was reaped (removed) by the maintenance reaper (D4).
   * `goalId` is the synthetic maintenance actor 'worktree-reaper' — the reaper
   * works from `git worktree list`, not a live goal. `branch` is absent when the
   * worktree had no branch checked out.
   */
  | { type: 'worktree-reaped'; at: number; goalId: string; path: string; branch?: string; reason: string }
  /**
   * The full set of files a collected tree touched vs its declared scope (C1).
   * Emitted at collection so a reviewer sees every changed path and its
   * in/out-of-scope marker in the report, without reading `git show`.
   */
  | { type: 'files-touched'; at: number; goalId: string; scope: string[]; files: { path: string; inScope: boolean }[] }
  /**
   * A root elected a ship-what's-green partial delivery (issue A5): it collected
   * the green subtree and opened the PR path while enumerating the child modules
   * that blocked producing nothing. `blockedModules` is the surfaced remainder.
   */
  | { type: 'partial-delivered'; at: number; goalId: string; blockedModules: { goalId: string; title: string; blocker: string }[] }
  /** A produce call completed, carrying its provider-reported usage. */
  | { type: 'produced'; at: number; goalId: string; usage: Usage }
  /** Measured tree spend reached the dollar ceiling — the tree halts. */
  | { type: 'ceiling-reached'; at: number; goalId: string; spentUsd: number; ceilingUsd: number }
  /** A bounded transport retry fired on a provider failure (not attempt-consuming). */
  | { type: 'transport-retry'; at: number; goalId: string; detail: string }
  /** A single corrective re-prompt fired on malformed model output. */
  | { type: 'malformation-reprompt'; at: number; goalId: string; detail: string }
  /** Raw tool reads were compressed to bound a leaf's working memory (ADR-036). */
  | { type: 'context-evicted'; at: number; goalId: string; detail: string }
  /**
   * A dependency blocked but produced a usable partial artifact, so the dependent
   * proceeds on that partial knowledge instead of cascade-blocking (ADR-037).
   * The dependency's blocker is carried forward as a finding, not a hard gate.
   */
  | { type: 'dependency-degraded'; at: number; goalId: string; dependency: string; blocker: string }
  /** A knowledge artifact was produced and appended — project memory's write path (ADR-019). */
  | { type: 'knowledge-written'; at: number; goalId: string; artifact: KnowledgeArtifact }
  /** A deep-dive's anchored region facts were appended — keeps dive output evented (ADR-003/ADR-019). */
  | { type: 'knowledge-facts-written'; at: number; goalId: string; facts: RegionFacts }
  /** A consumer ran the checkpoint freshness check on an artifact (verify-on-read, ADR-019). */
  | { type: 'knowledge-checked'; at: number; goalId: string; repoRoot: string; category: KnowledgeCategory; sha: string; outcome: 'fresh' | 'stale-validated' | 'invalid' }
  /**
   * A judge verdict on a real (non-scripted) run was captured as a golden-set
   * candidate (ADR-024): the `goldenCandidates` projection collects these per
   * judge-type for later human curation. References the judged context by digest
   * — the artifact and rubric are not duplicated into the log. Outcome labels
   * arrive later from exogenous signals (the operator's merge/rejection); capture
   * here is provenance, not promotion.
   */
  | { type: 'golden-candidate'; at: number; goalId: string; judgeType: string; artifactDigest: string; rubricDigest: string; verdictPass: boolean; tier: Tier; model?: string }
  /**
   * An exogenous ground-truth outcome attached to a captured golden candidate
   * (golden-outcome-labels): the operator's merge/rejection of the eventual PR,
   * or a human verdict confirming/refuting a judged criterion. Joined to
   * `golden-candidate` events by `goalId` (the tree/candidate reference), so the
   * `goldenCandidates` projection can report labeled pairs ready for curation.
   *
   * Labels are exogenous BY CONSTRUCTION — never produced by any eval. This is
   * the justification regress terminating outside the system (DESIGN.md): the
   * label is the ground truth a judge is later calibrated against, never another
   * judge's opinion. `source` records who/what delivered it (an operator, a
   * PR-merge listener); `note` is optional free context.
   */
  | { type: 'golden-label'; at: number; goalId: string; outcome: 'merged' | 'rejected' | 'confirmed' | 'refuted'; source: string; note?: string }
  /** A granted leaf pushed its tree's branch to the bound repo's origin (ADR-025). */
  | { type: 'branch-pushed'; at: number; goalId: string; treeId: string; branch: string; remote: string }
  /** A granted leaf opened exactly one PR for its tree's branch; carries the URL (ADR-025). */
  | { type: 'pr-opened'; at: number; goalId: string; treeId: string; branch: string; url: string }
  /** A completed run's blocker was routed to an improve-factory commission (ADR-027). */
  | { type: 'blocker-routed'; at: number; goalId: string; blocker: string; commissionId: string }
  /**
   * A milestone round began (ADR-031): which round, the tree spend so far, and
   * the round's wall-clock slice. The honest per-round log of the iterating loop.
   */
  | { type: 'round-started'; at: number; goalId: string; round: number; spentUsd: number; roundWallClockMs: number }
  /**
   * A milestone round was assessed against the frozen acceptance criteria
   * (ADR-031/032). Carries the deterministic `passingCount` / `criteriaTotal`,
   * the `judge-acceptance` verdict, the halt decision, and a diff DIGEST
   * (pointers, not bodies — MemoryView-consistent, memory.ts:15-22).
   */
  | { type: 'round-assessed'; at: number; goalId: string; round: number;
      passingCount: number; criteriaTotal: number; judgeVerdict: Verdict;
      outcome: 'done' | 'continue' | 'halt-no-progress' | 'halt-max-rounds' | 'halt-ceiling' | 'halt-deadline';
      diffDigest: string[] };

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

/**
 * A best-effort observer of the event stream, fanned out to *after* the store
 * has durably appended an event. The seam that lets the log reach an external
 * tracing backend (LangSmith, OTLP, …) without touching the store's durability
 * or the dependency-free core (ADR-001, ADR-003): sinks are additive and live
 * only in optional adapter modules wired at the daemon.
 *
 * `emit` must never throw into the store — a sink failure is caught and dropped
 * by the fan-out so observability can never break the factory's durability.
 */
export interface EventSink {
  /** Observe one event that was just persisted. Best-effort; must not throw. */
  emit(event: FactoryEvent): void;
  /** Flush any buffered output before shutdown. Optional. */
  flush?(): Promise<void>;
}
