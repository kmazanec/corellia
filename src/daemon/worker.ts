/**
 * The queue worker entrypoint (ADR-051): one process, one job at a time,
 * claimed from the shared Postgres queue. Run as many as the machine (or the
 * fleet) has room for; the control plane commissions and answers jobs, and
 * every worker's events land in the one shared log.
 *
 * Environment:
 *   DATABASE_URL           the shared Postgres (required: the queue lives there)
 *   CORELLIA_REPO_ROOT     the repo this worker builds in (default: cwd)
 *   CORELLIA_WORKER_REPOS  comma-separated repo keys it serves (default: the
 *                          repo root's GitHub slug, else its directory name)
 *   CORELLIA_WORKER_ID     stable worker id (default: <hostname>-<pid>)
 *   CORELLIA_WORKER_POLL_MS  idle poll period (default 2000)
 *   CORELLIA_ENGINE=simulated  run sample trees instead of a model (development)
 *   plus the engine's own settings (OPENROUTER_API_KEY, …) — see engine-selection.ts
 *
 * SIGTERM/SIGINT: stop claiming, preserve the job in hand's worktree
 * (ADR-026 preserve-don't-await), record the job `interrupted`, deregister, exit.
 *
 * Invocation: `npm run worker` (npx tsx src/daemon/worker.ts)
 */

import { hostname } from 'node:os';
import { basename, resolve } from 'node:path';

import { loadDotEnv } from '../env.js';
import { Listener } from '../listener/listener.js';
import { PgWorkerLink } from '../substrate/pg-worker-link.js';
import { buildPatternStore, buildStore } from './config.js';
import { selectEngine } from './engine-selection.js';
import { deriveRepoSlug } from './live-engine.js';
import { preserveInFlight } from './preserve.js';
import { WorkerLoop } from './worker-loop.js';

loadDotEnv();

const dbUrl = process.env['DATABASE_URL'];
if (!dbUrl) {
  console.error('DATABASE_URL is required — the job queue lives in the shared Postgres');
  process.exit(1);
}

const repoRoot = resolve(process.env['CORELLIA_REPO_ROOT'] ?? process.cwd());
const repos = (process.env['CORELLIA_WORKER_REPOS'] ?? deriveRepoSlug(repoRoot) ?? basename(repoRoot))
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const workerId = process.env['CORELLIA_WORKER_ID'] ?? `${hostname()}-${process.pid}`;
const pollMs = Number(process.env['CORELLIA_WORKER_POLL_MS'] ?? 2_000);

const { store, close: closeStore, pg } = buildStore({ targetRepoRoot: repoRoot });
const link = new PgWorkerLink(dbUrl);
let loop: WorkerLoop | undefined;
let closePatterns: () => Promise<void> = async () => {};

async function start(): Promise<void> {
  await pg?.ensureSchema();
  await link.ensureSchema();
  const patterns = await buildPatternStore(store);
  closePatterns = patterns.close;

  const listener = new Listener({ engine: selectEngine({ store, patterns: patterns.patterns }), store, repoRoot });
  loop = new WorkerLoop({
    id: workerId,
    repos,
    host: hostname(),
    link,
    listener,
    store,
    ...(pg ? { stamp: pg } : {}),
    pollMs,
  });
  await loop.start();
  console.log(`[worker ${workerId}] serving ${repos.join(', ')} from ${repoRoot}; polling every ${pollMs} ms`);
}

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[worker ${workerId}] ${signal} — leaving the queue`);
  const job = loop?.current;
  if (job) await preserveInFlight([job.id], repoRoot, store, `${signal}: worker shutting down`);
  try {
    await loop?.leave('worker shut down; worktree preserved');
  } catch (err) {
    console.error(`[worker ${workerId}] could not record the interruption:`, err);
  }
  await Promise.allSettled([closePatterns(), link.close(), closeStore()]);
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}

start().catch((err) => {
  console.error(`[worker ${workerId}] startup error:`, err);
  process.exit(1);
});
