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
import type { ChildPlan } from '../contract/decision.js';
import type { Artifact, Report } from '../contract/report.js';
import type { Verdict, Finding } from '../contract/verdict.js';
import type { EventStore } from '../contract/events.js';
import type { Brain, BrainContext, StepTranscript } from '../contract/brain.js';
import type { Registry, GoalTypeDef } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { RiskClass, SensitivityFact } from '../contract/risk.js';
import type { PatternStore } from '../contract/pattern.js';
import type { ToolBroker } from '../contract/tool.js';
import { debitAttempt, debitTokenCount, debitTokenUsage } from './budget-events.js';
import { lintLibrary } from '../library/constitution.js';
import { loadFamilySkill } from '../library/skills.js';
import { classifyRisk } from '../library/risk.js';
import type { CheckContext } from '../contract/goal-type.js';
import {
  openSandboxAssembly,
  openLearnAssembly,
  type SandboxConfig,
  type SandboxAssembly,
} from './assembly.js';
import { commitRound } from './worktree.js';
import type { KnowledgeArtifact, RegionFacts } from '../contract/knowledge.js';
import {
  type KnowledgeForCoverage,
  type MissingRequirement,
} from '../library/coverage.js';
import { isToolGranted } from './step-loop-tools.js';
import {
  stepLoopTranscriptFinding,
} from './step-loop-result.js';
import { runStepLoop } from './step-loop.js';
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
import { applyRootEmissionGate } from './root-emission-gate.js';
import { finalizeSandboxedRun } from './sandbox-finalization.js';
import {
  runKnowledgeCoverageSplitGate,
} from './coverage/split-gate.js';
import { appendGoldenCandidate } from './judge-support.js';
import { runAuthorityGate } from './authority-gate.js';
import { runDeterministicGate } from './deterministic-gate.js';
import { judgeLeafArtifact } from './leaf-judge.js';
import { produceClassicArtifact } from './attempt/classic-produce.js';
import { checkEmissionAuthority } from './attempt/emission-authority.js';
import { resolveAttemptFailure } from './attempt/failure.js';
import { transitionArtifactFailure } from './attempt/failure-transition.js';
import { transitionStepLoopFailure } from './attempt/step-loop-failure.js';
import {
  attemptBrainContext,
  continueAfterArtifactFailure,
  continueAfterStepLoopFailure,
  createAttemptLoopState,
  withAttemptBudget,
  withAttemptRetry,
} from './attempt/state.js';
import { runLeafTournament } from './attempt/leaf-tournament.js';
import { recheckArtifactAfterRepair } from './attempt/recheck.js';
import { emitSuccessfulArtifact } from './attempt/success.js';
import { resolveDecisionPhase } from './decision/phase.js';
import { runSplitRound, type SplitRoundResult } from './split-round.js';
import {
  assessMilestoneRound,
  type RoundAssessment,
} from './milestone/round-assessment.js';
import { runMilestoneLoop } from './milestone/loop.js';
import { reDecideMilestoneRound } from './milestone/redecide-round.js';

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

      report = await applyRootEmissionGate({
        goal,
        report,
        worktree: assembly.worktree,
        registry: this.registry,
        store: this.store,
        now: this.now,
      });
      return report;
    } finally {
      await finalizeSandboxedRun({
        goal,
        report,
        worktree: assembly.worktree,
        store: this.store,
        now: this.now,
      });
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

    const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
    const decisionPhase = await resolveDecisionPhase({
      goal,
      typeDef,
      tier: currentTier,
      registry: this.registry,
      brain: this.brain,
      store: this.store,
      now: t,
      patterns: this.patterns,
      goldenCapture: this.goldenCapture,
      ...(brainConfig !== undefined ? { brainConfig } : {}),
      skillForGoalType: (goalType) => this.decideSkillBlock(goalType),
      repoShapeForGoal: (goalForShape) => this.repoShapeHint(goalForShape),
      debitUsage: (usage) => debitTreeState(treeState, usage),
      hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
    });
    if (decisionPhase.kind === 'ceiling') {
      return this.ceilingReport(goal, treeState);
    }
    if (decisionPhase.kind === 'emitted') {
      return decisionPhase.report;
    }

    const { decision, decideUsage, terracedLoserFindings, goalShape } = decisionPhase;
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
            const repoRoot = this._activeAssembly?.worktree.repoRoot;
            if (repoRoot !== undefined) {
              childrenToSplit = await runKnowledgeCoverageSplitGate({
                goal,
                kind: typeDef.kind,
                children: decision.children,
                repoRoot,
                knowledge: this.knowledge,
                registry: this.registry,
                store: this.store,
                now: this.now,
              });
            }
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
    let attemptState = createAttemptLoopState({
      budget: goal.budget,
      tier: initialTier,
      tierIndex: initialTierIndex,
    });

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
      attemptState = withAttemptBudget(
        attemptState,
        await debitAttempt({ budget: attemptState.budget, goal, store: this.store, now: t }),
      );

      const ctx = attemptBrainContext(goal, attemptState);

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
        const loopResult = await runStepLoop({
          goal,
          grants: typeDef.grants,
          budget: attemptState.budget,
          ctx,
          typeDef,
          broker: this.effectiveBroker,
          sandboxRepoRoot: this._activeAssembly?.worktree.repoRoot,
          priorTranscript: attemptState.priorLoopTranscript,
          brain: this.brain,
          store: this.store,
          now: t,
          enforceToolCallBudget: this.enforceToolCallBudget,
          debitUsage: (usage) => debitTreeState(treeState, usage),
          hasReachedCeiling: () => hasReachedSpendCeiling(treeState),
        });

        if (loopResult.kind === 'ceiling') {
          // step loop tripped the ceiling — surface ceiling-reached once
          // and return immediately (no further brain calls).
          return this.ceilingReport(goal, treeState);
        } else if (loopResult.kind === 'artifact') {
          artifact = loopResult.artifact;
          attemptState = withAttemptBudget(attemptState, loopResult.budget);
          stepLoopTranscriptTail = loopResult.transcript;
          stepLoopTailFinding = stepLoopTranscriptFinding(stepLoopTranscriptTail);
          // Track accumulated step token usage on the tokens counter for
          // observability (ADR-033). Tokens never block work; the dollar ceiling
          // is the real bound on spend, enforced by the step loop's ceiling check.
          attemptState = withAttemptBudget(
            attemptState,
            await debitTokenCount({
              budget: attemptState.budget,
              tokens: loopResult.tokensUsed,
              goal,
              store: this.store,
              now: t,
            }),
          );
        } else {
          const failure = await transitionStepLoopFailure({
            goal,
            loopResult,
            tier: attemptState.tier,
            tierIndex: attemptState.tierIndex,
            tierLadder,
            priorAttempt: attemptState.priorAttempt,
            store: this.store,
            now: t,
            resolveFailure: (failureContext) =>
              this.handleFailure(
                goal,
                failureContext.artifact,
                failureContext.verdict,
                failureContext.budget,
                failureContext.tier,
                failureContext.tierIndex,
                tierLadder,
                failureContext.priorAttempt,
                treeState,
              ),
          });
          const continuation = continueAfterStepLoopFailure(failure);
          if (continuation.kind === 'return') {
            return continuation.report;
          }
          attemptState = withAttemptRetry(attemptState, continuation.retry);
          continue;
        }
      } else {
        // Classic produce path
        const produceResult = await produceClassicArtifact({
          goal,
          ctx,
          budget: attemptState.budget,
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
        attemptState = withAttemptBudget(attemptState, produceResult.budget);

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
            tier: attemptState.tier,
            budget: attemptState.budget,
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
          attemptState = withAttemptBudget(attemptState, tournResult.budget);
          tournamentRan = true;
        }
      }

      // ── DETERMINISTIC CHECKS ───────────────────────────────────────────
      const deterministicGate = await runDeterministicGate({
        goal,
        artifact,
        checks: typeDef.deterministic,
        budget: attemptState.budget,
        checkContext: this.checkContextFor(goal.id),
        store: this.store,
        now: t,
      });
      attemptState = withAttemptBudget(attemptState, deterministicGate.budget);
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
          const failure = await transitionArtifactFailure({
            goal,
            artifact,
            verdict: deterministicGate.verdict,
            budget: attemptState.budget,
            tier: attemptState.tier,
            tierIndex: attemptState.tierIndex,
            tierLadder,
            priorAttempt: attemptState.priorAttempt,
            stepLoopTailFinding,
            stepLoopTranscriptTail,
            resolveFailure: () =>
              this.handleFailure(
                goal,
                artifact,
                deterministicGate.verdict!,
                attemptState.budget,
                attemptState.tier,
                attemptState.tierIndex,
                tierLadder,
                attemptState.priorAttempt,
                treeState,
              ),
            recheck: (repairedArtifact, repairedBudget, repairedTier) =>
              this.recheckArtifactAfterRepair(
                goal,
                repairedArtifact,
                repairedBudget,
                repairedTier,
                typeDef,
                treeState,
              ),
            emitSuccess: (successArtifact) =>
              emitSuccessfulArtifact({
                goal,
                artifact: successArtifact,
                store: this.store,
                now: t,
                persist: (persistGoal, persistArtifact) =>
                  this.persistLeafKnowledge(persistGoal, persistArtifact),
              }),
          });
          const continuation = continueAfterArtifactFailure(failure);
          if (continuation.kind === 'ceiling') {
            return this.ceilingReport(goal, treeState);
          }
          if (continuation.kind === 'return') {
            return continuation.report;
          }
          attemptState = withAttemptRetry(attemptState, continuation.retry);
          continue;
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
          tier: attemptState.tier,
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
        attemptState = withAttemptBudget(
          attemptState,
          await debitTokenUsage({
            budget: attemptState.budget,
            usage: judgeResult.usage,
            goal,
            store: this.store,
            now: t,
          }),
        );

        if (!verdict.pass) {
          const failure = await transitionArtifactFailure({
            goal,
            artifact,
            verdict,
            budget: attemptState.budget,
            tier: attemptState.tier,
            tierIndex: attemptState.tierIndex,
            tierLadder,
            priorAttempt: attemptState.priorAttempt,
            stepLoopTailFinding,
            stepLoopTranscriptTail,
            resolveFailure: () =>
              this.handleFailure(
                goal,
                artifact,
                verdict,
                attemptState.budget,
                attemptState.tier,
                attemptState.tierIndex,
                tierLadder,
                attemptState.priorAttempt,
                treeState,
              ),
            recheck: (repairedArtifact, repairedBudget, repairedTier) =>
              this.recheckArtifactAfterRepair(
                goal,
                repairedArtifact,
                repairedBudget,
                repairedTier,
                typeDef,
                treeState,
              ),
            emitSuccess: (successArtifact) =>
              emitSuccessfulArtifact({
                goal,
                artifact: successArtifact,
                store: this.store,
                now: t,
                persist: (persistGoal, persistArtifact) =>
                  this.persistLeafKnowledge(persistGoal, persistArtifact),
              }),
          });
          const continuation = continueAfterArtifactFailure(failure);
          if (continuation.kind === 'ceiling') {
            return this.ceilingReport(goal, treeState);
          }
          if (continuation.kind === 'return') {
            return continuation.report;
          }
          attemptState = withAttemptRetry(attemptState, continuation.retry);
          continue;
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
  ): Promise<SplitRoundResult> {
    return runSplitRound({
      goal,
      children,
      extraFindings,
      memory: this.memory,
      registry: this.registry,
      brain: this.brain,
      goldenCapture: this.goldenCapture,
      store: this.store,
      now: this.now,
      activeRepoRoot: this._activeAssembly?.worktree.repoRoot,
      factsForRegions: this.knowledge?.factsForRegions,
      headSha: this.knowledge?.headSha,
      checkContext: this.checkContextFor(goal.id),
      persist: (mergeGoal, artifact) => this.persistLeafKnowledge(mergeGoal, artifact),
      runChild: (childGoal) => this._run(childGoal, treeState),
    });
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
    const typeDef = this.registry.get(goal.type);
    const iterative = typeDef.iterative!; // dispatch guard guarantees presence
    const effectiveMaxRounds = goal.maxRounds ?? iterative.maxRounds;
    return runMilestoneLoop({
      goal,
      initialChildren: children,
      effectiveMaxRounds,
      treeState,
      store: this.store,
      now: this.now,
      runRound: (roundChildren) => this.runRound(goal, roundChildren, [], treeState),
      reDecideRound: (priorAssessment, priorRoundRef) =>
        this.reDecideRound(goal, treeState, priorAssessment, priorRoundRef),
      persistCriteria: (artifact) => this.persistLeafKnowledge(goal, artifact),
      commitRound: (roundIndex) => this.commitRoundIfWorktree(roundIndex, goal.title),
      assessRound: (criteriaArtifact, mergedArtifact) =>
        this.assessRound(goal, criteriaArtifact, mergedArtifact, treeState),
      ceilingReachedOnce: () => this.ceilingReachedOnce(goal, treeState),
      ceilingReport: () => this.ceilingReport(goal, treeState),
    });
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
    priorAssessment: RoundAssessment,
    priorRoundRef: string | null,
  ): Promise<{ children: ChildPlan[] } | { halt: true }> {
    return reDecideMilestoneRound({
      goal,
      priorAssessment,
      priorRoundRef,
      worktreeRoot: this._activeAssembly?.worktree.root,
      registry: this.registry,
      brain: this.brain,
      store: this.store,
      now: this.now,
      decideSkill: this.decideSkillBlock(goal.type),
      tier: this.registry.get(goal.type).tier.default,
      debitUsage: (usage) => debitTreeState(treeState, usage),
    });
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
  ): Promise<RoundAssessment> {
    const brainConfig = (this.brain as { config?: { modelByTier?: Record<string, string> } }).config;
    return assessMilestoneRound({
      goal,
      criteriaArtifact,
      mergedArtifact,
      registry: this.registry,
      brain: this.brain,
      store: this.store,
      now: this.now,
      checkContext: this.checkContextFor(goal.id),
      goldenCapture: this.goldenCapture,
      ...(brainConfig !== undefined ? { brainConfig } : {}),
      debitUsage: (usage) => debitTreeState(treeState, usage),
    });
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
