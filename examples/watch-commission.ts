/**
 * Live observability for a running commission — make a long run watchable.
 *
 * A commission run (examples/run-commission.ts) writes its event log to
 * `out/commission-<id>/events.jsonl` but only renders the goal tree at the very
 * END. While the run is in flight there is no first-class way to see what it is
 * doing: a healthy-but-slow leaf grinding through LLM tool-calls is
 * indistinguishable from a wedged process without forensic `lsof`/`ps` and
 * hand-parsing the jsonl. This tool closes that gap.
 *
 * It tails the same on-disk event log the runner already writes — read-only, it
 * never touches the running factory — and re-renders on change:
 *   - the live goal tree (renderTree),
 *   - tree-wide spend against nothing but what the log reports (costSummary),
 *   - a rolling feed of the most recent activity (steps, tool-calls, scripts,
 *     verdicts, emissions, …) formatted one line each.
 *
 * Run (in a second terminal, while a commission is running):
 *   npm run commission:watch -- <id>          # e.g. visual-runtime-verification
 *
 * It polls the log file and prints only when the event count grows, so it is
 * cheap to leave running. Ctrl-C to stop; stopping the watcher does not affect
 * the run. Exits on its own once the run's terminal event (root emitted /
 * budget-exhausted / ceiling-reached) is observed, unless --follow is passed.
 */
import { resolve, join } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';

import { JsonlEventStore } from '../src/eventlog/jsonl-store.js';
import { renderTree, costSummary } from '../src/eventlog/projections.js';
import type { FactoryEvent } from '../src/contract/events.js';

// ── args ─────────────────────────────────────────────────────────────────────

const id = process.argv[2];
if (!id || id.startsWith('--')) {
  console.error('Usage: npm run commission:watch -- <id> [--feed N] [--follow]');
  console.error('  <id>      matches a running out/commission-<id>/events.jsonl');
  console.error('  --feed N  show the last N activity lines (default 18)');
  console.error('  --follow  keep watching even after the run reaches a terminal event');
  process.exit(1);
}
const feedSize = (() => {
  const i = process.argv.indexOf('--feed');
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 18;
})();
const follow = process.argv.includes('--follow');

/**
 * Resolve the log to watch: the NEWEST per-run `events-<stamp>.jsonl` (runs are
 * isolated per file by the runner), falling back to a legacy shared `events.jsonl`
 * if no per-run files exist. Re-resolved on each tick so launching the watcher
 * before the run starts — or a new run starting — picks up the right file.
 */
function resolveLogPath(): string {
  const dir = resolve('out', `commission-${id}`);
  if (!existsSync(dir)) return join(dir, 'events.jsonl'); // not created yet; poll waits
  const perRun = readdirSync(dir)
    .filter((f) => f.startsWith('events-') && f.endsWith('.jsonl'))
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (perRun.length > 0) return join(dir, perRun[0]!.f);
  return join(dir, 'events.jsonl');
}

// ── one-line activity formatting ───────────────────────────────────────────────

/** A short, stable goal handle: the readable kebab prefix the engine assigns. */
function shortGoal(goalId: string): string {
  return goalId.length > 14 ? goalId.slice(0, 14) : goalId;
}

