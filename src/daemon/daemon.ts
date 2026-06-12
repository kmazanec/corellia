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

// ── Listener (the single brief authority — ADR-008) ───────────────────────────

/**
 * The daemon instantiates exactly ONE Listener. Both the HTTP server and the
 * REPL mode (when enabled) route through this same instance — there is no
 * second Listener anywhere in the process (ADR-008 invariant).
 */
const listener = new Listener({ engine: buildNullEngine(), store });

/**
 * A stub engine used when no real engine is configured.
 *
 * A production deployment supplies a real Engine (built with an LLM brain,
 * a registry, etc.). For the daemon's own use — particularly the SIGTERM test
 * that spawns a child and only needs the HTTP surface to respond — a minimal
 * null engine prevents the process from crashing at startup. F-67 replaces
 * this with real engine construction by importing and extending this file.
 *
 * The stub rejects every run so that commissioned intents do not silently
 * succeed without a real brain. Callers that want a live engine should wire
 * it via the REPL path or extend daemon.ts.
 */
function buildNullEngine(): Engine {
  return {
    run: (_goal: unknown) =>
      Promise.reject(
        new Error(
          'No engine configured — start the daemon via a live entrypoint that wires a real Engine',
        ),
      ),
  } as unknown as Engine;
}

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
    const root = join(repoRoot, '.claude', 'worktrees', treeId);

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
