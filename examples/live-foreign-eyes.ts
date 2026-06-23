/**
 * live:foreign-eyes — AC-2 early checkpoint harness (ADR-029 Decision 4).
 *
 * OPERATOR-RUN: this script is NOT CI-gated. Run it with a real OPENROUTER_API_KEY
 * before any deliver spend (live:self or live:foreign). It is the hard gate on
 * cats comprehension quality before committing to more expensive runs.
 *
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the design as written (ADR-029 Decision 4): comprehension is JIT, pulled
 * by the split gate, bounded by the regions the intent touches. This harness
 * commissions ONE real scoped intent against cats and lets the split gate decide
 * what to comprehend — instead of speculatively commissioning four whole-repo
 * map-repo categories (the old behavior, which violated DESIGN's own JIT rule:
 * "a region no goal touches is never mapped; no comprehension is ever
 * speculative").
 *
 * Success is asserted on TWO things, both of which the iteration-08 proof runs
 * showed the old design failing:
 *   1. The scoped intent CONVERGES (the commission returns with no blockers).
 *   2. Comprehension is SCOPED, not speculative — the gate pulls only the
 *      comprehension the intent needs (map-repo + deep-dive-region goal count is
 *      bounded, not a whole-repo sweep). The harness reports the count; the
 *      operator records the honest number either way.
 *
 * This is read-only on cats: no prBoundary is configured, so no branch is pushed
 * and no PR is opened. The checkpoint proves comprehension SCOPING, not delivery
 * (that is live:foreign / live:self).
 *
 * STRANGE-LOOP HYGIENE (not applicable here — this targets cats, not corellia)
 *   The cats target is a foreign repo; no nested-worktree concern applies.
 *   corellia's primary checkout is undisturbed throughout.
 *
 * REQUIRED ENVIRONMENT VARIABLES
 * ─────────────────────────────────────────────────────────────────────────────
 *   OPENROUTER_API_KEY   — required; Bearer token for all LLM requests
 *   CATS_REPO_PATH       — required; absolute path to the cats local checkout
 *                          (can also be passed as first CLI arg)
 *
 * OPTIONAL OVERRIDES
 * ─────────────────────────────────────────────────────────────────────────────
 *   CATS_EYES_FEATURE    — the scoped intent to commission (a real, narrow
 *                          feature). Default: a small, self-contained addition
 *                          that touches one existing region.
 *   CATS_EYES_SCOPE      — comma-separated scope prefixes for the intent.
 *                          Default: matches the default feature.
 *   COMPREHENSION_BUDGET — soft ceiling on comprehension goals before the run is
 *                          flagged as over-firing (default 6). The pre-ADR-029
 *                          runs minted ~16 for a trivial intent.
 *   CORELLIA_MODEL_LOW / _MID / _HIGH — model id overrides per tier.
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   npm run live:foreign-eyes                        # uses CATS_REPO_PATH env var
 *   npm run live:foreign-eyes -- /path/to/cats       # CLI arg overrides env var
 *
 * SAFETY
 * ─────────────────────────────────────────────────────────────────────────────
 * No prBoundary → push_branch / open_pr are not granted, so the run cannot push
 * to or open a PR on cats. The factory opens a sandbox worktree under cats'
 * .corellia/worktrees/ for the deliver run (gitignored); the cats primary
 * checkout is undisturbed. Verify with `git -C <cats> status` after the run.
 *
 * OUTCOME
 * ─────────────────────────────────────────────────────────────────────────────
 * After the run, record the honest result (convergence + comprehension count) in:
 *   docs/prototype-build-notes.md  (iteration-09 section, AC-2 evidence)
 *
 * If the intent blocks or comprehension over-fires, root-cause before approving
 * any deliver spend.
 */

import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { loadDotEnv } from '../src/env.js';
import { InMemoryEventStore } from '../src/eventlog/memory-store.js';
import { JsonlEventStore } from '../src/eventlog/jsonl-store.js';
import { projectKnowledge, costSummary, renderTree } from '../src/eventlog/projections.js';
import { buildLiveEngine, assertGitRepo } from '../src/daemon/live-engine.js';
import { Listener } from '../src/listener/listener.js';
import type { CommissionInput } from '../src/contract/brief.js';

// ── Env + Gate ─────────────────────────────────────────────────────────────────

loadDotEnv();

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║     Corellia factory — live:foreign-eyes (AC-2 scoped checkpoint)    ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log('');

if (!process.env['OPENROUTER_API_KEY']) {
  console.log('live:foreign-eyes — SKIPPED');
  console.log('  OPENROUTER_API_KEY is not set.');
  console.log('  Export it (export OPENROUTER_API_KEY=sk-or-...) or copy .env.example to .env.');
  console.log('');
  process.exit(0);
}

