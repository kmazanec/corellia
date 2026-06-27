/**
 * The recursive engine — the single operation that is the factory.
 * receive → decide → (satisfy | split | block) → integrate → emit
 *
 * The DECIDE path integrates the structure flywheel: before deriving a fresh
 * decomposition for a non-leaf goal, the engine consults the pattern store for
 * a memoized split that matches the goal's structural shape. A trusted memo is
 * walked verbatim (no brain call); a provisional memo is passed as a hint; no
 * memo for a novel shape may trigger a terraced scan — k lens-diverse candidates
 * ranked by judge-split — when the goal-type declares scan.k > 1. After the
 * subtree completes, the engine records the outcome against the shape so the
 * flywheel accumulates evidence autonomously. Promotion to trusted is a
 * human-signoff step the engine never performs.
 */

import type { Goal, Tier, Budget, Usage } from '../contract/goal.js';
import type { Decision, ChildPlan } from '../contract/decision.js';
import type { Artifact, Report } from '../contract/report.js';
import type { Verdict, Finding } from '../contract/verdict.js';
import type { EventStore } from '../contract/events.js';
import type { Brain, BrainContext, StepTranscript } from '../contract/brain.js';
import { MalformedStepError, StepTransportError } from '../contract/brain.js';
import type { Registry, GoalTypeDef } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { RiskClass, SensitivityFact } from '../contract/risk.js';
import type { PatternStore } from '../contract/pattern.js';
import type { ToolBroker, ToolDef } from '../contract/tool.js';
import { debitAttempt, debitTokenCount, debitTokenUsage } from './budget-events.js';
import { lintLibrary } from '../library/constitution.js';
import { loadFamilySkill } from '../library/skills.js';
import { classifyRisk } from '../library/risk.js';
import { specShape } from '../flywheel/shape.js';
import type { CheckContext } from '../contract/goal-type.js';
import {
  openSandboxAssembly,
  openLearnAssembly,
  type SandboxConfig,
  type SandboxAssembly,
} from './assembly.js';
import { diffWithinScope, collectTree, preserveTree, commitRound, diffBodiesWithinScope, treeChangedWithinScope } from './worktree.js';
import { createIterationRecord, deleteProvenanceIssue } from './iteration-tools.js';
import {
  newScratchpad,
} from './scratchpad.js';
import {
  parseAcceptanceCriteria,
  criterionToCheck,
  type AcceptanceCriterion,
} from '../library/acceptance-criteria.js';
import type { KnowledgeArtifact, RegionFacts } from '../contract/knowledge.js';
import {
  coverageCheck,
  type KnowledgeForCoverage,
  type MissingRequirement,
} from '../library/coverage.js';
import { validateSplit } from './split-validation.js';
import {
  isExploreThenEmitLeaf,
} from './step-loop-guards.js';
import { buildStepLoopInitialTranscript } from './step-loop-context.js';
import { runForcedEmit, runStructuredArtifactEmit } from './step-loop-emit.js';
import { routeStepToolCalls } from './step-loop-router.js';
import { boundStepLoopTranscript, evictTranscriptAfterTruncation } from './step-loop-transcript.js';
import { NOTE_TOOL_DEF, deriveToolDefs, isToolGranted } from './step-loop-tools.js';
import {
  stepLoopFailureArtifact,
  stepLoopFailureVerdict,
  stepLoopTranscriptFinding,
  type StepLoopResult,
} from './step-loop-result.js';
import {
  blockedReport,
  exhaustedBrief,
  unknownTypeBrief,
} from './reports.js';
import {
  DEFAULT_SPEND_CEILING_USD,
  WORST_CASE_PRICE_PER_TOKEN,
  createTreeState,
  debitTreeState,
  hasReachedSpendCeiling,
  type TreeState,
} from './tree-spend.js';
import { repoShapeHint as buildRepoShapeHint } from './repo-shape-hint.js';
import {
  filterMissingCoveredByRefresh,
  gateMissingLabels,
  injectCoverageChildren,
} from './coverage-gate.js';
import { checkpointVerifyArtifacts } from './coverage-checkpoint.js';
import { appendGoldenCandidate, enrichRubric } from './judge-support.js';
import { runAuthorityGate } from './authority-gate.js';
import { runDeterministicGate } from './deterministic-gate.js';
import { judgeLeafArtifact } from './leaf-judge.js';
import {
  rejectedSplitSatisfyReport,
  runMustDecomposeGuard,
} from './decision/must-decompose-guard.js';
import {
  buildDecisionContext,
  memoStatus as deriveMemoStatus,
  shouldRunTerracedScan,
} from './decision/context.js';
import { produceClassicArtifact } from './attempt/classic-produce.js';
import { checkEmissionAuthority } from './attempt/emission-authority.js';
import { resolveAttemptFailure } from './attempt/failure.js';
import { runLeafTournament } from './attempt/leaf-tournament.js';
import { recheckArtifactAfterRepair } from './attempt/recheck.js';
import { emitSuccessfulArtifact } from './attempt/success.js';
import {
  invalidSplitStructureVerdict,
  isomorphicSplitFailure,
  judgeSplitDecision,
  splitPlanArtifact,
} from './decision/split-eval.js';
import { runTerracedScan } from './decision/terraced-scan.js';
import {
  appendChildSpawnedEvents,
  buildSplitChildGoals,
  runSplitChildren,
} from './split-children.js';
import {
  buildSplitRoundReport,
  childOutcomes,
  promoteChildReports,
} from './split-report.js';
import {
  judgeSplitIntegration,
  mergeComprehendChildArtifacts,
  mergeGenericChildArtifacts,
} from './split-integration.js';

export { WORST_CASE_PRICE_PER_TOKEN };

