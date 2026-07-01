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

import type { Goal } from '../contract/goal.js';
import type { Artifact, Report } from '../contract/report.js';
import type { EventStore } from '../contract/events.js';
import type { Brain } from '../contract/brain.js';
import type { Registry } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import type { RiskClass, SensitivityFact } from '../contract/risk.js';
import type { PatternStore } from '../contract/pattern.js';
import type { ToolBroker } from '../contract/tool.js';
import { lintLibrary } from '../library/constitution.js';
import { DEFAULT_SENSITIVITY } from '../library/risk.js';
import { loadFamilySkill } from '../library/skills.js';
import type { CheckContext } from '../contract/goal-type.js';
import {
  type SandboxAssembly,
  type SandboxConfig,
} from './assembly.js';
import {
  WORST_CASE_PRICE_PER_TOKEN,
  type TreeState,
} from './tree-spend.js';
import { repoShapeHint as buildRepoShapeHint } from './repo-shape-hint.js';
import { runRootGoal } from './root-runner.js';
import type { EngineOptions } from './options.js';
import { createRecursiveRunner } from './recursive-runner.js';

export { WORST_CASE_PRICE_PER_TOKEN };
export type { EngineOptions, EngineKnowledge } from './options.js';

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
    this.sensitivity = opts.sensitivity ?? DEFAULT_SENSITIVITY;
    this.onGate = opts.onGate;
    this.patterns = opts.patterns;
    this.broker = opts.broker;
    this.sandbox = opts.sandbox;
    this.knowledge = opts.knowledge;
  }

  async run(goal: Goal): Promise<Report> {
    return runRootGoal({
      goal,
      sandbox: this.sandbox,
      registry: this.registry,
      store: this.store,
      now: this.now,
      setActiveAssembly: (assembly) => {
        this._activeAssembly = assembly;
      },
      runTree: (treeState) => this._run(goal, treeState),
    });
  }

  private async _run(goal: Goal, treeState: TreeState): Promise<Report> {
    return createRecursiveRunner({
      registry: this.registry,
      brain: this.brain,
      store: this.store,
      memory: this.memory,
      now: this.now,
      goldenCapture: this.goldenCapture,
      enforceToolCallBudget: this.enforceToolCallBudget,
      sensitivity: this.sensitivity,
      onGate: this.onGate,
      onBrief: () => this.effectiveOnBrief,
      patterns: this.patterns,
      knowledge: this.knowledge,
      effectiveBroker: () => this.effectiveBroker,
      activeWorktree: () => this._activeAssembly?.worktree,
      checkContextFor: (goalId) => this.checkContextFor(goalId),
      persistLeafKnowledge: (persistGoal, artifact) =>
        this.persistLeafKnowledge(persistGoal, artifact),
      runChild: (childGoal, childTreeState) => this._run(childGoal, childTreeState),
      decideSkillBlock: (goalType) => this.decideSkillBlock(goalType),
      repoShapeHint: (goalForShape) => this.repoShapeHint(goalForShape),
    }).run(goal, treeState);
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
}
