/**
 * `corellia logs` — the event-log viewer. Two modes over the same store the
 * daemon writes (JSONL at CORELLIA_EVENTS_PATH, or PG via DATABASE_URL):
 *
 *   replay (default)  read a finished log and print tree + per-goal detail.
 *   --follow / -f     stream new events live as one-liners, with a goal-tree
 *                     snapshot on change (JSONL only — PG follow is not offered).
 *
 * Argument parsing is dependency-free (no yargs). This module owns the command's
 * behavior; scripts/corellia.ts is a thin dispatcher that hands it argv.
 */

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FactoryEvent } from '../contract/events.js';
import { parseFactoryEvent } from '../contract/event-parser.js';
import { renderTree } from './projections.js';
import { renderReplay, followLine } from './render.js';
import { follow } from './tail.js';

export interface LogsArgs {
  path: string | undefined;
  follow: boolean;
  tree: boolean;
  cost: boolean;
  goal: string | undefined;
  type: string | undefined;
}

/** Where the log lives, honoring CORELLIA_EVENTS_PATH and an explicit path arg. */
export function resolveEventsPath(explicit: string | undefined, env: NodeJS.ProcessEnv): string {
  if (explicit) return explicit;
  return env['CORELLIA_EVENTS_PATH'] ?? join(process.cwd(), 'out', 'events.jsonl');
}

/**
 * Parse `logs` argv (everything after the subcommand). Flags: `--follow`/`-f`,
 * `--tree`, `--cost`, `--goal <substr>`, `--type <evt>`. The first non-flag,
 * non-flag-value token is the optional path.
 */
export function parseLogsArgs(argv: readonly string[]): LogsArgs {
  let follow = false;
  let tree = false;
  let cost = false;
  let goal: string | undefined;
  let type: string | undefined;
  let path: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--follow':
      case '-f':
        follow = true;
        break;
      case '--tree':
        tree = true;
        break;
      case '--cost':
        cost = true;
        break;
      case '--goal':
        goal = argv[++i];
        break;
      case '--type':
        type = argv[++i];
        break;
      default:
        if (arg !== undefined && !arg.startsWith('-') && path === undefined) {
          path = arg;
        }
        break;
    }
  }

  return { path, follow, tree, cost, goal, type };
}

/** A minimal console surface, injectable so tests capture output. */
export interface LogsConsole {
  log(line: string): void;
  error(line: string): void;
}

/**
 * Run the `logs` command. In replay mode resolves once printed; in follow mode
 * resolves when the returned `stop` is invoked (the CLI wires it to SIGINT).
 * Returns a process exit code and, for follow mode, a stop handle.
 */
export async function runLogs(
  args: LogsArgs,
  io: LogsConsole,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stop?: () => void }> {
  if (env['DATABASE_URL'] && args.follow) {
    io.error('corellia logs --follow requires the JSONL store; DATABASE_URL (Postgres) is set.');
    io.error('  Unset DATABASE_URL / set CORELLIA_EVENTS_PATH to follow a JSONL run.');
    return { code: 2 };
  }

  const path = resolveEventsPath(args.path, env);

  if (args.follow) {
    return followLog(path, args, io);
  }

  return replayLog(path, args, io);
}

async function replayLog(path: string, args: LogsArgs, io: LogsConsole): Promise<{ code: number }> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    io.error(`corellia logs: cannot read ${path}`);
    io.error('  Pass a path, or set CORELLIA_EVENTS_PATH on the run that produced it.');
    return { code: 1 };
  }

  const events = parseJsonl(raw);
  io.log(`\nEvent log: ${path} — ${events.length} events\n`);
  const withCost: { goalFilter?: string; typeFilter?: string; cost: boolean } = { cost: args.cost };
  if (args.goal !== undefined) withCost.goalFilter = args.goal;
  if (args.type !== undefined) withCost.typeFilter = args.type;
  io.log(renderReplay(events, withCost));
  io.log('');
  return { code: 0 };
}

function followLog(path: string, args: LogsArgs, io: LogsConsole): { code: number; stop: () => void } {
  io.error(`corellia logs --follow ${path} (Ctrl-C to stop)\n`);

  // The projection accumulates every event so a --tree snapshot stays complete
  // even when --type hides some events from the stream. The --goal filter does
  // narrow the accumulator: a goal-scoped follow shows only that goal's subtree.
  const seenGoals = new Set<string>();
  const allEvents: FactoryEvent[] = [];

  const onValue = (value: unknown): void => {
    const event = parseFactoryEvent(value);
    if (event === null) return;
    if (args.goal && !event.goalId.includes(args.goal)) return;

    allEvents.push(event);

    if (!args.type || event.type === args.type) io.log(followLine(event));

    if (args.tree && event.type === 'goal-received' && !seenGoals.has(event.goalId)) {
      seenGoals.add(event.goalId);
      io.log('');
      io.log(renderTree(allEvents));
      io.log('');
    }
  };

  const tail = follow(path, onValue, { from: 'start' });
  return { code: 0, stop: () => tail.stop() };
}

function parseJsonl(raw: string): FactoryEvent[] {
  const events: FactoryEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = parseFactoryEvent(JSON.parse(trimmed));
      if (event !== null) events.push(event);
    } catch {
      // Skip unparseable lines (partial writes at a crash boundary).
    }
  }
  return events;
}
