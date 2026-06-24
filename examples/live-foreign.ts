/**
 * live:foreign — AC-4 live deliver harness: corellia delivers to cats (F-67 Chunk 5).
 *
 * OPERATOR-RUN: this script is NOT CI-gated. Run it with real GITHUB_TOKEN and
 * OPENROUTER_API_KEY AFTER live:foreign-eyes passes (AC-2 checkpoint) AND after
 * live:self succeeds (AC-3 evidence). Do not skip the checkpoint order.
 *
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Commissions a real cats feature through the factory, producing a cats PR.
 * Demonstrates AC-4: a feature on a foreign repo (cats) ends in a PR carrying
 * diff, proof artifacts, `learned`, and the factory has not merged it (structural
 * constraint, ADR-025/R13 — the factory cannot merge PRs it opens).
 *
 * If the report carries blockers, the improvement loop fires (if the daemon has
 * a standing envelope configured). Record whether an improve-factory commission
 * was minted and whether a factory-repo PR appeared.
 *
 * REQUIRED ENVIRONMENT VARIABLES
 * ─────────────────────────────────────────────────────────────────────────────
 *   OPENROUTER_API_KEY   — required; Bearer token for all LLM requests
 *   GITHUB_TOKEN         — required; `repo` scope on the cats GITHUB MIRROR
 *   CATS_REPO_PATH       — required; absolute path to the cats local checkout
 *   CATS_FEATURE         — required; feature title/description to commission
 *   CATS_SCOPE           — required; comma-separated scope prefixes (e.g. "src/")
 *
 * THE GITHUB-MIRROR PATH (AC-4 readiness, build-notes iteration 10)
 * ─────────────────────────────────────────────────────────────────────────────
 * cats' `origin` is a self-hosted GitLab host (labs.gauntletai.com) — the PR
 * boundary speaks GitHub REST only. cats ALSO has a `github` mirror remote
 * (git@github.com:kmazanec/cats.git). This harness derives the repo slug from,
 * and pushes the tree branch to, that GITHUB remote (CATS_GIT_REMOTE, default
 * `github`), so a real PR opens on the GitHub mirror.
 *
 * OPTIONAL OVERRIDES
 * ─────────────────────────────────────────────────────────────────────────────
 *   CATS_GIT_REMOTE      — the GitHub remote to derive the slug from + push to
 *                          (default: github). origin is GitLab; the mirror is github.
 *   CATS_BASE_BRANCH     — base branch for the PR (default: main)
 *   CORELLIA_MODEL_LOW/MID/HIGH — model tier overrides
 *   STANDING_BUDGET_JSON / STANDING_SPEND_CEILING_USD — improvement envelope
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   export OPENROUTER_API_KEY=sk-or-...
 *   export GITHUB_TOKEN=ghp_...
 *   export CATS_REPO_PATH=/path/to/cats
 *   export CATS_FEATURE="add a simple CLI command"
 *   export CATS_SCOPE="src/cli/"
 *   npm run live:foreign
 *
 * OUTCOME (record in docs/prototype-build-notes.md)
 * ─────────────────────────────────────────────────────────────────────────────
 *   - PR URL on cats (confirm factory has NOT merged it)
 *   - Cost + cache-hit share
 *   - Report's `learned` and `proof` artifacts
 *   - Whether an improve-factory commission fired (if blockers present)
 *   - Any factory-repo PR from the improvement loop
 */

import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { loadDotEnv } from '../src/env.js';
import { InMemoryEventStore } from '../src/eventlog/memory-store.js';
import { costSummary, renderTree } from '../src/eventlog/projections.js';
import { buildLiveEngine, assertGitRepo, deriveRepoSlug, requireEnv } from '../src/daemon/live-engine.js';
import { Listener } from '../src/listener/listener.js';
import { buildStore, buildStandingEnvelope } from '../src/daemon/config.js';
import type { CommissionInput } from '../src/contract/brief.js';

// ── Env + Gate ─────────────────────────────────────────────────────────────────

loadDotEnv();

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║        Corellia factory — live:foreign (AC-4: cats deliver)          ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log('');

if (!process.env['OPENROUTER_API_KEY']) {
  console.log('live:foreign — SKIPPED');
  console.log('  OPENROUTER_API_KEY is not set.');
  console.log('');
  process.exit(0);
}

const GITHUB_TOKEN = requireEnv('GITHUB_TOKEN');
const FEATURE = requireEnv('CATS_FEATURE');
const SCOPE_RAW = requireEnv('CATS_SCOPE');
const SCOPE = SCOPE_RAW.split(',').map((s) => s.trim()).filter(Boolean);
const BASE_BRANCH = process.env['CATS_BASE_BRANCH'] ?? 'main';
// cats' origin is GitLab; the GitHub mirror (PR target) is the `github` remote.
const GIT_REMOTE = process.env['CATS_GIT_REMOTE'] ?? 'github';

