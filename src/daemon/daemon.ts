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
import { preserveInFlight } from './preserve.js';
import { FrontDoorServer } from './http-server.js';
import { maybeStartRepl } from './repl.js';
import { buildStore, buildStandingEnvelope, buildPatternStore } from './config.js';
import { selectEngine } from './engine-selection.js';

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
  await preserveInFlight(status.running, repoRoot, store, 'SIGTERM: daemon shutting down');

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

  listener = new Listener({
    engine: selectEngine({ store, patterns: patternHandle.patterns }),
    store,
    repoRoot: process.env['CORELLIA_REPO_ROOT'] ?? process.cwd(),
  });
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
