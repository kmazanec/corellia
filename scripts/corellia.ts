/**
 * corellia — the factory's CLI front door.
 *
 * A tiny subcommand dispatcher. Each subcommand owns its own behavior in a src/
 * module (dependency-free arg parsing, no yargs); this file only routes argv to
 * one and wires process concerns (exit code, SIGINT for the live tail).
 *
 * USAGE
 *   npx tsx scripts/corellia.ts <command> [args]
 *   npm run logs -- [path] [--follow] [--tree] [--cost] [--goal <s>] [--type <e>]
 *
 * COMMANDS
 *   logs       view the event log — replay a finished run, or --follow a live one.
 *   label      attach an exogenous outcome to a tree's golden candidates.
 *   calibrate  replay a judge's golden set and print its agreement score.
 *   patterns   list split memos with their trust plane and recurrence/outcome stats.
 *   trust      promote a memo provisional → trusted (the authority gap; --by required).
 *   distrust   demote a memo trusted → provisional (deliberate; --by required).
 */

import { parseLogsArgs, runLogs, type LogsConsole } from '../src/eventlog/logs-cli.js';
import { parseLabelArgs, runLabel } from '../src/eventlog/label-cli.js';
import { parseCalibrateArgs, runCalibrate } from '../src/eval/golden/calibrate-cli.js';
import { parseTrustArgs, runTrust, runPatternsList } from '../src/eventlog/patterns-cli.js';
import { buildStore, buildPatternStore } from '../src/daemon/config.js';
import { loadDotEnv } from '../src/env.js';

const io: LogsConsole = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

const [command, ...rest] = process.argv.slice(2);

const COMMANDS = 'logs, label, calibrate, patterns, trust, distrust';

/**
 * Open the event store and the pattern store on the daemon's substrate (Pg when
 * DATABASE_URL is set, else the JSONL log rehydrated into memory), run `fn`, and
 * always close both — so a CLI trust/distrust writes to the very log the daemon
 * reads. Loads .env first so DATABASE_URL / CORELLIA_EVENTS_PATH are honored.
 */
async function withStores(
  fn: (stores: {
    store: Awaited<ReturnType<typeof buildStore>>['store'];
    patterns: Awaited<ReturnType<typeof buildPatternStore>>['patterns'];
  }) => Promise<number>,
): Promise<number> {
  loadDotEnv();
  const { store, close: closeStore } = buildStore();
  const { patterns, close: closePatterns } = await buildPatternStore(store);
  try {
    return await fn({ store, patterns });
  } finally {
    await closePatterns();
    await closeStore();
  }
}

async function main(): Promise<number> {
  switch (command) {
    case 'logs': {
      const args = parseLogsArgs(rest);
      const { code, stop } = await runLogs(args, io, process.env);
      if (stop) {
        // Follow mode: hold the process open until the user interrupts.
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => {
            stop();
            resolve();
          });
        });
      }
      return code;
    }
    case 'label': {
      const { code } = await runLabel(parseLabelArgs(rest), io, process.env);
      return code;
    }
    case 'calibrate': {
      const { code } = await runCalibrate(parseCalibrateArgs(rest), io);
      return code;
    }
    case 'patterns':
      return withStores(({ patterns }) => runPatternsList(patterns, io));
    case 'trust':
      return withStores(({ store, patterns }) =>
        runTrust('trusted', parseTrustArgs(rest), patterns, store, io),
      );
    case 'distrust':
      return withStores(({ store, patterns }) =>
        runTrust('provisional', parseTrustArgs(rest), patterns, store, io),
      );
    case undefined:
      io.error('corellia: no command given');
      io.error(`  commands: ${COMMANDS}`);
      return 2;
    default:
      io.error(`corellia: unknown command "${command}"`);
      io.error(`  commands: ${COMMANDS}`);
      return 2;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    io.error(`corellia: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