// Resolve cats repo path: CLI arg > CATS_REPO_PATH env var.
const rawCatsPath = process.argv[2] ?? process.env['CATS_REPO_PATH'];
if (!rawCatsPath) {
  console.error('live:foreign-eyes: CATS_REPO_PATH is not set.');
  console.error('  Usage: npm run live:foreign-eyes -- /path/to/cats');
  console.error('  Or: export CATS_REPO_PATH=/path/to/cats && npm run live:foreign-eyes');
  console.error('');
  process.exit(1);
}

const expanded = rawCatsPath.startsWith('~/') ? join(homedir(), rawCatsPath.slice(2)) : rawCatsPath;
const catsRoot = resolve(expanded);

assertGitRepo(catsRoot, 'live:foreign-eyes');

// The scoped intent. A narrow, real feature against ONE region so the split gate
// has something concrete to pull comprehension for — and a clear chance to NOT
// pull whole-repo maps. Override via env for a different cats-appropriate intent.
const FEATURE =
  process.env['CATS_EYES_FEATURE'] ??
  'Add a small, self-contained documentation comment block to the top of the main entry-point source file describing what the module does. No behavior change.';
const SCOPE_RAW = process.env['CATS_EYES_SCOPE'] ?? 'src/';
const SCOPE = SCOPE_RAW.split(',').map((s) => s.trim()).filter(Boolean);
const COMPREHENSION_BUDGET = Number(process.env['COMPREHENSION_BUDGET'] ?? '6');

console.log(`Target repo:  ${catsRoot} (cats)`);
console.log(`Mode:         scoped intent → JIT comprehension pulled by the split gate (read-only; no PR)`);
console.log(`Feature:      ${FEATURE}`);
console.log(`Scope:        ${SCOPE.join(', ')}`);
console.log(`Over-fire flag if comprehension goals > ${COMPREHENSION_BUDGET}`);
console.log('');

// ── Store + Engine ─────────────────────────────────────────────────────────────

// Persist the event log to JSONL when CORELLIA_EVENTS_PATH is set, so a run can
// be replayed/inspected after it exits (the event log IS the trace — see
// scripts/trace.ts). Defaults to in-memory (ephemeral) when unset.
const eventsPath = process.env['CORELLIA_EVENTS_PATH'];
const store = eventsPath ? new JsonlEventStore(eventsPath) : new InMemoryEventStore();
if (eventsPath) console.log(`Event log:    ${eventsPath} (persisted — replay with: npx tsx scripts/trace.ts ${eventsPath})`);
const runNonce = randomBytes(4).toString('hex');
const intentId = `foreign-eyes-${runNonce}`;

// No prBoundary: this checkpoint is read-only on cats. The factory may open a
// sandbox worktree but cannot push or open a PR.
const engine = buildLiveEngine({
  store,
  sandbox: {
    repoRoot: catsRoot,
    declaredScripts: {},
    knowledge: true,
  },
  knowledge: true,
  goldenCapture: true,
});

const listener = new Listener({ engine, store });

// ── Commission the scoped intent ─────────────────────────────────────────────────

const commission: CommissionInput = {
  id: intentId,
  title: FEATURE,
  spec: {
    description: FEATURE,
    scope: SCOPE,
    constraints: [
      'All work must be confined to declared scope.',
      'Comprehend only what is needed to make this specific change — do not map the whole repo.',
    ],
  },
  scope: SCOPE,
  budget: {
    attempts: 5,
    tokens: 2_000_000,
    toolCalls: 200,
    wallClockMs: 1_800_000,
  },
  intent: 'production',
};

console.log('── commissioning scoped intent ───────────────────────────────────────────');
console.log(`  Intent id:  ${intentId}`);
console.log(`  Budget:     5 attempts, 2M tokens, 200 tool calls, 30 min`);
console.log('');
console.log('Running... (this is a live LLM run; costs are real)');
console.log('');

let report;
let runError: string | undefined;
try {
  report = await listener.commission(commission);
} catch (err) {
  runError = err instanceof Error ? err.message : String(err);
  console.error('');
  console.error('═══ LIVE:FOREIGN-EYES RUN FAILED ═══════════════════════════════════════');
  console.error('Error:', runError);
}

// ── Projections: convergence + comprehension scoping ──────────────────────────────

const allEvents = await store.list();

// Count comprehension goals the gate pulled, from goal-received events.
const COMPREHENSION_TYPES = new Set(['map-repo', 'deep-dive-region']);
let mapRepoCount = 0;
let diveCount = 0;
for (const e of allEvents) {
  if (e.type !== 'goal-received') continue;
  const goalType = e.goal.type;
  if (!COMPREHENSION_TYPES.has(goalType)) continue;
  if (goalType === 'map-repo') mapRepoCount += 1;
  else diveCount += 1;
}
const comprehensionCount = mapRepoCount + diveCount;

