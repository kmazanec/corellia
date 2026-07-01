/**
 * Assembly: the composition layer that binds the six iteration-3 modules into a
 * single sandboxed tree. The engine asks this module, at the tree root, to open
 * a worktree, construct the one broker bound to that worktree, and manufacture
 * the per-goal CheckContext the deterministic gate reads.
 *
 * Trust posture (ADR-016): the worktree's child scripts run with a SCRUBBED
 * environment — the factory's own secrets (OpenRouter keys, database URLs) are
 * deleted before the repo's declared scripts ever see them. PATH/HOME and the
 * rest of the benign shell environment are kept so node and the toolchain still
 * resolve.
 */

import type { EventStore } from '../contract/events.js';
import type { Registry, CheckContext, GoalTypeDef, DeterministicCheck } from '../contract/goal-type.js';
import type { Goal } from '../contract/goal.js';
import type { ToolBroker, ToolImpl } from '../contract/tool.js';
import type { ScriptResult } from '../contract/tool.js';
import type { DeclaredCaptures } from '../contract/capture.js';
import { Broker } from './broker.js';
import { createFileTools } from './tools.js';
import { createCaptureRunner, loggingCaptureRunner } from '../library/capture-runner.js';
import {
  createScriptRunner,
  runScriptTool,
  loggingScriptRunner,
  createCommandRunner,
  runCommandTool,
  loggingCommandRunner,
  type ScriptRunner,
  type DeclaredScripts,
} from '../library/script-runner.js';
import { pushBranchTool, openPrTool, type FetchTransport } from './pr-tools.js';
import { fileIssueTool } from './issue-tools.js';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { openTreeWorktree, type TreeWorktree } from './worktree.js';
import { retrievalTools, type RetrievalDeps } from '../library/retrieval.js';
import { scanImports } from '../library/imports.js';
import { projectKnowledge } from '../eventlog/projections.js';
import {
  architectureCheck,
  stackCheck,
  conventionsCheck,
  testScaffoldCheck,
  diveAnchorCheck,
  mapRepoCheck,
  type ArchScanFn,
  type ScanEdge,
} from '../library/knowledge-checks.js';
import { extractArtifactPayload } from '../library/knowledge-checks.js';
import { writeKnowledge, writeRegionFacts } from '../library/knowledge.js';
import {
  coverageCheck,
  type KnowledgeForCoverage,
  type MissingRequirement,
} from '../library/coverage.js';
import type { ChildPlan } from '../contract/decision.js';
import type { Artifact } from '../contract/report.js';
import type { KnowledgeArtifact, KnowledgeCategory, RegionFacts } from '../contract/knowledge.js';

/**
 * The optional sandbox/assembly configuration the engine accepts. When present
 * the tree root opens a worktree against `repoRoot` and binds the broker to it;
 * `declaredScripts` is the name → entry-point map the run_script tool runs from.
 */
