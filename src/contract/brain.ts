/**
 * The one brain behind every harness. The central theorem: one brain, many
 * harnesses means one recursive operation, many goal-types. Every harness calls
 * this interface and nothing else — what changes between harnesses is the
 * goal-type bound to the work, never the brain.
 */

import type { Goal, MemoryPointer, Tier, Metered, Usage, TransportIncident } from './goal.js';
import type { Decision } from './decision.js';
import type { Artifact } from './report.js';
import type { Verdict } from './verdict.js';
import type { SplitMemo } from './pattern.js';
import type { ToolCall, ToolDef } from './tool.js';

/**
 * What the brain is given for a single call, beyond the goal itself: the tier it
 * runs at, the spawner-injected memories, and — on a retry — the prior attempt's
 * artifact and verdict, so the factory is not a sphex wasp: attempt N+1 sees
 * attempt N's failure and the verdict whose prescriptions drove the repair.
 */
export interface BrainContext {
  /** The model tier this call runs at; the control loop bumps it on failure. */
  tier: Tier;
  /** The provenance-labeled memory pointers the spawner injected for this goal. */
  memories: MemoryPointer[];
  /**
   * The previous attempt's artifact and verdict, present only on a retry. A
   * re-split is a perturbation of the failed split informed by what was rejected,
   * never an independent roll.
   */
  priorAttempt?: { artifact: Artifact | null; verdict: Verdict };
  /**
   * A terraced-scan lens: the candidate-diversity axis this call should reason
   * along, so `k` candidates for a novel shape differ in approach rather than
   * being independent rolls of the same one. Absent outside a scan.
   */
  lens?: string;
  /**
   * A provisional split memo consulted for this goal's shape — a suggestion the
   * brain weighs, never a command it obeys. A trusted memo would already be
   * relied on upstream; a hint is the factory saying "this shape worked before."
   */
  patternHint?: SplitMemo;
  /**
   * The JSON-Schema for the artifact this call must emit (ADR-023). Set only on
   * the dedicated emit call of an explore-then-emit leaf; the adapter translates
   * it into the provider's `response_format: { type: 'json_schema', … }` on that
   * call, so the final artifact is well-formed by construction. Absent on every
   * exploratory step and on types without an `outputSchema`.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * The family skill guidance for this goal's type, injected so the brain
   * reasons with the same craft at DECIDE time that it already gets at produce
   * and judge time. For a comprehend goal this carries the satisfy-vs-split
   * criterion; without it the brain decides blind and over-splits (observed: a
   * map-repo splitting into a deep-dive that split into another map-repo on a
   * repo where no split was warranted). Optional: absent → the brain decides on
   * the goal context alone, exactly as before.
   */
  skill?: string;
  /**
   * A cheap, factual hint about the size/shape of the repo or region this goal
   * would comprehend — e.g. "top-level source dirs: 14; tracked files: 259".
   * Injected into the DECIDE call for a whole-repo `map-repo` so the brain can
   * apply the skill's "8+ subsystems → split" rule on REAL data instead of
   * guessing (AC-4 run #6: a whole-repo architecture map of a 259-file repo
   * chose satisfy, then could not be built faithfully in one node). The engine
   * computes this from the working tree; the brain weighs it, never obeys it.
   * Absent → the brain decides on the goal context alone, exactly as before.
   */
  repoShape?: string;
  /**
   * When true, this goal's type CANNOT satisfy (it has no producing tool —
   * canonically the deliver-intent root). The decide prompt omits the `satisfy`
   * shape and instructs the brain to choose only split or block, so it never
   * wastes a decision on a satisfy the engine would have to block anyway. This is
   * the PREVENTION paired with the engine's cannot-satisfy GUARD: the guard is the
   * backstop, this stops the brain reaching for satisfy in the first place
   * (observed: a deliver-intent root deciding satisfy on its first decision).
   * Absent/false → all three shapes are offered, exactly as before.
   */
  mustDecompose?: boolean;
}

/**
 * One message in a tool-loop transcript, mirroring the standard chat
 * tool-calling wire shape so a provider adapter is a thin translation and the
 * byte-identical prefix keeps prompt caching effective (ADR-015):
 *
 * - `context`   — harness/system framing or an observation the engine injects.
 * - `assistant` — the model's turn: free text and/or a batch of tool-call requests.
 * - `tool`      — the broker's result for one prior tool call, by `callId`.
 */
export type StepMessage =
  | { role: 'context'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; callId: string; content: string };

/** The transcript so far for an in-progress tool loop, in order. */
export type StepTranscript = StepMessage[];

/**
 * The outcome of one brain step: either a batch of tool calls to route through
 * the broker, or the final artifact ending the loop. Carries the step's usage
 * (ADR-017) and any transport incidents the adapter encountered (ADR-018), which
 * the engine turns into log events — the adapter never holds the store.
 */
export type StepOutput =
  | { kind: 'tool-calls'; calls: ToolCall[]; usage: Usage; incidents?: TransportIncident[] }
  | { kind: 'artifact'; artifact: Artifact; usage: Usage; incidents?: TransportIncident[] };

/**
 * The brain interface. Four classic methods are the LLM-driven moments of the
 * factory — decide, produce, judge, repair — each returning its value paired
 * with provider-reported {@link Metered} usage. The fifth, `step`, is the pure
 * per-step function the engine drives for tool-using leaves: the engine owns the
 * loop and gates each step on budget; the brain only thinks one step forward.
 * Every harness — for every goal-type — performs its work through exactly these.
 */
export interface Brain {
  /**
   * Decide what to do with a goal: satisfy it directly, split it into sub-goals
   * with a dependency structure, or block on a decision brief.
   */
  decide(goal: Goal, ctx: BrainContext): Promise<Metered<Decision>>;
  /** Produce the goal's artifact directly — the leaf-builder path. */
  produce(goal: Goal, ctx: BrainContext): Promise<Metered<Artifact>>;
  /**
   * Judge a subject artifact against a rubric, rendering a verdict with findings.
   * A delegated judge carries a different lens than the maker — a second taste.
   */
  judge(goal: Goal, subject: Artifact, rubric: string, ctx: BrainContext): Promise<Metered<Verdict>>;
  /**
   * Apply a judge's prescriptions to an artifact — the repair rung. The expensive
   * model judges; the cheap model types. Repair is `produce` constrained to the
   * prescribed localized edits, not a fresh attempt.
   */
  repair(goal: Goal, artifact: Artifact, prescriptions: string[], ctx: BrainContext): Promise<Metered<Artifact>>;
  /**
   * Advance a tool loop by one step: given the transcript so far and the tools
   * the goal-type grants, return either the next batch of tool calls or the final
   * artifact. Pure per step — the engine routes calls through the broker, appends
   * events, and gates the next step on remaining budget.
   */
  step(goal: Goal, transcript: StepTranscript, tools: ToolDef[], ctx: BrainContext): Promise<StepOutput>;
}
