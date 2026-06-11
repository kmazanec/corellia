/**
 * Live "hands" demo: drives a real implement leaf through the FULLY ASSEMBLED
 * engine — worktree sandbox, broker with file tools + run_script, executing
 * deterministic check, diff ⊆ scope at emission, spend accounting — against a
 * throwaway git fixture repo created programmatically in a tmp directory.
 *
 * The commission is deliberately small: make the declared `test` script pass by
 * writing one target file with the expected content. PRD risk #1's first live
 * evidence.
 *
 * Prerequisites:
 *   export OPENROUTER_API_KEY=sk-or-...
 *
 * Optional model overrides (same as `npm run live`):
 *   export CORELLIA_MODEL_SONNET=anthropic/claude-sonnet-latest
 *
 * Run:
 *   npm run live:hands
 *
 * When OPENROUTER_API_KEY is absent this exits 0 with a clear message — it is an
 * operator-run demo, never a CI gate.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Engine } from '../src/engine/engine.js';
import { loadDotEnv } from '../src/env.js';
import { InMemoryEventStore } from '../src/eventlog/memory-store.js';
import { projectMemory, renderTree, costSummary } from '../src/eventlog/projections.js';
import { createRegistry } from '../src/library/registry.js';
import { starterTypes } from '../src/library/starter-types.js';
import { LlmBrain } from '../src/brains/llm.js';
import { openRouterConfig } from '../src/brains/openrouter.js';

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

loadDotEnv();

if (!process.env.OPENROUTER_API_KEY) {
  console.log('');
  console.log('npm run live:hands — SKIPPED');
  console.log('  OPENROUTER_API_KEY is not set, so the live demo cannot run.');
  console.log('  Export it (export OPENROUTER_API_KEY=sk-or-...) or copy .env.example to .env.');
  console.log('');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Fixture repo (created programmatically in a tmp dir)
// ---------------------------------------------------------------------------

const TARGET_FILE = 'src/greeting.txt';
const EXPECTED = 'hello from the factory';

/**
 * Build a throwaway git repo with a declared `test` script (node check.mjs) that
 * exits 0 only once TARGET_FILE contains EXPECTED. check.mjs and package.json are
 * committed so they never appear in the worktree diff.
 */
