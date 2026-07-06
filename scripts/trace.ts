/**
 * trace.ts — replay a persisted event log into a readable, per-goal trace.
 *
 * The Corellia event log IS the trace (ADR-003): every decision and tool effect
 * is an append-only event. This zero-dep script replays a JSONL event log into a
 * human-readable view so a finished run can be debugged after it exits.
 *
 * `corellia logs [path]` is the graduated form of this script and shares the
 * same rendering (src/eventlog/render.ts); trace.ts remains as the historical
 * entrypoint and a thin adapter over `renderReplay`.
 *
 * USAGE
 *   npx tsx scripts/trace.ts [path/to/events.jsonl] [--goal <substring>]
 *
 *   path defaults to out/events.jsonl. --goal filters the detailed section to
 *   goals whose id or title contains the substring (the tree always prints whole).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FactoryEvent } from '../src/contract/events.js';
import { renderReplay } from '../src/eventlog/render.js';

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
console.log(renderReplay(events, goalFilter !== undefined ? { goalFilter } : {}));
console.log('');