export interface SandboxConfig {
  /** The target repo the tree operates against; its worktree becomes the broker root. */
  repoRoot: string;
  /** The declared script entry points (name → repo-relative path) run_script may invoke. */
  declaredScripts: DeclaredScripts;
  /**
   * Optional knowledge/eyes wiring . When truthy, the assembly registers
   * the five read-only retrieval ToolImpls (find_symbol / find_exemplar /
   * conventions_for / stack_versions / impact) in the broker table, backed by
   * the real import scanner and the store's knowledge projection. When absent or
   * false, the broker carries only the iteration-03 tools — byte-identical
   * behavior. The engine's coverage gate is wired separately via
   * EngineOptions.knowledge (see {@link assembleKnowledgeWiring}); this flag only
   * governs the retrieval tools the broker exposes.
   */
  knowledge?: boolean;
  /**
   * Optional PR-boundary wiring (ADR-025). When present, registers `push_branch`
   * and `open_pr` ToolImpls in the broker for trees whose goal type holds
   * `repo.branch` / `repo.pr` grants (e.g. `improve-factory`). The `repoSlug`
   * is `owner/repo` derived from the origin remote — used by `open_pr` to
   * construct the GitHub REST URL. The optional `fetchTransport` is the
   * injectable network transport; absent → `realFetchTransport` (global fetch).
   * Absent → broker carries only the iteration-03 and retrieval tools.
   *
   * `factoryRepoSlug`: the `owner/repo` slug of the factory's OWN repo (e.g.
   * `acme/corellia`). The process-clean gate narrows to ALWAYS_DANGEROUS_PATTERNS
   * only when the push's `repoSlug` equals this value — i.e., when the target
   * genuinely IS the factory's own repo. Set this ONLY for the live:self /
   * improve-factory-to-own-repo path. Leave unset (or omit) for foreign product
   * repo pushes — they always get the full gate regardless of goal type.
   *
   * Security invariant: the gate decision is bound to the ACTUAL push target
   * (repoSlug vs factoryRepoSlug) not to goal.type, so an improve-factory goal
   * tree that is accidentally (or maliciously) bound to a foreign repo still
   * receives the full gate.
   */
  prBoundary?: {
    /** GitHub `owner/repo` slug for the bound repo (e.g. `acme/factory`). */
    repoSlug: string;
    /**
     * GitHub `owner/repo` slug of the factory's own repo. When set and equal to
     * `repoSlug`, the process-clean gate narrows to ALWAYS_DANGEROUS_PATTERNS
     * (factory vocabulary is legitimate in factory-own-repo diffs). Unset means
     * "no repo is the factory repo → full gate always" (safe default).
     */
    factoryRepoSlug?: string;
    /**
     * The git remote to push to (default `origin`). Set this when the PR target
     * is a non-`origin` remote — e.g. a repo whose `origin` is GitLab but which
     * has a `github` mirror remote the PR is opened against (the AC-4 cats case).
     */
    remote?: string;
    /** Injectable fetch transport for tests; omit for live runs (global fetch). */
    fetchTransport?: FetchTransport;
  };
  /**
   * Optional runtime/visual captures declared up front (ADR-042), parallel to
   * `declaredScripts`. When present, the assembly wires a worktree-pinned,
   * env-scrubbed, time-bounded, loopback-only capture runner into every leaf's
   * CheckContext, so a `{ capture }` acceptance criterion can run and be judged.
   * Absent → no capture context; a `{ capture }` criterion fails safe.
   */
  declaredCaptures?: DeclaredCaptures;
}

/**
 * Build a child-process environment with the factory's secrets removed. Starts
 * from the current process env and deletes every key that names an LLM provider
 * credential or a database connection, plus anything prefixed OPENROUTER_,
 * POSTGRES_, GH_TOKEN, GITHUB_TOKEN, NPM_TOKEN, AWS_, GOOGLE_, or STRIPE_, and
 * any key whose suffix matches _KEY, _SECRET, _TOKEN, _PASSWORD, or _CREDENTIALS
 * (case-insensitive). Benign entries (PATH, HOME, TMPDIR, LANG, TERM, …) are
 * preserved so the toolchain still resolves.
 */
export function scrubEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };

  // Exact names that must always be removed.
  const exactDeletes = [
    'DATABASE_URL',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'NPM_TOKEN',
  ];
  for (const key of exactDeletes) {
    delete env[key];
  }

  // Suffix pattern: any key ending with these strings (case-insensitive) is a secret.
  const secretSuffixPattern = /(_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIALS?)$/i;

  // Prefix patterns: any key whose name starts with these prefixes is a secret.
  const secretPrefixes = [
    'OPENROUTER_',
    'POSTGRES_',
    'AWS_',
    'GOOGLE_',
    'STRIPE_',
  ];

  for (const key of Object.keys(env)) {
    if (secretSuffixPattern.test(key)) {
      delete env[key];
      continue;
    }
    if (secretPrefixes.some((p) => key.startsWith(p))) {
      delete env[key];
    }
  }

  return env;
}

/**
 * The composed tree handle the engine holds for the duration of a sandboxed run:
 * the broker bound to the worktree, the full worktree descriptor (for collect /
 * preserve), and a factory that mints a per-goal CheckContext.
 */
export interface SandboxAssembly {
  /** The single broker for the whole tree, bound to the worktree root. */
  broker: ToolBroker;
  /** The full worktree descriptor for collect/preserve at tree end. */
  worktree: TreeWorktree;
  /**
   * Manufacture the CheckContext an executing deterministic check reads, with a
   * script runner that logs `script-ran` against the EXECUTING goal's id — not
   * the tree root's. Called per leaf at the deterministic-check invocation site.
   */
  checkContextFor(goalId: string): CheckContext;
}

