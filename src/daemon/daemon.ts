/**
 * The front-door daemon entrypoint (ADR-026).
 *
 * Wires together:
 *   - Substrate selection: DATABASE_URL → PgEventStore, else JSONL from
 *     CORELLIA_EVENTS_PATH (default: out/events.jsonl)
 *   - A Listener on the chosen store
 *   - An HTTP FrontDoorServer bound to FRONT_DOOR_PORT (default: 8080)
 *   - A periodic tick() clock (CORELLIA_TICK_MS, default: 5 000 ms)
 *   - SIGTERM: preserve in-flight trees, drain the tick, close the server,
 *     exit 0 (ADR-026 preserve-don't-await policy)
 *
 * Substrate selection (AC 7): see src/daemon/config.ts → buildStore().
 * Standing envelope (F-63 seam): see src/daemon/config.ts → buildStandingEnvelope().
 *
 * Daemon entrypoint path (for F-66 container build):
 *   src/daemon/daemon.ts
 * Invocation:
 *   npx tsx src/daemon/daemon.ts
 *   # or via compiled dist:
 *   node dist/src/daemon/daemon.js
 *
 * @module daemon
 */

import { loadDotEnv } from '../env.js';
import { PgEventStore } from '../substrate/pg-event-store.js';
import { Listener } from '../listener/listener.js';
import { preserveTree, sanitizeTreeId } from '../engine/worktree.js';
import type { Engine } from '../engine/engine.js';
import { FrontDoorServer } from './http-server.js';
import { buildStore, buildStandingEnvelope } from './config.js';
import { buildLiveEngine, deriveRepoSlug } from './live-engine.js';
import { join } from 'node:path';

// ── Load env ─────────────────────────────────────────────────────────────────

loadDotEnv();

// ── Token guard ───────────────────────────────────────────────────────────────

const token = process.env['FRONT_DOOR_TOKEN'];
if (!token) {
  console.error('FRONT_DOOR_TOKEN is required — set it and restart');
  process.exit(1);
}

// ── Substrate selection (AC 7) ────────────────────────────────────────────────

const { store, close: closeStore } = buildStore();

// ── Standing envelope (F-63 seam) ─────────────────────────────────────────────

const standingEnvelope = buildStandingEnvelope();
if (standingEnvelope) {
  console.log('[daemon] standing envelope:', JSON.stringify(standingEnvelope));
}

// ── Engine selection (env-guarded) ────────────────────────────────────────────

/**
 * A stub engine used when OPENROUTER_API_KEY is absent.
 *
 * For the daemon's keyless smoke/healthcheck path (docker compose up without
 * a real API key) this prevents the process from crashing at startup.
 * The stub rejects every run immediately so commissioned intents do not silently
 * succeed without a real brain.
 *
 * When OPENROUTER_API_KEY IS present, buildLiveEngine() is used instead and this
 * stub is never constructed.
 */
function buildNullEngine(): Engine {
  return {
    run: (_goal: unknown) =>
      Promise.reject(
        new Error(
          'No engine configured — set OPENROUTER_API_KEY to enable live commission delivery',
        ),
      ),
  } as unknown as Engine;
}

/**
 * Select the engine based on environment:
 *   - OPENROUTER_API_KEY present → buildLiveEngine() (real LLM delivery, AC-3)
 *   - OPENROUTER_API_KEY absent  → buildNullEngine() (keyless smoke/healthcheck path)
 *
 * The repo root for the live engine is CORELLIA_REPO_ROOT (default: cwd).
 * If the repo root is not a git repository, the daemon logs a warning and falls
 * back to the null engine rather than crashing — the HTTP surface stays up.
 */
