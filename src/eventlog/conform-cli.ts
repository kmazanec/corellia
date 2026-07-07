/**
 * `corellia conform <path-to-events.jsonl>` — replay a run's event log and
 * assert its runtime conduct invariants (src/eventlog/conformance.ts). Prints
 * PASS or the typed violation list and exits nonzero on any violation, so it
 * drops straight into a CI step or a post-run audit hook. Pure read: it opens
 * the log, projects, and reports — it never appends.
 *
 * The conduct dual of the constitution lint: the lint guards the library's shape
 * at PR time; this guards a run's conduct after the fact. Violations file issues,
 * not fixes (the issue's stated policy) — the nonzero exit is the signal.
 *
 * Argument parsing is dependency-free (no yargs). This module owns the command's
 * behavior; scripts/corellia.ts is a thin dispatcher that hands it argv.
 */

import { JsonlEventStore } from './jsonl-store.js';
import { resolveEventsPath } from './logs-cli.js';
import { checkConformance, formatConformance } from './conformance.js';
import { createRegistry } from '../library/registry.js';
import { starterTypes } from '../library/starter-types.js';
import type { EventStore } from '../contract/events.js';
import type { LogsConsole } from './logs-cli.js';

export interface ConformArgs {
  /** The log path to check; else CORELLIA_EVENTS_PATH / out/events.jsonl. */
  path: string | undefined;
  /** A malformed-argument message, when parsing failed. */
  error: string | undefined;
}

/**
 * Parse `conform` argv (everything after the subcommand):
 *   conform [<path>]
 * A single optional positional is the log path; when absent the shared
 * `resolveEventsPath` default applies. Any flag is rejected — the command takes
 * no options, so an unexpected `-x` is a usage error rather than a silent no-op.
 */
export function parseConformArgs(argv: readonly string[]): ConformArgs {
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('-')) {
      return { path: undefined, error: `corellia conform: unknown option "${arg}" — usage: corellia conform [<path>]` };
    }
    positional.push(arg);
  }
  if (positional.length > 1) {
    return { path: undefined, error: 'corellia conform: too many arguments — usage: corellia conform [<path>]' };
  }
  return { path: positional[0], error: undefined };
}

/**
 * Run the `conform` command: read the log, project the conformance verdict, and
 * print it. `makeStore` is injected so a test checks a fake store without
 * touching the filesystem. Returns exit code 0 on PASS, 1 on any violation, 2 on
 * a usage error.
 */
export async function runConform(
  args: ConformArgs,
  io: LogsConsole,
  env: NodeJS.ProcessEnv,
  deps: { makeStore?: (path: string) => EventStore } = {},
): Promise<{ code: number }> {
  if (args.error !== undefined) {
    io.error(args.error);
    return { code: 2 };
  }

  const path = resolveEventsPath(args.path, env);
  const store = (deps.makeStore ?? ((p) => new JsonlEventStore(p)))(path);
  const events = await store.list();

  // The starter library is the factory's own type registry, so the
  // no-judge-authored-writes check resolves kinds authoritatively rather than
  // falling back to the naming convention.
  const violations = checkConformance(events, { registry: createRegistry(starterTypes()) });
  const rendered = formatConformance(violations);

  if (violations.length === 0) {
    io.log(rendered);
    return { code: 0 };
  }
  io.error(rendered);
  return { code: 1 };
}