/**
 * Wall-clock ceiling for factory-initiated check scripts (deterministic checks
 * and acceptance criteria). These run whole declared scripts — the full test
 * suite — unlike a model's run_script call, which is expected to scope its
 * target and keeps the runner's 30s default.
 */
const CHECK_SCRIPT_TIME_LIMIT_MS = 600_000;

/**
 * Open the tree's worktree and compose the broker, the scrubbed-env script
 * runner, and the per-goal CheckContext factory. Called once, by the tree root,
 * when a SandboxConfig is present.
 *
 * The broker's run_script tool logs each `script-ran` event against the goal
 * that calls it (ToolImpl.execute receives the goal), so a leaf running the
 * test script is honestly attributed even though the broker is tree-scoped.
 */
export async function openSandboxAssembly(
  config: SandboxConfig,
  rootGoalId: string,
  registry: Registry,
  store: EventStore,
  now: () => number = () => Date.now(),
): Promise<SandboxAssembly> {
  const { treeId, branch, root, baseSha } = await openTreeWorktree(config.repoRoot, rootGoalId, store);

  const worktree: TreeWorktree = {
    treeId,
    branch,
    root,
    repoRoot: config.repoRoot,
    goalId: rootGoalId,
    baseSha,
  };

  // The base runner is bound to the worktree root + declared scripts, with a
  // scrubbed child env so repo scripts never inherit the factory's secrets.
  const baseRunner: ScriptRunner = createScriptRunner(root, config.declaredScripts, scrubEnv());

  // The broker's run_script tool logs each run against the CALLING goal's id
  // (ToolImpl.execute receives the goal). We wrap the base runner per call so
  // the 'script-ran' event carries the executing leaf's id, not the tree root.
  const runScriptImpl: ToolImpl = (() => {
    const base = runScriptTool(baseRunner);
    return {
      def: base.def,
      async execute(goal: Goal, args: Record<string, unknown>) {
        const perGoal = runScriptTool(loggingScriptRunner(store, baseRunner, goal.id, now));
        return perGoal.execute(goal, args);
      },
    };
  })();

  // run_command (ADR-016 amendment): a general worktree shell bound to the same
  // worktree root + scrubbed env as the declared-script runner, with the network/
  // push block and per-command timeout enforced inside the runner. Grant-gated
  // (repo.command) by the broker; logged per calling goal like run_script.
  const commandRunner = createCommandRunner(root, scrubEnv());
  const runCommandImpl: ToolImpl = (() => {
    const base = runCommandTool(commandRunner);
    return {
      def: base.def,
      async execute(goal: Goal, args: Record<string, unknown>) {
        const perGoal = runCommandTool(loggingCommandRunner(store, commandRunner, goal.id, now));
        return perGoal.execute(goal, args);
      },
    };
  })();

  const fileTools = createFileTools(root);

  // ── Retrieval tools  ───────────────────────────────────────────────
  // When knowledge wiring is enabled, register the five read-only retrieval
  // ToolImpls backed by the REAL import scanner (scanImports over the worktree
  // root) and the store's knowledge projection (latest artifacts for the target
  // repoRoot). Absent the flag, the broker carries only the iteration-03 tools.
  const knowledgeTools: ToolImpl[] = config.knowledge
    ? Object.values(retrievalTools(buildRetrievalDeps(root, config.repoRoot, store)))
    : [];

  // ── PR-boundary tools (ADR-025) ────────────────────────────────────
  // When prBoundary is configured, register push_branch and open_pr for
  // goal types that hold repo.branch / repo.pr grants (e.g. improve-factory).
  // The worktree root doubles as the repo root for git push; the repoSlug is
  // pre-derived from the origin URL at config time (operator-supplied).
  const prTools: ToolImpl[] = config.prBoundary
    ? [
        pushBranchTool({
          worktreeRoot: root,
          branch,
          treeId,
          store,
          repoSlug: config.prBoundary.repoSlug,
          ...(config.prBoundary.factoryRepoSlug !== undefined
            ? { factoryRepoSlug: config.prBoundary.factoryRepoSlug }
            : {}),
          ...(config.prBoundary.remote !== undefined
            ? { remote: config.prBoundary.remote }
            : {}),
        }),
        openPrTool({
          branch,
          treeId,
          repoSlug: config.prBoundary.repoSlug,
          store,
          ...(config.prBoundary.fetchTransport !== undefined
            ? { fetchTransport: config.prBoundary.fetchTransport }
            : {}),
        }),
      ]
    : [];

  // ── Issue-filing tool (ADR-034) ────────────────────────────────────
  // The file_issue tool is always registered — it writes within the sandbox
  // root to docs/issues/ only. Grant enforcement (docs.issues.write) is
  // handled by the broker via GRANT_TOOL_MAP; the tool impl itself validates
  // OKF frontmatter and refuses duplicate slugs.
  const issueTool = fileIssueTool(root);

  const broker = new Broker({
    root,
    registry,
    store,
    tools: [
      fileTools.readFile,
      fileTools.writeFile,
      fileTools.editFile,
      fileTools.deleteFile,
      fileTools.listDir,
      fileTools.search,
      fileTools.headSha,
      runScriptImpl,
      runCommandImpl,
      ...knowledgeTools,
      ...prTools,
      issueTool,
    ],
  });

  const checkContextFor = (goalId: string): CheckContext => {
    const perGoalRunner = loggingScriptRunner(store, baseRunner, goalId, now);
    const captures = config.declaredCaptures;
    return {
      sandboxRoot: root,
      // Factory-initiated verification (deterministic checks, acceptance
      // criteria) runs whole declared scripts — a full test suite, not a scoped
      // model tool call — so it gets a realistic ceiling instead of the 30s
      // run_script default sized for model-scoped runs. A 30s cap here made any
      // `{script:"test"}` acceptance criterion structurally unpassable on a repo
      // whose suite takes minutes (observed: live-tail commission run, 2026-07-01).
      runScript: (name: string): Promise<ScriptResult> =>
        perGoalRunner.run(name, undefined, CHECK_SCRIPT_TIME_LIMIT_MS),
      // A capture criterion runs its declared capture through a worktree-pinned,
      // env-scrubbed, time-bounded runner (ADR-042). The render/start scripts go
      // through the same per-goal logging script runner, so a capture's subprocess
      // work is evented like any other script run.
      ...(captures !== undefined
        ? {
            declaredCaptures: captures,
            runCapture: loggingCaptureRunner(store, createCaptureRunner(root, captures, perGoalRunner), goalId, now),
          }
        : {}),
    };
  };

  return { broker, worktree, checkContextFor };
}

