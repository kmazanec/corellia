/**
 * smoke:live — the one automated end-to-end run against a REAL model.
 *
 * The 160-file vitest suite proves the loop's plumbing against ScriptedBrain; the
 * live:* harnesses prove real behavior but are operator-run and ungated. This
 * script is the thin bridge: ONE greeting-sized goal, sent to the real low-band
 * model through the full engine, bounded hard by a dollar ceiling of a few cents
 * and a wall-clock of a few minutes, asserting only the cheap invariants a smoke
 * is allowed to assert (see src/smoke/verdict.ts). It exits nonzero with a
 * readable reason on any failure so a scheduled CI job can gate on it.
 *
 * ISOLATION (critical — mirrors examples/live.ts, never touches the repo)
 * ─────────────────────────────────────────────────────────────────────────────
 * The engine opens a git worktree under its target repo's .corellia/worktrees/.
 * We therefore run against a THROWAWAY git repo created fresh in the OS temp dir
 * (mkdtemp), NOT the Corellia checkout and NOT any .corellia/ under it. The temp
 * repo (and its worktrees, its events.jsonl) are deleted on exit. Nothing this
 * script does can mutate the repo's own git state.
 *
 * GATING (by secret presence)
 * ─────────────────────────────────────────────────────────────────────────────
 * Missing OPENROUTER_API_KEY → print a clear SKIP and exit 0. CI gates on the
 * secret existing; absence is a skip, never a failure.
 *
 * ENV
 * ─────────────────────────────────────────────────────────────────────────────
 *   OPENROUTER_API_KEY        required; absent → SKIP (exit 0)
 *   CORELLIA_SMOKE_CAP_USD    optional; dollar ceiling (default 0.25)
 *   CORELLIA_SMOKE_WALLCLOCK_MS optional; wall-clock bound (default 240000 = 4 min)
 *   CORELLIA_MODEL_LOW/MID/HIGH optional model overrides (as live.ts)
 *
 * The events.jsonl of the run is copied to CORELLIA_SMOKE_EVENTS_OUT (if set)
 * before the temp dir is torn down, so CI can upload it as a failure artifact.
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   export OPENROUTER_API_KEY=sk-or-...
 *   npm run smoke:live
 */

import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { loadDotEnv } from '../src/env.js';
import { JsonlEventStore } from '../src/eventlog/jsonl-store.js';
import { renderTree } from '../src/eventlog/projections.js';
import { buildLiveEngine } from '../src/daemon/live-engine.js';
import { assessSmoke } from '../src/smoke/verdict.js';
import type { Goal } from '../src/contract/goal.js';
import type { Report } from '../src/contract/report.js';

// ── Env + gate ───────────────────────────────────────────────────────────────

loadDotEnv();

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║          Corellia factory — smoke:live (one real-model goal)          ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log('');

if (!process.env['OPENROUTER_API_KEY']) {
  console.log('smoke:live — SKIPPED');
  console.log('  OPENROUTER_API_KEY is not set; nothing to run.');
  console.log('  (CI gates on secret presence: this is a skip, not a failure.)');
  console.log('');
  process.exit(0);
}

const CAP_USD = parseFloatEnv('CORELLIA_SMOKE_CAP_USD', 0.25);
const WALLCLOCK_MS = parseIntEnv('CORELLIA_SMOKE_WALLCLOCK_MS', 240_000);
const EVENTS_OUT = process.env['CORELLIA_SMOKE_EVENTS_OUT'];

console.log(`Cap:        $${CAP_USD.toFixed(2)} (per-tree ceiling)`);
console.log(`Wall clock: ${(WALLCLOCK_MS / 1000).toFixed(0)}s`);
console.log('');

// ── Throwaway target repo (isolation) ────────────────────────────────────────

const targetRoot = mkdtempSync(join(tmpdir(), 'corellia-smoke-'));
const eventsPath = join(targetRoot, 'events.jsonl');

