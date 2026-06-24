/**
 * The separate, explicit RUN step for a reviewed commission artifact.
 *
 * The `commission` skill (.claude/skills/commission/) produces a reviewed
 * `commissions/<id>.ts` artifact and STOPS. This runner is the deliberate second
 * step: it loads that artifact and feeds it through the factory's REAL front door
 * (`listener.commission()`) — not a hand-built root goal. Plan and build stay
 * decoupled; a human review gate sits between them.
 *
 * Prerequisites:
 *   export OPENROUTER_API_KEY=sk-or-...
 *
 * Run:
 *   npm run commission:run -- <id>          # e.g. example-word-count
 *
 * Events land in out/commission-<id>/events.jsonl; any file artifacts the factory
 * returns are written under that directory.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { Engine } from '../src/engine/engine.js';
import { Listener } from '../src/listener/listener.js';
import { loadDotEnv } from '../src/env.js';
import { JsonlEventStore } from '../src/eventlog/jsonl-store.js';
import { projectMemory, renderTree, traceStats } from '../src/eventlog/projections.js';
import { createRegistry } from '../src/library/registry.js';
import { starterTypes } from '../src/library/starter-types.js';
import { LlmBrain } from '../src/brains/llm.js';
import { openRouterConfig } from '../src/brains/openrouter.js';
import type { CommissionDoc } from '../commissions/types.js';

const DEFAULT_SPEND_CEILING_USD = 15; // mirrors engine.ts:56 (the effective default)

loadDotEnv();

// ── Resolve which commission to run ─────────────────────────────────────────────

const id = process.argv[2];
if (!id) {
  console.error('Usage: npm run commission:run -- <id>');
  console.error('  where <id> matches a commissions/<id>.ts artifact.');
  process.exit(1);
}

const artifactPath = resolve('commissions', `${id}.ts`);
let doc: CommissionDoc;
try {
  const mod = (await import(artifactPath)) as { default: CommissionDoc };
  doc = mod.default;
} catch (err) {
  console.error(`Could not load commission artifact: ${artifactPath}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const { commission, ceilingUsd } = doc;
if (commission.id !== id) {
  console.error(
    `Artifact id "${commission.id}" does not match filename "${id}". Fix one so they agree.`,
  );
  process.exit(1);
}

const OUT_DIR = `out/commission-${id}`;

// ── Banner + honest ceiling note (BEFORE building the brain/engine, so a bad ──────
//    artifact is caught even without an API key) ─────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║              Corellia — run reviewed commission              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`Commission:  ${commission.id} — ${commission.title}`);
console.log(`Scope:       ${commission.scope.join(', ')}`);
console.log(`Intent:      ${commission.intent ?? 'production'}`);
console.log(
  `Budget:      ${commission.budget.attempts} attempts, ` +
    `${commission.budget.tokens.toLocaleString()} tokens, ` +
    `${commission.budget.toolCalls} tool calls, ` +
    `${Math.round(commission.budget.wallClockMs / 60_000)} min`,
);
if (ceilingUsd !== DEFAULT_SPEND_CEILING_USD) {
  console.log('');
  console.log(
    `NOTE: artifact records ceilingUsd=$${ceilingUsd}, but the listener mints the ` +
      `root goal without a ceiling, so this run uses the engine default ` +
      `$${DEFAULT_SPEND_CEILING_USD}. A per-commission ceiling override is a ` +
      `separate engine/listener feature (not yet built).`,
  );
}
console.log('');
console.log('Running... (live LLM run; costs are real)');
console.log('');

// ── Engine + Listener (the real front door) ──────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });
const types = starterTypes();
const brain = new LlmBrain(openRouterConfig(), types.map((t) => t.name));
const store = new JsonlEventStore(`${OUT_DIR}/events.jsonl`);
const memory = {
  query: async (topic: string, scope: string[]) =>
    projectMemory(await store.list()).query(topic, scope),
};
const registry = createRegistry(types);
const engine = new Engine({ registry, brain, store, memory });
const listener = new Listener({ engine, store });

// ── Commission through the real front door ───────────────────────────────────────

let report;
try {
  report = await listener.commission(commission);
} catch (err) {
  console.error('');
  console.error('═══ COMMISSION RUN FAILED ══════════════════════════════════════');
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

// ── Write any file artifacts the factory returned (scoped to OUT_DIR) ─────────────

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
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, 'utf8');
    console.log(`Wrote: ${file.path}`);
  }
} else if (report.artifact?.kind === 'text') {
  const textPath = `${OUT_DIR}/artifact.txt`;
  writeFileSync(textPath, report.artifact.text ?? '', 'utf8');
  console.log(`Wrote text artifact: ${textPath}`);
}

// ── Goal tree + stats + outcome ──────────────────────────────────────────────────

const allEvents = await store.list();
console.log('');
console.log('── goal tree ────────────────────────────────────────────────────');
console.log(renderTree(allEvents));

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