function selectEngine(): Engine {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    console.log('[daemon] engine: null engine — commissions will be rejected; set OPENROUTER_API_KEY to enable delivery');
    return buildNullEngine();
  }

  try {
    const repoRoot = process.env['CORELLIA_REPO_ROOT'] ?? process.cwd();
    const repoSlug = deriveRepoSlug(repoRoot);
    // FACTORY_REPO_SLUG: the GitHub owner/repo slug of the factory's own repo.
    // When set and equal to the push target's repoSlug, the process-clean gate
    // narrows to ALWAYS_DANGEROUS_PATTERNS only (factory vocabulary is permitted
    // in factory-own-repo diffs). Unset = no repo is the factory repo → full
    // gate always. Safe default: do NOT set unless this daemon is corellia
    // pushing to its own repo.
    const factoryRepoSlugEnv = process.env['FACTORY_REPO_SLUG'] ?? undefined;
    const sandbox = {
      repoRoot,
      declaredScripts: {},
      ...(repoSlug
        ? {
            prBoundary: {
              repoSlug,
              ...(factoryRepoSlugEnv !== undefined ? { factoryRepoSlug: factoryRepoSlugEnv } : {}),
            },
          }
        : {}),
    };
    const engine = buildLiveEngine({ store, sandbox, goldenCapture: true });
    console.log('[daemon] engine: live engine — commissions will be processed via OpenRouter');
    if (repoSlug) {
      console.log(`[daemon] engine: target repo slug: ${repoSlug}`);
      if (factoryRepoSlugEnv) {
        console.log(`[daemon] engine: factory repo slug: ${factoryRepoSlugEnv} (process-clean gate narrowed for own-repo pushes)`);
      } else {
        console.log('[daemon] engine: FACTORY_REPO_SLUG unset → full process-clean gate for all pushes');
      }
    } else {
      console.log('[daemon] engine: no GitHub remote detected; push_branch/open_pr will not be available');
    }
    return engine;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[daemon] engine: failed to build live engine (${msg}); falling back to null engine`);
    return buildNullEngine();
  }
}

// ── Listener (the single brief authority — ADR-008) ───────────────────────────

/**
 * The daemon instantiates exactly ONE Listener. Both the HTTP server and the
 * REPL mode (when enabled) route through this same instance — there is no
 * second Listener anywhere in the process (ADR-008 invariant).
 */
const listener = new Listener({ engine: selectEngine(), store });

// ── HTTP server ───────────────────────────────────────────────────────────────

const port = parseInt(process.env['FRONT_DOOR_PORT'] ?? '8080', 10);
const host = process.env['FRONT_DOOR_HOST'] ?? '0.0.0.0';

const server = new FrontDoorServer({ listener, token });

// ── Tick clock (AC 4) ─────────────────────────────────────────────────────────

/**
 * Periodic TTL sweep. The listener has no internal timers; the daemon owns the
 * clock (ADR-026). CORELLIA_TICK_MS controls the period (default 5 s).
 */
const tickMs = parseInt(process.env['CORELLIA_TICK_MS'] ?? '5000', 10);
let tickTimer: ReturnType<typeof setInterval> | undefined;

function startTick(): void {
  tickTimer = setInterval(() => {
    const { bounced } = listener.tick();
    if (bounced.length > 0) {
      console.log(`[daemon] tick bounced: ${bounced.join(', ')}`);
    }
  }, tickMs);
  // Don't let the timer keep the process alive — the server + SIGTERM control
  // the lifecycle.
  tickTimer.unref();
}

// ── SIGTERM handler (AC 5) ────────────────────────────────────────────────────

/**
 * SIGTERM: preserve every in-flight tree, stop the tick, close the server,
 * close the store, exit 0.
 *
 * Policy: preserve-don't-await (ADR-026). We record the preservation event and
 * exit immediately — we never wait for an in-flight engine.run() to finish.
 * On restart, the parked-intent events in the store show the intents as parked;
 * the worktrees are left on disk for inspection.
 *
 * We derive the TreeWorktree descriptor from the running intent id using the
 * same sanitizeTreeId() function the engine uses, so the event matches what
 * the engine would have recorded.
 */
async function onSigterm(): Promise<void> {
  console.log('[daemon] SIGTERM received — preserving in-flight trees and shutting down');

  // Stop the periodic tick immediately.
  if (tickTimer !== undefined) {
    clearInterval(tickTimer);
  }

  const status = listener.status();
  const repoRoot = process.env['CORELLIA_REPO_ROOT'] ?? process.cwd();

  // Preserve each running intent's worktree.
  const preservations = status.running.map(async (intentId) => {
    const treeId = sanitizeTreeId(intentId);
    const branch = `tree/${treeId}`;
    // Same path layout as openTreeWorktree (worktree.ts).
    const root = join(repoRoot, '.corellia', 'worktrees', treeId);

    const worktree = { treeId, branch, root, repoRoot, goalId: intentId };
    try {
      await preserveTree(worktree, store, 'SIGTERM: daemon shutting down');
      console.log(`[daemon] preserved worktree for intent ${intentId}`);
    } catch (err) {
      console.error(`[daemon] failed to preserve worktree for ${intentId}:`, err);
    }
  });

  await Promise.all(preservations);

  // Close the HTTP server (stops accepting new connections).
  try {
    await server.close();
  } catch {
    // Ignore close errors — we're shutting down anyway.
  }

  // Close the store (flushes Pg pool if applicable).
  try {
    await closeStore();
  } catch {
    // Ignore close errors.
  }

  console.log('[daemon] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => {
  void onSigterm();
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Ensure schema exists for Pg (no-op for JSONL).
  if (store instanceof PgEventStore) {
    await store.ensureSchema();
  }

  await server.listen(port, host);
  startTick();

  console.log(`[daemon] front door listening on ${host}:${server.port}`);
  console.log(`[daemon] substrate: ${process.env['DATABASE_URL'] ? 'postgres' : 'jsonl'}`);
  console.log(`[daemon] tick period: ${tickMs} ms`);
}

start().catch((err) => {
  console.error('[daemon] startup error:', err);
  process.exit(1);
});