export interface EngineOptions {
  registry: Registry;
  brain: Brain;
  store: EventStore;
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
   * to `false` — warn-only.
   *
   * Rationale (2026-06-12): the eyes-on-cats checkpoint failed 0/5 because a
   * `toolCalls: 20` ceiling exhausts real-repo comprehension before the model
   * can emit, on both mid and high tier — and we have no runaway-job signal yet
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
   * Project-specific sensitivity facts used to classify instance risk. Each
   * SensitivityFact names a path pattern and the risk band touching it carries.
   * Defaults to [] (no project-specific sensitivity; combine with
   * DEFAULT_SENSITIVITY if desired).
   */
  sensitivity?: SensitivityFact[];
  /**
   * Called when the authority gate fires — the goal's type is gated or its
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
   * CheckContext, enforces diff ⊆ scope at the root's emission, and collects
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
   * deferred — they do not fire in this implementation.
   *
   * SANDBOX REQUIREMENT: the gate is skipped when no sandbox is active (repoRoot
   * would be ''); knowledge wiring requires a sandbox.
   *
   * When absent, behavior is byte-identical to a run without this option —
   * zero new events, no new brain calls (regression guard).
   *
   * The wiring object is structurally typed so assembly supplies the real
   * implementations while tests inject synthetic stubs.
   */
  knowledge?: {
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
     * Self-validate a knowledge artifact — the ADR-019 "cheap self-validation"
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
     * verdict passes — the assembly parses artifact.text and appends the
     * knowledge-written / knowledge-facts-written event via helpers. A
     * non-learn goal, a malformed artifact, or a missing hook is a no-op.
     *
     * Optional: tests that do not exercise persistence omit it. When absent, a
     * passing learn leaf emits exactly as before (no knowledge event appended).
     */
    persist?: (goal: Goal, artifact: Artifact) => Promise<void>;
    /**
     * The dive→build knowledge handoff (ADR-040). Return the FULL RegionFacts a
     * deep-dive-region produced for any region overlapping `scope` — the actual
     * anchored claims, not the existence-only `CoverageRegionFact` that `query`
     * returns for the coverage gate. The spawner adapts these into MemoryPointers
     * and injects them into a dependent builder, so a leaf that changes a region
     * starts WITH the comprehension a dependency dive already produced, instead of
     * re-reading the region from scratch (run live-self-4793fc14: a builder read 147
     * files the dives had already understood because nothing fed their facts forward
     * — DESIGN.md "findings injected by the spawner like any other memory").
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
  };
}

export class Engine {
  private readonly registry: Registry;
  private readonly brain: Brain;
  private readonly store: EventStore;
  private readonly memory: MemoryView;
  private readonly now: () => number;
  private readonly goldenCapture: boolean;
  private readonly enforceToolCallBudget: boolean;
  private readonly onBrief:
    | ((
        brief: import('../contract/decision.js').DecisionBrief,
      ) => Promise<'deny' | 'park' | 'bounce' | 'answered'>)
    | undefined;
  private readonly sensitivity: SensitivityFact[];
  private readonly onGate:
    | ((goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>)
    | undefined;
  private readonly patterns: PatternStore | undefined;
  private readonly broker: ToolBroker | undefined;
  private readonly sandbox: SandboxConfig | undefined;
  private readonly knowledge: EngineOptions['knowledge'];

  /**
   * The composed sandbox assembly for the in-flight tree, set by run() at the
   * root when a SandboxConfig is present and cleared in the finally. While set,
   * it supplies the tree-scoped broker (overriding EngineOptions.broker) and the
   * per-goal CheckContext factory; absent, the engine uses the plain broker.
   *
   * Why single-tree-per-instance: Engine.run() is single-tree-per-instance —
   * concurrent root runs on the same Engine instance are NOT supported. Each
   * concurrent tree must use its own Engine instance. This field is set once at
   * the root and cleared in the finally; a second concurrent run() call would
   * silently clobber it and corrupt the broker/CheckContext of the first tree.
   */
  private _activeAssembly: SandboxAssembly | undefined = undefined;

  /** The broker the step loop should use: the assembly's beats the plain option. */
  private get effectiveBroker(): ToolBroker | undefined {
    return this._activeAssembly?.broker ?? this.broker;
  }

  /**
   * The CheckContext an executing deterministic check receives for `goalId`.
   * Undefined when no sandbox is active — artifact-only checks ignore it and a
   * runScriptCheck fails safe with "no exec context" exactly as before.
   */
  private checkContextFor(goalId: string): CheckContext | undefined {
    return this._activeAssembly?.checkContextFor(goalId);
  }

  /**
   * Per-run brief handler override. When set (typically by the Listener), it
   * takes precedence over the constructor-level onBrief for the duration of
   * the run and all recursive child runs under the same tree. Reset to
   * undefined by the Listener after engine.run() returns.
   *
   * This is the single seam the Listener uses to become the park authority
   * without requiring a new Engine instance per intent.
   */
  private _activeOnBrief:
    | ((
        brief: import('../contract/decision.js').DecisionBrief,
      ) => Promise<'deny' | 'park' | 'bounce' | 'answered'>)
    | undefined = undefined;

  /**
   * Register a per-run brief handler that overrides the constructor-level one.
   * Called by the Listener before engine.run() and cleared after. Not part of
   * the public API contract — callers outside the Listener should use onBrief
   * at construction time.
   */
  _setActiveOnBrief(
    handler:
      | ((
          brief: import('../contract/decision.js').DecisionBrief,
        ) => Promise<'deny' | 'park' | 'bounce' | 'answered'>)
      | undefined,
  ): void {
    this._activeOnBrief = handler;
  }

  /** Resolve the effective brief handler: per-run override beats constructor-level. */
  private get effectiveOnBrief() {
    return this._activeOnBrief ?? this.onBrief;
  }

  constructor(opts: EngineOptions) {
    // CONSTITUTION AT THE BOUNDARY: an engine cannot be constructed over an
    // unconstitutional library — violations are caught here, not at runtime.
    // Structural checks only: skill-file coverage is enforced by the npm test
    // chain (npm run lint, which runs scripts/lint-library.ts with defaults), not
    // at runtime. Synthetic test types with stub families would fail the skill
    // check needlessly.
    const defs = opts.registry.names().map((n) => opts.registry.get(n));
    const violations = lintLibrary(defs, { checkSkills: false });
    if (violations.length > 0) {
      throw new Error(
        `Library fails constitution check:\n${violations.map((v) => `  • ${v}`).join('\n')}`,
      );
    }

    this.registry = opts.registry;
    this.brain = opts.brain;
    this.store = opts.store;
    this.memory = opts.memory;
    this.now = opts.now ?? (() => Date.now());
    this.goldenCapture = opts.goldenCapture ?? false;
    this.enforceToolCallBudget = opts.enforceToolCallBudget ?? false;
    this.onBrief = opts.onBrief;
    this.sensitivity = opts.sensitivity ?? [];
    this.onGate = opts.onGate;
    this.patterns = opts.patterns;
    this.broker = opts.broker;
    this.sandbox = opts.sandbox;
    this.knowledge = opts.knowledge;
  }

  async run(goal: Goal): Promise<Report> {
    const ceilingUsd = goal.spendCeilingUsd ?? DEFAULT_SPEND_CEILING_USD;
    const treeState = createTreeState(ceilingUsd);

    // No sandbox configured → byte-identical to a plain run: no worktree, no
    // assembly, no new events.
    if (this.sandbox === undefined) {
      return this._run(goal, treeState);
    }

    // Learn-kind ROOT path (F-65 A12): a root learn goal whose grants carry no
    // script-execution capability (no test.run_scoped / test.run_impacted) opens
    // NO worktree. The broker carries read-only tools only (write_file absent);
    // the finally skips collect/preserve entirely since there is no worktree to
    // tear down. The `report === undefined` guard ensures a partially-opened
    // assembly is not left dangling on an error mid-run.
    //
    // Script-granting learn goals still use the full sandbox path: running a
    // declared test script requires an isolated worktree so repo state is not
    // disturbed by concurrent runs or mid-run failures.
    const SCRIPT_GRANTS = new Set(['test.run_scoped', 'test.run_impacted']);
    const isLearnRootWithoutScripts =
      goal.parentId === null &&
      this.registry.has(goal.type) &&
      this.registry.get(goal.type).kind === 'learn' &&
      !this.registry.get(goal.type).grants.some((g) => SCRIPT_GRANTS.has(g));
    if (isLearnRootWithoutScripts) {
      const learnAssembly = openLearnAssembly(
        this.sandbox,
        goal.id,
        this.registry,
        this.store,
      );
      this._activeAssembly = learnAssembly;
      let report: Report | undefined;
      try {
        report = await this._run(goal, treeState);
        return report;
      } finally {
        // No worktree → skip collect/preserve. The report === undefined guard
        // ensures the caller sees the thrown error rather than a stale assembly.
        this._activeAssembly = undefined;
      }
    }

    // Sandboxed tree (ADR-016): only the ROOT opens the worktree and constructs
    // the one broker the whole tree shares. The assembly is torn down — collect
    // on success, preserve on failure/block — in the finally, always exactly one.
    const assembly = await openSandboxAssembly(
      this.sandbox,
      goal.id,
      this.registry,
      this.store,
      this.now,
    );
    this._activeAssembly = assembly;
    let report: Report | undefined;
    try {
      report = await this._run(goal, treeState);

      // ── EMISSION diff ⊆ scope (tree-level) ──────────────────────────
      // The worktree is shared by the whole tree, so a per-leaf diff check would
      // see siblings' work. The sound v1 enforcement is at the TREE ROOT's
      // emission against the ROOT goal's scope: the worktree's total diff must
      // fall within the root goal's declared scope. (Per-leaf scope stays
      // enforced by the broker's write_file check and the filesWithinScope
      // deterministic check on each leaf's artifact.) A violation downgrades a
      // would-be success to a scope-insufficiency block and preserves the tree.
      if (report.blockers.length === 0) {
        const diff = diffWithinScope(assembly.worktree.root, goal.scope);
        // HOLLOW-EMIT GATE: a make-kind root that "succeeds" but changed NO files
        // within scope did not actually deliver — every slice emitted plausible
        // text (or tried to open a PR) without writing the product. The integration
        // judge reads artifact TEXT and can be fooled; this is the deterministic
        // ground truth (build run live-self-a2397f0f: slice A did 0 write_file,
        // only open_pr, and the tree would otherwise have claimed success). Scoped
        // to make goals: a learn root (comprehension) legitimately produces
        // knowledge artifacts, not worktree files. Skips when no sandbox/worktree.
        const rootKind = this.registry.has(goal.type) ? this.registry.get(goal.type).kind : undefined;
        const changedSinceBase = treeChangedWithinScope(
          assembly.worktree.root, assembly.worktree.baseSha, goal.scope,
        );
        // A make delivery is real if EITHER the worktree changed since base (the
        // step-loop write_file path + committed milestone rounds) OR the final
        // report carries a non-empty files artifact (the deliver-via-files-artifact
        // path, which the collect step materializes). Only when BOTH are empty is
        // it a hollow emit — a success claim with no product anywhere.
        const artifactHasFiles =
          report.artifact?.kind === 'files' && (report.artifact.files?.length ?? 0) > 0;
        if (diff.ok && rootKind === 'make' && changedSinceBase === 0 && !artifactHasFiles) {
          const reason =
            `Hollow emit: "${goal.type}" reported success but produced NO change within ` +
            `scope (${goal.scope.join(', ') || '(none)'}). A make goal must deliver a real ` +
            `worktree change or a files artifact — its children emitted text/PR calls ` +
            `without writing the product.`;
          report = blockedReport(reason);
          await this.store.append({
            type: 'blocked',
            at: this.now(),
            goalId: goal.id,
            brief: {
              question: reason,
              options: ['deny', 'park', 'bounce'],
              links: [goal.id],
              deadlineMs: 0,
              onTimeout: 'deny',
            },
            resolution: 'deny',
          });
        } else if (!diff.ok) {
          // Downgrade: _run already emitted a 'emitted' success event. Rather than
          // appending a second contradictory 'emitted', replace the in-flight report
          // with the scope-insufficiency block and let the finally/preserve path handle
          // it. The existing 'emitted' success from _run is superseded — the store
          // carries the full history and the returned report is the authoritative one.
          report = blockedReport(
            `Scope insufficiency at tree emission: ${diff.scopeInsufficiency ?? 'diff exceeds declared scope'}`,
          );
          // Append a 'blocked' event (not a second 'emitted') to represent the
          // scope-downgrade so the event log is honest without two 'emitted' entries.
          await this.store.append({
            type: 'blocked',
            at: this.now(),
            goalId: goal.id,
            brief: {
              question: `Scope insufficiency at tree emission: ${diff.scopeInsufficiency ?? 'diff exceeds declared scope'}`,
              options: ['deny', 'park', 'bounce'],
              links: [goal.id],
              deadlineMs: 0,
              onTimeout: 'deny',
            },
            resolution: 'deny',
          });
        }
      }
      return report;
    } finally {
      const failedOrBlocked =
        report === undefined || report.blockers.length > 0;
      if (failedOrBlocked) {
        const reason =
          report === undefined
            ? 'tree threw before producing a report'
            : `tree blocked: ${report.blockers[0] ?? 'unknown'}`;
        await preserveTree(assembly.worktree, this.store, reason);
      } else {
        // ── Deliver-intent lifecycle integration (ADR-034) ──────────────────
        // On successful delivery, the engine itself (not a child goal) performs
        // two deterministic integration steps at the assembly-emit success
        // boundary, BEFORE collectTree so their writes join the delivered diff:
        //   1. create the iteration record (+ index row + log line),
        //   2. delete the originating issue the delivery resolves (if its spec
        //      carries a `// from docs/issues/<slug>.md` provenance annotation).
        // Both are no-ops on a blocked/partial delivery (this is the success
        // branch) and sit alongside the existing PR-emission mechanics. Gated to
        // the `deliver-intent` root: only a delivered intent earns an iteration
        // record + issue retirement (ADR-034); other sandboxed roots (e.g.
        // improve-factory) collect their tree without these lifecycle writes.
        // Wrapped so a lifecycle-bookkeeping failure can never undo a delivery
        // that already succeeded: the delivery stands; the bookkeeping is best-effort.
        if (goal.type === 'deliver-intent') {
          try {
            createIterationRecord(assembly.worktree.root, goal, this.now);
            deleteProvenanceIssue(assembly.worktree.root, goal);
          } catch (err) {
            // The delivery succeeded; a record/issue bookkeeping failure must not
            // fail it or fabricate a block. Surface for the operator, then proceed.
            console.warn(
              `[corellia] deliver-intent lifecycle integration (ADR-034) failed post-success for ${goal.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        await collectTree(assembly.worktree, this.store);
      }
      this._activeAssembly = undefined;
    }
  }

  private async _run(goal: Goal, treeState: TreeState): Promise<Report> {
    const t = this.now;
    const deadline = t() + goal.budget.wallClockMs;

    // ── RECEIVE ────────────────────────────────────────────────────────────
    await this.store.append({ type: 'goal-received', at: t(), goalId: goal.id, goal });

    // early ceiling gate — if the tree is already over ceiling (prior
    // siblings consumed it), halt before making any brain call. Guard: only emit
    // 'ceiling-reached' once per tree; if it was already emitted by a sibling
    // the treeState is already over ceiling and this child returns the same report
    // shape without a second event.
    if (hasReachedSpendCeiling(treeState)) {
      return this.ceilingReport(goal, treeState);
    }

    // Unknown type → block immediately (no throw)
    if (!this.registry.has(goal.type)) {
      const brief = unknownTypeBrief(goal);
      const resolution = this.effectiveOnBrief
        ? await this.effectiveOnBrief(brief)
        : brief.onTimeout;
      await this.store.append({
        type: 'blocked',
        at: t(),
        goalId: goal.id,
        brief,
        resolution,
      });
      const report = blockedReport(`Unknown goal type: ${goal.type}`);
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return report;
    }

    const typeDef = this.registry.get(goal.type);
    const tierLadder = typeDef.tier.ladder;
    let currentTierIndex = 0;
    let currentTier: Tier = typeDef.tier.default;

    // ── INSTANCE RISK AT ENTRY ─────────────────────────────────────────────
    // Classify scope against sensitivity facts before spending any subtree.
    // Medium is recorded but not gated (prototype policy — instance evidence
    // may accumulate to justify automatic medium gating in a future version).
    const entryRisk = classifyRisk(goal.scope, this.sensitivity);
    await this.store.append({ type: 'risk-classified', at: t(), goalId: goal.id, risk: entryRisk });

    // AUTHORITY GATE: fires when the type carries a type-level authority grant
    // requirement (gated: true) OR when instance risk is high. An act whose
    // consequences outrun any eval must route through a human before the tree
    // opens — fail-safe: no handler means denied.
    const authorityReport = await runAuthorityGate({
      shouldGate: typeDef.gated === true || entryRisk === 'high',
      goal,
      risk: entryRisk,
      typeGated: typeDef.gated === true,
      store: this.store,
      now: t,
      onGate: this.onGate,
      onBrief: this.effectiveOnBrief,
      deniedMessage: (brief) => `Authority gate denied: ${brief.question}`,
    });
    if (authorityReport !== null) return authorityReport;

    // ── DECIDE ─────────────────────────────────────────────────────────────
    // leafOnly types go straight to the attempt loop; non-leaf types decide.
    // Non-leaf types consult the pattern store first: a trusted memo is walked
    // verbatim; a provisional memo is passed as a hint to the brain; for a
    // novel shape with scan.k > 1, a terraced scan generates k lens-diverse
    // candidates and judge-split ranks them before committing.
    let decision: Decision;
    // Findings from losing terraced-scan candidates; threaded into the split report.
    let terracedLoserFindings: string[] = [];
    // Usage from the decide call that set the final decision (for the decided event).
    let decideUsage: Usage | undefined;

    if (typeDef.leafOnly) {
      decision = { kind: 'satisfy' };
    } else {
      const shape = specShape(goal);

      // ── PATTERN STORE CONSULTATION ─────────────────────────────────────
      const memo = this.patterns ? await this.patterns.match(shape) : null;
      const memoStatus = deriveMemoStatus(memo);

      await this.store.append({
        type: 'pattern-consulted',
        at: t(),
        goalId: goal.id,
        shape,
        status: memoStatus,
      });

      if (memoStatus === 'trusted' && memo !== null) {
        // TRUSTED MEMO — walk verbatim, skip fresh derivation. The brain is
        // never consulted for the decision itself: the structure was already
        // underwritten by a human signoff. The split eval and all downstream
        // evals still run — trust skips derivation, never judgment.
        decision = memo.decision;
      } else {
        // Build the base BrainContext, carrying the provisional memo as a hint
        // when one exists (the brain weighs it, never obeys it). Inject the family
        // skill so the brain decides satisfy-vs-split WITH the craft guidance it
        // already gets at produce/judge time — without it the decide call is blind
        // (e.g. comprehension over-splits: a map-repo splitting needlessly).
        const decideSkill = this.decideSkillBlock(goal.type);
        const repoShape = this.repoShapeHint(goal);
        const baseCtx = buildDecisionContext({
          goal,
          typeDef,
          tier: currentTier,
          memo,
          skill: decideSkill,
          repoShape,
        });

        const scan = typeDef.scan;
        if (scan !== undefined && shouldRunTerracedScan({
          scan,
          memoStatus,
          hasJudgeSplit: this.registry.has('judge-split'),
        })) {
          // ── TERRACED SCAN — novel shape, k > 1 ────────────────────────
          // Generate k lens-diverse candidates and rank them with judge-split.
          // The winning candidate (first pass, tie-broken by fewest findings)
          // becomes the decision; losers are collected as low-severity findings
          // ("alternatives considered") and surfaced in the split report.
          const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
          const scanResult = await runTerracedScan({
            goal,
            k: scan.k,
            lenses: scan.lenses,
            baseCtx,
            tier: currentTier,
            brain: this.brain,
            registry: this.registry,
            store: this.store,
            now: t,
            goldenCapture: this.goldenCapture,
            ...(brainConfig !== undefined ? { brainConfig } : {}),
            debitUsage: (usage) => debitTreeState(treeState, usage),
            hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
          });
          if ('ceiling' in scanResult) {
            return this.ceilingReport(goal, treeState);
          }
          decision = scanResult.decision;
          terracedLoserFindings = scanResult.loserFindings;
          decideUsage = scanResult.winnerUsage;
        } else {
          // Normal single-derive path: no memo, or scan not warranted.
          const decideResult = await this.brain.decide(goal, baseCtx);
          decision = decideResult.value;
          decideUsage = decideResult.usage;
          debitTreeState(treeState, decideResult.usage);
          if (hasReachedSpendCeiling(treeState)) {
            await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision, usage: decideResult.usage });
            return this.ceilingReport(goal, treeState);
          }
        }
      }
    }

    // Backstop: a comprehend-family goal that DECIDES to block here is blocking
    // before running a single tool (this top-level decide precedes the attempt
    // loop) — blocking-without-effort, almost always a misread (e.g. it tried an
    // absolute path, got refused, and concluded the repo is unreachable; traced on
    // AC-3 run #1). A comprehension goal cannot legitimately know it is blocked
    // until it has actually probed the sandbox. Coerce the block into a satisfy so
    // the goal MUST try its tools; a genuine blocker can still surface from the
    // attempt loop after real probing. Scoped to the comprehend family (the
    // discovery family) so deliver/build blocks are untouched.
    if (decision.kind === 'block' && typeDef.family === 'comprehend') {
      await this.store.append({
        type: 'decided',
        at: t(),
        goalId: goal.id,
        decision,
        ...(decideUsage !== undefined ? { usage: decideUsage } : {}),
      });
      decision = { kind: 'satisfy' };
    }

    // ── CANNOT-SATISFY GUARD (with one corrective re-decide) ───────────────
    // A `mustDecompose` type (canonically the deliver-intent root) has no
    // producing tool and CANNOT satisfy — its only legitimate decisions are split
    // or block. The decide prompt already omits the satisfy shape and forbids it
    // (`mustDecompose` ctx). But the brain can still return satisfy in defiance
    // (observed live-self-2e2ece33: a fresh first decision came back `satisfy` in
    // 8 completion tokens despite the instruction). A terminal block on that single
    // slip dead-ends the whole intent with no recovery, even though the model
    // plainly did not deliberate. So RE-DECIDE ONCE with a sharp correction; only a
    // REPEATED satisfy (the model had its chance and refused) terminal-blocks. A
    // corrected split/block then flows through the normal SPLIT EVAL + dispatch
    // below, so this must run BEFORE the split-eval. The invariant is declared on
    // the type (`mustDecompose`), not inferred from grants — "capability is the
    // type" (GOAL-TYPES.md) — so it stays lintable.
    // (See docs/issues/mustdecompose-satisfy-terminal-block.md.)
    const mustDecompose = await runMustDecomposeGuard({
      enabled: typeDef.mustDecompose === true,
      goal,
      decision,
      decideUsage,
      tier: currentTier,
      skill: this.decideSkillBlock(goal.type),
      repoShape: this.repoShapeHint(goal),
      brain: this.brain,
      store: this.store,
      now: t,
      debitUsage: (usage) => debitTreeState(treeState, usage),
      hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
    });
    if (mustDecompose.kind === 'ceiling') {
      return this.ceilingReport(goal, treeState);
    }
    if (mustDecompose.kind === 'blocked') {
      return mustDecompose.report;
    }
    if (mustDecompose.kind === 'adopted') {
      // The corrected decision is a split or block — adopt it and fall through to
      // the normal SPLIT EVAL + dispatch path (which records the `decided` event).
      decision = mustDecompose.decision;
      decideUsage = mustDecompose.decideUsage;
    }

    // The shape is captured for the post-subtree record call.
    const goalShape = typeDef.leafOnly ? null : specShape(goal);

    // ── SPLIT EVAL (before committing to a split) ──────────────────────────
    // When the decision is a split, validate it and optionally judge it.
    if (decision.kind === 'split') {
      // leafOnly types must never split
      if (typeDef.leafOnly) {
        const report = blockedReport(
          `Type "${goal.type}" is leafOnly but brain returned a split decision`,
        );
        await this.store.append({
          type: 'decided',
          at: t(),
          goalId: goal.id,
          decision,
        });
        await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
        return report;
      }

      // Validate structural constraints on the split
      let budget = goal.budget;
      let priorVerdict: Verdict | undefined;

      while (true) {
        const structErr = validateSplit(decision.children, (tp) => (this.registry.has(tp) ? this.registry.get(tp) : undefined));
        if (structErr) {
          // Structural violation of the split → fail verdict, re-decide with
          // priorAttempt carrying the rejection
          budget = await debitAttempt({ budget, goal, store: this.store, now: t });
          const failVerdict = invalidSplitStructureVerdict(structErr);

          // Isomorphic failure check: the same structural violation twice in a
          // row is non-convergence, not budget exhaustion — that is the real
          // terminator here (ADR-033). The attempts counter never terminates.
          if (isomorphicSplitFailure(priorVerdict, failVerdict)) {
            const report = blockedReport(
              `Isomorphic split structural failure (signature: ${failVerdict.failureSignature})`,
            );
            await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
            return report;
          }
          priorVerdict = failVerdict;

          // Re-decide with failure context
          const reDecideCtx: BrainContext = {
            tier: currentTier,
            memories: goal.memories,
            priorAttempt: { artifact: splitPlanArtifact(decision.children), verdict: failVerdict },
          };
          const reDecideResult = await this.brain.decide(goal, reDecideCtx);
          decision = reDecideResult.value;
          decideUsage = reDecideResult.usage;
          debitTreeState(treeState, reDecideResult.usage);
          if (hasReachedSpendCeiling(treeState)) {
            await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision, usage: reDecideResult.usage });
            return this.ceilingReport(goal, treeState);
          }
          if (decision.kind !== 'split') {
            // The re-decide changed its mind away from split. For a `mustDecompose`
            // type a `satisfy` is STILL invalid (it has no producing tool) — and
            // breaking here would dispatch it to the attempt loop, BYPASSING the
            // cannot-satisfy guard that runs only once before the split-eval. Block
            // honestly instead: the model had the split-rejection feedback and still
            // would not produce a valid split (surfaced live-self-c9329860, where a
            // requiresScope rejection forced a re-decide that returned satisfy and
            // ran the deliver-intent root as a leaf).
            if (decision.kind === 'satisfy' && typeDef.mustDecompose) {
              const report = rejectedSplitSatisfyReport(goal);
              await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision, ...(decideUsage !== undefined ? { usage: decideUsage } : {}) });
              await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
              return report;
            }
            break; // changed its mind (block, or satisfy for a non-mustDecompose type)
          }
          continue;
        }

        // Structure is valid. If there is a judge-split type, judge the split.
        if (this.registry.has('judge-split')) {
          const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
          const splitJudgeResult = await judgeSplitDecision({
            goal,
            children: decision.children,
            tier: currentTier,
            registry: this.registry,
            brain: this.brain,
            store: this.store,
            now: t,
            goldenCapture: this.goldenCapture,
            ...(brainConfig !== undefined ? { brainConfig } : {}),
          });
          const splitVerdict = splitJudgeResult.verdict;
          debitTreeState(treeState, splitJudgeResult.usage);
          if (hasReachedSpendCeiling(treeState)) {
            return this.ceilingReport(goal, treeState);
          }

          if (!splitVerdict.pass) {
            budget = await debitAttempt({ budget, goal, store: this.store, now: t });

            // Non-convergence check: the split judge failed again. If it repeats
            // the same failure signature — or fails twice with no signature to
            // distinguish the rounds — the re-decide is not converging. This is a
            // non-convergence terminator, NOT a budget bound (ADR-033): without
            // it a signature-less repeated failure would loop until wall-clock.
            if (isomorphicSplitFailure(priorVerdict, splitVerdict)) {
              const sig = splitVerdict.failureSignature ?? 'unsignatured';
              const report = blockedReport(
                `Isomorphic split failure (signature: ${sig})`,
              );
              await this.store.append({
                type: 'decided',
                at: t(),
                goalId: goal.id,
                decision,
                ...(decideUsage !== undefined ? { usage: decideUsage } : {}),
              });
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
            }

            priorVerdict = splitVerdict;

            // Re-decide carrying the rejected split
            const reDecideCtx2: BrainContext = {
              tier: currentTier,
              memories: goal.memories,
              priorAttempt: {
                artifact: splitPlanArtifact(decision.children),
                verdict: splitVerdict,
              },
            };
            const reDecideResult2 = await this.brain.decide(goal, reDecideCtx2);
            decision = reDecideResult2.value;
            decideUsage = reDecideResult2.usage;
            debitTreeState(treeState, reDecideResult2.usage);
            if (hasReachedSpendCeiling(treeState)) {
              await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision, usage: reDecideResult2.usage });
              return this.ceilingReport(goal, treeState);
            }
            if (decision.kind !== 'split') break; // changed to satisfy or block
            continue;
          }
        }

        // Split passed validation (and judge if present)
        break;
      }
    }

    await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision, ...(decideUsage !== undefined ? { usage: decideUsage } : {}) });

    // ── DISPATCH on decision kind ──────────────────────────────────────────
    switch (decision.kind) {
      case 'satisfy':
        return this.runAttemptLoop(goal, currentTier, currentTierIndex, tierLadder, deadline, entryRisk, treeState);

      case 'split': {
        // ── COVERAGE GATE (ADR-021) ────────────────────────────────────────
        // Mechanical pre-check: do we have enough knowledge to decompose?
        // Only fires when knowledge wiring is present AND the goal's kind
        // requires coverage (make-kind non-exempt). The check is a projection
        // query only — no brain call, no side effect.
        let childrenToSplit = decision.children;
        if (this.knowledge !== undefined) {
          try {
            childrenToSplit = await this.runCoverageGate(
              goal, typeDef.kind as 'make' | 'learn' | 'judge' | 'evolve',
              decision.children, treeState,
            );
          } catch (gateErr) {
            // coverage gate threw a structural split error (injection
            // pushed children over the budget). Block through the existing
            // structural-error block path rather than silently over-subdividing.
            const msg = gateErr instanceof Error ? gateErr.message : String(gateErr);
            const report = blockedReport(`Split structural validation failed after coverage injection: ${msg}`);
            await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
            return report;
          }
        }

        // ── ITERATIVE DISPATCH (ADR-031 §4.4) ──────────────────────────────
        // A type carrying `iterative` routes its split through the milestone
        // loop instead of the single-pass runSplit. The constitution's `>= 1`
        // floor is re-checked on the EFFECTIVE maxRounds (goal.maxRounds override
        // or the type default) so an override cannot smuggle in 0; a bad value
        // blocks through the structural-error path rather than looping.
        let splitReport: Report;
        if (typeDef.iterative) {
          const effectiveMaxRounds = goal.maxRounds ?? typeDef.iterative.maxRounds;
          if (!Number.isInteger(effectiveMaxRounds) || effectiveMaxRounds < 1) {
            const report = blockedReport(
              `iterative maxRounds must be an integer >= 1 (effective value ${effectiveMaxRounds})`,
            );
            await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
            return report;
          }
          splitReport = await this.runMilestone(goal, childrenToSplit, treeState);
        } else {
          splitReport = await this.runSplit(goal, childrenToSplit, terracedLoserFindings, treeState);
        }

        // ── PATTERN RECORD ────────────────────────────────────────────────
        // Record the outcome of the split against the shape so the flywheel
        // accumulates evidence autonomously. Recording creates or updates a
        // PROVISIONAL memo only — promotion to trusted is a human-signoff step
        // the engine never performs (the authority gap).
        if (this.patterns && goalShape !== null) {
          const outcome: 'success' | 'failure' =
            splitReport.blockers.length === 0 ? 'success' : 'failure';
          await this.patterns.record(goalShape, decision, outcome);
          await this.store.append({
            type: 'pattern-recorded',
            at: t(),
            goalId: goal.id,
            shape: goalShape,
            outcome,
          });
        }

        return splitReport;
      }

      case 'block':
        return this.runBlock(goal, decision.brief);
    }
  }

  /**
   * Persist a passing leaf's artifact through the assembly-supplied knowledge
   * hook (helpers over emission convention). Called at every
   * leaf-success emission site in the attempt loop, AFTER the gate verdict has
   * passed and BEFORE the 'emitted' event is appended, so a knowledge-written /
   * knowledge-facts-written event lands ahead of the leaf's emission in the log.
   *
   * No-op when knowledge wiring or the persist hook is absent. The hook itself
   * decides whether the goal is a learn type and whether artifact.text parses —
   * the engine stays free of knowledge-shape knowledge (it lives in assembly).
   */
  private async persistLeafKnowledge(goal: Goal, artifact: Artifact): Promise<void> {
    const persist = this.knowledge?.persist;
    if (persist === undefined) return;
    await persist(goal, artifact);
  }

  // ── ATTEMPT LOOP (the control loop) ──────────────────────────────────────
  private async runAttemptLoop(
    goal: Goal,
    initialTier: Tier,
    initialTierIndex: number,
    tierLadder: Tier[],
    deadline: number,
    entryRisk: RiskClass = 'low',
    treeState: TreeState = createTreeState(),
  ): Promise<Report> {
    const t = this.now;
    const typeDef = this.registry.get(goal.type);
    let budget = goal.budget;
    let tier: Tier = initialTier;
    let tierIndex: number = initialTierIndex;
    let priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined;
    // Carried exploration: transcript of the most-recent step-loop that ended in
    // failure (exhausted or thrown). Passed to the next attempt so the harness
    // injects a compact digest of the prior loop's tool RESULTS.
    let priorLoopTranscript: StepTranscript | undefined;

    while (true) {
      // Check wall-clock budget before each attempt
      if (t() >= deadline) {
        await this.store.append({
          type: 'budget-exhausted',
          at: t(),
          goalId: goal.id,
          dimension: 'wallClockMs',
        });
        return this.runBlock(goal, exhaustedBrief(goal, 'wallClockMs'));
      }

      // Attempts is an observability counter, not a terminator (ADR-033). Emit
      // the budget-exhausted signal once it crosses zero, then keep going — the
      // dollar ceiling and wall-clock (checked above) are the only hard bounds.
      budget = await debitAttempt({ budget, goal, store: this.store, now: t });

      const ctx: BrainContext = priorAttempt
        ? { tier, memories: goal.memories, priorAttempt }
        : { tier, memories: goal.memories };

      // ── STEP LOOP (tool-granted path) ──────────────────────────────────────
      // Run the step loop when the goal type has at least one grant that maps to
      // a known tool AND a broker is configured. Otherwise fall through to the
      // classic produce path.
      let artifact: Artifact;
      let stepLoopTranscriptTail: StepTranscript | undefined;
      // when the step loop produces an artifact, carry a compact
      // serialization of the transcript tail so that any subsequent failure
      // (deterministic or judge) can thread it into the next attempt's
      // BrainContext.priorAttempt. Stored as a non-gating advisory finding so
      // it travels through every priorAttempt assignment that follows.
      let stepLoopTailFinding: Finding | null = null;
      // Set to true when the leaf tournament ran for this attempt — when true, the
      // standard judgeType judge section is skipped (the tournament IS the judge).
      let tournamentRan = false;

      if (isToolGranted(typeDef.grants) && this.effectiveBroker !== undefined) {
        const loopResult = await this.runStepLoop(goal, typeDef.grants, budget, ctx, priorAttempt, treeState, priorLoopTranscript);

        if (loopResult.kind === 'ceiling') {
          // step loop tripped the ceiling — surface ceiling-reached once
          // and return immediately (no further brain calls).
          return this.ceilingReport(goal, treeState);
        } else if (loopResult.kind === 'artifact') {
          artifact = loopResult.artifact;
          budget = loopResult.budget;
          stepLoopTranscriptTail = loopResult.transcript;
          stepLoopTailFinding = stepLoopTranscriptFinding(stepLoopTranscriptTail);
          // Track accumulated step token usage on the tokens counter for
          // observability (ADR-033). Tokens never block work; the dollar ceiling
          // is the real bound on spend, enforced by the step loop's ceiling check.
          budget = await debitTokenCount({
            budget,
            tokens: loopResult.tokensUsed,
            goal,
            store: this.store,
            now: t,
          });
        } else {
          // exhausted or thrown — fail into the control loop
          if (loopResult.kind === 'exhausted') {
            await this.store.append({
              type: 'budget-exhausted',
              at: t(),
              goalId: goal.id,
              dimension: 'toolCalls',
            });
          }
          const transcriptArtifact = stepLoopFailureArtifact(loopResult.transcript);
          const loopVerdict = stepLoopFailureVerdict(loopResult);
          const resolution = await this.handleFailure(
            goal,
            transcriptArtifact,
            loopVerdict,
            loopResult.budget,
            tier,
            tierIndex,
            tierLadder,
            priorAttempt
              ? priorAttempt
              : { artifact: transcriptArtifact, verdict: loopVerdict },
            treeState,
          );
          if (resolution.kind === 'repaired') {
            budget = resolution.budget;
            priorAttempt = { artifact: transcriptArtifact, verdict: loopVerdict };
            // Carry the failed transcript so the next attempt's harness has evidence
            priorLoopTranscript = loopResult.transcript;
            continue;
          } else if (resolution.kind === 'escalated') {
            tier = resolution.tier;
            tierIndex = tierLadder.indexOf(tier);
            budget = resolution.budget;
            priorAttempt = { artifact: transcriptArtifact, verdict: loopVerdict };
            // Carry the failed transcript so the next attempt's harness has evidence
            priorLoopTranscript = loopResult.transcript;
            continue;
          } else {
            return resolution.report;
          }
        }
      } else {
        // Classic produce path
        const produceResult = await produceClassicArtifact({
          goal,
          ctx,
          budget,
          brain: this.brain,
          store: this.store,
          now: t,
          debitUsage: (usage) => debitTreeState(treeState, usage),
          hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
        });
        if (produceResult.kind === 'ceiling') {
          return this.ceilingReport(goal, treeState);
        }
        artifact = produceResult.artifact;
        budget = produceResult.budget;

        // ── LEAF TOURNAMENT (F-65 A9) ───────────────────────────────────────
        // When the type declares scan.k > 1 and has a judgeType, run a
        // k-candidate tournament: generate k-1 additional artifacts with
        // different lenses, judge all k, and select the winner by fewest
        // findings. The winner replaces the single artifact so the normal
        // deterministic + judge gates evaluate the best candidate.
        //
        // Fires only on the classic produce path (no-tool path): step-loop
        // types already use tool calls to produce a high-quality artifact and
        // do not benefit from blind-text comparison.
        if (typeDef.scan && typeDef.scan.k > 1 && typeDef.judgeType !== null) {
          const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
          const tournResult = await runLeafTournament({
            goal,
            firstArtifact: artifact,
            scan: typeDef.scan,
            judgeType: typeDef.judgeType,
            typeDef,
            tier,
            budget,
            ctx,
            registry: this.registry,
            brain: this.brain,
            store: this.store,
            now: t,
            goldenCapture: this.goldenCapture,
            ...(brainConfig !== undefined ? { brainConfig } : {}),
            debitUsage: (usage) => debitTreeState(treeState, usage),
            hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
          });
          if (tournResult.kind === 'ceiling') {
            return this.ceilingReport(goal, treeState);
          }
          artifact = tournResult.artifact;
          budget = tournResult.budget;
          tournamentRan = true;
        }
      }

      // ── DETERMINISTIC CHECKS ───────────────────────────────────────────
      const deterministicGate = await runDeterministicGate({
        goal,
        artifact,
        checks: typeDef.deterministic,
        budget,
        checkContext: this.checkContextFor(goal.id),
        store: this.store,
        now: t,
      });
      budget = deterministicGate.budget;
      if (deterministicGate.verdict !== null) {
        // Track tool calls spent. toolCalls exhaustion is WARN-ONLY by default
        // (ADR-030 / enforceToolCallBudget) — emit the signal but do not block
        // unless an operator armed enforcement. This site previously blocked
        // unconditionally, inconsistent with the step loop; a deep comprehension
        // node (with toolCalls now inherited, not floored) should not be killed
        // on the count.
        if (deterministicGate.toolCallsExhausted) {
          await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'toolCalls' });
          if (this.enforceToolCallBudget) {
            return this.runBlock(goal, exhaustedBrief(goal, 'toolCalls'));
          }
        }

        if (!deterministicGate.verdict.pass) {
          // Deterministic fail → try repair rung, then escalate, never judge
          const resolution = await this.handleFailure(
            goal,
            artifact,
            deterministicGate.verdict,
            budget,
            tier,
            tierIndex,
            tierLadder,
            priorAttempt,
            treeState,
          );

          if (resolution.kind === 'repaired') {
            // Repaired: loop again with the repaired artifact as context
            budget = resolution.budget;
            priorAttempt = {
              artifact: resolution.artifact,
              verdict: deterministicGate.verdict,
            };
            // Re-run checks on the repaired artifact immediately (repair is part of
            // the same attempt that produced the flawed artifact — no extra consume)
            const recheck = await this.recheckArtifactAfterRepair(
              goal,
              resolution.artifact,
              budget,
              tier,
              typeDef,
              treeState,
            );
            budget = recheck.budget;

            if (recheck.ceiling) {
              return this.ceilingReport(goal, treeState);
            }
            if (recheck.passed) {
              return emitSuccessfulArtifact({
                goal,
                artifact: resolution.artifact,
                store: this.store,
                now: t,
                persist: (persistGoal, persistArtifact) =>
                  this.persistLeafKnowledge(persistGoal, persistArtifact),
              });
            } else {
              // Repair didn't hold — continue loop with failure context
              priorAttempt = {
                artifact: resolution.artifact,
                verdict: recheck.verdict!,
              };
              if (recheck.tier !== tier) {
                tier = recheck.tier;
                tierIndex = tierLadder.indexOf(tier);
              }
              continue;
            }
          } else if (resolution.kind === 'escalated') {
            tier = resolution.tier;
            tierIndex = tierLadder.indexOf(tier);
            budget = resolution.budget;
            // Thread the transcript tail finding into the verdict so the next
            // attempt's BrainContext carries step-loop evidence.
            priorAttempt = {
              artifact,
              verdict: stepLoopTailFinding !== null
                ? { ...deterministicGate.verdict, findings: [stepLoopTailFinding, ...deterministicGate.verdict.findings] }
                : deterministicGate.verdict,
            };
            // Carry the successful step-loop transcript so the next attempt
            // sees what was read/learned even though the deterministic gate failed.
            priorLoopTranscript = stepLoopTranscriptTail;
            continue;
          } else {
            // blocked
            return resolution.report;
          }
        }
      }

      // ── EMISSION RISK RE-CHECK ────────────────────────────────────────────
      // After deterministic checks pass, re-classify risk against the ACTUAL
      // artifact file paths. If the artifact touches sensitive territory that
      // the declared scope did not (scope escape into sensitive paths), the
      // authority gate fires again before proceeding to the judge.
      const emissionAuthorityReport = await checkEmissionAuthority({
        goal,
        artifact,
        entryRisk,
        sensitivity: this.sensitivity,
        store: this.store,
        now: t,
        onGate: this.onGate,
        onBrief: this.effectiveOnBrief,
      });
      if (emissionAuthorityReport !== null) return emissionAuthorityReport;

      // ── LLM JUDGE (only if deterministic passed) ─────────────────────────
      // Skipped when the leaf tournament already ran (the tournament IS the judge
      // for scan.k > 1 types — the winner was selected by k judge calls).
      if (typeDef.judgeType !== null && !tournamentRan) {
        const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
        const judgeResult = await judgeLeafArtifact({
          goal,
          artifact,
          typeDef,
          judgeType: typeDef.judgeType,
          tier,
          registry: this.registry,
          brain: this.brain,
          store: this.store,
          now: t,
          goldenCapture: this.goldenCapture,
          ...(brainConfig !== undefined ? { brainConfig } : {}),
        });
        const verdict = judgeResult.verdict;

        debitTreeState(treeState, judgeResult.usage);
        if (hasReachedSpendCeiling(treeState)) {
          return this.ceilingReport(goal, treeState);
        }

        // Track reported tokens on the tokens counter for observability
        // (ADR-033). Tokens never block work; the dollar ceiling (checked above)
        // is the real bound on spend.
        budget = await debitTokenUsage({
          budget,
          usage: judgeResult.usage,
          goal,
          store: this.store,
          now: t,
        });

        if (!verdict.pass) {
          const resolution = await this.handleFailure(
            goal,
            artifact,
            verdict,
            budget,
            tier,
            tierIndex,
            tierLadder,
            priorAttempt,
            treeState,
          );

          if (resolution.kind === 'repaired') {
            budget = resolution.budget;
            priorAttempt = {
              artifact: resolution.artifact,
              verdict,
            };
            // Repair is part of the same attempt — no extra consume
            const recheck = await this.recheckArtifactAfterRepair(
              goal,
              resolution.artifact,
              budget,
              tier,
              typeDef,
              treeState,
            );
            budget = recheck.budget;

            if (recheck.ceiling) {
              return this.ceilingReport(goal, treeState);
            }
            if (recheck.passed) {
              return emitSuccessfulArtifact({
                goal,
                artifact: resolution.artifact,
                store: this.store,
                now: t,
                persist: (persistGoal, persistArtifact) =>
                  this.persistLeafKnowledge(persistGoal, persistArtifact),
              });
            } else {
              priorAttempt = {
                artifact: resolution.artifact,
                verdict: recheck.verdict!,
              };
              if (recheck.tier !== tier) {
                tier = recheck.tier;
                tierIndex = tierLadder.indexOf(tier);
              }
              continue;
            }
          } else if (resolution.kind === 'escalated') {
            tier = resolution.tier;
            tierIndex = tierLadder.indexOf(tier);
            budget = resolution.budget;
            // Thread the transcript tail finding into the verdict so the next
            // attempt's BrainContext carries step-loop evidence.
            priorAttempt = {
              artifact,
              verdict: stepLoopTailFinding !== null
                ? { ...verdict, findings: [stepLoopTailFinding, ...verdict.findings] }
                : verdict,
            };
            // Carry the successful step-loop transcript so the next attempt
            // sees what was read/learned even though the judge failed.
            priorLoopTranscript = stepLoopTranscriptTail;
            continue;
          } else {
            return resolution.report;
          }
        }
      }

      // Both gates passed (or no judge) — emit the report
      return emitSuccessfulArtifact({
        goal,
        artifact,
        store: this.store,
        now: t,
        persist: (persistGoal, persistArtifact) =>
          this.persistLeafKnowledge(persistGoal, persistArtifact),
      });
    }
  }

  /**
   * Run the engine-owned step loop for a tool-granted leaf. The brain is called
   * pure per step; the engine gates each step on remaining toolCalls budget,
   * routes tool calls through the broker, and logs every step and result. Returns
   * either the final artifact (with updated budget) or a failure descriptor.
   */

  /**
   * Append a `golden-candidate` event when goldenCapture is enabled (ADR-024).
   * The artifact and rubric are referenced by sha1 digest so the log does not
   * duplicate large payloads. The model is read from the brain config if the
   * brain exposes a `config.modelByTier` shape (LlmBrain); otherwise omitted.
   *
   * Called at every judge-verdict emission site, ONLY when this.goldenCapture
   * is true (discriminates live runs from scripted tests).
   */
  private async maybeAppendGoldenCandidate(
    goalId: string,
    judgeType: string,
    artifact: Artifact,
    rubric: string,
    verdict: Verdict,
    tier: Tier,
  ): Promise<void> {
    const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
    await appendGoldenCandidate({
      enabled: this.goldenCapture,
      store: this.store,
      now: this.now,
      goalId,
      judgeType,
      artifact,
      rubric,
      verdict,
      tier,
      ...(brainConfig !== undefined ? { brainConfig } : {}),
    });
  }

  private async runStepLoop(
    goal: Goal,
    grants: string[],
    budget: Budget,
    ctx: BrainContext,
    _priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined,
    treeState: TreeState = createTreeState(),
    priorTranscript?: StepTranscript,
  ): Promise<StepLoopResult> {
    const t = this.now;
    // Pass the concrete broker (if present) so real ToolDef parameter schemas
    // reach the brain — in particular, run_script's 'script' property.
    const tools = deriveToolDefs(grants, this.effectiveBroker as { defs?: () => ToolDef[] });
    // `note` (ADR-036) is available to every leaf, engine-intercepted (not broker-
    // routed, not grant-gated): distill what a read meant so the raw read can be
    // evicted without losing the substance. Appended to the model's tool surface.
    tools.push(NOTE_TOOL_DEF);
    let remainingToolCalls = budget.toolCalls;
    // Warn-only runaway backstop: even when the toolCalls budget is not enforced
    // (the default), a model that never emits must still terminate. The tokens
    // budget and dollar ceiling are the real backstops in live runs, but they
    // rely on provider-reported usage — a brain that reports none (or a tight
    // pathological loop) would otherwise spin forever. So warn-only mode still
    // hard-stops at a generous multiple of the soft budget. This is a safety
    // limit, not an economy lever; raise the multiple, don't lower it.
    const WARN_ONLY_BACKSTOP_MULTIPLE = 50;
    const hardToolCallCap = Math.max(budget.toolCalls, 1) * WARN_ONLY_BACKSTOP_MULTIPLE;
    let toolCallsMade = 0;
    let stepIndex = 0;
    // Count read-class calls for the over-explore signal only — NOT to force an
    // emit. The old EXPLORE_READ_CEILING (16) force-emitted any explore-then-emit
    // leaf once it crossed the count, on the theory that an unbounded read-loop
    // balloons the transcript to truncation and emits nothing. That theory is now
    // handled at the source by the working-memory bound (ADR-036, raised to 140K +
    // summarize-on-evict + ranged reads, run live-self-bcc825bb): context stays
    // bounded no matter how many files are read, so a thorough dive of a large
    // region (tests/engine, 33 files) no longer needs cutting short. The ceiling was
    // doing active harm — forcing a PARTIAL emit from ~16 reads of a region that
    // needs more, which then failed its dive-anchor gate and `step-loop:failed`
    // (dive-tests-engine, runs 15/16/17). True non-termination is still backstopped
    // by the warn-only tool-call cap (50× below), the tokens/dollar/wall-clock
    // bounds, and the malform-recovery forced emit — none of which truncate a
    // legitimately-reading dive. `exploreReadCalls` is retained only for the
    // honest read-count phrase on the malform-recovery emit path.
    let exploreReadCalls = 0;
    let forceEmitNext = false;
    // One recovery from a malformed/truncated step per attempt: on a MalformedStepError
    // (two consecutive unparseable tool-calls) we force a clean emit rather than letting
    // the leaf die on `step-loop:failed`. Consumed once so a malformation cannot loop.
    let malformRecoveryUsed = false;
    // Accumulate total token usage across all steps for tokens-budget debit.
    let totalTokensUsed = 0;
    // Per-attempt duplicate-call guard (F-64 / ADR-017): tracks (name, stable-args)
    // keys for read-only calls in this attempt. Byte-identical re-reads are refused
    // without debiting the toolCalls counter. Reset per-attempt (not per-step) so
    // the guard spans the full conversation window.
    const seenCalls = new Set<string>();

    // The leaf's curated note buffer (ADR-036): distilled working memory that
    // survives eviction of raw reads. Filled via the engine-intercepted `note` tool.
    const scratchpad = newScratchpad();
    // callId → duplicate-guard key, so an evicted read's guard can be released
    // (ADR-036) and the model may re-read it.
    const callKeyByCallId = new Map<string, string>();

    const typeDef = this.registry.get(goal.type);
    const isExploreThenEmit = isExploreThenEmitLeaf(typeDef);
    const transcript = buildStepLoopInitialTranscript({
      goal,
      typeDef,
      isExploreThenEmit,
      remainingToolCalls,
      sandboxRepoRoot: this._activeAssembly?.worktree.repoRoot,
      priorTranscript,
    });

    // Whether the budget-exhausted signal has already been emitted this attempt
    // (warn-only mode emits it once, then keeps going — see enforceToolCallBudget).
    let toolBudgetWarned = false;

    while (true) {
      // Gate: the toolCalls budget. When enforced, exhaustion blocks the run.
      // When WARN-ONLY (the default — see EngineOptions.enforceToolCallBudget),
      // emit the budget-exhausted signal exactly once and keep going: the tokens
      // budget (debited per step by the caller) and the dollar ceiling (checked
      // after every step below) remain the hard backstops, so a non-emitting
      // model still terminates — it is the toolCalls *block* that is relaxed,
      // not the safety net.
      if (remainingToolCalls <= 0) {
        if (this.enforceToolCallBudget) {
          return { kind: 'exhausted', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
        }
        if (!toolBudgetWarned) {
          await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'toolCalls' });
          toolBudgetWarned = true;
        }
        // Warn-only runaway backstop: a model that never converges still stops.
        if (toolCallsMade >= hardToolCallCap) {
          return { kind: 'exhausted', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
        }
      }

      // Update the context message (replace last context). Once over the soft
      // budget in warn-only mode, the model is told it is over budget rather than
      // shown a negative count — a nudge to converge without a hard stop.
      const remainingMsg =
        remainingToolCalls > 0
          ? `${remainingToolCalls} tool calls remaining`
          : `tool-call budget exceeded (over by ${-remainingToolCalls}); converge and emit the artifact now`;
      const lastMsg = transcript[transcript.length - 1];
      if (lastMsg && lastMsg.role === 'context') {
        (transcript[transcript.length - 1] as { role: 'context'; content: string }).content = remainingMsg;
      } else {
        transcript.push({ role: 'context', content: remainingMsg });
      }

      // Comprehend over-explore backstop: the read ceiling was crossed. Instead of
      // nudging the model and HOPING it volunteers the artifact (it may keep
      // reading, and two such failures trip the isomorphic-failure detector into a
      // block — AC-4 run #7), DIRECTLY drive the emit from what has already been
      // read. For an outputSchema type this is the two-phase emit's emit call,
      // forced now: append the emit instruction and set the schema so the brain
      // MUST return the structured artifact. For a no-schema type the same
      // instruction is appended and the brain returns the artifact as content. The
      // forced flag is consumed (a single forced emit per attempt) so we never loop
      // on it. This GUARANTEES the dive of a bounded region converges to an
      // artifact rather than read-looping to exhaustion.
      if (forceEmitNext) {
        forceEmitNext = false; // consume — one forced emit per attempt
        const forcedEmit = await runForcedEmit({
          goal,
          typeDef,
          ctx,
          transcript,
          brain: this.brain,
          store: this.store,
          now: t,
          state: { remainingToolCalls, stepIndex, totalTokensUsed, exploreReadCalls },
          debitUsage: (usage) => debitTreeState(treeState, usage),
          checkCeiling: async () => hasReachedSpendCeiling(treeState),
        });
        ({ stepIndex, totalTokensUsed } = forcedEmit.state);
        if (forcedEmit.kind === 'ceiling') {
          return { kind: 'ceiling', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
        }
        if (forcedEmit.kind === 'artifact') {
          return {
            kind: 'artifact',
            artifact: forcedEmit.artifact,
            budget: { ...budget, toolCalls: remainingToolCalls },
            transcript,
            tokensUsed: totalTokensUsed,
          };
        }
        return {
          kind: 'failed',
          error: forcedEmit.error,
          budget: { ...budget, toolCalls: remainingToolCalls },
          transcript,
        };
      }

      // ── WORKING-MEMORY BOUND (ADR-036) ──────────────────────────────────────
      // Refresh the always-retained notes block, then bound the transcript before
      // sending it: evict the oldest raw tool reads to stubs once the transcript
      // crosses the token cap, so the prompt never balloons to the point a tool-call
      // response truncates (build #8: ~117K tokens → truncated JSON → block). Notes
      // (distilled by the model) and recent reads survive; evicted paths are
      // released from the duplicate-read guard so the model may re-read on demand.
      await boundStepLoopTranscript({
        goal,
        transcript,
        scratchpad,
        store: this.store,
        now: t,
        seenCalls,
        callKeyByCallId,
        summarizeRead: this.brain.summarize !== undefined
          ? (text) => this.brain.summarize!(text, ctx)
          : undefined,
        debitUsage: (usage) => debitTreeState(treeState, usage),
      });

      let stepOutput: import('../contract/brain.js').StepOutput;
      try {
        stepOutput = await this.brain.step(goal, transcript, tools, ctx);
      } catch (err) {
        // A malformed/truncated tool-call (MalformedStepError) is a FORMAT incident,
        // not a logical failure — recover ONCE by forcing a clean emit rather than
        // letting two `step-loop:failed` signatures isomorphic-block the leaf with
        // nothing produced (the author-leaf-first-step failure: a structured emit
        // whose args were unparseable/cut off killed the leaf before any real step).
        if (err instanceof MalformedStepError && !malformRecoveryUsed) {
          malformRecoveryUsed = true;
          await this.store.append({
            type: 'malformation-reprompt',
            at: t(),
            goalId: goal.id,
            detail: err.truncated
              ? 'malformed+truncated tool-call — forcing a clean emit'
              : 'malformed tool-call — forcing a clean emit',
          });
          // If the output was truncated by size, shed context first so the forced
          // emit has room; then drive the emit on the next iteration.
          if (err.truncated) {
            await evictTranscriptAfterTruncation({
              goal,
              transcript,
              scratchpad,
              store: this.store,
              now: t,
              seenCalls,
              callKeyByCallId,
            });
          }
          transcript.push({
            role: 'context',
            content:
              `Your previous tool-call output was malformed${err.truncated ? ' or cut off' : ''} ` +
              `and could not be parsed. Do NOT repeat it. Make a SMALLER move now: ` +
              `emit the final artifact directly (matching the required schema if one ` +
              `applies), not a large or partial tool call.`,
          });
          forceEmitNext = true;
          continue;
        }
        // A transport incident that survived the adapter's retries (canonically a
        // timed-out step on a slow/flaky endpoint) is NOT a logical failure — give it
        // a distinct `step-loop:transport` signature so two of them don't
        // isomorphic-block the leaf as `step-loop:failed`, and leave it for the
        // attempt ladder to retry on a healthier endpoint (run live-self-6060bbf1: an
        // author leaf's step timed out and was terminal-blocked as non-convergence).
        const error = err instanceof Error ? err.message : String(err);
        const failKind: 'failed' | 'malformed' | 'transport' =
          err instanceof MalformedStepError
            ? 'malformed'
            : err instanceof StepTransportError
              ? 'transport'
              : 'failed';
        return { kind: 'failed', error, failKind, budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
      }

      // Emit step event and debit usage
      await this.store.append({
        type: 'step',
        at: t(),
        goalId: goal.id,
        index: stepIndex,
        outputKind: stepOutput.kind,
        usage: stepOutput.usage,
      });
      debitTreeState(treeState, stepOutput.usage);
      // accumulate step token usage for tokens-budget debit.
      totalTokensUsed += stepOutput.usage.promptTokens + stepOutput.usage.completionTokens;
      stepIndex++;
      // ceiling check after each step debit — surface ceiling-reached
      // exactly once and short-circuit the loop.
      if (hasReachedSpendCeiling(treeState)) {
        return { kind: 'ceiling', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
      }

      // Emit transport incidents if any
      if (stepOutput.incidents) {
        for (const incident of stepOutput.incidents) {
          await this.store.append({
            type: incident.kind,
            at: incident.at,
            goalId: goal.id,
            detail: incident.detail,
          });
        }
      }

      if (stepOutput.kind === 'artifact') {
        // ── TWO-PHASE EMIT (ADR-023) ──────────────────────────────────────────
        // When the goal-type declares outputSchema, this artifact-kind output is
        // the exploration-complete signal — not the final artifact yet. Append
        // the emit instruction context message, make ONE more brain.step call
        // with ctx.outputSchema set (budget-gated, debited, evented like any
        // step), and use THAT call's artifact-kind text as the final artifact.
        // If the emit call returns tool-calls, treat as a failed step into the
        // existing control loop (return kind:'failed').
        if (typeDef.outputSchema !== undefined) {
          const structuredEmit = await runStructuredArtifactEmit({
            goal,
            outputSchema: typeDef.outputSchema,
            ctx,
            transcript,
            brain: this.brain,
            store: this.store,
            now: t,
            enforceToolCallBudget: this.enforceToolCallBudget,
            state: { remainingToolCalls, stepIndex, totalTokensUsed, exploreReadCalls },
            debitUsage: (usage) => debitTreeState(treeState, usage),
            checkCeiling: async () => hasReachedSpendCeiling(treeState),
          });
          ({ stepIndex, totalTokensUsed } = structuredEmit.state);
          if (structuredEmit.kind === 'exhausted') {
            return { kind: 'exhausted', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
          }
          if (structuredEmit.kind === 'ceiling') {
            return { kind: 'ceiling', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
          }
          if (structuredEmit.kind === 'failed') {
            return {
              kind: 'failed',
              error: structuredEmit.error,
              budget: { ...budget, toolCalls: remainingToolCalls },
              transcript,
            };
          }
          return {
            kind: 'artifact',
            artifact: structuredEmit.artifact,
            budget: { ...budget, toolCalls: remainingToolCalls },
            transcript,
            tokensUsed: totalTokensUsed,
          };
        }

        return {
          kind: 'artifact',
          artifact: stepOutput.artifact,
          budget: { ...budget, toolCalls: remainingToolCalls },
          transcript,
          tokensUsed: totalTokensUsed,
        };
      }

      const routing = await routeStepToolCalls({
        goal,
        calls: stepOutput.calls,
        budget,
        transcript,
        scratchpad,
        broker: this.effectiveBroker!,
        store: this.store,
        now: t,
        enforceToolCallBudget: this.enforceToolCallBudget,
        isExploreThenEmit,
        seenCalls,
        callKeyByCallId,
        state: { remainingToolCalls, toolCallsMade, exploreReadCalls },
      });
      if (routing.kind === 'exhausted') {
        return routing;
      }
      ({ remainingToolCalls, toolCallsMade, exploreReadCalls } = routing.state);

      // After routing all calls, update remaining in context for next step
      // (the context message is prepended at the top of the next iteration)
    }
  }

  private async recheckArtifactAfterRepair(
    goal: Goal,
    artifact: Artifact,
    budget: Budget,
    tier: Tier,
    typeDef: GoalTypeDef,
    treeState: TreeState = createTreeState(),
  ): Promise<{ passed: boolean; budget: Budget; verdict: Verdict | null; tier: Tier; ceiling?: true }> {
    const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
    return recheckArtifactAfterRepair({
      goal,
      artifact,
      budget,
      tier,
      typeDef,
      registry: this.registry,
      brain: this.brain,
      store: this.store,
      now: this.now,
      checkContext: this.checkContextFor(goal.id),
      goldenCapture: this.goldenCapture,
      ...(brainConfig !== undefined ? { brainConfig } : {}),
      debitUsage: (usage) => debitTreeState(treeState, usage),
      hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
    });
  }

  /**
   * After a failing verdict, decide what to do:
   * - escalated finding → block
   * - has prescriptions → repair rung
   * - no prescription → tier escalation
   * - isomorphic failure → block early
   */
  private async handleFailure(
    goal: Goal,
    artifact: Artifact,
    verdict: Verdict,
    budget: Budget,
    tier: Tier,
    tierIndex: number,
    tierLadder: Tier[],
    priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined,
    treeState: TreeState = createTreeState(),
  ): Promise<
    | { kind: 'repaired'; artifact: Artifact; budget: Budget }
    | { kind: 'escalated'; tier: Tier; budget: Budget }
    | { kind: 'blocked'; report: Report }
  > {
    return resolveAttemptFailure({
      goal,
      artifact,
      verdict,
      budget,
      tier,
      tierIndex,
      tierLadder,
      priorAttempt,
      brain: this.brain,
      store: this.store,
      now: this.now,
      onBrief: this.effectiveOnBrief,
      debitUsage: (usage) => debitTreeState(treeState, usage),
      hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
      onCeilingReached: async () => this.ceilingReport(goal, treeState),
    });
  }

  // ── COVERAGE GATE (ADR-021) ────────────────────────────────────────────────
  /**
   * Run the mechanical coverage check before a split is committed. On pass,
   * emits gate-checked {ok:true} and returns the original children unchanged.
   * On miss, mints comprehension ChildPlans (map-repo / deep-dive-region via
   * knowledge.mintComprehension), injects them as dependencies of every existing
   * child, emits gate-checked {ok:false, missing}, and returns the augmented
   * children list so the dependency scheduler sequences comprehension first.
   *
   * No brain call on either path. The check is a projection query only.
   *
   * SANDBOX REQUIREMENT: knowledge wiring requires an active sandbox/assembly
   * (so that repoRoot is a real path). When no sandbox is active the gate is
   * skipped entirely — children are returned unchanged and no gate-checked event
   * is emitted. Callers that want gate enforcement must configure a sandbox.
   *
   * GATE-CHECKED MISSING ENCODING: coverage-gate helpers encode each entry in
   * the `missing` array of the gate-checked event.
   *
   * CHECKPOINT: verify-on-read fires at the split gate only. The integrate
   * checkpoint is deferred (not yet wired); the EngineOptions.knowledge docstring
   * describes the intended three-checkpoint design but only the split checkpoint
   * is currently implemented.
   */
  /**
   * The family skill block for a goal type, for injection into the DECIDE call —
   * the preamble plus the type's section, the same shape the step-loop harness
   * uses. Carries the satisfy-vs-split criterion so the brain decides with craft,
   * not blind. Returns undefined when the family has no loadable skill.
   */
  private decideSkillBlock(goalType: string): string | undefined {
    if (!this.registry.has(goalType)) return undefined;
    const familySkill = loadFamilySkill(this.registry.get(goalType).family);
    if (!familySkill) return undefined;
    const section = familySkill.sectionFor(goalType);
    const preamble = familySkill.full.split(/\n## /)[0]!.trim();
    const parts: string[] = [];
    if (preamble) parts.push(preamble);
    if (section) parts.push(section.trim());
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  /**
   * A cheap factual size signal for a WHOLE-REPO `map-repo` decide call (AC-4
   * run #6): the comprehend skill carries a "8+ subsystems → split immediately"
   * rule, but the brain was deciding blind and chose satisfy, then could not map
   * a 259-file repo in one node. Counting top-level source dirs + tracked files
   * lets the brain apply that rule on real data. Returns undefined when there is
   * no active sandbox, the goal is not a whole-repo map, or the scan fails — in
   * which case the decide falls back to the goal-context-only behavior. Scoped
   * goals (non-empty scope) are excluded: scoping already bounds them.
   */
  private repoShapeHint(goal: Goal): string | undefined {
    return buildRepoShapeHint(goal, this._activeAssembly?.worktree.root);
  }

  private async runCoverageGate(
    goal: Goal,
    kind: 'make' | 'learn' | 'judge' | 'evolve',
    children: ChildPlan[],
    _treeState: TreeState,
  ): Promise<ChildPlan[]> {
    const t = this.now;
    const kw = this.knowledge;
    if (kw === undefined) return children;

    // knowledge wiring requires a sandbox with a real repoRoot.
    // Without a sandbox the gate cannot query meaningful knowledge — skip it
    // entirely so callers never query with repoRoot '' by accident.
    if (this._activeAssembly === undefined) return children;

    const repoRoot = this._activeAssembly.worktree.repoRoot;

    const knowledgeState = await kw.query(repoRoot);

    // ── Checkpoint verify-on-read at split entry (ADR-019) ──────────────────
    // Before running the coverage check, verify any artifacts the goal's kind
    // would consume. On drift, validate; pass → stale-validated event + proceed;
    // fail → invalid event + inject refresh child as a dependency.
    const { refreshChildren, validatedOk, refreshedCategories } =
      await checkpointVerifyArtifacts({
        goal,
        knowledge: knowledgeState,
        repoRoot,
        knowledgeGateway: kw,
        store: this.store,
        now: t,
      });

    // Build a goal model for coverageCheck — the parent's kind and split status,
    // plus the scopes its make-leaf children touch (those leaves go straight to
    // satisfy and never run their own coverage gate, so the parent is the only
    // place their region dives can be pulled).
    //
    // ADR-029 Decision 2 (comprehension is JIT, pulled by the split gate, bounded
    // by the regions the goal touches): we union proposed child scopes, but
    // existsByRegion then bounds the demand to regions that ACTUALLY EXIST. A
    // child creating a brand-new region has nothing to comprehend, so it pulls no
    // dive — which is precisely the speculative over-firing the iteration-08
    // proof runs exposed (~10 dives of unrelated/new regions for a trivial
    // feature). A child touching an EXISTING region still pulls its dive.
    const coverageGoal = {
      kind,
      isRootSplit: !this.registry.get(goal.type).leafOnly,
      scope: goal.scope,
      typeName: goal.type,
    };

    // Collect scopes from proposed make-kind leaf children so region dives are
    // checked for them too (they never reach a gate on their own).
    const childScopeEntries: string[] = [];
    for (const child of children) {
      if (!this.registry.has(child.type)) continue;
      const childDef = this.registry.get(child.type);
      if (childDef.kind === 'make' && childDef.leafOnly) {
        childScopeEntries.push(...child.scope);
      }
    }
    const effectiveScope =
      childScopeEntries.length > 0
        ? [...goal.scope, ...childScopeEntries]
        : goal.scope;

    // existsByRegion is the relevance signal over the full effective scope: a
    // region absent from the working tree is never comprehended (greenfield root
    // split → no whole-repo maps; not-yet-created child region → no dive).
    // Region existence is supplied by the knowledge wiring (real existsSync-backed
    // impl in assembly; deterministic injection in tests). When absent, default to
    // treat-as-existing — the legacy pre-existence-signal behavior.
    const regionExists = kw.regionExists ?? (() => true);
    const existsByRegion: Record<string, boolean> = {};
    for (const scopeEntry of effectiveScope) {
      const region = scopeEntry.replace(/\/$/, '');
      existsByRegion[region] = regionExists(repoRoot, region);
    }

    const effectiveCoverageGoal =
      childScopeEntries.length > 0
        ? { ...coverageGoal, isRootSplit: false, scope: effectiveScope, existsByRegion }
        : { ...coverageGoal, existsByRegion };

    const result = coverageCheck(effectiveCoverageGoal, knowledgeState, validatedOk);

    // filter out categories already covered by a refresh child so that
    // an invalid-then-refreshed category never produces two children for the
    // same category (one from checkpointVerifyArtifacts and one from
    // mintComprehension). Each category gets exactly one child.
    const filteredMissing = filterMissingCoveredByRefresh(result.missing, refreshedCategories);
    const filteredResult = { ok: filteredMissing.length === 0, missing: filteredMissing };

    // Emit gate-checked (always, per spec)
    await this.store.append({
      type: 'gate-checked',
      at: t(),
      goalId: goal.id,
      ok: filteredResult.ok && refreshChildren.length === 0,
      missing: gateMissingLabels(filteredResult.missing, refreshChildren),
    });

    if (filteredResult.ok && refreshChildren.length === 0) {
      // Gate passes — no new children, no extra brain calls
      return children;
    }

    return injectCoverageChildren({
      children,
      missing: filteredResult.missing,
      refreshChildren,
      mintComprehension: kw.mintComprehension,
      resolveType: (tp) => (this.registry.has(tp) ? this.registry.get(tp) : undefined),
    });
  }

  // ── SPLIT PATH ────────────────────────────────────────────────────────────
  /**
   * One split pass, made re-enterable (ADR-031 decision 3). Does everything
   * `runSplit` did between subdivide and the final emit — build child goals,
   * run them, the comprehend structured merge, the `judge-integration` integrate
   * gate, the lesson/memory promotion — but does NOT emit the `emitted` event and
   * does NOT promote-as-final. Returns the round's report, its merged artifact,
   * and the deterministic `passingCount` (0 for a non-iterative caller, which
   * ignores it). `runMilestone` calls this once per round; `runSplit` calls it
   * once and appends the emit tail. Behavior-preserving: every existing split
   * path stays byte-identical (the safety net for the milestone loop).
   */
  private async runRound(
    goal: Goal,
    children: ChildPlan[],
    extraFindings: string[] = [],
    treeState: TreeState = createTreeState(),
  ): Promise<{
    report: Report;
    mergedArtifact: Artifact | null;
    passingCount: number;
    /** Each child's plan paired with the report it produced, for the iterative
     * caller (runMilestone) to locate the criteria child's artifact. The
     * non-iterative caller (runSplit) ignores it. */
    childOutcomes: { plan: ChildPlan; report: Report }[];
  }> {
    const t = this.now;

    // The dive→build knowledge handoff (ADR-040) resolves the repo root once. The
    // ACTUAL injection happens at child-run time (after a child's dependency dives
    // have executed and persisted their RegionFacts), NOT here at construction — all
    // child goals are built upfront before any sibling runs, so a dive's facts do not
    // yet exist at this point (run live-self-c43b4f69: a builder got 0 dive memories
    // because they were queried before the dives ran). See the run-time injection below.
    const spawnSpecRepoRoot = (goal.spec as Record<string, unknown>)['repoRoot'];
    const spawnRepoRoot =
      this._activeAssembly?.worktree.repoRoot ??
      (typeof spawnSpecRepoRoot === 'string' ? spawnSpecRepoRoot : '');

    const childGoals = await buildSplitChildGoals({
      parent: goal,
      children,
      memory: this.memory,
    });
    await appendChildSpawnedEvents({
      parent: goal,
      children,
      childGoals,
      store: this.store,
      now: t,
    });
    const childReports = await runSplitChildren({
      parent: goal,
      children,
      childGoals,
      store: this.store,
      now: t,
      repoRoot: spawnRepoRoot,
      factsForRegions: this.knowledge?.factsForRegions,
      headSha: this.knowledge?.headSha,
      runChild: (childGoal) => this._run(childGoal, treeState),
    });

    // ── INTEGRATE ────────────────────────────────────────────────────────────
    const comprehendMerge = await mergeComprehendChildArtifacts({
      goal,
      typeDef: this.registry.get(goal.type),
      childReports,
      activeRepoRoot: this._activeAssembly?.worktree.repoRoot,
      headSha: this.knowledge?.headSha,
      checkContext: this.checkContextFor(goal.id),
      store: this.store,
      now: t,
      persist: (mergeGoal, artifact) => this.persistLeafKnowledge(mergeGoal, artifact),
    });
    const mergedArtifact =
      comprehendMerge.kind === 'handled'
        ? comprehendMerge.mergedArtifact
        : mergeGenericChildArtifacts(childReports);
    const comprehendFindings =
      comprehendMerge.kind === 'handled' ? comprehendMerge.findings : [];
    const comprehendBlockers =
      comprehendMerge.kind === 'handled' ? comprehendMerge.blockers : [];

    const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
    const integration = await judgeSplitIntegration({
      goal,
      artifact: mergedArtifact,
      registry: this.registry,
      brain: this.brain,
      goldenCapture: this.goldenCapture,
      store: this.store,
      now: t,
      ...(brainConfig !== undefined ? { brainConfig } : {}),
    });

    const promotion = await promoteChildReports({
      childGoals,
      childReports,
      store: this.store,
      now: t,
    });
    const report = buildSplitRoundReport({
      mergedArtifact,
      childReports,
      promotion,
      extraFindings,
      integrationFindings: integration.findings,
      integrationBlockers: integration.blockers,
      comprehendFindings,
      comprehendBlockers,
    });

    // `passingCount` is computed by the iterative caller (runMilestone) against
    // the round's worktree; a non-iterative split ignores it (0).
    return { report, mergedArtifact, passingCount: 0, childOutcomes: childOutcomes(children, childReports) };
  }

  private async runSplit(
    goal: Goal,
    children: ChildPlan[],
    extraFindings: string[] = [],
    treeState: TreeState = createTreeState(),
  ): Promise<Report> {
    const { report } = await this.runRound(goal, children, extraFindings, treeState);
    await this.store.append({ type: 'emitted', at: this.now(), goalId: goal.id, report });
    return report;
  }

  // ── MILESTONE LOOP (ADR-031) ───────────────────────────────────────────────
  /**
   * The milestone loop: an iterative `deliver-intent`-style root re-decides
   * against a frozen acceptance-criteria done-condition each round until DONE or
   * a guard halts it (ADR-031 §4.2). Reached from the split dispatch arm when the
   * type carries `iterative`.
   *
   * Reused verbatim: `runRound` (one split pass), `brain.decide`/`brain.judge`,
   * budget/spend accounting, `persistLeafKnowledge`, `ceilingReport`, the
   * comprehend merge, the lesson/memory promotion edge, and
   * `commitRound`/`diffBodiesWithinScope`.
   *
   * The loop (step 6): round 0 mints + freezes the criteria; round N>0 re-decides
   * against what is still unmet, threading round N-1's diff bodies + the unmet
   * findings + judge findings into the decide. The four-guard halt
   * (first-to-fire-wins; §4.3) ends the loop and names which guard fired.
   */
  private async runMilestone(
    goal: Goal,
    children: ChildPlan[],
    treeState: TreeState,
    _depth = 0,
  ): Promise<Report> {
    const t = this.now;
    const typeDef = this.registry.get(goal.type);
    const iterative = typeDef.iterative!; // dispatch guard guarantees presence
    const effectiveMaxRounds = goal.maxRounds ?? iterative.maxRounds;

    // The frozen done-condition (minted round 0, never re-authored) and the loop
    // carry-state across rounds.
    let criteriaArtifact: Artifact | null = null;
    let roundReport: Report = blockedReport('milestone loop produced no round');
    let lastAssessment: Awaited<ReturnType<Engine['assessRound']>> | null = null;
    let priorPassingCount = -1; // -1 so round 0 is always a "strict increase" baseline
    let flatRounds = 0;
    let priorRoundRef: string | null = null;
    let roundChildren = children;

    let roundIndex = 0;
    let outcome: 'done' | 'continue' | 'halt-no-progress' | 'halt-max-rounds' | 'halt-ceiling' =
      'continue';

    while (true) {
      // (a) GUARD 4 (CEILING) at the TOP of every round — the per-round top gate
      // the termination tradeoff requires; the bound spend cannot exceed.
      if (hasReachedSpendCeiling(treeState)) {
        if (lastAssessment === null) {
          // Tripped before any round ran — a plain ceiling block, no partial yet.
          return this.ceilingReport(goal, treeState);
        }
        // A round already produced a partial — record the ceiling halt honestly:
        // the once-per-tree ceiling-reached event + a round-assessed naming the
        // guard, then break to emit the cumulative partial.
        await this.ceilingReachedOnce(goal, treeState);
        outcome = 'halt-ceiling';
        await this.store.append({
          type: 'round-assessed',
          at: t(),
          goalId: goal.id,
          round: roundIndex,
          passingCount: lastAssessment.passingCount,
          criteriaTotal: lastAssessment.criteriaTotal,
          judgeVerdict: lastAssessment.judgeVerdict,
          outcome,
          diffDigest: lastAssessment.diffDigest,
        });
        break;
      }

      await this.store.append({
        type: 'round-started',
        at: t(),
        goalId: goal.id,
        round: roundIndex,
        spentUsd: treeState.spentUsd,
        roundWallClockMs: goal.budget.wallClockMs,
      });

      // (b) DECIDE — round 0 uses the dispatch's already-validated split; round
      // N>0 re-decides against the unmet criteria, the judge findings, and the
      // prior round's diff bodies (quoted DATA, weighed not obeyed).
      if (roundIndex > 0) {
        const reDecided = await this.reDecideRound(
          goal,
          treeState,
          lastAssessment!,
          priorRoundRef,
        );
        if ('halt' in reDecided) {
          // Re-decide could not produce a runnable split — halt with the partial
          // we have rather than looping blind.
          outcome = 'continue';
          break;
        }
        roundChildren = reDecided.children;
      }

      // (c) runRound — the existing single-pass body (build child map → integrate).
      const round = await this.runRound(goal, roundChildren, [], treeState);
      roundReport = round.report;

      // Round 0 freezes the criteria; later rounds keep the frozen one.
      if (roundIndex === 0) {
        criteriaArtifact = this.extractCriteriaArtifact(round.childOutcomes);
        if (criteriaArtifact !== null) {
          await this.persistLeafKnowledge(goal, criteriaArtifact);
        }
      }

      // (d) commitRound advancing HEAD (so verify-on-read + diffBodies are real).
      const committedRef = this.commitRoundIfWorktree(roundIndex, goal.title);

      // (e) assess → passingCount + judge-acceptance; emit round-assessed.
      const assessment = await this.assessRound(
        goal,
        criteriaArtifact,
        round.mergedArtifact,
        treeState,
      );
      lastAssessment = assessment;

      // (f) THE FOUR-GUARD HALT (first-to-fire-wins, §4.3). CEILING (guard 4) is
      // gated at the TOP of the loop; here we evaluate DONE → NO-PROGRESS →
      // MAX-ROUNDS in order, the first that fires winning.
      const strictIncrease = assessment.passingCount > priorPassingCount;
      // Update the no-progress grace counter on this round's deterministic result:
      // a strict increase resets it; a non-increase consumes the one grace round.
      if (strictIncrease) {
        flatRounds = 0;
      } else {
        flatRounds += 1;
      }
      const done =
        assessment.criteriaTotal > 0 &&
        assessment.passingCount === assessment.criteriaTotal &&
        assessment.judgeVerdict.pass;

      if (done) {
        outcome = 'done'; // GUARD 1 — scripts AND judge (decision 1)
      } else if (flatRounds >= 2) {
        // GUARD 2 — NO-PROGRESS: passingCount failed to strictly increase for a
        // SECOND consecutive round (one grace round tolerated, decision 4).
        // Judge-independent — the one near-deterministic guard.
        outcome = 'halt-no-progress';
      } else if (roundIndex + 1 >= effectiveMaxRounds) {
        // GUARD 3 — MAX-ROUNDS runaway-backstop (decision 4).
        outcome = 'halt-max-rounds';
      } else {
        outcome = 'continue';
      }

      await this.store.append({
        type: 'round-assessed',
        at: t(),
        goalId: goal.id,
        round: roundIndex,
        passingCount: assessment.passingCount,
        criteriaTotal: assessment.criteriaTotal,
        judgeVerdict: assessment.judgeVerdict,
        outcome,
        diffDigest: assessment.diffDigest,
      });

      if (outcome !== 'continue') break;

      // Advance loop state for the next round.
      priorPassingCount = assessment.passingCount;
      priorRoundRef = committedRef ?? priorRoundRef;
      roundIndex += 1;
    }

    // ── After break: emit ONE final report. DONE → the cumulative green report;
    // any non-DONE halt → the cumulative green artifact with the unmet criteria
    // and the judge's gating verdict as blockers (gap A5, honest partial). The
    // last round's integrate (judge-integration inside runRound) already ran —
    // we do NOT double-run it.
    const finalReport =
      outcome === 'done' || lastAssessment === null
        ? roundReport
        : this.withUnmetBlockers(roundReport, lastAssessment);
    await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report: finalReport });
    return finalReport;
  }

  /**
   * Re-decide a round N>0: ask the brain for a fresh split, informed by the prior
   * round's assessment (unmet criteria + judge findings) and a digest of the
   * bodies the prior round changed (ADR-032 §6 — quoted DATA, weighed not obeyed).
   * Returns the validated children, or `{ halt: true }` when no runnable split
   * could be produced (the loop then halts with the partial it has).
   */
  private async reDecideRound(
    goal: Goal,
    treeState: TreeState,
    priorAssessment: Awaited<ReturnType<Engine['assessRound']>>,
    priorRoundRef: string | null,
  ): Promise<{ children: ChildPlan[] } | { halt: true }> {
    const t = this.now;

    // Build the diff-bodies digest of what the prior round changed (in-scope).
    let diffBodies = '';
    const worktree = this._activeAssembly?.worktree;
    if (worktree !== undefined && priorRoundRef !== null) {
      const bodies = diffBodiesWithinScope(worktree.root, goal.scope, priorRoundRef);
      diffBodies = bodies
        .map((b) => `--- ${b.path}${b.truncated ? ' (truncated)' : ''} ---\n${b.body}`)
        .join('\n\n');
    }

    // The unmet criteria + judge findings as a priorAttempt verdict the brain
    // weighs. This is the re-decide hint: target the next round at the gap.
    const unmetFindings: Finding[] = priorAssessment.checkResults
      .filter((r) => !r.ok)
      .map((r) => ({
        title: `Unmet criterion ${r.id}`,
        dimension: 'spec' as const,
        severity: 'high' as const,
        gating: true,
        prescription: r.detail,
      }));
    const reDecideVerdict: Verdict = {
      pass: false,
      findings: [...unmetFindings, ...priorAssessment.judgeVerdict.findings],
    };

    const decideSkill = this.decideSkillBlock(goal.type);
    const ctx: BrainContext = {
      tier: this.registry.get(goal.type).tier.default,
      memories: goal.memories,
      ...(decideSkill ? { skill: decideSkill } : {}),
      priorAttempt: {
        artifact: diffBodies.length > 0 ? { kind: 'text', text: diffBodies } : null,
        verdict: reDecideVerdict,
      },
    };

    const decideResult = await this.brain.decide(goal, ctx);
    debitTreeState(treeState, decideResult.usage);
    await this.store.append({
      type: 'decided',
      at: t(),
      goalId: goal.id,
      decision: decideResult.value,
      usage: decideResult.usage,
    });

    const decision = decideResult.value;
    if (decision.kind !== 'split') {
      return { halt: true };
    }
    const structErr = validateSplit(decision.children, (tp) => (this.registry.has(tp) ? this.registry.get(tp) : undefined));
    if (structErr !== null) {
      return { halt: true };
    }
    return { children: decision.children };
  }

  /**
   * Locate the frozen acceptance-criteria artifact among a round's children: the
   * report of the child planned as `author-acceptance-criteria`. Null when no
   * such child ran or it produced no artifact (the loop then has no criteria to
   * gate on — handled as zero criteria by the assessment).
   */
  private extractCriteriaArtifact(
    childOutcomes: { plan: ChildPlan; report: Report }[],
  ): Artifact | null {
    const criteriaChild = childOutcomes.find(
      (c) => c.plan.type === 'author-acceptance-criteria',
    );
    return criteriaChild?.report.artifact ?? null;
  }

  /**
   * Commit the round onto the tree branch (advancing HEAD) when a worktree is
   * active. No-op without a sandbox (tests / sandbox-less runs) — there is no
   * worktree to commit, and verify-on-read is moot.
   */
  private commitRoundIfWorktree(roundIndex: number, title: string): string | null {
    const worktree = this._activeAssembly?.worktree;
    if (worktree === undefined) return null;
    return commitRound(worktree, roundIndex, title);
  }

  /**
   * Assess one round against the frozen criteria: parse the checklist, run each
   * criterion's deterministic check against the round's cumulative artifact +
   * sandbox (→ passingCount / criteriaTotal), then run `judge-acceptance` over
   * the cumulative artifact + criteria + check results. Returns the components
   * the four-guard halt and the `round-assessed` event need.
   */
  private async assessRound(
    goal: Goal,
    criteriaArtifact: Artifact | null,
    mergedArtifact: Artifact | null,
    treeState: TreeState,
  ): Promise<{
    passingCount: number;
    criteriaTotal: number;
    judgeVerdict: Verdict;
    criteria: AcceptanceCriterion[];
    checkResults: { id: string; ok: boolean; detail: string }[];
    diffDigest: string[];
  }> {
    const parsed = parseAcceptanceCriteria(criteriaArtifact);
    const criteria = parsed.ok ? parsed.criteria : [];
    const checkCtx = this.checkContextFor(goal.id);

    const checkResults: { id: string; ok: boolean; detail: string }[] = [];
    for (const criterion of criteria) {
      const result = await criterionToCheck(criterion).run(goal, mergedArtifact, checkCtx);
      checkResults.push({ id: criterion.id, ok: result.ok, detail: result.detail });
    }
    const passingCount = checkResults.filter((r) => r.ok).length;

    // judge-acceptance: the ship-gate judge (decision 1). Reads the cumulative
    // artifact + the frozen criteria + this round's deterministic check RESULTS.
    let judgeVerdict: Verdict = { pass: false, findings: [] };
    if (this.registry.has(iterativeAcceptanceJudge(this.registry, goal.type)) && mergedArtifact) {
      const judgeType = iterativeAcceptanceJudge(this.registry, goal.type);
      const criteriaSummary = criteria
        .map((c) => {
          const r = checkResults.find((x) => x.id === c.id);
          return `- [${r?.ok ? 'PASS' : 'FAIL'}] ${c.id}: ${c.claim} (${r?.detail ?? 'not run'})`;
        })
        .join('\n');
      const rubric = enrichRubric(this.registry,
        `Are the frozen acceptance criteria satisfied to a shippable bar for the intent: "${goal.title}"?\n\nFrozen criteria and this round's deterministic check results:\n${criteriaSummary}`,
        judgeType,
        goal.intent,
      );
      const judgeTypeDef = this.registry.get(judgeType);
      const judgeTier = judgeTypeDef.tier.default;
      const judgeCtx: BrainContext = { tier: judgeTier, memories: goal.memories };
      const { value, usage } = await this.brain.judge(goal, mergedArtifact, rubric, judgeCtx);
      judgeVerdict = value;
      if (this.goldenCapture) {
        await this.store.append({
          type: 'judge-verdict',
          at: this.now(),
          goalId: goal.id,
          judgeType,
          verdict: value,
          tier: judgeTier,
          usage,
        });
        await this.maybeAppendGoldenCandidate(goal.id, judgeType, mergedArtifact, rubric, value, judgeTier);
      }
      debitTreeState(treeState, usage);
    }

    // diff DIGEST: pointers, not bodies — the failing criteria ids (the honest
    // per-round log of what is still unmet).
    const diffDigest = checkResults.filter((r) => !r.ok).map((r) => `unmet:${r.id}`);

    return {
      passingCount,
      criteriaTotal: criteria.length,
      judgeVerdict,
      criteria,
      checkResults,
      diffDigest,
    };
  }

  /**
   * Decorate a round's report with the unmet criteria as blockers — the honest
   * non-done outcome (gap A5): the cumulative green artifact is emitted, never an
   * empty worktree, with the unmet criteria and the judge's gating verdict named.
   */
  private withUnmetBlockers(
    report: Report,
    assessment: {
      passingCount: number;
      criteriaTotal: number;
      judgeVerdict: Verdict;
      checkResults: { id: string; ok: boolean; detail: string }[];
    },
  ): Report {
    const unmet = assessment.checkResults.filter((r) => !r.ok);
    const blockers = [...report.blockers];
    if (unmet.length > 0) {
      blockers.push(
        `Acceptance criteria not yet met (${assessment.passingCount}/${assessment.criteriaTotal}): ` +
          unmet.map((r) => `${r.id} (${r.detail})`).join('; '),
      );
    }
    if (!assessment.judgeVerdict.pass) {
      blockers.push(
        `judge-acceptance did not pass: ${assessment.judgeVerdict.findings.map((f) => f.title).join(', ') || 'no shippable verdict'}`,
      );
    }
    return { ...report, blockers };
  }

  // ── BLOCK PATH ────────────────────────────────────────────────────────────
  private async runBlock(
    goal: Goal,
    brief: import('../contract/decision.js').DecisionBrief,
  ): Promise<Report> {
    const t = this.now;
    const resolution = this.effectiveOnBrief
      ? await this.effectiveOnBrief(brief)
      : brief.onTimeout;
    await this.store.append({
      type: 'blocked',
      at: t(),
      goalId: goal.id,
      brief,
      resolution,
    });
    const report = blockedReport(brief.question);
    await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
    return report;
  }

  // ── TREE-SPEND EVENTS ─────────────────────────────────────────────────────

  /**
   * Emit the 'ceiling-reached' event exactly once per tree (ADR-017 guard:
   * concurrent branches all see the ceiling tripped but only the first fires it).
   * Factored out of {@link ceilingReport} so the milestone loop can record a
   * ceiling halt without also emitting a block brief (it emits a partial instead).
   */
  private async ceilingReachedOnce(goal: Goal, treeState: TreeState): Promise<void> {
    if (!treeState.ceilingEmitted) {
      treeState.ceilingEmitted = true;
      await this.store.append({
        type: 'ceiling-reached',
        at: this.now(),
        goalId: goal.id,
        spentUsd: treeState.spentUsd,
        ceilingUsd: treeState.ceilingUsd,
      });
    }
  }

  private async ceilingReport(goal: Goal, treeState: TreeState): Promise<Report> {
    const t = this.now;
    // Emit 'ceiling-reached' exactly once per tree. Concurrent branches all see
    // the ceiling tripped but only the first one fires the event (ADR-017 guard).
    await this.ceilingReachedOnce(goal, treeState);
    const brief: import('../contract/decision.js').DecisionBrief = {
      question: `Tree spend ceiling of $${treeState.ceilingUsd.toFixed(2)} reached (spent $${treeState.spentUsd.toFixed(4)}). Tree halted.`,
      options: ['deny', 'park', 'bounce'],
      links: [goal.id],
      deadlineMs: 30_000,
      onTimeout: 'deny',
    };
    return this.runBlock(goal, brief);
  }
}

// ── STEP LOOP HELPERS ────────────────────────────────────────────────────────

/**
 * The acceptance-judge type name an iterative type names. The dispatch guard
 * guarantees the type carries `iterative`; the constitution guarantees the named
 * judge is a registered `kind:'judge'` type.
 */
function iterativeAcceptanceJudge(registry: Registry, goalType: string): string {
  return registry.get(goalType).iterative!.acceptanceJudge;
}