/** Render one event as a single human-readable activity line, or null to skip. */
function activityLine(e: FactoryEvent): string | null {
  const g = shortGoal(e.goalId);
  switch (e.type) {
    case 'goal-received':
      return `recv   ${g}  ${e.goal.type}`;
    case 'decided':
      return `decide ${g}  ${e.decision.kind}`;
    case 'child-spawned':
      return `spawn  ${g}  → ${e.childType} (${shortGoal(e.childId)})`;
    case 'step':
      return `step   ${g}  #${e.index} → ${e.outputKind}`;
    case 'tool-call': {
      const argStr = e.args
        ? Object.entries(e.args)
            .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 48 ? v.slice(0, 48) + '…' : v}`)
            .join(' ')
        : '';
      const mark = e.outcome === 'refused' ? '✗' : ' ';
      return `tool ${mark} ${g}  ${e.tool}${argStr ? '  ' + argStr : ''}${e.outcome === 'refused' && e.reason ? `  (${e.reason})` : ''}`;
    }
    case 'script-ran':
      return `script ${g}  ${e.command}  exit=${e.exitStatus ?? 'null'}  ${e.durationMs}ms`;
    case 'deterministic-checked':
      return `det    ${g}  ${e.verdict.pass ? 'PASS' : 'FAIL'}`;
    case 'judge-verdict':
      return `judge  ${g}  ${e.judgeType}@${e.tier}  ${e.verdict.pass ? 'PASS' : 'FAIL'}`;
    case 'repair-applied':
      return `repair ${g}  ${e.prescriptions.length} prescription(s)`;
    case 'tier-escalated':
      return `escal  ${g}  ${e.from} → ${e.to}`;
    case 'emitted': {
      const art = e.report.artifact ? e.report.artifact.kind : 'no-artifact';
      const blk = e.report.blockers.length > 0 ? `  ${e.report.blockers.length} blocker(s)` : '';
      return `EMIT   ${g}  ${art}${blk}`;
    }
    case 'budget-exhausted':
      return `BUDGET ${g}  exhausted: ${e.dimension}`;
    case 'ceiling-reached':
      return `CEILING ${g}  $${e.spentUsd.toFixed(2)} / $${e.ceilingUsd}`;
    case 'worktree-created':
      return `tree+  ${g}  ${e.branch}`;
    case 'worktree-collected':
      return `tree✓  ${g}  ${e.branch}  (${e.commits.length} commit(s))`;
    case 'transport-retry':
      return `retry  ${g}  ${e.detail}`;
    case 'malformation-reprompt':
      return `reprmt ${g}  ${e.detail}`;
    case 'context-evicted':
      return `evict  ${g}  ${e.detail}`;
    case 'blocked':
      return `BLOCK  ${g}  ${e.resolution}`;
    case 'knowledge-written':
      return `know+  ${g}`;
    default:
      return null; // low-signal events (memory, pattern, gate, …) stay out of the feed
  }
}

/**
 * A run is over only when the ROOT goal reaches a terminal state — it emitted,
 * its budget was exhausted, or the tree hit its dollar ceiling. A per-leaf
 * budget-exhausted is NOT the run ending: leaves exhaust and the tree carries on
 * (re-splitting / re-attempting), so the terminal check must be scoped to the
 * root goal (the first goal-received) and not fire on any descendant's stop.
 */
function isTerminal(events: FactoryEvent[]): boolean {
  if (events.length === 0) return false;
  const rootId = events[0]!.goalId;
  return events.some(
    (e) =>
      e.goalId === rootId &&
      (e.type === 'emitted' || e.type === 'budget-exhausted' || e.type === 'ceiling-reached'),
  );
}

// ── render ─────────────────────────────────────────────────────────────────────

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function render(events: FactoryEvent[], path: string): void {
  const cost = costSummary(events);
  const usd = cost.tree.costUsd;
  const totalTok = cost.tree.promptTokens + cost.tree.completionTokens;

  const lines = events.map(activityLine).filter((l): l is string => l !== null);
  const feed = lines.slice(-feedSize);

  // Clear screen + home cursor for a stable live view.
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`── commission: ${id} ───────────────────────────────────────────`);
  console.log(`log: ${path.split('/').pop()}`);
  console.log(
    `events: ${events.length}   spend: ${usd !== undefined ? '$' + usd.toFixed(4) : '(no cost reported)'}   tokens: ${totalTok.toLocaleString()}   updated: ${new Date().toLocaleTimeString()}`,
  );
  console.log('');
  console.log(renderTree(events));
  console.log('');
  console.log(`── recent activity (last ${feed.length}) ──────────────────────────────`);
  for (const l of feed) console.log('  ' + clamp(l, 110));
  console.log('');
}

// ── poll loop ──────────────────────────────────────────────────────────────────

let lastCount = -1;
let sawTerminal = false;

let watchedPath = '';

async function tick(): Promise<void> {
  const path = resolveLogPath();
  if (path !== watchedPath) {
    watchedPath = path;
    lastCount = -1; // force a re-render when the resolved file changes (new run)
  }
  const events = await new JsonlEventStore(path).list();
  if (events.length !== lastCount) {
    lastCount = events.length;
    render(events, path);
  }
  if (isTerminal(events) && !sawTerminal) {
    sawTerminal = true;
    if (!follow) {
      console.log('Run reached a terminal event. (pass --follow to keep watching)');
      process.exit(0);
    } else {
      console.log('(terminal event seen; --follow keeps the watcher alive)');
    }
  }
}

console.log(`Watching out/commission-${id}/ … (Ctrl-C to stop; the run is unaffected)`);
await tick();
const interval = setInterval(() => {
  void tick();
}, 1500);

// Keep the process alive on the interval; clean exit on Ctrl-C.
process.on('SIGINT', () => {
  clearInterval(interval);
  console.log('\nStopped watching.');
  process.exit(0);
});
