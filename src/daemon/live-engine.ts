/**
 * Live Engine builder for the daemon (F-67 Chunk 1).
 *
 * Replaces buildNullEngine() in daemon.ts for live commission processing.
 * This module is imported by the live harness scripts (live-self.ts,
 * live-foreign.ts, live-foreign-eyes.ts) and could be used to launch the
 * daemon with a real Engine instead of the null stub.
 *
 * The null stub in daemon.ts is kept as-is (it rejects every run immediately
 * with a helpful error) so that `docker compose up` + smoke tests continue to
 * work for the HTTP/webhook surface without requiring a real LLM API key at
 * container start time. For live commission processing, a live entrypoint
 * or one of the harness scripts wires buildLiveEngine() instead.
 *
 * Wiring details:
 *   - LlmBrain via OpenRouter (OPENROUTER_API_KEY required).
 *   - Standard starter types with knowledge-scan rebind for learn goals.
 *   - InMemoryEventStore (JSONL or Pg substrate is the daemon's concern;
 *     the live harness scripts supply their own store).
 *   - SandboxConfig.prBoundary: supply repoSlug when open_pr tools are needed
 *     (improve-factory goal type); omit for product deliver runs.
 *   - Knowledge wiring: optional; enable for eyes/comprehension runs.
 *
 * @module daemon/live-engine
 */

import { Engine } from '../engine/engine.js';
import { LlmBrain } from '../brains/llm.js';
import { openRouterConfig } from '../brains/openrouter.js';
import { createRegistry } from '../library/registry.js';
import { starterTypes } from '../library/starter-types.js';
import {
  assembleKnowledgeWiring,
  rebindKnowledgeScan,
  type SandboxConfig,
} from '../engine/assembly.js';
import { projectMemory, unionMemoryViews } from '../eventlog/projections.js';
import { buildSharedStore } from './config.js';
import type { EventStore } from '../contract/events.js';
import type { FetchTransport } from '../engine/pr-tools.js';
import { extractRepoSlug } from '../engine/pr-tools.js';
import { execFileSync } from 'node:child_process';

// ── Registry (shared across builds) ───────────────────────────────────────────

/**
 * Build the goal-type registry with knowledge-scan rebound for live runs.
 * The starter types' map-repo check is rebound to the real scanImports-backed
 * ArchScanFn so architecture validation runs against the live import graph.
 */
export function buildLiveRegistry() {
  const types = rebindKnowledgeScan(starterTypes());
  return { registry: createRegistry(types), types };
}

// ── Options ────────────────────────────────────────────────────────────────────

export interface LiveEngineOptions {
  /** The EventStore the engine appends events to. */
  store: EventStore;
  /**
   * The shared type/global memory store (ADR-049) — the home of the compounding
   * layers, which outlives any one project's log. Defaults to `buildSharedStore()`
   * (env-configured, a shared sibling of the per-project logs). Retrieval unions
   * this store's type/global layers with the per-project store's project layer,
   * and the promote edge routes type/global writes here. Supply an explicit store
   * (e.g. an InMemoryEventStore) in tests; omit for the env-configured default.
   */
  sharedStore?: EventStore;
  /** SandboxConfig for the target repo. Must include repoRoot. */
  sandbox: SandboxConfig;
  /**
   * When true, enable the knowledge COVERAGE GATE (comprehension minting, artifact
   * persist). Enable for comprehension / eyes runs; disable for deliver / implement
   * runs where coverage is not the goal.
   *
   * Note this is the gate only. The five read-only retrieval TOOLS (find_symbol,
   * find_exemplar, conventions_for, stack_versions, impact) are a per-leaf
   * capability — always registered in the broker regardless of this flag — so any
   * leaf whose type grants `retrieval.api` can use them. The broker still
   * grant-checks each call, so registering them is harmless for leaves without the
   * grant. (Keeping tool availability tied to this gate flag is the footgun that
   * left author-acceptance-criteria with every retrieval call refused.)
   */
  knowledge?: boolean;
  /**
   * When true, accrue golden candidates at every judge verdict (ADR-024).
   * Enable for all live production runs.
   */
  goldenCapture?: boolean;
  /**
   * Injectable fetch transport for the GitHub REST path (open_pr). Omit to
   * use the real global fetch. Supply a stub in operator-run integration tests.
   */
  fetchTransport?: FetchTransport;
}