// Resolve cats repo.
const rawCatsPath = process.argv[2] ?? process.env['CATS_REPO_PATH'];
if (!rawCatsPath) {
  console.error('live:foreign: CATS_REPO_PATH is not set.');
  console.error('  Usage: CATS_REPO_PATH=/path/to/cats npm run live:foreign');
  process.exit(1);
}
const expanded = rawCatsPath.startsWith('~/') ? join(homedir(), rawCatsPath.slice(2)) : rawCatsPath;
const catsRoot = resolve(expanded);

assertGitRepo(catsRoot, 'live:foreign');

// Derive the GitHub repo slug from cats' GitHub mirror remote (default `github`).
// origin is GitLab and would not match; the PR opens against the GitHub mirror.
const catsRepoSlug = deriveRepoSlug(catsRoot, GIT_REMOTE);
if (!catsRepoSlug) {
  console.error(`live:foreign: cannot derive a GitHub repo slug from cats "${GIT_REMOTE}" remote.`);
  console.error(`  Ensure git remote get-url ${GIT_REMOTE} is a GitHub URL (https or SSH).`);
  console.error(`  cats' origin is GitLab — set CATS_GIT_REMOTE to the GitHub mirror remote.`);
  process.exit(1);
}

console.log(`Target repo:  ${catsRoot} (cats)`);
console.log(`Repo slug:    ${catsRepoSlug} (from "${GIT_REMOTE}" remote)`);
console.log(`Push remote:  ${GIT_REMOTE}`);
console.log(`Feature:      ${FEATURE}`);
console.log(`Scope:        ${SCOPE.join(', ')}`);
console.log(`Base branch:  ${BASE_BRANCH}`);
console.log('');

// ── Store + Engine ─────────────────────────────────────────────────────────────

// For live:foreign, use the daemon's substrate selection so the event log
// persists if DATABASE_URL or CORELLIA_EVENTS_PATH is configured. This also
// means the improvement loop (if triggered) uses the same store as product work.
const { store } = buildStore();
const standingEnvelope = buildStandingEnvelope();

if (standingEnvelope) {
  console.log(`Standing envelope: ${JSON.stringify(standingEnvelope)}`);
  console.log('  (improvement loop is active — improvement commissions may fire)');
} else {
  console.log('Standing envelope: not configured (improvement loop disabled for this run)');
}
console.log('');

const runNonce = randomBytes(4).toString('hex');
const intentId = `live-foreign-${runNonce}`;

process.env['GITHUB_TOKEN'] = GITHUB_TOKEN; // Ensure token is in env for push_branch.

const engine = buildLiveEngine({
  store,
  sandbox: {
    repoRoot: catsRoot,
    // cats is a Python repo (no package.json). Its checks run through its
    // Makefile via the `make:<target>` declared-script form — so the deliver
    // leaf can VERIFY ITS OWN WORK (the AC-3 "let the leaf verify" lesson).
    // The operator fixes the command; only the run_script `target` is model input.
    //
    // `test` → make:test-unit, NOT make:test: the full suite (`make test`) needs
    // Postgres+Redis (make dev = compose-up + migrate) and errors out regardless
    // of the leaf's code; `make test-unit` (uv run pytest tests/unit) is DB-free
    // and green at baseline (AC-4 run #1 finding 2). `test-unit` is also declared
    // by its own name because the leaf reaches for it directly. NB the worktree
    // symlinks the repo root's .venv (worktree.ts), so these uv commands resolve.
    declaredScripts: {
      test: 'make:test-unit',
      'test-unit': 'make:test-unit',
      typecheck: 'make:typecheck',
      lint: 'make:lint',
    },
    knowledge: true,
    // prBoundary enables push_branch + open_pr for this deliver run and for any
    // improvement commission that routes through the improvement loop.
    prBoundary: {
      repoSlug: catsRepoSlug,
      // Push to the GitHub mirror remote, NOT origin (origin is GitLab).
      remote: GIT_REMOTE,
      // No factoryRepoSlug: cats is a FOREIGN repo → the full process-clean gate
      // applies (factory vocabulary in the diff is blocked).
      // No fetchTransport override: uses real GitHub REST (live run).
    },
  },
  knowledge: true,
  goldenCapture: true,
});

const listener = standingEnvelope
  ? new Listener({ engine, store, standingEnvelope })
  : new Listener({ engine, store });

// ── Commission ─────────────────────────────────────────────────────────────────

