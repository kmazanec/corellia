/**
 * First live run: ships a word-count CLI through the full factory using a
 * real LLM (OpenRouter).  The factory splits, implements, and judges the
 * artifact autonomously; we watch via events and print a cost summary.
 *
 * Prerequisites:
 *   export OPENROUTER_API_KEY=sk-or-...
 *
 * Optional model overrides:
 *   export CORELLIA_MODEL_HAIKU=anthropic/claude-haiku-latest
 *   export CORELLIA_MODEL_SONNET=anthropic/claude-sonnet-latest
 *   export CORELLIA_MODEL_OPUS=anthropic/claude-opus-4-5
 *
 * Run:
 *   npm run live
 *
 * Artifacts land in out/live/; events in out/live/events.jsonl.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Engine } from '../src/engine/engine.js';
import { JsonlEventStore } from '../src/eventlog/jsonl-store.js';
import { projectMemory, renderTree, traceStats } from '../src/eventlog/projections.js';
import { createRegistry } from '../src/library/registry.js';
import { starterTypes } from '../src/library/starter-types.js';
import { LlmBrain } from '../src/brains/llm.js';
import { openRouterConfig } from '../src/brains/openrouter.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const OUT_DIR = 'out/live';
mkdirSync(OUT_DIR, { recursive: true });

const types = starterTypes();
// Pass type catalog into LlmBrain so decide prompts can name valid goal-types.
const brain = new LlmBrain(openRouterConfig(), types.map((t) => t.name));

const store = new JsonlEventStore(`${OUT_DIR}/events.jsonl`);

const memory = {
  query: (topic: string, scope: string[]) =>
    projectMemory(store.list()).query(topic, scope),
};

const registry = createRegistry(types);
const engine = new Engine({ registry, brain, store, memory });

// ---------------------------------------------------------------------------
// Root goal
// ---------------------------------------------------------------------------

const rootGoal = {
  id: 'live-wc-demo',
  type: 'deliver-intent',
  parentId: null,
  title: 'Ship a word-count CLI',
  spec: {
    description:
      'A Node.js ESM CLI at out/live/wc.mjs that accepts a single string argument ' +
      'and prints the word count (integer, newline-terminated) to stdout. ' +
      'Words are whitespace-delimited tokens. ' +
      'If no argument is given, print 0.',
  },
  intent: 'production' as const,
  scope: [`${OUT_DIR}/`],
  budget: {
    attempts: 3,
    tokens: 200_000,
    toolCalls: 200,
    wallClockMs: 600_000, // 10 minutes — generous for a live run
  },
  memories: [],
};

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           Corellia factory — LIVE word-count run             ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('Goal:   Ship a word-count CLI → out/live/wc.mjs');
console.log('Brain:  LlmBrain via OpenRouter (Anthropic model family)');
console.log('Events: out/live/events.jsonl');
console.log('');

// ---------------------------------------------------------------------------
// Run (wrapped so failures print the partial event tree + diagnosis)
// ---------------------------------------------------------------------------

let report;
try {
  report = await engine.run(rootGoal);
} catch (err) {
  console.error('');
  console.error('═══ FACTORY RUN FAILED ════════════════════════════════════════');
  console.error('');
  console.error('Diagnosis:', err instanceof Error ? err.message : String(err));
  console.error('');

  // Print whatever events we collected before the crash.
  const events = store.list();
  if (events.length > 0) {
    console.error('Partial goal tree at failure:');
    console.error(renderTree(events));
  } else {
    console.error('(No events recorded — likely a configuration or network error.)');
  }

  if (err instanceof Error && err.stack) {
    console.error('');
    console.error('Stack trace:');
    console.error(err.stack);
  }

  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write artifacts to disk
// ---------------------------------------------------------------------------

/** Resolve path and assert it stays inside OUT_DIR to prevent traversal. */
function safeResolve(filePath: string): string {
  const abs = resolve(filePath);
  const base = resolve(OUT_DIR);
  if (!abs.startsWith(base + '/') && abs !== base) {
    throw new Error(`Path traversal rejected: ${filePath} resolves outside ${OUT_DIR}`);
  }
  return abs;
}

