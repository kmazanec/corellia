/**
 * live:tiutni — commission the tiutni tax-filing assistant build through the
 * corellia factory, LOCAL-ONLY (no PR boundary).
 *
 * Modeled on live-foreign.ts but with prBoundary OMITTED: the factory writes
 * into a git worktree under tiutni/.corellia/worktrees/<treeId>/, runs the
 * declared JS/TS verification scripts there, judges + repairs, and on collection
 * retains the work as commits on a `tree/<treeId>` branch in tiutni's git. The
 * operator (Claude Code) then merges that branch onto main. No GitHub, no PR.
 *
 * REQUIRED ENV
 *   OPENROUTER_API_KEY   — Bearer token for all LLM requests
 *   TIUTNI_REPO_PATH     — absolute path to the tiutni repo (default: ../../tiutni)
 *
 * OPTIONAL
 *   TIUTNI_FEATURE       — override the commissioned feature description
 *   TIUTNI_SCOPE         — comma-separated scope prefixes (default: the stub dirs)
 *   CORELLIA_MODEL_LOW/MID/HIGH — model tier overrides
 *
 * USAGE
 *   export OPENROUTER_API_KEY=sk-or-...
 *   export TIUTNI_REPO_PATH=/Users/keith/dev/gauntlet/tiutni
 *   npm run live:tiutni
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { loadDotEnv } from '../src/env.js';
import { costSummary, renderTree } from '../src/eventlog/projections.js';
import { buildLiveEngine, assertGitRepo, requireEnv } from '../src/daemon/live-engine.js';
import { Listener } from '../src/listener/listener.js';
import { buildStore } from '../src/daemon/config.js';
import type { CommissionInput } from '../src/contract/brief.js';

loadDotEnv();

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║   Corellia factory — live:tiutni (local-only tax-filing build)      ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log('');

if (!process.env['OPENROUTER_API_KEY']) {
  console.log('live:tiutni — SKIPPED: OPENROUTER_API_KEY is not set.');
  process.exit(0);
}
requireEnv('OPENROUTER_API_KEY');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rawPath = process.env['TIUTNI_REPO_PATH'] ?? resolve(scriptDir, '..', '..', 'tiutni');
const repoRoot = resolve(rawPath);
assertGitRepo(repoRoot, 'live:tiutni');

const FEATURE =
  process.env['TIUTNI_FEATURE'] ??
  [
    'Build the working tax-filing assistant into this existing TypeScript/Express scaffold.',
    'The scaffold already defines the domain contract (src/domain/types.ts), the HTTP server',
    '(src/server/*), the chat UI (public/*), the observation Trace (src/observe/trace.ts), and',
    'a realistic sample W-2 (src/fixtures/sample-w2.ts). Replace the stub bodies — which throw',
    '"pending corellia fan-out" — with real, tested implementations:',
    '',
    '1. src/tax/engine.ts — computeReturn(): the 2025 federal tax engine. Pure and deterministic.',
    '   Use the official 2025 figures: standard deduction (single 15000, MFJ 30000, MFS 15000,',
    '   HoH 22500); the 2025 tax brackets per filing status; Child Tax Credit / Credit for Other',
    '   Dependents (2000 per qualifying child, 500 other, with this income no phaseout). Compute',
    '   every Form1040 line in the contract. Round to whole dollars on the form. Exhaustive unit',
    '   tests in tests/, including the sample W-2 (44629.35 wages, single, 0 dependents).',
    '2. src/tax/w2.ts — parseW2() parses pasted W-2 text into the W2 shape; validateW2() range/',
    '   schema validates it (positive wages, withholding not exceeding wages, etc.). Tested against',
    '   SAMPLE_W2_PASTED and against messy/partial input.',
    '3. src/form/fill1040.ts — renderForm1040Pdf(): produce a real downloadable PDF of the 2025',
    '   Form 1040 with the computed line values, using pdf-lib (already a dependency). A clean',
    '   readable facsimile that shows name, filing status, and every computed line is fine — it',
    '   must be a valid, openable PDF. Tested (returns non-empty %PDF bytes).',
    '4. src/agent/guardrails.ts — classifyUserInput(): code-enforced guardrails. Redirect off-topic',
    '   or tax-ADVICE-seeking input with a warm message and a reminder this is not tax advice and',
    '   does not file the return. Keep budgetExhausted/QUESTION_BUDGET. Tested.',
    '5. src/agent/orchestrator.ts — handleTurn(): the conversational state machine (the chat loop).',
    '   It carries state across turns via the Session, asks NO MORE THAN 5 questions total to',
    '   collect filing status, dependents, and confirm the W-2, accepting the sample W-2 when the',
    '   user asks to use it. Warm, human, concise tone — not robotic or interrogative. It calls the',
    '   tools (parseW2/validateW2, computeReturn, renderForm1040Pdf) as real actions, records each',
    '   step on session.trace (questions, captured facts, tool calls, computations), and on',
    '   completion sets session.completed=true and session.form1040 so the download route works.',
    '   Support changing filing status (single/MFJ/MFS/HoH) and a dependent gracefully. Drive the',
    '   tone with an LLM ONLY if OPENROUTER/OPENAI is configured; otherwise use warm static copy so',
    '   the app works with no API key. Tested: a full single-filer happy path within 5 questions.',
    '',
    'Keep npm run typecheck and npm test green. Do not add heavy dependencies. Do not change the',
    'domain contract types or the route signatures. Honor the observation discipline: every',
    'meaningful action records a trace event.',
  ].join('\n');

const SCOPE = (process.env['TIUTNI_SCOPE'] ?? 'src/tax/,src/form/,src/agent/,tests/')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Target repo:  ${repoRoot} (tiutni — local only, no PR)`);
console.log(`Scope:        ${SCOPE.join(', ')}`);
console.log('');

const { store } = buildStore();
const runNonce = randomBytes(4).toString('hex');
const intentId = `live-tiutni-${runNonce}`;

const engine = buildLiveEngine({
  store,
  sandbox: {
    repoRoot,
    // The leaf verifies its own work with the scaffold's declared scripts.
    declaredScripts: {
      test: 'npm-script:test',
      typecheck: 'npm-script:typecheck',
    },
    // NO prBoundary: local-only run. open-pr never fires; work is collected as
    // commits on a tree/<id> branch for the operator to merge.
  },
  knowledge: false,
  goldenCapture: true,
});

const listener = new Listener({ engine, store });

const commission: CommissionInput = {
  id: intentId,
  title: 'Build the tiutni tax-filing assistant',
  spec: {
    description: FEATURE,
    scope: SCOPE,
    constraints: [
      'All work confined to declared scope.',
      'Keep `npm run typecheck` and `npm test` green.',
      'Do not change the domain contract types or route signatures.',
      'Do not add heavy dependencies; pdf-lib and express are already present.',
      'No PR: this is a local-only run. Do not attempt to push or open a PR.',
      'Every meaningful agent action must record an observation trace event.',
    ],
  },
  scope: SCOPE,
  budget: {
    attempts: 80,
    tokens: 8_000_000,
    toolCalls: 800,
    wallClockMs: 2_400_000,
  },
  intent: 'production',
};

console.log('── commissioning ─────────────────────────────────────────────────────────');
console.log(`  Intent id:  ${intentId}`);
console.log(`  Budget:     80 attempts, 8M tokens, 800 tool calls, 40 min`);
console.log('');
console.log('Running... (live LLM run; costs are real)');
console.log('');

let report;
try {
  report = await listener.commission(commission);
} catch (err) {
  console.error('');
  console.error('═══ LIVE:TIUTNI RUN FAILED ═════════════════════════════════════════════');
  console.error('Error:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  const events = await store.list();
  if (events.length > 0) {
    console.error('\nPartial goal tree:');
    console.error(renderTree(events));
  }
  process.exit(1);
}

const allEvents = await store.list();

console.log('── goal tree ─────────────────────────────────────────────────────────────');
console.log(renderTree(allEvents));

console.log('');
console.log('── collected branches ───────────────────────────────────────────────────');
const collected = allEvents.filter((e) => e.type === 'worktree-collected');
for (const e of collected) {
  if (e.type !== 'worktree-collected') continue;
  console.log(`  branch ${e.branch} — commits: ${e.commits.join(', ') || '(none)'}`);
}
if (collected.length === 0) console.log('  (no worktree-collected events)');

console.log('');
console.log('── cost summary ─────────────────────────────────────────────────────────');
const cost = costSummary(allEvents);
console.log(`  prompt tokens:     ${cost.tree.promptTokens}`);
console.log(`  completion tokens: ${cost.tree.completionTokens}`);
const totalCost = cost.tree.costUsd === undefined ? '(no cost reported)' : `$${cost.tree.costUsd.toFixed(4)}`;
console.log(`  total cost:        ${totalCost}`);

console.log('');
console.log('── outcome ───────────────────────────────────────────────────────────────');
console.log(`  Blockers: ${report.blockers.length === 0 ? 'none' : report.blockers.join('; ')}`);
if (report.learned) console.log(`  Learned:  ${report.learned}`);
console.log('');
console.log('Next: in tiutni, merge the collected tree/<id> branch onto main:');
console.log('  git -C <tiutni> log --oneline --all | head');
console.log('  git -C <tiutni> merge --no-ff tree/<id>');
console.log('');