// ───────────────────────────────────────────────────────────────────────────
// LEARN-KIND READ-ONLY ASSEMBLY (F-65 A12)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a read-only SandboxAssembly for a learn-kind ROOT goal that requires NO
 * git worktree. The broker is bound directly to `config.repoRoot` and carries
 * only read-only tools — `write_file` and `run_script` are absent, so the repo
 * is left byte-identical after the run.
 *
 * The returned `worktree` is a sentinel stub: its fields are never used because
 * the engine's `finally` block skips collect/preserve when the assembly was
 * opened via this function (guarded by the `report === undefined` check plus the
 * caller's no-worktree awareness). Do not call `collectTree` or `preserveTree`
 * on this assembly's worktree.
 *
 * When `config.knowledge` is true, the five retrieval ToolImpls (find_symbol,
 * find_exemplar, conventions_for, stack_versions, impact) are registered,
 * backed by the live import scanner over `config.repoRoot`. This matches the
 * sandboxed assembly's behaviour for learn types that hold `retrieval.api`.
 */
export function openLearnAssembly(
  config: SandboxConfig,
  rootGoalId: string,
  registry: Registry,
  store: EventStore,
): SandboxAssembly {
  const root = config.repoRoot;

  const fileTools = createFileTools(root);

  const knowledgeTools: ToolImpl[] = config.knowledge
    ? Object.values(retrievalTools(buildRetrievalDeps(root, config.repoRoot, store)))
    : [];

  // Read-only broker: writeFile and runScriptImpl are intentionally absent.
  const broker = new Broker({
    root,
    registry,
    store,
    tools: [
      fileTools.readFile,
      fileTools.listDir,
      fileTools.search,
      ...knowledgeTools,
    ],
  });

  // Stub worktree: never used (no collect/preserve for learn-kind root runs).
  const worktree: TreeWorktree = {
    treeId: '',
    branch: '',
    root,
    repoRoot: root,
    goalId: rootGoalId,
    baseSha: '',
  };

  const checkContextFor = (_goalId: string): CheckContext => ({
    sandboxRoot: root,
    // runScript intentionally absent: learn roots have no sandbox worktree.
  });

  return { broker, worktree, checkContextFor };
}

// ───────────────────────────────────────────────────────────────────────────
// KNOWLEDGE / EYES WIRING
// ───────────────────────────────────────────────────────────────────────────

/**
 * The real ArchScanFn the architecture check consumes — backed by the
 * deterministic import scanner . The check passes (root, generatedAtSha);
 * we scan `root` and project scanImports' edge list onto the {from,to} ScanEdge
 * shape the check expects. The artifact's claimed SHA is advisory only here: the
 * scanner reads the live worktree, which is the ground truth the check validates
 * pointers against.
 */
export function realArchScan(root: string, _sha: string): Promise<ScanEdge[]> {
  const graph = scanImports(root);
  return Promise.resolve(graph.edges.map((e) => ({ from: e.from, to: e.to })));
}

/**
 * Build the RetrievalDeps the five retrieval tools run over: the worktree root
 * for symbol/exemplar/stack search and impact scanning, a scanImports-backed
 * `scan` adapted to the retrieval graph shape, and a `knowledge` query that
 * projects the store's events and returns the latest artifacts for the TARGET
 * repoRoot (artifacts are keyed by the target repo, not the worktree path).
 */
function buildRetrievalDeps(
  worktreeRoot: string,
  targetRepoRoot: string,
  store: EventStore,
): RetrievalDeps {
  return {
    repoRoot: worktreeRoot,
    scan: async (root: string) => {
      const graph = scanImports(root);
      // Adapt scanImports' edge-list to retrieval's adjacency-map ImportGraph.
      const edges: Record<string, string[]> = {};
      for (const e of graph.edges) {
        (edges[e.from] ??= []).push(e.to);
      }
      return { edges, scannedAtSha: graph.scannedAtSha };
    },
    knowledge: async () => {
      const view = projectKnowledge(await store.list());
      const out: KnowledgeArtifact[] = [];
      for (const [, entry] of view.artifacts) {
        if (entry.artifact.repoRoot === targetRepoRoot) out.push(entry.artifact);
      }
      return out;
    },
  };
}

/**
 * Project the store's event log into the KnowledgeForCoverage shape the engine's
 * coverage gate consumes: the latest artifact per category for `repoRoot`, every
 * region dive for that repo, and the supplied current HEAD `headSha`.
 */
/** Does a dived `region` overlap any entry in a child's `scope`? (ADR-040 handoff:
 *  a dive of `src/engine` is relevant to a builder scoped to `src/engine/foo.ts`,
 *  and vice versa.) Trailing slashes are normalized; nesting either way counts. */
function regionOverlapsScope(region: string, scope: string[]): boolean {
  const norm = (p: string): string => p.replace(/\/+$/, '');
  const rn = norm(region);
  if (rn === '') return true; // a whole-repo dive is relevant to everything
  return scope.some((s) => {
    const sn = norm(s);
    return rn === sn || rn.startsWith(`${sn}/`) || sn.startsWith(`${rn}/`);
  });
}

function projectCoverageKnowledge(
  events: import('../contract/events.js').FactoryEvent[],
  repoRoot: string,
  headSha: string,
): KnowledgeForCoverage {
  const view = projectKnowledge(events);
  const artifacts = [];
  for (const [, entry] of view.artifacts) {
    if (entry.artifact.repoRoot === repoRoot) {
      artifacts.push({
        category: entry.artifact.category,
        generatedAtSha: entry.artifact.generatedAtSha,
        repoRoot: entry.artifact.repoRoot,
      });
    }
  }
  const regionFacts = [];
  for (const [, facts] of view.diveFacts) {
    if (facts.repoRoot === repoRoot) {
      regionFacts.push({
        repoRoot: facts.repoRoot,
        region: facts.region,
        generatedAtSha: facts.generatedAtSha,
      });
    }
  }
  return { artifacts, regionFacts, headSha };
}

/** Read the current HEAD SHA of a repo via an args-array execFile (no shell). */
function gitHeadSha(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
      .toString()
      .trim();
  } catch {
    return 'no-sha';
  }
}

