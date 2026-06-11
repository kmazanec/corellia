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

import type { Goal, Tier, MemoryPointer, Budget, Usage } from '../contract/goal.js';
import type { Decision, ChildPlan } from '../contract/decision.js';
import type { Artifact, Report } from '../contract/report.js';
import type { Verdict, Finding } from '../contract/verdict.js';
import type { EventStore } from '../contract/events.js';
import type { Brain, BrainContext, StepTranscript } from '../contract/brain.js';
import type { Registry } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { RiskClass, SensitivityFact } from '../contract/risk.js';
import type { PatternStore } from '../contract/pattern.js';
import type { ToolBroker, ToolDef } from '../contract/tool.js';
import { GRANT_TOOL_MAP } from '../contract/tool.js';
import { subdivide, consume } from './budget.js';
import { lintLibrary } from '../library/constitution.js';
import { classifyRisk } from '../library/risk.js';
import { specShape } from '../flywheel/shape.js';
import type { CheckContext } from '../contract/goal-type.js';
import {
  openSandboxAssembly,
  type SandboxConfig,
  type SandboxAssembly,
} from './assembly.js';
import { diffWithinScope, collectTree, preserveTree } from './worktree.js';

/**
 * Per-tree spend ceiling default (learning phase, ADR-017).
 * Applied at the root when Goal.spendCeilingUsd is absent.
 */
const DEFAULT_SPEND_CEILING_USD = 15;

/**
 * Worst-case price constant for the conservative token-only ceiling fallback
 * (AC-5, ADR-017). Used when an endpoint reports tokens but not cost.
 * Covers output-token worst-case for opus-class models (~$0.000025/token).
 * The fallback fires only on cost-silent endpoints; over-conservatism just
 * halts earlier, which is preferable to under-bounding real spend.
 */
export const WORST_CASE_PRICE_PER_TOKEN = 0.000025;

/**
 * Mutable tree-scoped accumulator for the dollar ceiling. Created once at the
 * root run() call and passed by reference through all recursive child runs so
 * the whole tree shares a single spend counter. Never subdivided.
 */
interface TreeState {
  /** Running total of reported costUsd across all brain calls in the tree. */
  spentUsd: number;
  /**
   * The dollar ceiling for this tree. When spentUsd reaches ceilingUsd the
   * tree halts via runBlock with a decision brief and a ceiling-reached event.
   */
  ceilingUsd: number;
  /**
   * Set to true after the first 'ceiling-reached' event is emitted for this
   * tree. Prevents duplicate emission when concurrent branches all find the
   * ceiling tripped (ADR-017 one-in-flight exception — at most one event per
   * tree, not one per branch that trips it).
   */
  ceilingEmitted?: boolean;
}

export interface EngineOptions {
  registry: Registry;
  brain: Brain;
  store: EventStore;
  memory: MemoryView;
  now?: () => number;
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
}

export class Engine {
  private readonly registry: Registry;
  private readonly brain: Brain;
  private readonly store: EventStore;
  private readonly memory: MemoryView;
  private readonly now: () => number;
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

