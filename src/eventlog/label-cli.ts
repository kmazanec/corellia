/**
 * `corellia label <tree> <outcome> [--note ...] [--source ...]` — the exogenous
 * ground-truth ingestion path (golden-outcome-labels). Appends one `golden-label`
 * event to the same store the daemon writes (JSONL at CORELLIA_EVENTS_PATH), so
 * the `goldenCandidates` projection joins the outcome to that tree's captured
 * candidates.
 *
 * The outcome is ground truth from OUTSIDE the factory — a human operator's
 * merge/rejection of the PR, or a verdict confirming/refuting a judged criterion.
 * It is never produced by an eval; this command is how a human (or, later, a
 * PR-merge listener) delivers it.
 *
 * Argument parsing is dependency-free (no yargs). This module owns the command's
 * behavior; scripts/corellia.ts is a thin dispatcher that hands it argv.
 */

import { JsonlEventStore } from './jsonl-store.js';
import { resolveEventsPath } from './logs-cli.js';
import type { EventStore } from '../contract/events.js';
import type { LogsConsole } from './logs-cli.js';

const OUTCOMES = ['merged', 'rejected', 'confirmed', 'refuted'] as const;
export type LabelOutcome = (typeof OUTCOMES)[number];

export interface LabelArgs {
  /** The tree/candidate reference — the goalId a golden-candidate carries. */
  tree: string | undefined;
  /** The exogenous outcome. */
  outcome: LabelOutcome | undefined;
  /** Who/what delivered the label; defaults to `operator`. */
  source: string;
  /** Optional free-text context. */
  note: string | undefined;
  /** Optional explicit store path (else CORELLIA_EVENTS_PATH / out/events.jsonl). */
  path: string | undefined;
  /** A malformed-argument message, when parsing failed. */
  error: string | undefined;
}

function isOutcome(value: string): value is LabelOutcome {
  return (OUTCOMES as readonly string[]).includes(value);
}

/**
 * Parse `label` argv (everything after the subcommand):
 *   label <tree> <outcome> [--note <s>] [--source <s>] [<path>]
 * The first two positionals are the tree ref and the outcome; a third positional
 * is the store path. Flags may appear anywhere.
 */
export function parseLabelArgs(argv: readonly string[]): LabelArgs {
  let source = 'operator';
  let note: string | undefined;
  let path: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--note':
        note = argv[++i];
        break;
      case '--source':
        source = argv[++i] ?? source;
        break;
      default:
        if (arg !== undefined && !arg.startsWith('-')) positional.push(arg);
        break;
    }
  }

  const [tree, outcomeRaw, pathArg] = positional;
  path = pathArg;

  if (tree === undefined || outcomeRaw === undefined) {
    return blank(`usage: corellia label <tree> <${OUTCOMES.join('|')}> [--note <s>] [--source <s>] [<path>]`);
  }
  if (!isOutcome(outcomeRaw)) {
    return blank(`corellia label: unknown outcome "${outcomeRaw}" — expected one of ${OUTCOMES.join(', ')}`);
  }

  const parsed: LabelArgs = { tree, outcome: outcomeRaw, source, note, path, error: undefined };
  return parsed;
}

function blank(error: string): LabelArgs {
  return { tree: undefined, outcome: undefined, source: 'operator', note: undefined, path: undefined, error };
}

/**
 * Run the `label` command: append one `golden-label` event to the resolved
 * store. `now` and `makeStore` are injected so tests append into a fake store
 * with a deterministic clock and never touch the filesystem.
 */
export async function runLabel(
  args: LabelArgs,
  io: LogsConsole,
  env: NodeJS.ProcessEnv,
  deps: { now?: () => number; makeStore?: (path: string) => EventStore } = {},
): Promise<{ code: number }> {
  if (args.error !== undefined) {
    io.error(args.error);
    return { code: 2 };
  }
  if (args.tree === undefined || args.outcome === undefined) {
    io.error('corellia label: missing tree or outcome');
    return { code: 2 };
  }

  const path = resolveEventsPath(args.path, env);
  const store = (deps.makeStore ?? ((p) => new JsonlEventStore(p)))(path);
  const now = deps.now ?? Date.now;

  await store.append({
    type: 'golden-label',
    at: now(),
    goalId: args.tree,
    outcome: args.outcome,
    source: args.source,
    ...(args.note !== undefined ? { note: args.note } : {}),
  });

  io.log(`labeled ${args.tree} → ${args.outcome} (source: ${args.source})${args.note ? ` — ${args.note}` : ''}`);
  return { code: 0 };
}
