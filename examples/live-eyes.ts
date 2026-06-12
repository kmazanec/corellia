/**
 * Live "eyes" demo: drives the FULLY ASSEMBLED comprehension path — the
 * retrieval broker, the real import-scanner-backed knowledge validation, the
 * knowledge projection, and the persist hook — against a real repo, with a live
 * LlmBrain via OpenRouter.
 *
 * The plan is strictly READ-ONLY: it commissions learn goals only (map-repo for
 * the four shipped categories + one deep-dive-region of a small region). Learn
 * grants carry no product-write capability, so nothing is written to the target
 * repo's tracked files.
 *
 * Default target: corellia's OWN repo root (resolved relative to this script, not
 * the cwd). Pass any repo path to map a foreign repo:
 *
 *   npm run live:eyes                 # map corellia itself
 *   npm run live:eyes -- /path/to/repo  # map a foreign repo (read-only)
 *
 * FOREIGN-REPO SAFETY (read-only answer): the current assembly has no seam to
 * run a leaf with a CheckContext/broker WITHOUT opening a git worktree (the
 * engine's checkContextFor is only populated when a sandbox worktree is active).
 * A no-worktree read-only mode would require an engine change, which is out of
 * scope here. So each learn goal runs in its own isolated worktree under the
 * target repo's .claude/worktrees/, and this script TEARS DOWN that worktree AND
 * its branch completely afterward — `git worktree remove --force`, `git branch -D`,
 * `git worktree prune` — so the foreign repo is left byte-identical (modulo the
 * benign `.claude/worktrees` line the assembly adds to .git/info/exclude, which
 * this script also reverts when it added it). The worktree gives isolation: even
 * mid-run the target's working tree is never touched.
 *
 * Prerequisites:
 *   export OPENROUTER_API_KEY=sk-or-...
 *
 * When OPENROUTER_API_KEY is absent this exits 0 with a clear message — it is an
 * operator-run demo, never a CI gate.
 */

import { readFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { resolveGitDir } from '../src/engine/worktree.js';
import { execFileSync } from 'node:child_process';

import { Engine } from '../src/engine/engine.js';
import { loadDotEnv } from '../src/env.js';
import { InMemoryEventStore } from '../src/eventlog/memory-store.js';
import { projectKnowledge, projectMemory, costSummary } from '../src/eventlog/projections.js';
import { createRegistry } from '../src/library/registry.js';
import { starterTypes } from '../src/library/starter-types.js';
import {
  assembleKnowledgeWiring,
  rebindKnowledgeScan,
  type SandboxConfig,
} from '../src/engine/assembly.js';
import { LlmBrain } from '../src/brains/llm.js';
import { openRouterConfig } from '../src/brains/openrouter.js';
import type { Goal } from '../src/contract/goal.js';
import type { KnowledgeCategory } from '../src/contract/knowledge.js';

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

loadDotEnv();

if (!process.env.OPENROUTER_API_KEY) {
  console.log('');
  console.log('npm run live:eyes — SKIPPED');
  console.log('  OPENROUTER_API_KEY is not set, so the live demo cannot run.');
  console.log('  Export it (export OPENROUTER_API_KEY=sk-or-...) or copy .env.example to .env.');
  console.log('');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Resolve the target repo (default: corellia's own root, relative to THIS file)
// ---------------------------------------------------------------------------

const scriptDir = dirname(fileURLToPath(import.meta.url));
const corelliaRoot = resolve(scriptDir, '..');
const rawTarget = process.argv[2];
const expanded = rawTarget?.startsWith('~/') ? join(homedir(), rawTarget.slice(2)) : rawTarget;
const targetRepo = expanded ? resolve(expanded) : corelliaRoot;

if (!existsSync(join(targetRepo, '.git'))) {
  console.error(`live:eyes: "${targetRepo}" is not a git repository (no .git found). A git repo is required.`);
  process.exit(1);
}

// Detect the declared test script (for the test-scaffold category validation).
function detectTestScript(repo: string): { name: string; entry: string } | null {
  try {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    if (pkg.scripts && typeof pkg.scripts['test'] === 'string') {
      return { name: 'test', entry: pkg.scripts['test'] };
    }
  } catch {
    /* no package.json */
  }
  return null;
}

const declaredTest = detectTestScript(targetRepo);

// ---------------------------------------------------------------------------
// Shared store + registry + knowledge wiring
// ---------------------------------------------------------------------------

const store = new InMemoryEventStore();
const liveTypes = rebindKnowledgeScan(starterTypes());
const registry = createRegistry(liveTypes);
const brain = new LlmBrain(openRouterConfig(), liveTypes.map((t) => t.name));

// The declared scripts the run_script tool / test-scaffold check may invoke.
// Map the repo's "test" script through under both its own name and "test" so the
// test-scaffold check (which defaults to "test") resolves it.
const declaredScripts = declaredTest ? { test: declaredTest.entry } : {};

const sandboxBase: Omit<SandboxConfig, 'repoRoot'> = { declaredScripts, knowledge: true };

// ---------------------------------------------------------------------------
// Foreign-repo cleanup bookkeeping: capture .git/info/exclude before the first
// run so we can revert the assembly's `.claude/worktrees` addition afterward.
// ---------------------------------------------------------------------------

const excludePath = join(resolveGitDir(targetRepo), 'info', 'exclude');
const excludeBefore = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : null;

/** Remove a tree's worktree + branch completely, leaving the repo byte-identical. */
function teardown(branch: string, worktreePath: string): void {
  try {
    if (existsSync(worktreePath)) {
      execFileSync('git', ['-C', targetRepo, 'worktree', 'remove', '--force', worktreePath], { stdio: 'pipe' });
    }
  } catch { /* already removed by collectTree */ }
  try {
    execFileSync('git', ['-C', targetRepo, 'worktree', 'prune'], { stdio: 'pipe' });
  } catch { /* ignore */ }
  try {
    execFileSync('git', ['-C', targetRepo, 'branch', '-D', branch], { stdio: 'pipe' });
  } catch { /* branch already gone */ }
}

// ---------------------------------------------------------------------------
// Commission: four map-repo leaves + one deep-dive-region, each its own root.
// ---------------------------------------------------------------------------

const CATEGORIES: KnowledgeCategory[] = ['architecture', 'stack', 'conventions', 'test-scaffold'];

// Pick the dive region with the most direct children (files + subdirs) among
// 'src', 'app', 'lib', 'pkg'.  Falls back to '.' when none of the candidates
// exist.  Counting direct children is a cheap proxy for "largest directory" that
// avoids a recursive walk and produces a stable, repo-sensitive default.
function pickDiveRegion(repo: string): string {
  let best: string | null = null;
  let bestCount = -1;
  for (const candidate of ['src', 'app', 'lib', 'pkg']) {
    const full = join(repo, candidate);
    if (!existsSync(full)) continue;
    let count: number;
    try {
      count = readdirSync(full).length;
    } catch {
      count = 0;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best ?? '.';
}
const diveRegion = pickDiveRegion(targetRepo);

const DEFAULT_BUDGET = {
  attempts: 3,
  tokens: 500_000,
  toolCalls: 40,
  wallClockMs: 600_000,
};

function mapGoal(category: KnowledgeCategory): Goal {
  return {
    id: `live-eyes-map-${category}`,
    type: 'map-repo',
    parentId: null,
    title: `Map ${category} knowledge`,
    spec: {
      repoRoot: targetRepo,
      category,
      // Task intent only. The KnowledgeArtifact envelope is guaranteed by the
      // type's outputSchema (structured emission, ADR-023) and the per-category
      // craft lives in the comprehend family skill — no need to recite either here.
      description: `Map the "${category}" knowledge of the repo at ${targetRepo}.`,
    },
    intent: 'production',
    scope: [],
    budget: DEFAULT_BUDGET,
    memories: [],
  };
}

function diveGoal(region: string): Goal {
  return {
    id: `live-eyes-dive-${region.replace(/[^a-zA-Z0-9]+/g, '-')}`,
    type: 'deep-dive-region',
    parentId: null,
    title: `Deep-dive region ${region}`,
    spec: {
      repoRoot: targetRepo,
      region,
      // Task intent only. The RegionFacts envelope is guaranteed by the type's
      // outputSchema and the anchoring craft lives in the comprehend family skill.
      description: `Deep-dive the region "${region}" of the repo at ${targetRepo}.`,
    },
    intent: 'production',
    scope: [region],
    budget: DEFAULT_BUDGET,
    memories: [],
  };
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║          Corellia factory — LIVE EYES (read-only mapping)     ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`Target:   ${targetRepo}${targetRepo === corelliaRoot ? ' (corellia itself)' : ' (foreign)'}`);
console.log(`Plan:     map-repo x${CATEGORIES.length} (${CATEGORIES.join(', ')}) + deep-dive-region (${diveRegion})`);
console.log(`Test:     ${declaredTest ? declaredTest.entry : '(no declared test script — test-scaffold validation will soft-pass)'}`);
console.log('Brain:    LlmBrain via OpenRouter (tier defaults from openRouterConfig)');
console.log('Mode:     READ-ONLY — learn grants only; worktree isolated; torn down after each goal');
console.log('');

// ---------------------------------------------------------------------------
// Coverage BEFORE
// ---------------------------------------------------------------------------

const wiring = assembleKnowledgeWiring({ repoRoot: targetRepo, ...sandboxBase }, store, registry);
const coverageBefore = await wiring.query(targetRepo);
console.log('── gate coverage (before) ───────────────────────────────────────');
console.log(`  artifacts: ${coverageBefore.artifacts.length}, region dives: ${coverageBefore.regionFacts.length}, HEAD: ${coverageBefore.headSha}`);
console.log('');

// ---------------------------------------------------------------------------
// Run each learn goal in its own worktree, tearing it down afterward.
// ---------------------------------------------------------------------------

interface RunOutcome {
  label: string;
  blocked: boolean;
  detail: string;
}
const outcomes: RunOutcome[] = [];

async function runLearnGoal(goal: Goal, label: string): Promise<void> {
  const engine = new Engine({
    registry,
    brain,
    store,
    memory: { query: async (topic: string, scope: string[]) => projectMemory(await store.list()).query(topic, scope) },
    sandbox: { repoRoot: targetRepo, ...sandboxBase },
    knowledge: assembleKnowledgeWiring({ repoRoot: targetRepo, ...sandboxBase }, store, registry),
    // This is a real run — accrue golden candidates (ADR-024) at every judge verdict.
    goldenCapture: true,
  });

  let report;
  try {
    report = await engine.run(goal);
  } catch (err) {
    outcomes.push({ label, blocked: true, detail: err instanceof Error ? err.message : String(err) });
    report = null;
  }

  // Teardown: find this tree's worktree-created event and remove it + its branch.
  const events = await store.list();
  for (const e of events) {
    if (e.type === 'worktree-created' && e.goalId === goal.id) {
      teardown(e.branch, e.path);
    }
    // A preserved worktree (blocked run) must also be cleaned up completely.
    if (e.type === 'worktree-preserved' && e.goalId === goal.id) {
      teardown(e.branch, e.path);
    }
  }

  if (report) {
    outcomes.push({
      label,
      blocked: report.blockers.length > 0,
      detail: report.blockers[0] ?? 'emitted',
    });
  }
}

for (const category of CATEGORIES) {
  await runLearnGoal(mapGoal(category), `map-repo: ${category}`);
}
await runLearnGoal(diveGoal(diveRegion), `deep-dive-region: ${diveRegion}`);

// ---------------------------------------------------------------------------
// Restore .git/info/exclude if the assembly added its line (foreign-repo hygiene)
// ---------------------------------------------------------------------------

if (excludeBefore !== null) {
  // Revert to the captured contents (drops any `.claude/worktrees` line added).
  writeFileSync(excludePath, excludeBefore);
} else if (existsSync(excludePath)) {
  // There was no exclude file before; if the assembly created one solely for us,
  // leaving it is harmless, but blank it to minimize footprint.
  const after = readFileSync(excludePath, 'utf8');
  if (after.trim() === '.claude/worktrees') rmSync(excludePath);
}

// ---------------------------------------------------------------------------
// Report: artifacts written + validation, coverage after, dive facts, cost
// ---------------------------------------------------------------------------

const finalEvents = await store.list();
const view = projectKnowledge(finalEvents);

console.log('');
console.log('── artifacts written ────────────────────────────────────────────');
if (view.artifacts.size === 0) {
  console.log('  (none — every map-repo goal blocked; see outcomes below)');
} else {
  for (const [key, entry] of view.artifacts) {
    if (entry.artifact.repoRoot !== targetRepo) continue;
    const a = entry.artifact;
    // Validation outcome: re-run the real self-validation now.
    let validation: string;
    try {
      validation = (await wiring.validate!(a)) ? 'valid' : 'INVALID';
    } catch (err) {
      validation = `validation-error: ${err instanceof Error ? err.message : String(err)}`;
    }
    console.log(`  [${a.category}] confidence=${a.confidence} pointers=${a.pointers.length} freshness=${entry.freshness} validation=${validation}`);
    console.log(`      summary: ${a.summary.slice(0, 100)}`);
  }
}

console.log('');
console.log('── dive facts ───────────────────────────────────────────────────');
if (view.diveFacts.size === 0) {
  console.log('  (none)');
} else {
  for (const [, facts] of view.diveFacts) {
    if (facts.repoRoot !== targetRepo) continue;
    console.log(`  region "${facts.region}" @ ${facts.generatedAtSha}: ${facts.facts.length} fact(s)`);
    for (const f of facts.facts.slice(0, 5)) {
      const anchor = f.anchors[0];
      console.log(`      - ${f.claim.slice(0, 80)} [${anchor ? `${anchor.path}:${anchor.line}` : 'no anchor'}]`);
    }
  }
}

console.log('');
console.log('── gate coverage (after) ────────────────────────────────────────');
const coverageAfter = await wiring.query(targetRepo);
console.log(`  artifacts: ${coverageAfter.artifacts.length} (categories: ${coverageAfter.artifacts.map((a) => a.category).join(', ') || 'none'})`);
console.log(`  region dives: ${coverageAfter.regionFacts.length} (regions: ${coverageAfter.regionFacts.map((r) => r.region).join(', ') || 'none'})`);

console.log('');
console.log('── per-goal outcomes ────────────────────────────────────────────');
for (const o of outcomes) {
  console.log(`  ${o.blocked ? '✗' : '✓'} ${o.label} — ${o.detail}`);
}

console.log('');
console.log('── cost summary (from event usage) ──────────────────────────────');
const cost = costSummary(finalEvents);
console.log(`  prompt tokens:     ${cost.tree.promptTokens}`);
console.log(`  completion tokens: ${cost.tree.completionTokens}`);
console.log(`  cache-hit share:   ${cost.tree.cacheHitShare === undefined ? '(no cached tokens reported)' : (cost.tree.cacheHitShare * 100).toFixed(1) + '%'}`);
console.log(`  total cost:        ${cost.tree.costUsd === undefined ? '(no cost reported)' : '$' + cost.tree.costUsd.toFixed(4)}`);
// Golden candidates captured this run (ADR-024) — one per judge verdict; learn
// types have no judge, so this is typically zero unless a judged leaf ran.
const goldenCount = finalEvents.filter((e) => e.type === 'golden-candidate').length;
console.log(`  golden candidates: ${goldenCount}`);
console.log('');
console.log('live:eyes complete. The target repo was left byte-identical (worktrees + branches torn down).');
console.log('');