  /**
   * The composed sandbox assembly for the in-flight tree, set by run() at the
   * root when a SandboxConfig is present and cleared in the finally. While set,
   * it supplies the tree-scoped broker (overriding EngineOptions.broker) and the
   * per-goal CheckContext factory; absent, the engine uses the plain broker.
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
    const defs = opts.registry.names().map((n) => opts.registry.get(n));
    const violations = lintLibrary(defs);
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
    this.onBrief = opts.onBrief;
    this.sensitivity = opts.sensitivity ?? [];
    this.onGate = opts.onGate;
    this.patterns = opts.patterns;
    this.broker = opts.broker;
    this.sandbox = opts.sandbox;
  }

  async run(goal: Goal): Promise<Report> {
    const ceilingUsd = goal.spendCeilingUsd ?? DEFAULT_SPEND_CEILING_USD;
    const treeState: TreeState = { spentUsd: 0, ceilingUsd };

    // No sandbox configured → byte-identical to a plain run: no worktree, no
    // assembly, no new events.
    if (this.sandbox === undefined) {
      return this._run(goal, treeState);
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

      // ── EMISSION diff ⊆ scope (tree-level, AC-6) ──────────────────────────
      // The worktree is shared by the whole tree, so a per-leaf diff check would
      // see siblings' work. The sound v1 enforcement is at the TREE ROOT's
      // emission against the ROOT goal's scope: the worktree's total diff must
      // fall within the root goal's declared scope. (Per-leaf scope stays
      // enforced by the broker's write_file check and the filesWithinScope
      // deterministic check on each leaf's artifact.) A violation downgrades a
      // would-be success to a scope-insufficiency block and preserves the tree.
      if (report.blockers.length === 0) {
        const diff = diffWithinScope(assembly.worktree.root, goal.scope);
        if (!diff.ok) {
          report = blockedReport(
            `Scope insufficiency at tree emission: ${diff.scopeInsufficiency ?? 'diff exceeds declared scope'}`,
          );
          await this.store.append({ type: 'emitted', at: this.now(), goalId: goal.id, report });
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

    // FIX 3: early ceiling gate — if the tree is already over ceiling (prior
    // siblings consumed it), halt before making any brain call. Guard: only emit
    // 'ceiling-reached' once per tree; if it was already emitted by a sibling
    // the treeState is already over ceiling and this child returns the same report
    // shape without a second event.
    if (await this.checkCeiling(goal, treeState)) {
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
    const needsGate = typeDef.gated === true || entryRisk === 'high';
    if (needsGate) {
      const gateDecision = this.onGate
        ? await this.onGate(goal, entryRisk)
        : 'denied';
      await this.store.append({ type: 'gate-decision', at: t(), goalId: goal.id, resolution: gateDecision });
      if (gateDecision === 'denied') {
        const brief = gateDeniedBrief(goal, entryRisk, typeDef.gated === true);
        const report = blockedReport(
          `Authority gate denied: ${brief.question}`,
        );
        const resolution = this.effectiveOnBrief ? await this.effectiveOnBrief(brief) : brief.onTimeout;
        await this.store.append({ type: 'blocked', at: t(), goalId: goal.id, brief, resolution });
        await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
        return report;
      }
    }

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
      const memoStatus: 'none' | 'provisional' | 'trusted' =
        memo === null ? 'none' : memo.status;

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
        // when one exists (the brain weighs it, never obeys it).
        const baseCtx: BrainContext = {
          tier: currentTier,
          memories: goal.memories,
          ...(memoStatus === 'provisional' && memo !== null
            ? { patternHint: memo }
            : {}),
        };

        const scan = typeDef.scan;
        if (scan && scan.k > 1 && memoStatus === 'none' && this.registry.has('judge-split')) {
          // ── TERRACED SCAN — novel shape, k > 1 ────────────────────────
          // Generate k lens-diverse candidates and rank them with judge-split.
          // The winning candidate (first pass, tie-broken by fewest findings)
          // becomes the decision; losers are collected as low-severity findings
          // ("alternatives considered") and surfaced in the split report.
          const scanResult = await this.runTerracedScan(goal, scan.k, scan.lenses, baseCtx, currentTier, shape, treeState);
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
          this.debitTreeState(treeState, decideResult.usage);
          if (await this.checkCeiling(goal, treeState)) {
            await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision, usage: decideResult.usage });
            return this.ceilingReport(goal, treeState);
          }
        }
      }
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

      const maxSplitAttempts = budget.attempts;
      let splitAttempts = 0;

      while (true) {
        const structErr = validateSplit(decision.children, budget);
        if (structErr) {
          // Structural violation of the split → fail verdict, re-decide with
          // priorAttempt carrying the rejection
          splitAttempts++;
          const consumed = consume(budget, 'attempts');
          budget = consumed.budget;
          const failVerdict: Verdict = {
            pass: false,
            findings: [
              {
                title: 'Invalid split structure',
                dimension: 'spec',
                severity: 'high',
                gating: true,
                prescription: structErr,
              },
            ],
            failureSignature: `invalid-split:${structErr}`,
          };
          priorVerdict = failVerdict;

          if (consumed.exhausted || splitAttempts >= maxSplitAttempts) {
            await this.store.append({
              type: 'budget-exhausted',
              at: t(),
              goalId: goal.id,
              dimension: 'attempts',
            });
            const report = blockedReport(
              `Split structural validation failed: ${structErr}`,
            );
            await this.store.append({
              type: 'emitted',
              at: t(),
              goalId: goal.id,
              report,
            });
            return report;
          }

          // Re-decide with failure context
          const splitPlanArtifact: Artifact = {
            kind: 'text',
            text: JSON.stringify(decision.children),
          };
          const reDecideCtx: BrainContext = {
            tier: currentTier,
            memories: goal.memories,
            priorAttempt: { artifact: splitPlanArtifact, verdict: failVerdict },
          };
          const reDecideResult = await this.brain.decide(goal, reDecideCtx);
          decision = reDecideResult.value;
          decideUsage = reDecideResult.usage;
          this.debitTreeState(treeState, reDecideResult.usage);
          if (await this.checkCeiling(goal, treeState)) {
            await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision, usage: reDecideResult.usage });
            return this.ceilingReport(goal, treeState);
          }
          if (decision.kind !== 'split') break; // changed its mind
          continue;
        }

        // Structure is valid. If there is a judge-split type, judge the split.
        if (this.registry.has('judge-split')) {
          const splitPlanArtifact: Artifact = {
            kind: 'text',
            text: JSON.stringify(decision.children),
          };
          const rubric =
            'Evaluate the split: is it sound and complete? Are dependencies correct and acyclic? Are budgetShares sensible?';
          const judgeCtx: BrainContext = {
            tier: currentTier,
            memories: goal.memories,
          };
          const splitJudgeResult = await this.brain.judge(
            goal,
            splitPlanArtifact,
            rubric,
            judgeCtx,
          );
          const splitVerdict = splitJudgeResult.value;
          this.debitTreeState(treeState, splitJudgeResult.usage);
          await this.store.append({
            type: 'judge-verdict',
            at: t(),
            goalId: goal.id,
            judgeType: 'judge-split',
            verdict: splitVerdict,
            tier: currentTier,
            usage: splitJudgeResult.usage,
          });
          if (await this.checkCeiling(goal, treeState)) {
            return this.ceilingReport(goal, treeState);
          }

          if (!splitVerdict.pass) {
            splitAttempts++;
            const consumed = consume(budget, 'attempts');
            budget = consumed.budget;

            // Isomorphic failure check
            if (
              priorVerdict &&
              splitVerdict.failureSignature &&
              splitVerdict.failureSignature === priorVerdict.failureSignature
            ) {
              const report = blockedReport(
                `Isomorphic split failure (signature: ${splitVerdict.failureSignature})`,
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

            if (consumed.exhausted || splitAttempts >= maxSplitAttempts) {
              await this.store.append({
                type: 'budget-exhausted',
                at: t(),
                goalId: goal.id,
                dimension: 'attempts',
              });
              const report = blockedReport('Split eval failed, budget exhausted');
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
            }

            // Re-decide carrying the rejected split
            const splitPlanWithFailure: Artifact = {
              kind: 'text',
              text: JSON.stringify(decision.children),
            };
            const reDecideCtx2: BrainContext = {
              tier: currentTier,
              memories: goal.memories,
              priorAttempt: {
                artifact: splitPlanWithFailure,
                verdict: splitVerdict,
              },
            };
            const reDecideResult2 = await this.brain.decide(goal, reDecideCtx2);
            decision = reDecideResult2.value;
            decideUsage = reDecideResult2.usage;
            this.debitTreeState(treeState, reDecideResult2.usage);
            if (await this.checkCeiling(goal, treeState)) {
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
        const splitReport = await this.runSplit(goal, decision.children, terracedLoserFindings, treeState);

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

  // ── TERRACED SCAN ─────────────────────────────────────────────────────────
  /**
   * Generate k lens-diverse candidate splits for a novel shape, rank them with
   * judge-split, and return the winning decision alongside low-severity findings
   * that describe each losing candidate ("alternative considered").
   *
   * Candidates are lens-diverse, not k identical rolls of the same prompt — each
   * call uses a different lens (an architect's cut, a reuse-maximising cut, a
   * contrarian's cut) so that the tournament catches failure modes redundancy
   * cannot. The winner is the first candidate whose judge-split verdict passes,
   * tie-broken by fewest findings. Losing candidates are returned as low-severity,
   * non-gating findings (dimension 'spec') so they surface in the split report as
   * "alternatives considered" — explored, not retrofitted. No extra `decided`
   * events are emitted for losers; only the winner's single `decided` (at the
   * normal DISPATCH path) is the authority record.
   *
   * When no candidate passes, the scan falls through to a plain single-derive
   * call whose BrainContext carries the best candidate's verdict as priorAttempt,
   * so the brain can use what the tournament learned.
   */
  private async runTerracedScan(
    goal: Goal,
    k: number,
    lenses: string[],
    baseCtx: BrainContext,
    currentTier: Tier,
    _shape: string,
    treeState: TreeState,
  ): Promise<{ decision: Decision; loserFindings: string[]; winnerUsage?: Usage } | { ceiling: true }> {
    const t = this.now;
    type Candidate = {
      decision: Extract<Decision, { kind: 'split' }>;
      verdict: Verdict;
      lens: string;
      decideUsage: Usage;
      judgeUsage: Usage;
    };

    const candidates: Candidate[] = [];
    const rubric =
      'Evaluate the split: is it sound and complete? Are dependencies correct and acyclic? Are budgetShares sensible?';

    for (let i = 0; i < k; i++) {
      const lens = lenses[i % lenses.length] ?? lenses[0]!;
      const lensCtx: BrainContext = { ...baseCtx, lens };
      const decideResult = await this.brain.decide(goal, lensCtx);
      const candidate = decideResult.value;
      this.debitTreeState(treeState, decideResult.usage);
      // FIX 2: ceiling check after each terraced-scan decide debit.
      if (await this.checkCeiling(goal, treeState)) {
        return { ceiling: true };
      }

      if (candidate.kind !== 'split') {
        // A candidate that is not a split is itself a meaningful decision —
        // return it immediately (satisfy or block beats an uncertain tournament).
        return { decision: candidate, loserFindings: [], winnerUsage: decideResult.usage };
      }

      const splitArtifact: Artifact = {
        kind: 'text',
        text: JSON.stringify(candidate.children),
      };
      const judgeCtx: BrainContext = { tier: currentTier, memories: goal.memories };
      const judgeResult = await this.brain.judge(goal, splitArtifact, rubric, judgeCtx);
      const verdict = judgeResult.value;
      this.debitTreeState(treeState, judgeResult.usage);
      // FIX 2: ceiling check after each terraced-scan judge debit.
      if (await this.checkCeiling(goal, treeState)) {
        return { ceiling: true };
      }
      await this.store.append({
        type: 'judge-verdict',
        at: t(),
        goalId: goal.id,
        judgeType: 'judge-split',
        verdict,
        tier: currentTier,
        usage: judgeResult.usage,
      });

      candidates.push({ decision: candidate, verdict, lens, decideUsage: decideResult.usage, judgeUsage: judgeResult.usage });
    }

    // Rank: first passing verdict wins; tie-break by fewest findings.
    const passing = candidates.filter((c) => c.verdict.pass);

    let winner: Candidate | undefined;
    if (passing.length > 0) {
      winner = passing.reduce((best, c) =>
        c.verdict.findings.length < best.verdict.findings.length ? c : best,
      );
    }

    // Collect losing candidates as advisory findings — explored paths the
    // tournament did not select. They surface in the split report without
    // blocking it (gating: false, severity: low).
    const losers = winner
      ? candidates.filter((c) => c !== winner)
      : candidates;

    const loserFindings: string[] = losers.map((loser) => {
      const summary = loser.verdict.findings.length > 0
        ? loser.verdict.findings[0]!.title
        : (loser.verdict.pass ? 'passed' : 'failed judge');
      return `alternative considered (lens=${loser.lens}): ${summary}`;
    });

    if (winner !== undefined) {
      return { decision: winner.decision, loserFindings, winnerUsage: winner.decideUsage };
    }

    // No candidate passed — fall through to a normal single-derive call
    // carrying the best candidate's verdict so the brain learns from the scan.
    const bestLoser = candidates.reduce((best, c) =>
      c.verdict.findings.length < best.verdict.findings.length ? c : best,
    );
    const fallbackArtifact: Artifact = {
      kind: 'text',
      text: JSON.stringify(bestLoser.decision.children),
    };
    const fallbackCtx: BrainContext = {
      ...baseCtx,
      priorAttempt: { artifact: fallbackArtifact, verdict: bestLoser.verdict },
    };
    const fallbackResult = await this.brain.decide(goal, fallbackCtx);
    this.debitTreeState(treeState, fallbackResult.usage);
    // FIX 2: ceiling check after terraced-scan fallback debit.
    if (await this.checkCeiling(goal, treeState)) {
      return { ceiling: true };
    }
    return { decision: fallbackResult.value, loserFindings, winnerUsage: fallbackResult.usage };
  }

