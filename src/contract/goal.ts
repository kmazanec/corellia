/**
 * The unit the factory passes around: a typed goal with an I/O contract.
 *
 * Everything in the factory is a goal — a PRD, a design, a diff, a renamed
 * symbol are goals of different types. There is no other primitive. A
 * goal-type is a harness; an instance of that type is a {@link Goal}.
 */

/**
 * The four locked eval-shape classes. A goal of each kind centers its report on
 * a different thing, and the four differ in what their eval can even be:
 *
 * - `make`   — an artifact that changes the product (deterministic gate → judge).
 * - `learn`  — a finding that changes what the factory knows (verifiable-on-read).
 * - `judge`  — a verdict on another goal's output (calibration-only; no instance ground truth).
 * - `evolve` — a change to the factory's own substrate (promotion eval / maintainer review).
 *
 * Kinds are architecture, human-locked; each carries a worst-case blast radius
 * that sets the grant ceiling the constitution lints every member type against.
 */
export type Kind = 'make' | 'learn' | 'judge' | 'evolve';

/**
 * How strictly the judge grades, inherited down the subtree unless a child
 * overrides. Intent modulates judges and never the deterministic gates:
 *
 * - `production`       — judged on mimicry: could a team member have written this?
 * - `spike`            — judged on "does it answer the question," not polish.
 * - `characterization` — judged on fidelity of capture, not improvement.
 *
 * Intent is orthogonal to risk: a spike touching auth is relaxed-judge but still gated.
 */
export type Intent = 'production' | 'spike' | 'characterization';

/**
 * The model tier a goal runs on. The default is set by the goal-type; eval
 * failure bumps it up the ladder via the control loop. Specification quality,
 * not stakes, picks the tier — a well-specified goal runs cheaper.
 */
export type Tier = 'low' | 'mid' | 'high';

/**
 * A call's hard requirements on the concrete model that serves its {@link Tier}
 * demand band. The tier is the abstract capability-demand band; `needs` is the
 * per-call capability floor the resolved model must clear regardless of band —
 * canonically a screenshot judge that must run on a vision-capable model. The
 * model catalog (`src/brains/model-catalog.ts`) filters by these before banding.
 * All fields optional; an absent need does not constrain (the common case is no
 * needs at all).
 */
export interface ModelNeeds {
  /** Require image input support (a screenshot-ui judge sets this). */
  vision?: boolean;
  /** Require at least this many context tokens. */
  minContext?: number;
  /** Require at least this tool-calling reliability ('ok' or 'strong'). */
  minToolCalling?: 'ok' | 'strong';
}

/**
 * A backstop against runaway recursion and spend. Budget never influences what
 * or how anything is built: a goal plans, splits, and builds identically at any
 * budget. The only hard bounds are the ones tied to real runaway cost — the
 * per-tree dollar ceiling and `wallClockMs`. The count dimensions below are
 * tracked and reported for observability; they never block, cap, or steer work
 * (ADR-033).
 */
export interface Budget {
  /** Retry/re-split counter. Tracked for observability; never blocks or caps fan-out. */
  attempts: number;
  /** Model-token counter. Tracked for observability; never blocks work. */
  tokens: number;
  /** Agentic round-trip counter. Tracked for observability; never blocks work. */
  toolCalls: number;
  /**
   * Wall-clock backstop in milliseconds — a hard bound on runaway external time.
   * The ROOT's value fixes one deadline for the whole tree; children inherit it
   * as a reported allowance but are never sliced by it. A goal blocks only when
   * the shared tree deadline passes, never per-goal by fan-out width (ADR-046).
   */
  wallClockMs: number;
}

/**
 * A memory injected into a goal as context by its spawner — a pointer, not a
 * body. Children never touch the store; the spawner retrieves what is relevant
 * and injects it. Injected memories are quoted data the spawner mentions, never
 * directives the child obeys, which makes poisoning a data-quality problem
 * rather than a prompt-injection one.
 */
export interface MemoryPointer {
  /** Stable identifier, used for reinforcement writes against memories actually used. */
  id: string;
  /**
   * The memory layer this pointer came from, mirroring instance / class / universe:
   * - `project` — facts about this artifact; dies with the project.
   * - `type`    — how this operation is done well; the compounding asset.
   * - `global`  — org-wide conventions, house style; ambient.
   */
  layer: 'project' | 'type' | 'global';
  /**
   * The goal-type this memory is scoped to, set ONLY on a `type`-layer pointer —
   * type memory is "how *this operation* is done well," so it is namespaced by the
   * operation (the goal-type name) and retrieved only for goals of that same type.
   * Absent on `project` and `global` pointers, which are not type-scoped.
   */
  namespace?: string;
  /** The pointer text — what to recall and where to look, not the full body. */
  content: string;
  /**
   * Trust state at read time:
   * - `provisional` reads as a suggestion to weigh.
   * - `trusted`     reads as a fact to rely on.
   */
  provenance: 'provisional' | 'trusted';
}

