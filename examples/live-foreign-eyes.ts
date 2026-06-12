/**
 * live:foreign-eyes — AC-2 early checkpoint harness (F-67 Chunk 3).
 *
 * OPERATOR-RUN: this script is NOT CI-gated. Run it with a real OPENROUTER_API_KEY
 * before any deliver spend (live:self or live:foreign). It is the hard gate on
 * cats comprehension quality before committing to more expensive runs.
 *
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Retests the cats repo under the iteration-06 stack:
 *   - Structured emission (ADR-023 KnowledgeArtifact JSON)
 *   - F-64 economics (provider pinning + duplicate-call guard + cost reporting)
 *   - F-65 read-only root path (learn goals: no worktree write capability)
 *
 * Target: 5/5 knowledge categories. cats blocked all five in iteration-04
 * (pre-structured-emission). This checkpoint determines whether the new stack
 * unblocks comprehension before any deliver spend is authorized.
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
 *   CORELLIA_MODEL_LOW   — override low-tier model id
 *   CORELLIA_MODEL_MID   — override mid-tier model id
 *   CORELLIA_MODEL_HIGH  — override high-tier model id
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   npm run live:foreign-eyes                        # uses CATS_REPO_PATH env var
 *   npm run live:foreign-eyes -- /path/to/cats       # CLI arg overrides env var
 *
 * SAFETY
 * ─────────────────────────────────────────────────────────────────────────────
 * The run is strictly READ-ONLY on the cats repo. learn-kind root goals open
 * no worktree on the target repo (F-65 A12). After the run, the cats checkout
 * is byte-identical (modulo the benign .git/info/exclude line the first
 * openSandboxAssembly call adds — but F-65 means no sandbox worktree is opened).
 *
 * OUTCOME
 * ─────────────────────────────────────────────────────────────────────────────
 * After the run, record the honest result (pass count + any failures) in:
 *   docs/prototype-build-notes.md  (iteration-06 section, AC-2 evidence)
 *
 * If cats blocks again, root-cause before approving any deliver spend.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { loadDotEnv } from '../src/env.js';
import { InMemoryEventStore } from '../src/eventlog/memory-store.js';
import { projectKnowledge, costSummary } from '../src/eventlog/projections.js';
import type { Goal } from '../src/contract/goal.js';
import type { KnowledgeCategory } from '../src/contract/knowledge.js';
import { buildLiveEngine, assertGitRepo } from '../src/daemon/live-engine.js';
import { randomBytes } from 'node:crypto';

// ── Env + Gate ─────────────────────────────────────────────────────────────────

loadDotEnv();

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║     Corellia factory — live:foreign-eyes (AC-2 early checkpoint)     ║');
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

console.log(`Target repo:  ${catsRoot} (cats)`);
console.log(`Mode:         comprehension-only (read-only; learn goals; no worktree)`);
console.log(`Economics:    provider-pinned requests (F-64); cache-hit share reported`);
console.log('');

// ── Store + Engine ─────────────────────────────────────────────────────────────

const store = new InMemoryEventStore();
const runNonce = randomBytes(4).toString('hex');

// Pick a reasonable dive region.
function pickDiveRegion(repo: string): string {
  let best: string | null = null;
  let bestCount = -1;
  for (const candidate of ['src', 'app', 'lib', 'pkg']) {
    const full = join(repo, candidate);
    if (!existsSync(full)) continue;
    let count: number;
    try { count = readdirSync(full).length; } catch { count = 0; }
    if (count > bestCount) { bestCount = count; best = candidate; }
  }
  return best ?? '.';
}

const diveRegion = pickDiveRegion(catsRoot);
const CATEGORIES: KnowledgeCategory[] = ['architecture', 'stack', 'conventions', 'test-scaffold'];

// Detect declared test script.
function detectDeclaredScripts(repo: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    if (pkg.scripts?.['test']) return { test: 'npm-script:test' };
  } catch { /* no package.json */ }
  return {};
}

const declaredScripts = detectDeclaredScripts(catsRoot);

const engine = buildLiveEngine({
  store,
  sandbox: {
    repoRoot: catsRoot,
    declaredScripts,
    knowledge: true,
  },
  knowledge: true,
  goldenCapture: true,
});

// ── Commission: one map-repo goal per category ─────────────────────────────────

const DEFAULT_BUDGET = {
  attempts: 3,
  tokens: 500_000,
  toolCalls: 20,
  wallClockMs: 600_000,
};