  // ── ATTEMPT LOOP (the control loop) ──────────────────────────────────────
  private async runAttemptLoop(
    goal: Goal,
    initialTier: Tier,
    initialTierIndex: number,
    tierLadder: Tier[],
    deadline: number,
    entryRisk: RiskClass = 'low',
    treeState: TreeState = { spentUsd: 0, ceilingUsd: DEFAULT_SPEND_CEILING_USD },
  ): Promise<Report> {
    const t = this.now;
    const typeDef = this.registry.get(goal.type);
    let budget = goal.budget;
    let tier: Tier = initialTier;
    let tierIndex: number = initialTierIndex;
    let priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined;

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

      // Check attempts budget before producing
      if (budget.attempts <= 0) {
        await this.store.append({
          type: 'budget-exhausted',
          at: t(),
          goalId: goal.id,
          dimension: 'attempts',
        });
        return this.runBlock(goal, exhaustedBrief(goal, 'attempts'));
      }

      // Consume one attempt
      const consumed = consume(budget, 'attempts');
      budget = consumed.budget;

      const ctx: BrainContext = priorAttempt
        ? { tier, memories: goal.memories, priorAttempt }
        : { tier, memories: goal.memories };

      // ── STEP LOOP (tool-granted path) ──────────────────────────────────────
      // Run the step loop when the goal type has at least one grant that maps to
      // a known tool AND a broker is configured. Otherwise fall through to the
      // classic produce path.
      let artifact: Artifact;
      let stepLoopTranscriptTail: StepTranscript | undefined;
      // FIX 1: when the step loop produces an artifact, carry a compact
      // serialization of the transcript tail so that any subsequent failure
      // (deterministic or judge) can thread it into the next attempt's
      // BrainContext.priorAttempt. Stored as a non-gating advisory finding so
      // it travels through every priorAttempt assignment that follows.
      let stepLoopTailFinding: import('../contract/verdict.js').Finding | null = null;

      if (isToolGranted(typeDef.grants) && this.effectiveBroker !== undefined) {
        const loopResult = await this.runStepLoop(goal, typeDef.grants, budget, ctx, priorAttempt, treeState);

        if (loopResult.kind === 'ceiling') {
          // FIX 1a: step loop tripped the ceiling — surface ceiling-reached once
          // and return immediately (no further brain calls).
          return this.ceilingReport(goal, treeState);
        } else if (loopResult.kind === 'artifact') {
          artifact = loopResult.artifact;
          budget = loopResult.budget;
          stepLoopTranscriptTail = loopResult.transcript;
          const tail = stepLoopTranscriptTail.slice(-8).map((m) => {
            if (m.role === 'assistant') {
              return { role: m.role, calls: m.toolCalls?.map((c) => c.name) ?? [] };
            } else if (m.role === 'context') {
              return { role: m.role, content: m.content };
            } else {
              return { role: m.role, content: m.content.slice(0, 120) };
            }
          });
          if (tail.length > 0) {
            stepLoopTailFinding = {
              title: `step-loop-transcript:${JSON.stringify(tail)}`,
              dimension: 'spec',
              severity: 'low',
              gating: false,
            };
          }
          // FIX 1b: debit accumulated step token usage against the tokens budget
          // dimension, exactly as the classic produce branch does. This gates tool
          // leaves on the tokens dimension so a tight tokens budget exhausts them.
          const stepTokens = loopResult.tokensUsed;
          if (stepTokens > 0) {
            const tkConsumed = consumeN(budget, 'tokens', stepTokens);
            budget = tkConsumed.budget;
            if (tkConsumed.exhausted) {
              await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'tokens' });
              return this.runBlock(goal, exhaustedBrief(goal, 'tokens'));
            }
          }
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
          const transcriptArtifact: Artifact = {
            kind: 'text',
            text: JSON.stringify(loopResult.transcript ?? []),
          };
          const loopVerdict: import('../contract/verdict.js').Verdict = {
            pass: false,
            findings: [
              {
                title: loopResult.kind === 'exhausted'
                  ? 'Tool-call budget exhausted in step loop'
                  : `Step loop failed: ${loopResult.error}`,
                dimension: 'spec',
                severity: 'high',
                gating: true,
              },
            ],
            failureSignature: `step-loop:${loopResult.kind}`,
          };
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
            continue;
          } else if (resolution.kind === 'escalated') {
            tier = resolution.tier;
            tierIndex = tierLadder.indexOf(tier);
            budget = resolution.budget;
            priorAttempt = { artifact: transcriptArtifact, verdict: loopVerdict };
            continue;
          } else {
            return resolution.report;
          }
        }
      } else {
        // Classic produce path
        const produceResult = await this.brain.produce(goal, ctx);
        artifact = produceResult.value;
        this.debitTreeState(treeState, produceResult.usage);
        await this.store.append({ type: 'produced', at: t(), goalId: goal.id, usage: produceResult.usage });
        if (await this.checkCeiling(goal, treeState)) {
          return this.ceilingReport(goal, treeState);
        }
        // Debit reported tokens against the tokens budget dimension.
        const produceTokens = produceResult.usage.promptTokens + produceResult.usage.completionTokens;
        if (produceTokens > 0) {
          const tkConsumed = consumeN(budget, 'tokens', produceTokens);
          budget = tkConsumed.budget;
          if (tkConsumed.exhausted) {
            await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'tokens' });
            return this.runBlock(goal, exhaustedBrief(goal, 'tokens'));
          }
        }
      }

      // ── DETERMINISTIC CHECKS ───────────────────────────────────────────
      let deterministicVerdict: Verdict | null = null;
      if (typeDef.deterministic.length > 0) {
        const findings: Finding[] = [];
        let allOk = true;
        let toolCallsUsed = 0;

        const checkCtx = this.checkContextFor(goal.id);
        for (const check of typeDef.deterministic) {
          toolCallsUsed++;
          const result = await check.run(goal, artifact, checkCtx);
          if (!result.ok) {
            allOk = false;
            // Deterministic checks produce objective failures — detail is an
            // explanation, not a repair prescription. The repair rung is for
            // judge findings with explicit prescriptions.
            findings.push({
              title: `${check.name}: ${result.detail}`,
              dimension: 'spec',
              severity: 'high',
              gating: true,
            });
          }
        }

        // Track tool calls spent
        const tcConsumed = consumeN(budget, 'toolCalls', toolCallsUsed);
        budget = tcConsumed.budget;
        if (tcConsumed.exhausted) {
          await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'toolCalls' });
          return this.runBlock(goal, exhaustedBrief(goal, 'toolCalls'));
        }

        deterministicVerdict = {
          pass: allOk,
          findings,
          ...(allOk ? {} : { failureSignature: `deterministic:${findings.map((f) => f.title).join(',')}` }),
        };

        await this.store.append({
          type: 'deterministic-checked',
          at: t(),
          goalId: goal.id,
          verdict: deterministicVerdict,
        });

        if (!deterministicVerdict.pass) {
          // Deterministic fail → try repair rung, then escalate, never judge
          const resolution = await this.handleFailure(
            goal,
            artifact,
            deterministicVerdict,
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
              verdict: deterministicVerdict,
            };
            // Re-run checks on the repaired artifact immediately (repair is part of
            // the same attempt that produced the flawed artifact — no extra consume)
            const recheck = await this.recheckAndJudge(
              goal,
              resolution.artifact,
              budget,
              tier,
              treeState,
            );
            budget = recheck.budget;

            if (recheck.ceiling) {
              return this.ceilingReport(goal, treeState);
            }
            if (recheck.passed) {
              const report = buildReport(goal, resolution.artifact);
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
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
            // attempt's BrainContext carries step-loop evidence (FIX 1).
            priorAttempt = {
              artifact,
              verdict: stepLoopTailFinding !== null
                ? { ...deterministicVerdict, findings: [stepLoopTailFinding, ...deterministicVerdict.findings] }
                : deterministicVerdict,
            };
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
      if (artifact.kind === 'files' && artifact.files && artifact.files.length > 0) {
        const artifactPaths = artifact.files.map((f) => f.path);
        const emitRisk = classifyRisk(artifactPaths, this.sensitivity);
        await this.store.append({ type: 'risk-classified', at: t(), goalId: goal.id, risk: emitRisk });

        // Gate fires when artifact risk is high and entry scope was not — the
        // scope declaration did not cover the sensitive surface actually touched.
        if (emitRisk === 'high' && entryRisk !== 'high') {
          const gateDecision = this.onGate
            ? await this.onGate(goal, emitRisk)
            : 'denied';
          await this.store.append({ type: 'gate-decision', at: t(), goalId: goal.id, resolution: gateDecision });
          if (gateDecision === 'denied') {
            const brief = gateDeniedBrief(goal, emitRisk, false);
            const report = blockedReport(
              `Authority gate denied at emission (artifact touched sensitive paths): ${brief.question}`,
            );
            const resolution = this.effectiveOnBrief ? await this.effectiveOnBrief(brief) : brief.onTimeout;
            await this.store.append({ type: 'blocked', at: t(), goalId: goal.id, brief, resolution });
            await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
            return report;
          }
        }
      }

      // ── LLM JUDGE (only if deterministic passed) ─────────────────────────
      if (typeDef.judgeType !== null) {
        const rubric = `Judge this artifact as a ${typeDef.judgeType} for goal type ${typeDef.name}`;
        const judgeCtx: BrainContext = { tier, memories: goal.memories };
        const judgeResult = await this.brain.judge(goal, artifact, rubric, judgeCtx);
        const verdict = judgeResult.value;

        this.debitTreeState(treeState, judgeResult.usage);
        await this.store.append({
          type: 'judge-verdict',
          at: t(),
          goalId: goal.id,
          judgeType: typeDef.judgeType,
          verdict,
          tier,
          usage: judgeResult.usage,
        });
        if (await this.checkCeiling(goal, treeState)) {
          return this.ceilingReport(goal, treeState);
        }

        // Debit reported tokens against the tokens budget dimension.
        const judgeTokens = judgeResult.usage.promptTokens + judgeResult.usage.completionTokens;
        if (judgeTokens > 0) {
          const tkConsumed = consumeN(budget, 'tokens', judgeTokens);
          budget = tkConsumed.budget;
          if (tkConsumed.exhausted) {
            await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'tokens' });
            return this.runBlock(goal, exhaustedBrief(goal, 'tokens'));
          }
        }

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
            const recheck = await this.recheckAndJudge(
              goal,
              resolution.artifact,
              budget,
              tier,
              treeState,
            );
            budget = recheck.budget;

            if (recheck.ceiling) {
              return this.ceilingReport(goal, treeState);
            }
            if (recheck.passed) {
              const report = buildReport(goal, resolution.artifact);
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
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
            // attempt's BrainContext carries step-loop evidence (FIX 1).
            priorAttempt = {
              artifact,
              verdict: stepLoopTailFinding !== null
                ? { ...verdict, findings: [stepLoopTailFinding, ...verdict.findings] }
                : verdict,
            };
            continue;
          } else {
            return resolution.report;
          }
        }
      }

      // Both gates passed (or no judge) — emit the report
      const report = buildReport(goal, artifact);
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return report;
    }
  }

  /**
   * Run the engine-owned step loop for a tool-granted leaf. The brain is called
   * pure per step; the engine gates each step on remaining toolCalls budget,
   * routes tool calls through the broker, and logs every step and result. Returns
   * either the final artifact (with updated budget) or a failure descriptor.
   */
  private async runStepLoop(
    goal: Goal,
    grants: string[],
    budget: Budget,
    ctx: BrainContext,
    _priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined,
    treeState: TreeState = { spentUsd: 0, ceilingUsd: DEFAULT_SPEND_CEILING_USD },
  ): Promise<
    | { kind: 'artifact'; artifact: Artifact; budget: Budget; transcript: StepTranscript; tokensUsed: number }
    | { kind: 'exhausted'; budget: Budget; transcript: StepTranscript }
    | { kind: 'failed'; error: string; budget: Budget; transcript: StepTranscript }
    | { kind: 'ceiling'; budget: Budget; transcript: StepTranscript }
  > {
    const t = this.now;
    const tools = deriveToolDefs(grants);
    const transcript: StepTranscript = [];
    let remainingToolCalls = budget.toolCalls;
    let stepIndex = 0;
    // Accumulate total token usage across all steps for tokens-budget debit (FIX 1b).
    let totalTokensUsed = 0;

    // Inject initial context message for the brain
    transcript.push({
      role: 'context',
      content: `${remainingToolCalls} tool calls remaining`,
    });

    while (true) {
      // Gate: must have budget for at least one more step before calling the brain
      if (remainingToolCalls <= 0) {
        return { kind: 'exhausted', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
      }

      // Update the context message with the current remaining count (replace last context)
      const lastMsg = transcript[transcript.length - 1];
      if (lastMsg && lastMsg.role === 'context') {
        (transcript[transcript.length - 1] as { role: 'context'; content: string }).content =
          `${remainingToolCalls} tool calls remaining`;
      } else {
        transcript.push({ role: 'context', content: `${remainingToolCalls} tool calls remaining` });
      }

      let stepOutput: import('../contract/brain.js').StepOutput;
      try {
        stepOutput = await this.brain.step(goal, transcript, tools, ctx);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { kind: 'failed', error, budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
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
      this.debitTreeState(treeState, stepOutput.usage);
      // FIX 1b: accumulate step token usage for tokens-budget debit.
      totalTokensUsed += stepOutput.usage.promptTokens + stepOutput.usage.completionTokens;
      stepIndex++;
      // FIX 1a: ceiling check after each step debit — surface ceiling-reached
      // exactly once and short-circuit the loop.
      if (await this.checkCeiling(goal, treeState)) {
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
        return {
          kind: 'artifact',
          artifact: stepOutput.artifact,
          budget: { ...budget, toolCalls: remainingToolCalls },
          transcript,
          tokensUsed: totalTokensUsed,
        };
      }

      // Tool-calls path: append assistant turn to transcript, then route each call.
      // FIX 2: check remaining BEFORE dispatching each call so that a step that
      // returns multiple calls cannot drive the counter negative when only one
      // slot remains. When the counter hits 0 with calls left, stop routing and
      // surface exhaustion exactly like the pre-step gate above.
      transcript.push({
        role: 'assistant',
        content: '',
        toolCalls: stepOutput.calls,
      });

      for (const call of stepOutput.calls) {
        if (remainingToolCalls <= 0) {
          return { kind: 'exhausted', budget: { ...budget, toolCalls: remainingToolCalls }, transcript };
        }

        const result = await this.effectiveBroker!.execute(goal, call);
        remainingToolCalls--;

        // Log the tool-call event
        await this.store.append({
          type: 'tool-call',
          at: t(),
          goalId: goal.id,
          tool: call.name,
          callId: call.id,
          outcome: result.ok ? 'ran' : 'refused',
          ...(result.ok ? {} : { reason: result.output }),
        });

        // Append result to transcript regardless of ok/refusal (refusal is data)
        transcript.push({
          role: 'tool',
          callId: call.id,
          content: result.output,
        });
      }

      // After routing all calls, update remaining in context for next step
      // (the context message is prepended at the top of the next iteration)
    }
  }

  /**
   * Re-run all deterministic checks (and judge if applicable) on a repaired
   * artifact. Returns whether it passed and the updated budget.
   */
  private async recheckAndJudge(
    goal: Goal,
    artifact: Artifact,
    budget: Budget,
    tier: Tier,
    treeState: TreeState = { spentUsd: 0, ceilingUsd: DEFAULT_SPEND_CEILING_USD },
  ): Promise<{ passed: boolean; budget: Budget; verdict: Verdict | null; tier: Tier; ceiling?: true }> {
    const t = this.now;
    const typeDef = this.registry.get(goal.type);

    // Re-run deterministic
    if (typeDef.deterministic.length > 0) {
      const findings: Finding[] = [];
      let allOk = true;
      let toolCallsUsed = 0;

      const recheckCtx = this.checkContextFor(goal.id);
      for (const check of typeDef.deterministic) {
        toolCallsUsed++;
        const result = await check.run(goal, artifact, recheckCtx);
        if (!result.ok) {
          allOk = false;
          findings.push({
            title: `${check.name}: ${result.detail}`,
            dimension: 'spec',
            severity: 'high',
            gating: true,
          });
        }
      }

      const tcConsumed = consumeN(budget, 'toolCalls', toolCallsUsed);
      budget = tcConsumed.budget;

      const detVerdict: Verdict = {
        pass: allOk,
        findings,
        ...(allOk ? {} : { failureSignature: `deterministic:${findings.map((f) => f.title).join(',')}` }),
      };

      await this.store.append({
        type: 'deterministic-checked',
        at: t(),
        goalId: goal.id,
        verdict: detVerdict,
      });

      if (!detVerdict.pass) {
        return { passed: false, budget, verdict: detVerdict, tier };
      }
    }

    // Re-run judge
    if (typeDef.judgeType !== null) {
      const rubric = `Judge this artifact as a ${typeDef.judgeType} for goal type ${typeDef.name}`;
      const judgeCtx: BrainContext = { tier, memories: goal.memories };
      const judgeResult = await this.brain.judge(goal, artifact, rubric, judgeCtx);
      const verdict = judgeResult.value;

      this.debitTreeState(treeState, judgeResult.usage);
      await this.store.append({
        type: 'judge-verdict',
        at: t(),
        goalId: goal.id,
        judgeType: typeDef.judgeType,
        verdict,
        tier,
        usage: judgeResult.usage,
      });
      // FIX 2: ceiling check after recheckAfterRepair judge debit.
      if (await this.checkCeiling(goal, treeState)) {
        return { passed: false, budget, verdict: null, tier, ceiling: true };
      }

      if (!verdict.pass) {
        return { passed: false, budget, verdict, tier };
      }
    }

    return { passed: true, budget, verdict: null, tier };
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
    treeState: TreeState = { spentUsd: 0, ceilingUsd: DEFAULT_SPEND_CEILING_USD },
  ): Promise<
    | { kind: 'repaired'; artifact: Artifact; budget: Budget }
    | { kind: 'escalated'; tier: Tier; budget: Budget }
    | { kind: 'blocked'; report: Report }
  > {
    const t = this.now;

    // Check for escalated findings — human decision required
    const escalatedFinding = verdict.findings.find(
      (f) => f.gating && f.escalated,
    );
    if (escalatedFinding) {
      const report = blockedReport(
        `Escalated finding requires human decision: ${escalatedFinding.title}`,
        verdict.findings.map((f) => f.title),
      );
      const brief = escalatedBrief(goal, escalatedFinding);
      const resolution = this.effectiveOnBrief ? await this.effectiveOnBrief(brief) : brief.onTimeout;
      await this.store.append({
        type: 'blocked',
        at: t(),
        goalId: goal.id,
        brief,
        resolution,
      });
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return { kind: 'blocked', report };
    }

    // Isomorphic failure check
    if (
      priorAttempt &&
      verdict.failureSignature &&
      priorAttempt.verdict.failureSignature === verdict.failureSignature
    ) {
      const report = blockedReport(
        `Isomorphic failure detected (signature: ${verdict.failureSignature}) — escalating to block`,
        verdict.findings.map((f) => f.title),
      );
      const brief = isomorphicBrief(goal, verdict.failureSignature);
      const resolution = this.effectiveOnBrief ? await this.effectiveOnBrief(brief) : brief.onTimeout;
      await this.store.append({
        type: 'blocked',
        at: t(),
        goalId: goal.id,
        brief,
        resolution,
      });
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return { kind: 'blocked', report };
    }

    // Repair rung: gating findings with prescriptions that are not escalated
    const prescribedFindings = verdict.findings.filter(
      (f) => f.gating && f.prescription && !f.escalated,
    );

    if (prescribedFindings.length > 0) {
      const prescriptions = prescribedFindings.map((f) => f.prescription!);
      const repairCtx: BrainContext = { tier, memories: goal.memories };
      const repairResult = await this.brain.repair(
        goal,
        artifact,
        prescriptions,
        repairCtx,
      );
      const repairedArtifact = repairResult.value;
      this.debitTreeState(treeState, repairResult.usage);
      await this.store.append({
        type: 'repair-applied',
        at: t(),
        goalId: goal.id,
        prescriptions,
        usage: repairResult.usage,
      });
      // FIX 2: ceiling check after handleFailure repair debit.
      if (await this.checkCeiling(goal, treeState)) {
        const ceilingRpt = await this.ceilingReport(goal, treeState);
        return { kind: 'blocked', report: ceilingRpt };
      }
      return { kind: 'repaired', artifact: repairedArtifact, budget };
    }

    // No prescriptions → escalate tier
    const nextTierIndex = tierIndex + 1;
    if (nextTierIndex < tierLadder.length) {
      const nextTier = tierLadder[nextTierIndex];
      if (nextTier === undefined) {
        // Ladder exhausted
        return this.blockOnBudgetExhaustion(goal, budget, 'attempts');
      }
      await this.store.append({
        type: 'tier-escalated',
        at: t(),
        goalId: goal.id,
        from: tier,
        to: nextTier,
      });
      return { kind: 'escalated', tier: nextTier, budget };
    }

    // Tier ladder exhausted → block
    return this.blockOnBudgetExhaustion(goal, budget, 'attempts');
  }

  private async blockOnBudgetExhaustion(
    goal: Goal,
    budget: Budget,
    dim: keyof Budget,
  ): Promise<{ kind: 'blocked'; report: Report }> {
    const t = this.now;
    const brief = exhaustedBrief(goal, dim);
    await this.store.append({
      type: 'budget-exhausted',
      at: t(),
      goalId: goal.id,
      dimension: dim,
    });
    const report = await this.runBlock(goal, brief);
    return { kind: 'blocked', report };
  }

  // ── SPLIT PATH ────────────────────────────────────────────────────────────
  private async runSplit(
    goal: Goal,
    children: ChildPlan[],
    extraFindings: string[] = [],
    treeState: TreeState = { spentUsd: 0, ceilingUsd: DEFAULT_SPEND_CEILING_USD },
  ): Promise<Report> {
    const t = this.now;

    // Subdivide the budget by each child's share
    const shares = children.map((c) => c.budgetShare);
    const budgets = subdivide(goal.budget, shares);

    // Build child goals, injecting memories via memory.query (spawner-mediated)
    const childGoals: Goal[] = await Promise.all(children.map(async (child, i) => {
      const childMemories = await this.memory.query(child.title, child.scope);
      const childBudget = budgets[i] ?? {
        attempts: 1,
        tokens: 1,
        toolCalls: 1,
        wallClockMs: 1,
      };
      return {
        id: `${goal.id}/${child.localId}`,
        type: child.type,
        parentId: goal.id,
        title: child.title,
        spec: child.spec,
        intent: child.intent ?? goal.intent,
        scope: child.scope,
        budget: childBudget,
        memories: childMemories,
        ...(goal.spendCeilingUsd !== undefined ? { spendCeilingUsd: goal.spendCeilingUsd } : {}),
      };
    }));

    // Emit child-spawned events
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const childGoal = childGoals[i]!;
      await this.store.append({
        type: 'child-spawned',
        at: t(),
        goalId: goal.id,
        childId: childGoal.id,
        childType: child.type,
        dependsOn: child.dependsOn.map((localId) => `${goal.id}/${localId}`),
      });
    }

    // Build a promise map: localId → Promise<Report>
    // Children run when all dependsOn siblings' reports are available.
    const reportMap = new Map<string, Promise<Report>>();
    const localIdToIndex = new Map<string, number>();
    children.forEach((c, i) => localIdToIndex.set(c.localId, i));

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const childGoal = childGoals[i]!;

      const depPromises = child.dependsOn.map((depLocalId) => {
        const p = reportMap.get(depLocalId);
        if (!p) throw new Error(`Dependency "${depLocalId}" not found — this should have been caught in validateSplit`);
        return p;
      });

      // This child's promise awaits its deps then runs
      const childPromise = (async () => {
        try {
          // Await all dependencies
          const depReports = await Promise.all(depPromises);

          // If any dependency failed or blocked, this child is blocked too
          const failedDep = depReports.find((r) => r.blockers.length > 0);
          if (failedDep) {
            const report = blockedReport(
              `Blocked because a dependency failed: ${failedDep.blockers[0] ?? 'unknown'}`,
            );
            await this.store.append({
              type: 'emitted',
              at: t(),
              goalId: childGoal.id,
              report,
            });
            return report;
          }

          // Run the child through the engine (shares the tree-scoped accumulator)
          return await this._run(childGoal, treeState);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const report = blockedReport(`child threw: ${msg}`);
          await this.store.append({ type: 'emitted', at: t(), goalId: childGoal.id, report });
          return report;
        }
      })();

      reportMap.set(child.localId, childPromise);
    }

    // Await all children
    const allPromises = children.map((c) => reportMap.get(c.localId)!);
    const childReports = await Promise.all(allPromises);

    // ── INTEGRATE ────────────────────────────────────────────────────────────
    // Merge artifacts
    const allFiles: { path: string; content: string }[] = [];
    const allTexts: string[] = [];
    let hasFiles = false;
    let hasText = false;

    for (const r of childReports) {
      if (r.artifact) {
        if (r.artifact.kind === 'files' && r.artifact.files) {
          allFiles.push(...r.artifact.files);
          hasFiles = true;
        } else if (r.artifact.kind === 'text' && r.artifact.text) {
          allTexts.push(r.artifact.text);
          hasText = true;
        }
      }
    }

    let mergedArtifact: import('../contract/report.js').Artifact | null = null;
    if (hasFiles) {
      mergedArtifact = { kind: 'files', files: allFiles };
    } else if (hasText) {
      mergedArtifact = { kind: 'text', text: allTexts.join('\n') };
    }

    // Integration eval: if registry has judge-integration, judge the assembly
    const integrationFindings: string[] = [];
    const integrationBlockers: string[] = [];
    if (this.registry.has('judge-integration') && mergedArtifact) {
      const rubric = `Does the integrated artifact satisfy the original goal: "${goal.title}"?`;
      const integTypeDef = this.registry.get(goal.type);
      const judgeCtx: BrainContext = {
        tier: integTypeDef.tier.default,
        memories: goal.memories,
      };
      const { value: intVerdict } = await this.brain.judge(
        goal,
        mergedArtifact,
        rubric,
        judgeCtx,
      );
      if (!intVerdict.pass) {
        // Failing integration is a hard blocker — emit failure honestly
        const msg = `Integration eval failed: ${intVerdict.findings.map((f) => f.title).join(', ')}`;
        integrationBlockers.push(msg);
        integrationFindings.push(msg);
      }
    }

    // ── PROMOTE: lessons and memory reinforcement ─────────────────────────
    const allLessons: string[] = [];
    const allLearnedLines: string[] = [];

    for (let i = 0; i < childReports.length; i++) {
      const r = childReports[i]!;
      const childGoal = childGoals[i]!;
      const succeeded = r.blockers.length === 0;

      // Promote each lesson as a provisional memory write
      for (const lesson of r.lessons) {
        const pointer: MemoryPointer = {
          id: `${childGoal.id}:lesson:${lesson.slice(0, 40)}`,
          layer: 'project',
          content: lesson,
          provenance: 'provisional',
        };
        await this.store.append({
          type: 'memory-written',
          at: t(),
          goalId: childGoal.id,
          pointer,
        });
        allLessons.push(lesson);
      }

      // Reinforce memories actually used
      for (const memId of r.memoriesUsed) {
        await this.store.append({
          type: 'memory-reinforced',
          at: t(),
          goalId: childGoal.id,
          memoryId: memId,
          outcome: succeeded ? 'success' : 'failure',
        });
      }

      if (r.learned) allLearnedLines.push(r.learned);
    }

    // Deduplicate lessons
    const uniqueLessons = [...new Set(allLessons)];
    const uniqueLearnedLines = [...new Set(allLearnedLines)];

    // Collect all blockers and child findings, plus terraced-scan loser findings.
    const allBlockers: string[] = [...integrationBlockers];
    const allFindings: string[] = [...extraFindings, ...integrationFindings];
    for (const r of childReports) {
      allBlockers.push(...r.blockers);
      allFindings.push(...r.findings);
    }

    const report: Report = {
      artifact: mergedArtifact,
      proof: [],
      lessons: uniqueLessons,
      memoriesUsed: childReports.flatMap((r) => r.memoriesUsed),
      blockers: allBlockers,
      findings: allFindings,
      learned: uniqueLearnedLines.join('\n'),
    };

    await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
    return report;
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

  // ── TREE-SPEND ACCOUNTING ─────────────────────────────────────────────────

  private debitTreeState(treeState: TreeState, usage: Usage): void {
    if (usage.costUsd !== undefined) {
      treeState.spentUsd += usage.costUsd;
    } else {
      // Conservative token-only fallback (AC-5, ADR-017): when the endpoint
      // reports tokens but not cost, use the documented worst-case price constant
      // to bound spend. This prevents uncapped execution on cost-silent endpoints.
      const tokens = usage.promptTokens + usage.completionTokens;
      treeState.spentUsd += tokens * WORST_CASE_PRICE_PER_TOKEN;
    }
  }

  private async checkCeiling(goal: Goal, treeState: TreeState): Promise<boolean> {
    return treeState.spentUsd >= treeState.ceilingUsd;
  }

  private async ceilingReport(goal: Goal, treeState: TreeState): Promise<Report> {
    const t = this.now;
    // Emit 'ceiling-reached' exactly once per tree. Concurrent branches all see
    // the ceiling tripped but only the first one fires the event (ADR-017 guard).
    if (!treeState.ceilingEmitted) {
      treeState.ceilingEmitted = true;
      await this.store.append({
        type: 'ceiling-reached',
        at: t(),
        goalId: goal.id,
        spentUsd: treeState.spentUsd,
        ceilingUsd: treeState.ceilingUsd,
      });
    }
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
 * Whether a goal type's grants include at least one grant that maps to a known
 * tool in GRANT_TOOL_MAP. This is the predicate that selects the step-loop path.
 */
function isToolGranted(grants: string[]): boolean {
  const allGranted = Object.values(GRANT_TOOL_MAP).flat();
  return grants.some((g) => allGranted.includes(g as never));
}

/**
 * Derive the ToolDef array the brain receives for a step, from the intersection
 * of the type's grants and GRANT_TOOL_MAP. The brain uses these as a menu of
 * available tools; the broker's dispatch table is the executor.
 */
function deriveToolDefs(grants: string[]): ToolDef[] {
  const defs: ToolDef[] = [];
  for (const [toolName, toolGrants] of Object.entries(GRANT_TOOL_MAP)) {
    if (toolGrants.some((tg) => grants.includes(tg))) {
      defs.push({
        name: toolName,
        description: `Tool: ${toolName}`,
        parameters: { type: 'object', properties: {}, additionalProperties: true },
      });
    }
  }
  return defs;
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Validate structural constraints on a proposed split.
 * Returns an error message if invalid, or null if valid.
 */
function validateSplit(children: ChildPlan[], budget: Budget): string | null {
  if (children.length === 0) return 'Split must have at least one child';

  // Fan-out guard: child count must not exceed the parent attempt budget
  if (children.length > budget.attempts) {
    return `Fan-out of ${children.length} children exceeds parent attempt budget of ${budget.attempts}`;
  }

  const localIds = new Set(children.map((c) => c.localId));

  // localIds must be unique
  if (localIds.size !== children.length) return 'Duplicate localIds in split';

  // budgetShares must sum to ≤ 1
  const totalShare = children.reduce((s, c) => s + c.budgetShare, 0);
  if (totalShare > 1.0001) {
    return `budgetShares sum to ${totalShare.toFixed(4)}, must be ≤ 1`;
  }

  // dependsOn must reference sibling localIds
  for (const child of children) {
    for (const dep of child.dependsOn) {
      if (!localIds.has(dep)) {
        return `Child "${child.localId}" depends on unknown sibling "${dep}"`;
      }
      if (dep === child.localId) {
        return `Child "${child.localId}" depends on itself`;
      }
    }
  }

  // dependsOn must be acyclic (DFS cycle detection)
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const depMap = new Map(children.map((c) => [c.localId, c.dependsOn]));

  function hasCycle(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of depMap.get(id) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const child of children) {
    if (hasCycle(child.localId)) {
      return `Cyclic dependency detected in split`;
    }
  }

  return null;
}

function blockedReport(reason: string, findings: string[] = []): Report {
  return {
    artifact: null,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [reason],
    findings,
    learned: '',
  };
}

function buildReport(goal: Goal, artifact: Artifact): Report {
  return {
    artifact,
    proof: [],
    lessons: [],
    memoriesUsed: goal.memories.map((m) => m.id),
    blockers: [],
    findings: [],
    learned: '',
  };
}

function gateDeniedBrief(
  goal: Goal,
  risk: RiskClass,
  typeLevelGate: boolean,
): import('../contract/decision.js').DecisionBrief {
  const reason = typeLevelGate
    ? `type "${goal.type}" carries a type-level authority gate`
    : `instance risk is "${risk}" (scope touches a sensitive surface)`;
  return {
    question: `Goal "${goal.title}" requires authority grant: ${reason}. Grant or deny?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
    teaching: {
      finding: reason,
      confidence: 'high',
      costs: 'grant: goal proceeds; deny: goal is blocked; park: goal waits for human decision (TTL applies)',
      recommendation: 'deny',
    },
  };
}

function unknownTypeBrief(
  goal: Goal,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Unknown goal type: "${goal.type}". How should this goal be handled?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

function exhaustedBrief(
  goal: Goal,
  dim: keyof Budget,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Goal "${goal.title}" exhausted its ${dim} budget. How should it be handled?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

function escalatedBrief(
  goal: Goal,
  finding: Finding,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Goal "${goal.title}" has an escalated finding requiring human decision: "${finding.title}"`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

function isomorphicBrief(
  goal: Goal,
  signature: string,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Goal "${goal.title}" is repeating the same failure (signature: "${signature}"). Needs human resolution.`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

/**
 * Consume N units of a budget dimension at once.
 */
function consumeN(
  budget: Budget,
  dim: keyof Budget,
  n: number,
): { budget: Budget; exhausted: boolean } {
  const next: Budget = { ...budget, [dim]: budget[dim] - n };
  return { budget: next, exhausted: next[dim] <= 0 };
}