// ── Builder ────────────────────────────────────────────────────────────────────

/**
 * Build a fully assembled live Engine for a target repo.
 *
 * Call this from live harness scripts and from a live daemon entrypoint that
 * needs real LLM processing. The result is a fully wired Engine that:
 *
 *   1. Uses LlmBrain via OpenRouter (OPENROUTER_API_KEY must be set).
 *   2. Opens git worktrees under targetRepo/.corellia/worktrees/ for sandboxed runs.
 *   3. Registers push_branch + open_pr when prBoundary is configured.
 *   4. Optionally enables the knowledge coverage gate.
 *   5. Captures golden candidates for judge improvement (ADR-024).
 *
 * For the daemon's null stub replacement, see daemon.ts's buildNullEngine()
 * comment — this builder is the intended production replacement.
 *
 * @throws If OPENROUTER_API_KEY is missing from the environment.
 */
export function buildLiveEngine(opts: LiveEngineOptions): Engine {
  const { registry, types } = buildLiveRegistry();
  const brain = new LlmBrain(openRouterConfig(), types.map((t) => t.name));

  // The shared store holds the compounding type/global layers (ADR-049); the
  // per-project store holds the project layer. Retrieval unions both views so a
  // child sees this repo's project memory plus its goal-type's type namespace and
  // the global layer — with provenance and layer labels intact per view.
  const sharedStore = opts.sharedStore ?? buildSharedStore().store;

  const memory = {
    query: async (topic: string, scope: string[], ctx?: import('../contract/memory.js').MemoryQueryContext) =>
      unionMemoryViews(
        projectMemory(await opts.store.list()),
        projectMemory(await sharedStore.list()),
      ).query(topic, scope, ctx),
  };

  const engineOpts = {
    registry,
    brain,
    store: opts.store,
    sharedStore,
    memory,
    // Always register the read-only retrieval tools in the broker. They are a
    // per-leaf capability (grant-checked per call), not a run-mode choice, so a
    // leaf granted retrieval.api can always use them. The coverage GATE below is
    // the run-mode choice, kept separate behind opts.knowledge.
    sandbox: { ...opts.sandbox, knowledge: true },
    goldenCapture: opts.goldenCapture ?? true,
  };

  if (opts.knowledge) {
    return new Engine({
      ...engineOpts,
      knowledge: assembleKnowledgeWiring(opts.sandbox, opts.store, registry),
    });
  }

  return new Engine(engineOpts);
}

// ── Helpers for live scripts ───────────────────────────────────────────────────

/**
 * Derive the GitHub owner/repo slug from a named remote's URL (default `origin`)
 * of a local repo. Used by live scripts to populate prBoundary.repoSlug without
 * hardcoding. Pass a non-`origin` remote when the GitHub PR target is a mirror
 * remote (e.g. cats: `origin` is GitLab, `github` is the GitHub mirror).
 *
 * Returns null if the named remote's URL is not a recognized GitHub URL.
 */
export function deriveRepoSlug(repoRoot: string, remote = 'origin'): string | null {
  try {
    const url = execFileSync('git', ['-C', repoRoot, 'remote', 'get-url', remote], {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
    return extractRepoSlug(url);
  } catch {
    return null;
  }
}

/**
 * Check that a directory is a git repo (has a .git entry or is a worktree).
 */
export function assertGitRepo(path: string, label: string): void {
  try {
    execFileSync('git', ['-C', path, 'rev-parse', '--git-dir'], { stdio: 'pipe' });
  } catch {
    throw new Error(`${label}: "${path}" is not a git repository. A git repo is required.`);
  }
}

/**
 * Fail fast with a clear message if a required environment variable is absent.
 */
export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Set it in your shell or in .env before running this harness.`,
    );
  }
  return val;
}
