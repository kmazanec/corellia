/**
 * trace.ts — replay a persisted event log into a readable, per-goal trace.
 *
 * The Corellia event log IS the trace (ADR-003): every decision and tool effect
 * is an append-only event. This zero-dep script replays a JSONL event log into a
 * human-readable view so a finished run can be debugged after it exits — the
 * native, in-repo equivalent of "turn on tracing" (no external tracer, nothing
 * leaves the repo).
 *
 * USAGE
 *   npx tsx scripts/trace.ts [path/to/events.jsonl] [--goal <substring>]
 *
 *   path defaults to out/events.jsonl. --goal filters the detailed section to
 *   goals whose id or title contains the substring (the tree always prints whole).
 *
 * OUTPUT
 *   1. The goal tree (renderTree).
 *   2. Per goal, in first-seen order: decisions, tool calls (with ran/refused +
 *      the write_file/run_script targets), step kinds, verdicts (pass/fail +
 *      gating findings), knowledge written, budget-exhausted signals, and blocks.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FactoryEvent } from '../src/contract/events.js';
import { renderTree } from '../src/eventlog/projections.js';

const args = process.argv.slice(2);
const goalFilterIdx = args.indexOf('--goal');
const goalFilter = goalFilterIdx >= 0 ? args[goalFilterIdx + 1] : undefined;
// The path is the first positional arg that is neither a flag nor a flag's value.
const flagValueIdx = goalFilterIdx >= 0 ? goalFilterIdx + 1 : -1;
const pathArg = args.find((a, i) => !a.startsWith('--') && i !== goalFilterIdx && i !== flagValueIdx);
const eventsPath = pathArg ?? join(process.cwd(), 'out', 'events.jsonl');

let raw: string;
try {
  raw = readFileSync(eventsPath, 'utf8');
} catch {
  console.error(`trace: cannot read ${eventsPath}`);
  console.error('  Pass a path, or set CORELLIA_EVENTS_PATH on the run that produced it.');
  process.exit(1);
}

const events: FactoryEvent[] = raw
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as FactoryEvent);

console.log(`\nEvent log: ${eventsPath} — ${events.length} events\n`);
console.log('── goal tree ──────────────────────────────────────────────────────────────');
console.log(renderTree(events));
console.log('');

// Index goal metadata (id → title/type) from goal-received events.
const meta = new Map<string, { title: string; type: string }>();
const order: string[] = [];
for (const e of events) {
  if (e.type === 'goal-received') {
    if (!meta.has(e.goalId)) order.push(e.goalId);
    meta.set(e.goalId, { title: e.goal.title, type: e.goal.type });
  }
}

/** One human-readable line for an event, or null to skip it in the detail view. */
function describe(e: FactoryEvent): string | null {
  switch (e.type) {
    case 'goal-received':
      return null; // header is printed per goal
    case 'decided':
      return `decided: ${e.decision.kind}${e.decision.kind === 'split' ? ` (${e.decision.children.length} children)` : ''}`;
    case 'child-spawned':
      return `spawned child: ${e.childType} (${e.childId})`;
    case 'pattern-consulted':
      return `pattern: ${e.status}`;
    case 'step':
      return `step ${e.index}: ${e.outputKind}`;
    case 'tool-call': {
      const detail = e.reason ? ` — ${e.reason}` : '';
      return `tool-call: ${e.tool} → ${e.outcome}${detail}`;
    }
    case 'script-ran':
      return `script-ran: ${e.command} → exit ${e.exitStatus}`;
    case 'deterministic-checked':
      return `deterministic: ${verdictLine(e.verdict)}`;
    case 'judge-verdict':
      return `judge(${e.judgeType}) @${e.tier}: ${verdictLine(e.verdict)}`;
    case 'repair-applied':
      return `repair: ${e.prescriptions.join('; ')}`;
    case 'tier-escalated':
      return `tier: ${e.from} → ${e.to}`;
    case 'knowledge-written':
      return `knowledge-written: ${e.artifact.category} (${e.artifact.pointers.length} pointers)`;
    case 'knowledge-facts-written':
      return `knowledge-facts: ${e.facts.region} (${e.facts.facts.length} facts)`;
    case 'knowledge-checked':
      return `knowledge-checked: ${e.category} → ${e.outcome}`;
    case 'gate-checked':
      return `gate-checked: ${e.ok ? 'ok' : `missing [${e.missing.join(', ')}]`}`;
    case 'budget-exhausted':
      return `⚠ budget-exhausted: ${e.dimension}`;
    case 'transport-retry':
      return `transport-retry: ${e.detail}`;
    case 'malformation-reprompt':
      return `malformation-reprompt: ${e.detail}`;
    case 'blocked':
      return `✗ BLOCKED (${e.resolution}): ${e.brief.question}`;
    case 'emitted':
      return `emitted: ${e.report.blockers.length > 0 ? `BLOCKERS [${e.report.blockers.join(' | ')}]` : 'ok'}`;
    case 'ceiling-reached':
      return `⚠ ceiling: $${e.spentUsd.toFixed(4)} / $${e.ceilingUsd.toFixed(2)}`;
    case 'worktree-created':
      return `worktree: ${e.branch} @ ${e.path}`;
    default:
      return null;
  }
}

function verdictLine(v: { pass: boolean; findings: { title: string; gating: boolean; severity: string }[] }): string {
  if (v.pass) return 'PASS';
  const gating = v.findings.filter((f) => f.gating).map((f) => `[${f.severity}] ${f.title}`);
  return `FAIL — ${gating.length > 0 ? gating.join('; ') : v.findings.map((f) => f.title).join('; ')}`;
}

console.log('── per-goal detail ──────────────────────────────────────────────────────────');
for (const goalId of order) {
  const m = meta.get(goalId)!;
  if (goalFilter && !goalId.includes(goalFilter) && !m.title.includes(goalFilter)) continue;
  console.log(`\n● [${m.type}] ${m.title}`);
  console.log(`  ${goalId}`);
  for (const e of events) {
    if (e.goalId !== goalId) continue;
    const line = describe(e);
    if (line) console.log(`    ${line}`);
  }
}
console.log('');