// The engine's tree opens a git worktree against the target; make it a repo.
execFileSync('git', ['-C', targetRoot, 'init', '-q'], { stdio: 'pipe' });
execFileSync('git', ['-C', targetRoot, 'config', 'user.email', 'smoke@corellia.local'], { stdio: 'pipe' });
execFileSync('git', ['-C', targetRoot, 'config', 'user.name', 'corellia-smoke'], { stdio: 'pipe' });
// A worktree cannot open off a repo with no commits; seed an empty root commit.
execFileSync('git', ['-C', targetRoot, 'commit', '--allow-empty', '-q', '-m', 'root'], { stdio: 'pipe' });

console.log(`Target:     ${targetRoot} (throwaway; deleted on exit)`);
console.log('');

// ── Goal ─────────────────────────────────────────────────────────────────────

const goal: Goal = {
  id: 'smoke-greeting',
  type: 'deliver-intent',
  parentId: null,
  title: 'Ship a greeting CLI',
  spec: {
    description:
      'A Node.js ESM CLI at greeting.mjs that accepts a single string argument (a name) ' +
      'and prints "Hello, <name>!" (newline-terminated) to stdout. ' +
      'If no argument is given, use "world".',
  },
  intent: 'production',
  scope: ['./'],
  budget: {
    attempts: 3,
    tokens: 200_000,
    toolCalls: 200,
    wallClockMs: WALLCLOCK_MS,
  },
  // The per-tree dollar ceiling — the real cost backstop (ADR-017). The tree halts
  // itself here; assessSmoke re-checks reported spend against the same cap as a
  // belt-and-braces assertion.
  spendCeilingUsd: CAP_USD,
  memories: [],
};

// ── Run ──────────────────────────────────────────────────────────────────────

const store = new JsonlEventStore(eventsPath);
const engine = buildLiveEngine({
  store,
  sandbox: {
    repoRoot: targetRoot,
    declaredScripts: {},
  },
});

console.log('Running... (live LLM call; cost is real but bounded by the cap)');
console.log('');

let report: Report | null = null;
let runError: unknown = null;
try {
  report = await engine.run(goal);
} catch (err) {
  runError = err;
}

// ── Assess ───────────────────────────────────────────────────────────────────

const events = await store.list();
const verdict = assessSmoke({ events, report, capUsd: CAP_USD });

console.log('── goal tree ──────────────────────────────────────────────────────────');
console.log(events.length > 0 ? renderTree(events) : '(no events)');
console.log('');

if (runError !== null) {
  console.log('── run threw ──────────────────────────────────────────────────────────');
  console.log(`  ${runError instanceof Error ? runError.message : String(runError)}`);
  console.log('');
}

console.log('── smoke checks ───────────────────────────────────────────────────────');
for (const check of verdict.checks) {
  console.log(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}: ${check.detail}`);
}
console.log('');
console.log(`  spend: ${verdict.spentUsd === undefined ? '(none reported)' : `$${verdict.spentUsd.toFixed(4)}`}`);
console.log('');

// Preserve the event log for CI failure-artifact upload before teardown.
if (EVENTS_OUT !== undefined && existsSync(eventsPath)) {
  try {
    copyFileSync(eventsPath, EVENTS_OUT);
    console.log(`  events.jsonl copied to ${EVENTS_OUT}`);
  } catch (err) {
    console.log(`  (could not copy events.jsonl: ${err instanceof Error ? err.message : String(err)})`);
  }
}

// ── Teardown ─────────────────────────────────────────────────────────────────

try {
  rmSync(targetRoot, { recursive: true, force: true });
} catch {
  // Best-effort; the temp dir is the OS's to reclaim if we cannot.
}

// ── Verdict ──────────────────────────────────────────────────────────────────

if (verdict.pass) {
  console.log('smoke:live — PASS');
  console.log('');
  process.exit(0);
}

console.log('smoke:live — FAIL');
const failed = verdict.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`);
console.log(`  ${failed.join('; ')}`);
console.log('');
process.exit(1);

// ── Env helpers ──────────────────────────────────────────────────────────────

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`smoke:live: ${name}="${raw}" is not a positive number; using default ${fallback}.`);
    return fallback;
  }
  return n;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`smoke:live: ${name}="${raw}" is not a positive integer; using default ${fallback}.`);
    return fallback;
  }
  return n;
}
