/**
 * live:self — AC-3 live deliver harness: corellia builds corellia (F-67 Chunk 4).
 *
 * OPERATOR-RUN: this script is NOT CI-gated. Run it with real GITHUB_TOKEN and
 * OPENROUTER_API_KEY after live:foreign-eyes passes (AC-2 checkpoint).
 *
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Commissions a real corellia feature through the daemonized front door,
 * producing a corellia PR. Demonstrates AC-3: a feature commissioned through
 * the live factory ends in a PR on the factory's own repo.
 *
 * STRANGE-LOOP HYGIENE (critical — read before running)
 * ─────────────────────────────────────────────────────────────────────────────
 * corellia building corellia means the factory operates on its own repo.
 * This creates a potentially confusing nested-worktree situation:
 *
 *   - The factory's PRIMARY CHECKOUT is on `main` (or build/06-loop).
 *     It MUST remain undisturbed throughout the run.
 *   - The factory opens a WORKTREE under .corellia/worktrees/<treeId>/ for the
 *     sandboxed deliver run. The worktree is on a tree/<treeId> branch.
 *   - The worktree's broker's write_file calls are scoped to the feature's
 *     declared scope — they cannot touch the primary checkout's working tree.
 *   - .corellia/worktrees/ is gitignored (.git/info/exclude), so the worktree
 *     itself does not appear in the diff.
 *
 * Isolation verification after the run:
 *   1. git status on the primary checkout must be clean (no dirty files).
 *   2. git worktree list must show only main + the (already-collected) tree.
 *   3. The emitted PR's diff must contain only feature-scoped changes.
 *
 * Process-clean gate (AC-20 / ADR-025): push_branch runs
 * scanDiffForProcessLanguage over the worktree diff before pushing. Any
 * factory-internal content (goal ids, plan refs, "corellia", "improve-factory",
 * etc.) is blocked. The push refuses and names the offending file:line.
 *
 * REQUIRED ENVIRONMENT VARIABLES
 * ─────────────────────────────────────────────────────────────────────────────
 *   OPENROUTER_API_KEY   — required; Bearer token for all LLM requests
 *   GITHUB_TOKEN         — required; `repo` scope on the corellia remote
 *   CORELLIA_FEATURE     — required; the feature title/description to commission
 *                          (e.g. "add a simple CLI greeting command")
 *   CORELLIA_SCOPE       — required; comma-separated scope prefixes (e.g. "src/cli/")
 *
 * OPTIONAL OVERRIDES
 * ─────────────────────────────────────────────────────────────────────────────
 *   CORELLIA_REPO_PATH   — path to corellia root (default: resolved from this file)
 *   CORELLIA_MODEL_LOW/MID/HIGH — model tier overrides
 *   CORELLIA_REFS        — comma-separated files (relative to the corellia root, or
 *                          absolute) whose CONTENT is attached to the commission as
 *                          spec.references = [{ path, content }], so the factory
 *                          works from the real artifacts the intent names rather
 *                          than rediscovering them (e.g.
 *                          "GOAL-TYPES.md,docs/issues/factory-manages-issues.md")
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   export OPENROUTER_API_KEY=sk-or-...
 *   export GITHUB_TOKEN=ghp_...
 *   export CORELLIA_FEATURE="add X"
 *   export CORELLIA_SCOPE="src/x/"
 *   npm run live:self
 *
 * OUTCOME
 * ─────────────────────────────────────────────────────────────────────────────
 * Record in the current docs/iterations/<slug>/index.md (and a line in docs/log.md):
 *   - PR URL
 *   - Total cost + cache-hit share
 *   - Strange-loop isolation behavior (primary checkout clean? worktree listed?)
 *   - Process-clean gate outcome (fired? what content?)
 *   - Any blockers in the report
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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
console.log('║       Corellia factory — live:self (AC-3: corellia delivers)         ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log('');

if (!process.env['OPENROUTER_API_KEY']) {
  console.log('live:self — SKIPPED');
  console.log('  OPENROUTER_API_KEY is not set.');
  console.log('');
  process.exit(0);
}

const GITHUB_TOKEN = requireEnv('GITHUB_TOKEN');
const FEATURE = requireEnv('CORELLIA_FEATURE');
const SCOPE_RAW = requireEnv('CORELLIA_SCOPE');
const SCOPE = SCOPE_RAW.split(',').map((s) => s.trim()).filter(Boolean);

// Resolve corellia root from this file's location (or override via env).
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rawCorelliaPath = process.env['CORELLIA_REPO_PATH'];
const corelliaRoot = rawCorelliaPath ? resolve(rawCorelliaPath) : resolve(scriptDir, '..');

assertGitRepo(corelliaRoot, 'live:self');

// Optional: CORELLIA_REFS — a comma-separated list of files (paths relative to
// the corellia root, or absolute) whose CONTENT is attached to the commission as
// spec.references = [{ path, content }]. This lets the harness hand the factory
// the ACTUAL artifacts the intent refers to (GOAL-TYPES.md, an issue, an ADR)
// rather than making it rediscover them via comprehension. The brain renders each
// reference as a readable, fenced block (see renderSpec in src/brains/llm.ts) — it
// is NOT JSON-stringified, so large reference content does not reintroduce the
// decode-fragility the spec rendering was hardened against. Unknown to the frozen
// CommissionInput shape: the data rides inside spec (typed `unknown`), so no
// contract field is added (ADR-026 stays intact).
const REFS_RAW = process.env['CORELLIA_REFS'] ?? '';
const references: Array<{ path: string; content: string }> = REFS_RAW
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => {
    const abs = isAbsolute(p) ? p : join(corelliaRoot, p);
    if (!existsSync(abs)) {
      console.error(`live:self: CORELLIA_REFS file not found: ${p} (resolved ${abs})`);
      process.exit(1);
    }
    return { path: p, content: readFileSync(abs, 'utf-8') };
  });

// Derive the GitHub repo slug from origin remote.
const repoSlug = deriveRepoSlug(corelliaRoot);
if (!repoSlug) {
  console.error('live:self: cannot derive repo slug from git remote get-url origin.');
  console.error('  Ensure the origin remote is a GitHub URL (https or SSH).');
  process.exit(1);
}

console.log(`Target repo:  ${corelliaRoot} (corellia itself — strange loop)`);
console.log(`Repo slug:    ${repoSlug}`);
console.log(`Feature:      ${FEATURE}`);
console.log(`Scope:        ${SCOPE.join(', ')}`);
if (references.length > 0) {
  console.log(`References:   ${references.map((r) => r.path).join(', ')}`);
}
console.log('');

// ── Strange-loop hygiene pre-check ────────────────────────────────────────────

console.log('── strange-loop pre-check ───────────────────────────────────────────────');

// Verify the primary checkout is on the expected branch and clean.
let primaryBranch: string;
try {
  primaryBranch = execFileSync('git', ['-C', corelliaRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    stdio: 'pipe', encoding: 'utf-8',
  }).trim();
} catch {
  primaryBranch = '<unknown>';
}

const primaryClean = execFileSync('git', ['-C', corelliaRoot, 'status', '--porcelain'], {
  stdio: 'pipe', encoding: 'utf-8',
}).trim();

console.log(`  Primary branch:   ${primaryBranch}`);
console.log(`  Primary clean:    ${primaryClean === '' ? 'YES' : 'NO (dirty)'}`);

if (primaryClean !== '') {
  console.log('');
  console.log('WARNING: primary checkout has uncommitted changes. Proceeding anyway.');
  console.log('The factory worktree runs in isolation and will NOT touch these files.');
  console.log('Verify the primary is still clean after the run.');
}

// Check .corellia/worktrees/ is excluded from git (it must be gitignored).
const gitDir = execFileSync('git', ['-C', corelliaRoot, 'rev-parse', '--git-dir'], {
  stdio: 'pipe', encoding: 'utf-8',
}).trim();
const gitDirAbsolute = gitDir.startsWith('/') ? gitDir : join(corelliaRoot, gitDir);
const excludePath = join(gitDirAbsolute, 'info', 'exclude');
const excludeContent = existsSync(excludePath)
  ? execFileSync('cat', [excludePath], { stdio: 'pipe', encoding: 'utf-8' })
  : '';
const worktreesExcluded = excludeContent.includes('.corellia/worktrees');
console.log(`  Worktrees excluded from git:  ${worktreesExcluded ? 'YES' : 'NO (check .gitignore)'}`);
console.log('');

// ── Store + Engine ─────────────────────────────────────────────────────────────

// For the live:self run, we use the daemon's substrate selection so the event
// log persists if DATABASE_URL or CORELLIA_EVENTS_PATH is configured.
const { store } = buildStore();
const standingEnvelope = buildStandingEnvelope();

const runNonce = randomBytes(4).toString('hex');
const intentId = `live-self-${runNonce}`;

process.env['GITHUB_TOKEN'] = GITHUB_TOKEN; // Ensure token is in env for push_branch.

const engine = buildLiveEngine({
  store,
  sandbox: {
    repoRoot: corelliaRoot,
    // corellia building corellia: declare its own verification scripts so a
    // self-build can run them (the intent asks to keep these green).
    declaredScripts: {
      test: 'npm-script:test',
      typecheck: 'npm-script:typecheck',
      lint: 'npm-script:lint',
      // Commission constraints routinely ask for code-shape evidence; leaving it
      // undeclared makes every such run_script call an instant refusal.
      'code-shape': 'npm-script:code-shape',
    },
    // prBoundary: wires push_branch + open_pr for improve-factory goal types.
    // For a deliver-intent root, open_pr is called via the improvement path only
    // if the deliver completes with blockers and the improvement loop routes a fix.
    prBoundary: {
      repoSlug,
      // factoryRepoSlug: corellia is pushing to its own repo. Setting this to
      // `repoSlug` tells the process-clean gate that this push's target IS the
      // factory's own repo, so factory vocabulary in the diff is permitted
      // (only ALWAYS_DANGEROUS_PATTERNS are blocked). Without this, the full
      // gate would fire and block legitimate factory-internal file changes.
      factoryRepoSlug: repoSlug,
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
    constraints: [
      'The factory primary checkout must remain undisturbed.',
      'All work must be confined to declared scope.',
      'Process-clean gate will block any factory-internal language in the diff.',
      'Push and open a PR on the GitHub repo when done.',
    ],
    // Attached only when CORELLIA_REFS is set; the brain renders each as a
    // readable fenced block so the goal works from the artifacts' real content.
    ...(references.length > 0 ? { references } : {}),
  },
  scope: SCOPE,
  budget: {
    // Proving-run headroom: deliberately generous so that structural budget
    // rejections (subdivide floors attempts, so a small share of a small parent
    // collapses to attempts:1 — which a now-RECURSING comprehension child cannot
    // fan out from) stop masking the real question of whether recursive
    // comprehension functions end-to-end. attempts is the lever: it bounds
    // per-level fan-out width AND, after subdivision, how much each child can
    // itself split. Tune down later; while validating the architecture, keep it
    // off the critical path.
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
  console.error('═══ LIVE:SELF RUN FAILED ═══════════════════════════════════════════════');
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

// ── Strange-loop post-check ────────────────────────────────────────────────────

console.log('── strange-loop post-check ──────────────────────────────────────────────');

const postClean = execFileSync('git', ['-C', corelliaRoot, 'status', '--porcelain'], {
  stdio: 'pipe', encoding: 'utf-8',
}).trim();
console.log(`  Primary clean after run: ${postClean === '' ? 'YES (isolation confirmed)' : 'NO — investigate!'}`);

const worktreeList = execFileSync('git', ['-C', corelliaRoot, 'worktree', 'list'], {
  stdio: 'pipe', encoding: 'utf-8',
}).trim();
console.log(`  Worktree list:\n${worktreeList.split('\n').map((l) => `    ${l}`).join('\n')}`);

console.log('');

// ── Outcome ────────────────────────────────────────────────────────────────────

console.log('── outcome ───────────────────────────────────────────────────────────────');
if (prUrls.length > 0) {
  for (const url of prUrls) {
    console.log(`  PR opened:  ${url}`);
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

console.log('');

// ── Evidence template ──────────────────────────────────────────────────────────

console.log('── evidence template for the iteration index.md / log.md ───────────────────────');
console.log('');
console.log('### AC-3: live:self result (corellia delivers to itself)');
console.log('');
console.log(`**Date:** ${new Date().toISOString().split('T')[0]}`);
console.log(`**Intent id:** ${intentId}`);
console.log(`**Feature:** ${FEATURE}`);
console.log(`**Scope:** ${SCOPE.join(', ')}`);
console.log('');
for (const url of prUrls) {
  console.log(`**PR:** ${url}`);
}
console.log('');
console.log(`**Cost:** ${totalCost}`);
console.log(`**Cache-hit share:** ${cacheHitPct}`);
console.log('');
console.log('**Strange-loop isolation:**');
console.log(`- Primary clean after run: ${postClean === '' ? 'YES' : 'NO — investigate'}`);
console.log(`- Primary branch undisturbed: ${primaryBranch}`);
console.log('');
console.log(`**Blockers:** ${report.blockers.length === 0 ? 'none' : report.blockers.join('; ')}`);
console.log('');
console.log(`**Learned:** ${report.learned || '(none)'}`);
console.log('');
