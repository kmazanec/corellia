import type { Brain } from '../contract/brain.js';
import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { Registry } from '../contract/goal-type.js';
import type { KnowledgeArtifact, RegionFacts } from '../contract/knowledge.js';
import type { MemoryView } from '../contract/memory.js';
import type { PatternStore } from '../contract/pattern.js';
import type { Artifact } from '../contract/report.js';
import type { RiskClass, SensitivityFact } from '../contract/risk.js';
import type { ToolBroker } from '../contract/tool.js';
import type {
  KnowledgeForCoverage,
  MissingRequirement,
} from '../library/coverage.js';
import type { SandboxConfig } from './assembly.js';

export interface EngineOptions {
  registry: Registry;
  brain: Brain;
  store: EventStore;
  /**
   * The shared type/global memory store (ADR-049) — a home for the compounding
   * layers that outlives any one project's log. When present, the promote edge
   * routes `type`/`global` memory writes here instead of the per-project `store`,
   * so a lesson learned in one project can be retrieved in another. When absent,
   * every layer stays in `store` (the pre-ADR-049 single-store behavior).
   */
  sharedStore?: EventStore;
  memory: MemoryView;
  now?: () => number;
  /**
   * When true, every judge-verdict on this engine appends a `golden-candidate`
   * event (ADR-024). Discriminates live runs from scripted tests: false by
   * default (scripted brains never accumulate golden candidates). The live
   * examples set it to true via their EngineOptions.
   */
  goldenCapture?: boolean;
  /**
   * Whether the per-attempt `toolCalls` budget is ENFORCED (block on exhaustion)
   * or WARN-ONLY (keep going, but emit the `budget-exhausted` signal). Defaults
   * to `false` -- warn-only.
   *
   * Rationale (2026-06-12): the eyes-on-cats checkpoint failed 0/5 because a
   * `toolCalls: 20` ceiling exhausts real-repo comprehension before the model
   * can emit, on both mid and high tier -- and we have no runaway-job signal yet
   * that would justify a hard limit. So the counter, the rolling "N tool calls
   * remaining" context message, and the `budget-exhausted` event all stay in
   * place (the signal we need to eventually set a real limit), but exhaustion no
   * longer blocks the run unless an operator opts in by setting this true.
   * Re-arm once a genuine runaway appears in the trace.
   */
  enforceToolCallBudget?: boolean;
  /**
   * Called when a goal blocks. The resolution drives the blocked event.
   * Returning 'answered' means the brief was handled (goal can continue or not
   * depending on caller semantics); other values map to onTimeout defaults.
   */
  onBrief?: (
    brief: import('../contract/decision.js').DecisionBrief,
  ) => Promise<'deny' | 'park' | 'bounce' | 'answered'>;
  /**
   * Sensitivity facts used to classify instance risk. Each SensitivityFact
   * names a path pattern and the risk band touching it carries. Omit to use the
   * built-in DEFAULT_SENSITIVITY. Pass an explicit array, including [], to
   * replace the defaults.
   */
  sensitivity?: SensitivityFact[];
  /**
   * Called when the authority gate fires -- the goal's type is gated or its
   * instance risk is high. Must return 'granted' or 'denied'. When absent the
   * gate defaults to 'denied': an act whose consequences outrun any eval cannot
   * proceed without an authority that can underwrite it.
   */
  onGate?: (goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>;
  /**
   * The split-memo pattern store. When present the DECIDE path consults it
   * before deriving a fresh decomposition, and records the outcome after the
   * subtree completes. When absent the flywheel is inactive and the engine
   * derives every split from scratch.
   */
  patterns?: PatternStore;
  /**
   * The tool broker that mediates every tool call for tool-granted goal types.
   * When present and the goal type declares at least one grant that maps to a
   * known tool, the engine runs the step loop instead of the classic produce
   * path. When absent the classic produce path always runs.
   */
  broker?: ToolBroker;
  /**
   * Optional sandbox/assembly configuration (ADR-016). When present the tree
   * ROOT opens a git worktree against `repoRoot`, constructs ONE broker bound
   * to that worktree (core file tools + run_script over the declared scripts),
   * uses it for the whole tree, feeds executing deterministic checks their
   * CheckContext, enforces diff <= scope at the root's emission, and collects
   * (success) or preserves (failure/block) the worktree at tree end. When
   * absent, behavior is byte-identical to a plain run.
   */
  sandbox?: SandboxConfig;
  /**
   * Optional knowledge wiring (ADR-021/ADR-019). When present, the split gate
   * runs a mechanical coverage check before any split is executed. On misses,
   * comprehension ChildPlans are minted and injected as dependencies of every
   * existing child so the ordinary dependency scheduler sequences them first.
   * On pass, a gate-checked {ok:true} event is emitted with no extra brain
   * calls (the check is purely mechanical). At the split checkpoint, consumed
   * artifacts are verified for SHA drift; a drifted artifact that fails
   * self-validation spawns a refresh child as a dependency.
   *
   * CHECKPOINT STATUS: only the split checkpoint (verify-on-read before fan-out)
   * is currently wired. The decide checkpoint and the integrate checkpoint are
   * deferred -- they do not fire in this implementation.
   *
   * SANDBOX REQUIREMENT: the gate is skipped when no sandbox is active (repoRoot
   * would be ''); knowledge wiring requires a sandbox.
   *
   * When absent, behavior is byte-identical to a run without this option --
   * zero new events, no new brain calls (regression guard).
   *
   * The wiring object is structurally typed so assembly supplies the real
   * implementations while tests inject synthetic stubs.
   */
  knowledge?: EngineKnowledge;
}

export interface EngineKnowledge {
  /**
   * Query the latest knowledge artifacts for a repo and its region facts, plus
   * the current HEAD SHA. Returns the KnowledgeForCoverage shape consumed by
   * coverageCheck. Assembly wires the real projectKnowledge projection + git
   * HEAD; tests inject stubs.
   */
  query: (repoRoot: string) => Promise<KnowledgeForCoverage>;
  /**
   * Return the current HEAD SHA for the given repoRoot. Used at
   * decide/split/integrate checkpoints to detect SHA drift. May be the same
   * implementation as query().headSha, but exposed separately so the engine
   * can call it cheaply at each checkpoint without re-querying artifacts.
   */
  headSha: (repoRoot: string) => Promise<string>;
  /**
   * Self-validate a knowledge artifact -- the ADR-019 "cheap self-validation"
   * step. Returns true if the artifact is still trustworthy despite a SHA
   * mismatch; false if a refresh is needed. Async because spot queries (anchor
   * existence, scaffold-runs-green) may touch the filesystem.
   */
  validate: (artifact: KnowledgeArtifact) => Promise<boolean>;
  /**
   * Mint the comprehension ChildPlans the engine should spawn to fill a set
   * of missing requirements. Returns one or more ChildPlans (typically a
   * map-repo child for category misses, a deep-dive-region child per missing
   * region). The engine injects these as dependencies of every existing child
   * and does NOT call the brain for them.
   */
  mintComprehension: (missing: MissingRequirement[]) => ChildPlan[];
  /**
   * Persist a learn-type leaf's artifact after it passes its deterministic
   * gate, per emission convention: map-repo emits a KnowledgeArtifact
   * as JSON in artifact.text, deep-dive-region emits a RegionFacts. The engine
   * calls this exactly once, at each leaf-success emission site, AFTER the gate
   * verdict passes -- the assembly parses artifact.text and appends the
   * knowledge-written / knowledge-facts-written event via helpers. A
   * non-learn goal, a malformed artifact, or a missing hook is a no-op.
   *
   * Optional: tests that do not exercise persistence omit it. When absent, a
   * passing learn leaf emits exactly as before (no knowledge event appended).
   */
  persist?: (goal: Goal, artifact: Artifact) => Promise<void>;
  /**
   * The dive->build knowledge handoff (ADR-040). Return the FULL RegionFacts a
   * deep-dive-region produced for any region overlapping `scope` -- the actual
   * anchored claims, not the existence-only `CoverageRegionFact` that `query`
   * returns for the coverage gate. The spawner adapts these into MemoryPointers
   * and injects them into a dependent builder, so a leaf that changes a region
   * starts WITH the comprehension a dependency dive already produced, instead of
   * re-reading the region from scratch (run live-self-4793fc14: a builder read 147
   * files the dives had already understood because nothing fed their facts forward
   * -- DESIGN.md "findings injected by the spawner like any other memory").
   * Optional: when absent, no dive facts are injected (behavior as before).
   */
  factsForRegions?: (repoRoot: string, scope: string[]) => Promise<RegionFacts[]>;
  /**
   * Does a scope region correspond to EXISTING code in the working tree?
   * The coverage gate's relevance signal (ADR-029 Decision 2): a region that
   * does not yet exist has nothing to comprehend, so it pulls neither a
   * whole-repo map (greenfield root split) nor a deep-dive (a child creating a
   * fresh region). Assembly wires the real existsSync-backed check; tests
   * inject deterministic existence. When absent, the gate treats every region
   * as existing (the legacy pre-existence-signal behavior).
   */
  regionExists?: (repoRoot: string, region: string) => boolean;
}
