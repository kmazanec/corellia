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
 *   logs   view the event log — replay a finished run, or --follow a live one.
 */

import { parseLogsArgs, runLogs, type LogsConsole } from '../src/eventlog/logs-cli.js';

const io: LogsConsole = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

const [command, ...rest] = process.argv.slice(2);

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
    case undefined:
      io.error('corellia: no command given');
      io.error('  commands: logs');
      return 2;
    default:
      io.error(`corellia: unknown command "${command}"`);
      io.error('  commands: logs');
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
