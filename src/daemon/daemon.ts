/**
 * The front-door daemon entrypoint (ADR-026).
 *
 * Wires together:
 *   - Substrate selection: DATABASE_URL → PgEventStore, else JSONL from
 *     CORELLIA_EVENTS_PATH (default: out/<target-repo>/events.jsonl,
 *     namespaced by CORELLIA_REPO_ROOT's basename)
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
import { maybeStartRepl } from './repl.js';
import { buildStore, buildStandingEnvelope, buildPatternStore } from './config.js';
import { buildLiveEngine, deriveRepoSlug } from './live-engine.js';
import type { PatternStore } from '../contract/pattern.js';
import { join } from 'node:path';

// ── Load env ─────────────────────────────────────────────────────────────────

loadDotEnv();

// ── Token guard ───────────────────────────────────────────────────────────────

const tokenEnv = process.env['FRONT_DOOR_TOKEN'];
if (!tokenEnv) {
  console.error('FRONT_DOOR_TOKEN is required — set it and restart');
  process.exit(1);
}
// Narrowed to string past the guard; start() (below) reads it after the async
// pattern-store build, where control-flow narrowing on the const would be lost.
const token: string = tokenEnv;

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
function selectEngine(patterns: PatternStore): Engine {
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
    const engine = buildLiveEngine({ store, sandbox, goldenCapture: true, patterns });
    console.log('[daemon] engine: live engine — commissions will be processed via OpenRouter');
    console.log('[daemon] flywheel: split-memo pattern store wired — recurring splits memoize');
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
 * REPL mode (when enabled via CORELLIA_REPL=1 on a TTY) route through this same
 * instance — there is no second Listener anywhere in the process (ADR-008
 * invariant).
 */
// The Listener, engine, HTTP server, and pattern store are all built in start()
// because the pattern store's construction is async (Pg schema / event-log
// rehydration). They are module-scoped so the SIGTERM handler can reach them.
let listener: Listener;
let server: FrontDoorServer;
let closePatternStore: () => Promise<void> = () => Promise.resolve();

// ── HTTP server config ──────────────────────────────────────────────────────

const port = parseInt(process.env['FRONT_DOOR_PORT'] ?? '8080', 10);
const host = process.env['FRONT_DOOR_HOST'] ?? '0.0.0.0';

// ── Tick clock (AC 4) ─────────────────────────────────────────────────────────

/**
 * Periodic TTL sweep. The listener has no internal timers; the daemon owns the
 * clock (ADR-026). CORELLIA_TICK_MS controls the period (default 5 s).
 */
const tickMs = parseInt(process.env['CORELLIA_TICK_MS'] ?? '5000', 10);
let tickTimer: ReturnType<typeof setInterval> | undefined;

// ── REPL (opt-in local surface — ADR-026) ─────────────────────────────────────

/**
 * The interactive REPL handle, present only when CORELLIA_REPL=1 AND stdin is a
 * TTY (see maybeStartRepl). Held so SIGTERM can close it; undefined on the
 * default headless/container path.
 */
let repl: ReturnType<typeof maybeStartRepl>;

function startTick(): void {
  tickTimer = setInterval(() => {
    void listener.tick().then(
      ({ bounced }) => {
        if (bounced.length > 0) {
          console.log(`[daemon] tick bounced: ${bounced.join(', ')}`);
        }
      },
      (err: unknown) => {
        console.log(`[daemon] tick failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
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

  // SIGTERM before start() finished wiring the listener — nothing in flight.
  if (listener === undefined) {
    console.log('[daemon] shutdown complete (pre-startup)');
    process.exit(0);
  }

  // Close the interactive REPL if one is running (no-op on the headless path).
  if (repl !== undefined) {
    repl.close();
  }

  const status = listener.status();
  const repoRoot = process.env['CORELLIA_REPO_ROOT'] ?? process.cwd();

  // Preserve each running intent's worktree.
  const preservations = status.running.map(async (intentId) => {
    const treeId = sanitizeTreeId(intentId);
    const branch = `tree/${treeId}`;
    // Same path layout as openTreeWorktree (worktree.ts).
    const root = join(repoRoot, '.corellia', 'worktrees', treeId);

    const worktree = { treeId, branch, root, repoRoot, goalId: intentId, baseSha: '' };
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
    await server?.close();
  } catch {
    // Ignore close errors — we're shutting down anyway.
  }

  // Close the pattern store (flushes its Pg pool if applicable).
  try {
    await closePatternStore();
  } catch {
    // Ignore close errors.
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

  // Build the split-memo pattern store (async: Pg schema or event-log rehydration),
  // then wire the engine + listener + server on top of it.
  const patternHandle = await buildPatternStore(store);
  closePatternStore = patternHandle.close;

  listener = new Listener({ engine: selectEngine(patternHandle.patterns), store });
  server = new FrontDoorServer({ listener, token });

  await server.listen(port, host);
  startTick();

  // Opt-in interactive REPL: shares the single Listener, never blocks startup,
  // and is off on every headless/container run (default; requires CORELLIA_REPL=1
  // on a TTY). A REPL start failure is swallowed inside maybeStartRepl.
  repl = maybeStartRepl({ listener });

  console.log(`[daemon] front door listening on ${host}:${server.port}`);
  console.log(`[daemon] substrate: ${process.env['DATABASE_URL'] ? 'postgres' : 'jsonl'}`);
  console.log(`[daemon] tick period: ${tickMs} ms`);
}

start().catch((err) => {
  console.error('[daemon] startup error:', err);
  process.exit(1);
});