/**
 * The per-category self-validation map (checks). The architecture check
 * is bound to the REAL scanImports-backed ArchScanFn — replacing the no-op
 * scanner that starter-types registers (see {@link rebindKnowledgeScan}).
 */
function categoryCheck(category: KnowledgeCategory, scanFn: ArchScanFn): DeterministicCheck {
  switch (category) {
    case 'architecture':
      return architectureCheck(scanFn);
    case 'stack':
      return stackCheck();
    case 'conventions':
      return conventionsCheck();
    case 'test-scaffold':
      return testScaffoldCheck();
    default:
      // Categories without shipped self-validation: the map-repo dispatcher
      // passes them through. Mirror that here with a passing check.
      return mapRepoCheck(scanFn);
  }
}

/**
 * Default comprehension minting: a single map-repo ChildPlan per missing
 * category and a deep-dive-region ChildPlan per missing region, with sane
 * read-only budgets/scopes and no inter-dependencies (the engine injects them as
 * dependencies of the existing children and strips dependsOn itself). Exposed so
 * the live script and convergence test share one minting policy.
 */
export function defaultMintComprehension(
  repoRoot: string,
  missing: MissingRequirement[],
): ChildPlan[] {
  const plans: ChildPlan[] = [];
  // Dedup: one map-repo per category, one deep-dive per region — a category and
  // a region can each be reported more than once (e.g. the same region surfaced
  // by both the parent and a child scope). Minting a child twice for the same
  // unit would only waste budget and risk a localId collision.
  const seenCategories = new Set<string>();
  const seenRegions = new Set<string>();
  for (const m of missing) {
    if (m.region !== undefined) {
      const region = m.region;
      if (seenRegions.has(region)) continue;
      seenRegions.add(region);
      plans.push({
        localId: `dive-${region.replace(/[^a-zA-Z0-9]+/g, '-')}`,
        type: 'deep-dive-region',
        title: `Deep-dive region ${region}`,
        spec: { repoRoot, region, reason: m.reason },
        scope: [region],
        budgetShare: 0.1,
        dependsOn: [],
      });
    } else {
      if (seenCategories.has(m.category)) continue;
      seenCategories.add(m.category);
      plans.push({
        localId: `map-${m.category}`,
        type: 'map-repo',
        title: `Map repo: ${m.category}`,
        spec: { repoRoot, category: m.category, reason: m.reason },
        scope: [],
        budgetShare: 0.1,
        dependsOn: [],
      });
    }
  }
  return plans;
}

