/**
 * The one brain behind every harness. The central theorem: one brain, many
 * harnesses means one recursive operation, many goal-types. Every harness calls
 * this interface and nothing else — what changes between harnesses is the
 * goal-type bound to the work, never the brain.
 */

import type { Goal, MemoryPointer, ModelNeeds, Tier, Metered, Usage, TransportIncident } from './goal.js';
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
  /**
   * The call's hard model requirements, resolved against the catalog on top of
   * the tier band (a screenshot judge sets `{ vision: true }` so it lands on a
   * vision-capable model regardless of band). Absent → no extra constraint: the
   * band's cheapest model serves the call, exactly as a tier-only lookup did.
   */
  needs?: ModelNeeds;
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
  /**
   * A free-text corrective injected into a RE-DECIDE after the engine rejected a
   * structurally-invalid decision and is giving the brain exactly one more chance
   * to correct it — canonically a `mustDecompose` root that returned `satisfy`
   * despite the prompt forbidding it. Carries the sharp reason ("your last
   * decision was satisfy; that is invalid for this type — split into typed
   * children NOW") so the second decision is steered, not blind. Distinct from
   * `priorAttempt` (which is a produce/judge Verdict, not a decision correction).
   * Absent → a fresh decide with no correction, exactly as before.
   */
  decideCorrection?: string;
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
 * Thrown by `brain.step` when the model's tool-call output cannot be parsed — its
 * `function.arguments` is not a JSON object — and a single inline corrective
 * re-prompt did not fix it. This is a FORMAT incident, NOT a logical failure: the
 * model tried to act but its output was malformed or truncated (e.g. a large
 * structured emit cut off by the output-token limit). The engine catches this
 * `instanceof` to recover (force a clean emit) rather than counting it toward the
 * `step-loop:failed` isomorphic signature as if it were non-convergence — so a
 * leaf does not die on a malformed first step with nothing produced. Lives in the
 * contract (ADR-002) so the engine identifies it without reaching into the adapter.
 */
export class MalformedStepError extends Error {
  /** True when the provider also signaled output truncation (`finish_reason: 'length'`). */
  readonly truncated: boolean;
  constructor(message: string, truncated = false) {
    super(message);
    this.name = 'MalformedStepError';
    this.truncated = truncated;
  }
}

/**
 * Thrown by `brain.step` when a step's provider request fails as a TRANSPORT
 * incident that survived the adapter's own retries — canonically a request that
 * timed out (the abort fired) MAX_RETRIES times, or a retryable network error that
 * never recovered. This is NOT a logical failure: the leaf's work is fine; the
 * endpoint was unreachable/slow. The engine catches it `instanceof` so a transport
 * incident does not count toward the `step-loop:failed` isomorphic signature as if
 * it were non-convergence (which would terminal-block a leaf on a flaky provider).
 * It gets a distinct `step-loop:transport` signature and is left for the attempt
 * ladder to retry on a (possibly healthier) endpoint. Lives in the contract
 * (ADR-002) so the engine identifies it without reaching into the adapter.
 */
export class StepTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepTransportError';
  }
}

/**
 * Whether a thrown error is a TRANSPORT-class fault: the typed
 * {@link StepTransportError}, an abort/timeout, or a network-layer fetch
 * failure (undici's "terminated" on a destroyed socket, "fetch failed",
 * connection resets). One predicate so every seam that classifies errors
 * (the step loop, the emit paths) agrees — run 21 died because "terminated"
 * matched none of the ad-hoc heuristics and classified as a model failure.
 */
export function isTransportErrorLike(err: unknown): boolean {
  if (err instanceof StepTransportError) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('terminated') ||
    msg.includes('fetch failed') ||
    msg.includes('socket') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('epipe') ||
    msg.includes('network')
  );
}

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
  /**
   * OPTIONAL: distill an evicted read into a terse gist for the working-memory
   * bound (ADR-036). When the engine evicts a raw read to stay under the transcript
   * cap, a summarizing brain replaces the content with this gist (what the file
   * contained and why it mattered to the task) instead of a bare "re-read me" stub —
   * so a build leaf retains orientation without re-reading (run live-self-bcc825bb:
   * blind eviction forced a 170-read / 46-evict / 0-write thrash). Runs on the cheap
   * tier by default. When absent (test brains, or a provider without it), the engine
   * falls back to the blind stub — behavior as before, no test churn.
   */
  summarize?(text: string, ctx: BrainContext): Promise<Metered<string>>;
}