const converged = runError === undefined && report !== undefined && report.blockers.length === 0;

// ── Cost summary ───────────────────────────────────────────────────────────────

const cost = costSummary(allEvents);
console.log('');
console.log('── cost summary ─────────────────────────────────────────────────────────');
console.log(`  prompt tokens:     ${cost.tree.promptTokens}`);
console.log(`  completion tokens: ${cost.tree.completionTokens}`);
const cacheHitPct = cost.tree.cacheHitShare === undefined
  ? '(no cached tokens reported)'
  : `${(cost.tree.cacheHitShare * 100).toFixed(1)}%`;
console.log(`  cache-hit share:   ${cacheHitPct}`);
const totalCost = cost.tree.costUsd === undefined
  ? '(no cost reported)'
  : `$${cost.tree.costUsd.toFixed(4)}`;
console.log(`  total cost:        ${totalCost}`);
console.log('');

// ── Knowledge projection ───────────────────────────────────────────────────────

const knowledge = projectKnowledge(allEvents);
console.log('── knowledge artifacts written ──────────────────────────────────────────');
if (knowledge.artifacts.size === 0) {
  console.log('  (none written)');
} else {
  for (const [key, entry] of knowledge.artifacts) {
    console.log(`  ${key}: generatedAtSha=${entry.artifact.generatedAtSha.slice(0, 8)}`);
  }
}
console.log('');

// ── Goal tree ────────────────────────────────────────────────────────────────────

console.log('── goal tree ──────────────────────────────────────────────────────────────');
console.log(renderTree(allEvents));
console.log('');

// ── Result summary ─────────────────────────────────────────────────────────────

const scoped = comprehensionCount <= COMPREHENSION_BUDGET;

console.log('── result summary ────────────────────────────────────────────────────────');
console.log(`  convergence:        ${converged ? '✓ intent converged (no blockers)' : '✗ intent did NOT converge'}`);
if (runError !== undefined) {
  console.log(`    run error:        ${runError}`);
} else if (report !== undefined && report.blockers.length > 0) {
  console.log(`    blockers:         ${report.blockers.join('; ')}`);
}
console.log(`  comprehension:      ${mapRepoCount} map-repo + ${diveCount} deep-dive = ${comprehensionCount} goal(s)`);
console.log(`  scoping:            ${scoped ? `✓ scoped (≤ ${COMPREHENSION_BUDGET})` : `✗ OVER-FIRES (> ${COMPREHENSION_BUDGET} — speculative whole-repo comprehension)`}`);
console.log('');

const pass = converged && scoped;
if (pass) {
  console.log('AC-2 CHECKPOINT: PASSED.');
  console.log('A scoped intent converged with JIT-scoped comprehension (ADR-029 Decision 4).');
  console.log('Record this result in docs/prototype-build-notes.md and approve deliver spend.');
} else {
  console.log('AC-2 CHECKPOINT: FAILED.');
  if (!converged) console.log('  The intent did not converge — root-cause the blockers above.');
  if (!scoped) console.log('  Comprehension over-fired — the split gate pulled speculative whole-repo maps.');
  console.log('  Record the honest result in docs/prototype-build-notes.md before any spend.');
}
console.log('');

// ── Evidence template (print to stdout for operator to paste into build notes) ─

console.log('── evidence template for prototype-build-notes.md ───────────────────────');
console.log('');
console.log('<!-- paste into docs/prototype-build-notes.md → iteration-09 section -->');
console.log('');
console.log('### AC-2: live:foreign-eyes scoped checkpoint result');
console.log('');
console.log(`**Date:** ${new Date().toISOString().split('T')[0]}`);
console.log(`**Target:** cats (${catsRoot})`);
console.log(`**Run nonce:** ${runNonce}`);
console.log(`**Intent:** ${FEATURE}`);
console.log(`**Scope:** ${SCOPE.join(', ')}`);
console.log('');
console.log('| Check | Result |');
console.log('|---|---|');
console.log(`| Convergence | ${converged ? 'PASS (no blockers)' : `FAIL${runError ? `: ${runError}` : report ? `: ${report.blockers.join('; ')}` : ''}`} |`);
console.log(`| Comprehension goals | ${comprehensionCount} (${mapRepoCount} map-repo + ${diveCount} deep-dive) |`);
console.log(`| Scoping (≤ ${COMPREHENSION_BUDGET}) | ${scoped ? 'PASS' : 'FAIL — over-fires'} |`);
console.log('');
console.log(`**Cost:** ${totalCost}`);
console.log(`**Cache-hit share:** ${cacheHitPct}`);
console.log('');
console.log(`**Decision:** ${pass ? 'Approve deliver spend.' : 'Root-cause before spend.'}`);
console.log('');

process.exit(pass ? 0 : 1);