function mapGoal(category: KnowledgeCategory): Goal {
  return {
    id: `foreign-eyes-${runNonce}-map-${category}`,
    type: 'map-repo',
    parentId: null,
    title: `Map ${category} knowledge — cats`,
    spec: {
      repoRoot: catsRoot,
      category,
      description: `Map the "${category}" knowledge of the cats repo at ${catsRoot}.`,
    },
    intent: 'production',
    scope: [],
    budget: DEFAULT_BUDGET,
    memories: [],
  };
}

function diveGoal(): Goal {
  return {
    id: `foreign-eyes-${runNonce}-dive-${diveRegion.replace(/[^a-z0-9]/gi, '-')}`,
    type: 'deep-dive-region',
    parentId: null,
    title: `Deep-dive region "${diveRegion}" — cats`,
    spec: {
      repoRoot: catsRoot,
      region: diveRegion,
      reason: 'Early checkpoint: validate region comprehension before deliver runs.',
    },
    intent: 'production',
    scope: [diveRegion],
    budget: DEFAULT_BUDGET,
    memories: [],
  };
}

// ── Run ────────────────────────────────────────────────────────────────────────

console.log(`Categories:   ${CATEGORIES.join(', ')}`);
console.log(`Dive region:  ${diveRegion}`);
console.log(`Run nonce:    ${runNonce}`);
console.log('');
console.log('Starting comprehension runs. Each category runs sequentially.');
console.log('This may take several minutes. Costs are real — operator is watching.');
console.log('');

const results: Array<{ category: string; ok: boolean; error: string | undefined }> = [];

for (const category of CATEGORIES) {
  const goal = mapGoal(category);
  process.stdout.write(`  [map-repo:${category}] ... `);
  try {
    const report = await engine.run(goal);
    const ok = report.blockers.length === 0;
    results.push({ category, ok, error: ok ? undefined : report.blockers.join('; ') });
    console.log(ok ? 'PASS' : `FAIL — ${report.blockers.join('; ')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ category, ok: false, error: msg });
    console.log(`ERROR — ${msg}`);
  }
}

// Dive region.
{
  const goal = diveGoal();
  process.stdout.write(`  [deep-dive:${diveRegion}] ... `);
  try {
    const report = await engine.run(goal);
    const ok = report.blockers.length === 0;
    results.push({ category: `dive:${diveRegion}`, ok, error: ok ? undefined : report.blockers.join('; ') });
    console.log(ok ? 'PASS' : `FAIL — ${report.blockers.join('; ')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ category: `dive:${diveRegion}`, ok: false, error: msg });
    console.log(`ERROR — ${msg}`);
  }
}

// ── Cost summary ───────────────────────────────────────────────────────────────

const allEvents = await store.list();
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

// ── Result summary ─────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
const total = results.length;

console.log('── result summary ────────────────────────────────────────────────────────');
for (const r of results) {
  const icon = r.ok ? '✓' : '✗';
  const detail = r.error ? `  — ${r.error}` : '';
  console.log(`  ${icon} ${r.category}${detail}`);
}
console.log('');
console.log(`  ${passed}/${total} categories passed`);
console.log('');

if (passed === total) {
  console.log('AC-2 CHECKPOINT: ALL CATEGORIES PASSED.');
  console.log('The cats repo is comprehension-ready for deliver runs (live:foreign).');
  console.log('Record this result in docs/prototype-build-notes.md and approve deliver spend.');
} else {
  console.log('AC-2 CHECKPOINT: SOME CATEGORIES FAILED.');
  console.log('Root-cause the failures above before approving deliver spend.');
  console.log('Record the honest result in docs/prototype-build-notes.md.');
}
console.log('');

// ── Evidence template (print to stdout for operator to paste into build notes) ─

console.log('── evidence template for prototype-build-notes.md ───────────────────────');
console.log('');
console.log('<!-- paste into docs/prototype-build-notes.md → iteration-06 section -->');
console.log('');
console.log('### AC-2: live:foreign-eyes early checkpoint result');
console.log('');
console.log(`**Date:** ${new Date().toISOString().split('T')[0]}`);
console.log(`**Target:** cats (${catsRoot})`);
console.log(`**Run nonce:** ${runNonce}`);
console.log('');
console.log('| Category | Result |');
console.log('|---|---|');
for (const r of results) {
  console.log(`| ${r.category} | ${r.ok ? 'PASS' : `FAIL: ${r.error ?? '?'}`} |`);
}
console.log('');
console.log(`**Cost:** ${totalCost}`);
console.log(`**Cache-hit share:** ${cacheHitPct}`);
console.log('');
console.log(`**Decision:** ${passed === total ? 'Approve deliver spend.' : 'Root-cause failures before spend.'}`);
console.log('');