const commission: CommissionInput = {
  id: intentId,
  title: FEATURE,
  spec: {
    description: FEATURE,
    scope: SCOPE,
    baseBranch: BASE_BRANCH,
    constraints: [
      'All work must be confined to declared scope.',
      'Push the branch and open a PR on the cats GitHub repo when done.',
      'The factory cannot merge the PR — leave it open for human review.',
      'The PR body must carry: proof artifacts, learned notes, and commit SHAs.',
    ],
  },
  scope: SCOPE,
  budget: {
    // First-proof headroom, matching live:self's AC-3 rationale: keep structural
    // budget rejections (subdivide flooring a small child to attempts:1, which a
    // recursing comprehension child cannot fan out from) off the critical path so
    // they don't mask the real question — does deliver-to-foreign function
    // end-to-end. Tune down once AC-4 is proven.
    attempts: 80,
    tokens: 5_000_000,
    toolCalls: 600,
    wallClockMs: 1_800_000,
  },
  intent: 'production',
};

console.log('── commissioning ─────────────────────────────────────────────────────────');
console.log(`  Intent id:  ${intentId}`);
console.log(`  Budget:     80 attempts, 5M tokens, 600 tool calls, 30 min`);
console.log('');
console.log('Running... (this is a live LLM run; costs are real)');
console.log('');

let report;
try {
  report = await listener.commission(commission);
} catch (err) {
  console.error('');
  console.error('═══ LIVE:FOREIGN RUN FAILED ════════════════════════════════════════════');
  console.error('Error:', err instanceof Error ? err.message : String(err));
  const events = await store.list();
  if (events.length > 0) {
    console.error('');
    console.error('Partial goal tree:');
    console.error(renderTree(events));
  }
  process.exit(1);
}

// ── Results ────────────────────────────────────────────────────────────────────

const allEvents = await store.list();

console.log('── goal tree ─────────────────────────────────────────────────────────────');
console.log(renderTree(allEvents));

// PR URL from event log.
const prEvents = allEvents.filter((e) => e.type === 'pr-opened');
const prUrls = prEvents.map((e) => (e.type === 'pr-opened' ? e.url : '')).filter(Boolean);

// Improvement commissions that fired.
const blockerRoutedEvents = allEvents.filter((e) => e.type === 'blocker-routed');

console.log('');
console.log('── cost summary ─────────────────────────────────────────────────────────');
const cost = costSummary(allEvents);
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

// ── Outcome ────────────────────────────────────────────────────────────────────

console.log('── outcome ───────────────────────────────────────────────────────────────');
if (prUrls.length > 0) {
  for (const url of prUrls) {
    console.log(`  PR opened:  ${url}`);
    console.log('  (factory has NOT merged it — operator review required)');
  }
} else {
  console.log('  No PR opened (no pr-opened events in log).');
}

if (report.blockers.length > 0) {
  console.log('');
  console.log('  Blockers:', report.blockers);
}

if (report.learned) {
  console.log('');
  console.log('  Learned:', report.learned);
}

if (blockerRoutedEvents.length > 0) {
  console.log('');
  console.log('  Improvement loop fired:');
  for (const ev of blockerRoutedEvents) {
    if (ev.type !== 'blocker-routed') continue;
    console.log(`    blocker-routed: "${ev.blocker}" → commission ${ev.commissionId}`);
  }
}

console.log('');

// ── Evidence template ──────────────────────────────────────────────────────────

console.log('── evidence template for prototype-build-notes.md ───────────────────────');
console.log('');
console.log('### AC-4: live:foreign result (cats deliver)');
console.log('');
console.log(`**Date:** ${new Date().toISOString().split('T')[0]}`);
console.log(`**Intent id:** ${intentId}`);
console.log(`**Feature:** ${FEATURE}`);
console.log(`**Target:** cats (${catsRoot})`);
console.log(`**Scope:** ${SCOPE.join(', ')}`);
console.log('');
for (const url of prUrls) {
  console.log(`**PR:** ${url} ← factory has NOT merged this`);
}
console.log('');
console.log(`**Cost:** ${totalCost}`);
console.log(`**Cache-hit share:** ${cacheHitPct}`);
console.log('');
console.log(`**Blockers:** ${report.blockers.length === 0 ? 'none' : report.blockers.join('; ')}`);
console.log('');
console.log(`**Learned:** ${report.learned || '(none)'}`);
console.log('');

if (blockerRoutedEvents.length > 0) {
  console.log('**Improvement loop:**');
  for (const ev of blockerRoutedEvents) {
    if (ev.type !== 'blocker-routed') continue;
    console.log(`- Blocker: "${ev.blocker}"`);
    console.log(`  Commission: ${ev.commissionId}`);
  }
  console.log('');
} else {
  console.log('**Improvement loop:** did not fire (no blockers, or envelope not configured)');
  console.log('');
}

console.log('**Proof artifacts:**');
if (report.proof && report.proof.length > 0) {
  for (const p of report.proof) {
    console.log(`- ${typeof p === 'string' ? p : JSON.stringify(p)}`);
  }
} else {
  console.log('- (none)');
}
console.log('');