/**
 * Parse a learn-leaf artifact and persist it via write helpers. map-repo
 * leaves emit a KnowledgeArtifact JSON in artifact.text → knowledge-written;
 * deep-dive-region leaves emit a RegionFacts JSON → knowledge-facts-written.
 *
 * A non-learn goal type, a non-text artifact, malformed JSON, or a shape that
 * matches neither known producer is a silent no-op: persistence never blocks an
 * already-passing leaf (the deterministic gate already validated the shape).
 */
async function persistLearnArtifact(
  store: EventStore,
  registry: Registry,
  goal: Goal,
  artifact: Artifact,
): Promise<void> {
  if (!registry.has(goal.type)) return;
  const def = registry.get(goal.type);
  if (def.kind !== 'learn') return;
  const payload = extractArtifactPayload(artifact);
  if (payload === null || payload.length === 0) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const obj = parsed as Record<string, unknown>;

  // RegionFacts: has region + facts array.
  if (typeof obj['region'] === 'string' && Array.isArray(obj['facts'])) {
    await writeRegionFacts(store, goal.id, parsed as RegionFacts);
    return;
  }
  // KnowledgeArtifact: has category + pointers array + summary.
  if (typeof obj['category'] === 'string' && Array.isArray(obj['pointers'])) {
    await writeKnowledge(store, goal.id, parsed as KnowledgeArtifact);
    return;
  }
}