if (report.artifact?.kind === 'files' && report.artifact.files) {
  for (const file of report.artifact.files) {
    const abs = safeResolve(file.path);
    const dir = abs.substring(0, abs.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(abs, file.content, 'utf8');
    console.log(`Wrote: ${file.path}`);
  }
} else if (report.artifact?.kind === 'text') {
  // Unexpected for a files-type goal, but don't discard it.
  const textPath = `${OUT_DIR}/wc-artifact.txt`;
  writeFileSync(textPath, report.artifact.text ?? '', 'utf8');
  console.log(`Wrote text artifact: ${textPath}`);
}

// ---------------------------------------------------------------------------
// Execute the produced CLI on sample strings
// ---------------------------------------------------------------------------

console.log('');
console.log('── CLI smoke test ───────────────────────────────────────────────');

const wcPath = `${OUT_DIR}/wc.mjs`;
const samples: Array<{ label: string; arg: string; expected: number }> = [
  { label: 'empty string', arg: '', expected: 0 },
  { label: 'one word', arg: 'hello', expected: 1 },
  { label: 'three words', arg: 'one two three', expected: 3 },
  { label: 'extra spaces', arg: '  a  b  c  ', expected: 3 },
];

let smokePass = true;
for (const { label, arg, expected } of samples) {
  try {
    const output = execSync(`node ${wcPath} ${JSON.stringify(arg)}`, {
      encoding: 'utf8',
    }).trim();
    const got = Number(output);
    const ok = got === expected;
    if (!ok) smokePass = false;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: expected ${expected}, got ${output}`);
  } catch (err) {
    smokePass = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [ERROR] ${label}: ${msg.split('\n')[0]}`);
  }
}

if (!smokePass) {
  console.log('');
  console.log('NOTE: Some smoke tests failed. The factory may need another attempt or the');
  console.log('produced CLI may use a slightly different interface than expected.');
}

// ---------------------------------------------------------------------------
// Goal tree
// ---------------------------------------------------------------------------

console.log('');
console.log('── goal tree ────────────────────────────────────────────────────');
const allEvents = store.list();
console.log(renderTree(allEvents));

// ---------------------------------------------------------------------------
// Trace stats
// ---------------------------------------------------------------------------

console.log('');
console.log('── trace stats ──────────────────────────────────────────────────');
const stats = traceStats(allEvents);
for (const [type, s] of Object.entries(stats)) {
  const parts: string[] = [`${type}:`];
  if (s.attempts) parts.push(`${s.attempts} attempt(s)`);
  if (s.passes) parts.push(`${s.passes} pass(es)`);
  if (s.failures) parts.push(`${s.failures} failure(s)`);
  if (s.repairs) parts.push(`${s.repairs} repair(s)`);
  if (s.escalations) parts.push(`${s.escalations} escalation(s)`);
  console.log(' ', parts.join('  '));
}

// ---------------------------------------------------------------------------
// Cost-relevant brain-call summary (derived from events)
// ---------------------------------------------------------------------------

console.log('');
console.log('── brain call summary (from events) ─────────────────────────────');

// Events emitted around each brain method:
//   decide: goal-decided
//   produce: artifact-produced (or artifact-repaired for repair)
//   judge: verdict-rendered
//   repair: artifact-repaired
const decided = allEvents.filter((e) => e.type === 'goal-decided').length;
const produced = allEvents.filter((e) => e.type === 'artifact-produced').length;
const judged = allEvents.filter((e) => e.type === 'verdict-rendered').length;
const repaired = allEvents.filter((e) => e.type === 'repair-applied').length;
const escalated = allEvents.filter((e) => e.type === 'tier-escalated').length;

console.log(`  decide calls:   ${decided}`);
console.log(`  produce calls:  ${produced}`);
console.log(`  judge calls:    ${judged}`);
console.log(`  repair calls:   ${repaired}`);
console.log(`  escalations:    ${escalated}`);
console.log(`  total events:   ${allEvents.length}`);

// ---------------------------------------------------------------------------
// Learned + blockers
// ---------------------------------------------------------------------------

console.log('');
console.log('── learned ──────────────────────────────────────────────────────');
console.log(report.learned || '(none)');

console.log('');
if (report.blockers.length > 0) {
  console.log('BLOCKERS:', report.blockers);
} else {
  console.log('Run complete. Report: PASS (no blockers).');
}
console.log('');