function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-live-hands-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'demo@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Live Hands Demo'], { cwd: dir, stdio: 'pipe' });

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'live-hands-fixture', version: '0.0.0', scripts: { test: 'node check.mjs' } }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'check.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      'let content = "";',
      `try { content = readFileSync(${JSON.stringify(TARGET_FILE)}, "utf8"); } catch { content = ""; }`,
      `if (content.trim() === ${JSON.stringify(EXPECTED)}) { console.log("ok"); process.exit(0); }`,
      'console.error("target not yet correct: " + JSON.stringify(content)); process.exit(1);',
    ].join('\n') + '\n',
  );
  execFileSync('git', ['add', 'package.json', 'check.mjs'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

const repoRoot = makeFixtureRepo();

// ---------------------------------------------------------------------------
// Engine, fully assembled
// ---------------------------------------------------------------------------

const types = starterTypes();
const brain = new LlmBrain(openRouterConfig(), types.map((t) => t.name));
const store = new InMemoryEventStore();
const memory = {
  query: async (topic: string, scope: string[]) =>
    projectMemory(await store.list()).query(topic, scope),
};
const registry = createRegistry(types);

const engine = new Engine({
  registry,
  brain,
  store,
  memory,
  sandbox: { repoRoot, declaredScripts: { test: 'check.mjs' } },
});

// ---------------------------------------------------------------------------
// Commission (small implement leaf)
// ---------------------------------------------------------------------------

const rootGoal = {
  id: 'live-hands',
  type: 'implement',
  parentId: null,
  title: 'Make the declared test pass',
  spec: {
    description:
      `Make the repo's declared "test" script pass. The test runs \`node check.mjs\`, ` +
      `which requires the file ${TARGET_FILE} to contain exactly the text "${EXPECTED}" ` +
      `(trailing whitespace is trimmed). Use write_file to create it inside your scope ` +
      `(src/), then run_script("test") to confirm it is green before emitting.`,
  },
  intent: 'production' as const,
  scope: ['src/'],
  budget: {
    attempts: 3,
    tokens: 200_000,
    toolCalls: 40,
    wallClockMs: 600_000,
  },
  memories: [],
};

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║          Corellia factory — LIVE HANDS (assembled run)        ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`Repo:   ${repoRoot} (throwaway git fixture)`);
console.log(`Goal:   make \`npm test\` pass by writing ${TARGET_FILE}`);
console.log('Brain:  LlmBrain via OpenRouter (Anthropic model family)');
console.log('');

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let report;
try {
  report = await engine.run(rootGoal);
} catch (err) {
  console.error('');
  console.error('═══ LIVE HANDS RUN FAILED ══════════════════════════════════════');
  console.error('Diagnosis:', err instanceof Error ? err.message : String(err));
  const events = await store.list();
  if (events.length > 0) {
    console.error('');
    console.error('Partial goal tree at failure:');
    console.error(renderTree(events));
  }
  if (err instanceof Error && err.stack) {
    console.error('');
    console.error(err.stack);
  }
  process.exit(1);
}

const allEvents = await store.list();

// ---------------------------------------------------------------------------
// Run tree
// ---------------------------------------------------------------------------

console.log('');
console.log('── goal tree ────────────────────────────────────────────────────');
console.log(renderTree(allEvents));

// ---------------------------------------------------------------------------
// Tool calls (including refusals)
// ---------------------------------------------------------------------------

console.log('');
console.log('── tool calls ───────────────────────────────────────────────────');
const toolCalls = allEvents.filter((e) => e.type === 'tool-call');
if (toolCalls.length === 0) {
  console.log('  (none)');
} else {
  for (const e of toolCalls) {
    if (e.type === 'tool-call') {
      const tag = e.outcome === 'ran' ? 'ran    ' : 'REFUSED';
      const reason = e.outcome === 'refused' && e.reason ? `  — ${e.reason}` : '';
      console.log(`  [${tag}] ${e.tool}${reason}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Script runs (with exit statuses)
// ---------------------------------------------------------------------------

console.log('');
console.log('── script runs ──────────────────────────────────────────────────');
const scriptRuns = allEvents.filter((e) => e.type === 'script-ran');
if (scriptRuns.length === 0) {
  console.log('  (none)');
} else {
  for (const e of scriptRuns) {
    if (e.type === 'script-ran') {
      const status = e.exitStatus === null ? 'killed/timeout' : `exit ${e.exitStatus}`;
      console.log(`  ${e.command}: ${status} (${e.durationMs}ms)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

console.log('');
console.log('── worktree lifecycle ───────────────────────────────────────────');
for (const e of allEvents) {
  if (e.type === 'worktree-created') console.log(`  created:   ${e.branch} @ ${e.path}`);
  if (e.type === 'worktree-collected') console.log(`  collected: ${e.branch} (${e.commits.length} commit(s))`);
  if (e.type === 'worktree-preserved') console.log(`  preserved: ${e.branch} — ${e.reason}`);
}

// ---------------------------------------------------------------------------
// Cost summary (real tokens + dollars from event usage)
// ---------------------------------------------------------------------------

console.log('');
console.log('── cost summary (from event usage) ──────────────────────────────');
const cost = costSummary(allEvents);
console.log(`  prompt tokens:     ${cost.tree.promptTokens}`);
console.log(`  completion tokens: ${cost.tree.completionTokens}`);
console.log(
  `  total cost:        ${cost.tree.costUsd === undefined ? '(no cost reported)' : '$' + cost.tree.costUsd.toFixed(4)}`,
);

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

console.log('');
if (report.blockers.length > 0) {
  console.log('BLOCKERS:', report.blockers);
  console.log(`(The worktree was preserved under ${repoRoot}/.claude/worktrees/ for inspection.)`);
} else {
  console.log('Run complete. Report: PASS (no blockers). The declared test went green.');
  // Clean up the throwaway fixture only on success; preserve on failure for debugging.
  rmSync(repoRoot, { recursive: true, force: true });
}
console.log('');