/**
 * The composed knowledge wiring the engine's coverage gate + checkpoint consume,
 * built over the REAL parts: store-backed projection (filtered to repoRoot),
 * git HEAD, per-category self-validation (architecture bound to the real
 * scanImports ArchScanFn), default comprehension minting, and the event-store-backed
 * persist hook. Pass the result as EngineOptions.knowledge.
 *
 * NOTE: the engine only fires the split checkpoint (verify-on-read before
 * fan-out); the integrate checkpoint is honestly deferred (see EngineOptions).
 */
export function assembleKnowledgeWiring(
  config: SandboxConfig,
  store: EventStore,
  registry: Registry,
): NonNullable<import('./engine.js').EngineOptions['knowledge']> {
  const scanFn: ArchScanFn = realArchScan;
  return {
    query: async (repoRoot: string): Promise<KnowledgeForCoverage> => {
      const headSha = gitHeadSha(repoRoot);
      return projectCoverageKnowledge(await store.list(), repoRoot, headSha);
    },
    headSha: async (repoRoot: string): Promise<string> => gitHeadSha(repoRoot),
    validate: async (artifact: KnowledgeArtifact): Promise<boolean> => {
      // The engine's checkpoint hands a stub with empty pointers (it only carries
      // category + sha from the coverage projection). Re-project the FULL latest
      // artifact for this repo × category from the store so self-validation runs
      // against the real pointers/anchors the producer emitted.
      const view = projectKnowledge(await store.list());
      const key = `${artifact.repoRoot}::${artifact.category}`;
      const full = view.artifacts.get(key)?.artifact ?? artifact;
      const check = categoryCheck(full.category, scanFn);
      const ctx: CheckContext = { sandboxRoot: full.repoRoot };
      const result = await check.run(
        { id: 'validate', type: 'map-repo' } as unknown as Goal,
        { kind: 'text', text: JSON.stringify(full) },
        ctx,
      );
      return result.ok;
    },
    mintComprehension: (missing: MissingRequirement[]): ChildPlan[] =>
      defaultMintComprehension(config.repoRoot, missing),
    persist: (goal: Goal, artifact: Artifact): Promise<void> =>
      persistLearnArtifact(store, registry, goal, artifact),
    factsForRegions: async (repoRoot: string, scope: string[]): Promise<RegionFacts[]> => {
      // The dive→build handoff (ADR-040): return the FULL RegionFacts (anchored
      // claims, not the existence-only CoverageRegionFact `query` returns) for any
      // dived region overlapping `scope`. Same projection `projectCoverageKnowledge`
      // reads (view.diveFacts), but without stripping the facts.
      const view = projectKnowledge(await store.list());
      const out: RegionFacts[] = [];
      for (const [, facts] of view.diveFacts) {
        if (facts.repoRoot !== repoRoot) continue;
        if (scope.length > 0 && !regionOverlapsScope(facts.region, scope)) continue;
        out.push(facts);
      }
      return out;
    },
    regionExists: (repoRoot: string, region: string): boolean => {
      // ADR-029 Decision 2 relevance signal: a region exists if its path is
      // present in the working tree. An empty region (whole-repo intent) is the
      // repo itself; a region resolving outside repoRoot is not part of it.
      if (region === '') return true;
      const abs = isAbsolute(region) ? region : join(repoRoot, region);
      return existsSync(abs);
    },
  };
}

/**
 * Replace the no-op architecture scanner that `starterTypes()` registers
 * (map-repo's `mapRepoCheck(async () => [])`) with the REAL scanImports-backed
 * ArchScanFn, returning a fresh GoalTypeDef list (the originals are untouched).
 *
 * Registry-rebind choice (review finding): rather than mutate the contract or
 * the engine's gate, the assembly rebuilds the goal-type table so map-repo's
 * deterministic gate validates artifact pointers against the live import graph.
 * The composition root passes the rebound types to its registry.
 */
export function rebindKnowledgeScan(types: GoalTypeDef[]): GoalTypeDef[] {
  return types.map((t) => {
    if (t.name === 'map-repo') {
      return {
        ...t,
        deterministic: t.deterministic.map((c) =>
          c.name === 'knowledge:map-repo' ? mapRepoCheck(realArchScan) : c,
        ),
      };
    }
    return t;
  });
}