/**
 * Provider-reported usage for one brain call. Tokens and cost come from the
 * endpoint's own accounting, never an estimate (ADR-017). `costUsd` is present
 * only when the endpoint reports it; a token-only endpoint omits it.
 */
export interface Usage {
  /** Prompt (input) tokens the provider charged for this call. */
  promptTokens: number;
  /** Completion (output) tokens the provider charged for this call. */
  completionTokens: number;
  /** The provider-reported dollar cost of this call, when the endpoint reports it. */
  costUsd?: number;
  /**
   * Prompt tokens served from the provider's cache, when the endpoint reports
   * them — a subset of {@link promptTokens}, billed at the cache-read rate. Lets
   * the cost summary credit cache hits (e.g. the explore-then-emit transcript
   * prefix, ADR-023) instead of pricing every prompt token at the full rate.
   */
  cachedPromptTokens?: number;
}

/** The zero-usage sentinel: no tokens, no cost. Used by non-metering paths. */
export const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0 };

/**
 * One infrastructure event that occurred while producing a value, reported back
 * to the engine so it can append the matching log event. Adapters never hold
 * the event store (adapter purity, ADR-018); they surface incidents as data and
 * the engine records them. `at` is wall-clock ms.
 */
export interface TransportIncident {
  /** Whether this was a bounded transport retry or a single malformation re-prompt. */
  kind: 'transport-retry' | 'malformation-reprompt';
  /** Human-readable detail (the status code, the parse error) for the log. */
  detail: string;
  /** Wall-clock ms at which the incident occurred. */
  at: number;
}

/**
 * A value paired with the provider usage spent producing it, and any transport
 * incidents that occurred along the way. Every metered brain method returns this
 * so the engine can debit tokens and dollars from measured figures (ADR-017).
 */
export interface Metered<T> {
  /** The produced value. */
  value: T;
  /** The provider-reported usage for the call(s) that produced `value`. */
  usage: Usage;
  /** Transport retries / malformation re-prompts the adapter encountered, if any. */
  incidents?: TransportIncident[];
}

/**
 * A goal instance — the downward half of the one handoff contract, identical at
 * every level of the tree. Free text never flows down: parsing happens once, at
 * the root, and below that `spec` is always typed for the goal's type.
 */
export interface Goal {
  /** Stable identifier for this instance, used as the event-log anchor. */
  id: string;
  /** The goal-type name; resolves to a {@link import('./goal-type.js').GoalTypeDef} in the registry. */
  type: string;
  /** The spawning goal's id, or null at the root of a tree. */
  parentId: string | null;
  /** Human-readable one-line summary of what this goal is for. */
  title: string;
  /**
   * The typed input for this goal's type. Opaque at the contract layer — each
   * goal-type narrows it — but never free text below the root.
   */
  spec: unknown;
  /** Judge strictness, inherited down the subtree unless overridden. */
  intent: Intent;
  /** The impact set: files/regions this goal may touch, enforced as `diff ⊆ scope` at emission. */
  scope: string[];
  /** This goal's resource allowance, subdivided from its parent. */
  budget: Budget;
  /** Spawner-injected memory pointers, provenance-labeled. */
  memories: MemoryPointer[];
  /**
   * The per-tree dollar ceiling: measured spend reaching it halts the tree with
   * a decision brief (ADR-017). Set at the root (learning-phase default $15) and
   * threaded to child runs; unlike {@link Budget}, it is never subdivided.
   */
  spendCeilingUsd?: number;
  /**
   * Per-commission override for an iterative type's round backstop (ADR-031,
   * decision 4). When set on a root goal whose type carries `iterative`,
   * `runMilestone` uses `goal.maxRounds ?? typeDef.iterative.maxRounds`. A
   * runaway-backstop only — the real terminators are the dollar ceiling and the
   * no-progress halt — and the constitution's `>= 1` floor is re-checked on the
   * effective value at the dispatch guard. Additive: ignored by every
   * non-iterative type.
   */
  maxRounds?: number;
}
