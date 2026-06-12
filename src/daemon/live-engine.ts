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
import { projectMemory } from '../eventlog/projections.js';
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
  /** SandboxConfig for the target repo. Must include repoRoot. */
  sandbox: SandboxConfig;
  /**
   * When true, enable knowledge wiring (coverage gate, comprehension minting,
   * artifact persist). Enable for comprehension / eyes runs; disable for
   * deliver / implement runs where coverage is not the goal.
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

  const memory = {
    query: async (topic: string, scope: string[]) =>
      projectMemory(await opts.store.list()).query(topic, scope),
  };

  const engineOpts = {
    registry,
    brain,
    store: opts.store,
    memory,
    sandbox: opts.sandbox,
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
 * Derive the GitHub owner/repo slug from the origin remote URL of a local
 * repo. Used by live scripts to populate prBoundary.repoSlug without hardcoding.
 *
 * Returns null if the origin remote is not a recognized GitHub URL.
 */
export function deriveRepoSlug(repoRoot: string): string | null {
  try {
    const url = execFileSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
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
