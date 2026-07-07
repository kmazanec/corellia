/**
 * REPL mode for the front-door daemon: local-development surface (ADR-026).
 *
 * Reads commands from stdin (readline) and drives commission, answer, and
 * status against the same in-process Listener that the HTTP server uses.
 * There is exactly ONE Listener in the process — this REPL and the HTTP
 * server are both wired to it (ADR-008 single-brief-authority invariant).
 *
 * Commands:
 *   commission <json>   — commission a new intent; json is a CommissionInput
 *   answer <id> <text>  — answer a parked intent (text may contain spaces)
 *   status              — print FrontDoorStatus JSON
 *   help                — list commands
 *   exit / quit         — close the REPL
 *
 * For test purposes: when stdout is not a TTY, no prompt is printed so piped
 * input works cleanly. Each response is a single JSON line.
 */

import { createInterface, type Interface } from 'node:readline';
import type { Listener } from '../listener/listener.js';
import type { CommissionInput, FrontDoorStatus } from '../contract/brief.js';

// ── Opt-in gate ────────────────────────────────────────────────────────────────

/**
 * Whether the daemon should start the interactive REPL. Opt-in and double-gated
 * so headless and container runs are never affected: it starts ONLY when the
 * operator explicitly set `CORELLIA_REPL=1` AND stdin is an interactive terminal.
 * A container/CI/piped run (stdin not a TTY) keeps the REPL off even with the
 * flag set, so the headless path is byte-for-byte unchanged. Default off.
 */
export function replEnabled(params: { env: Record<string, string | undefined>; stdinIsTTY: boolean }): boolean {
  return params.env['CORELLIA_REPL'] === '1' && params.stdinIsTTY === true;
}

/**
 * Start the REPL iff {@link replEnabled}, sharing the daemon's single Listener
 * (ADR-008). Returns the readline Interface when started, else undefined. Wrapped
 * so a REPL start can never throw into — or block — daemon startup: any failure
 * is logged and swallowed, and the HTTP front door stays up regardless.
 */
export function maybeStartRepl(opts: ReplOptions & {
  env?: Record<string, string | undefined>;
  stdinIsTTY?: boolean;
  log?: (msg: string) => void;
}): Interface | undefined {
  const env = opts.env ?? process.env;
  const stdinIsTTY = opts.stdinIsTTY ?? process.stdin.isTTY === true;
  if (!replEnabled({ env, stdinIsTTY })) return undefined;
  try {
    const rl = startRepl(opts);
    (opts.log ?? ((m) => console.log(m)))('[daemon] REPL enabled (CORELLIA_REPL=1, stdin is a TTY)');
    return rl;
  } catch (err) {
    (opts.log ?? ((m) => console.log(m)))(
      `[daemon] REPL failed to start (${err instanceof Error ? err.message : String(err)}); continuing headless`,
    );
    return undefined;
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

function jsonLine(obj: unknown): string {
  return JSON.stringify(obj);
}

// ── Command handlers ─────────────────────────────────────────────────────────

async function handleCommission(
  listener: Listener,
  argStr: string,
  out: (line: string) => void,
): Promise<void> {
  let input: CommissionInput;
  try {
    input = JSON.parse(argStr) as CommissionInput;
  } catch {
    out(jsonLine({ error: 'commission: argument must be a valid JSON CommissionInput' }));
    return;
  }

  // Fire-and-forget: commission returns when the tree settles; we report back
  // immediately with { id } so interactive users know the intent was accepted.
  out(jsonLine({ ok: true, id: input.id, status: 'commissioned' }));
  listener.commission(input).then(
    (report) => {
      out(jsonLine({ event: 'completed', id: input.id, blockers: report.blockers }));
    },
    (err: unknown) => {
      out(jsonLine({ event: 'error', id: input.id, message: String(err) }));
    },
  );
}

async function handleAnswer(
  listener: Listener,
  argStr: string,
  out: (line: string) => void,
): Promise<void> {
  // argStr: "<intentId> <answer text...>"
  const spaceIdx = argStr.indexOf(' ');
  if (spaceIdx < 0) {
    out(jsonLine({ error: 'answer: usage: answer <intentId> <answer text>' }));
    return;
  }
  const intentId = argStr.slice(0, spaceIdx).trim();
  const humanAnswer = argStr.slice(spaceIdx + 1).trim();

  if (!intentId || !humanAnswer) {
    out(jsonLine({ error: 'answer: intentId and answer text are both required' }));
    return;
  }

  // Validate the intent is parked before calling answer().
  const s = listener.status();
  if (!s.parked.some((p) => p.id === intentId)) {
    out(jsonLine({ error: `answer: no parked intent with id "${intentId}"` }));
    return;
  }

  out(jsonLine({ ok: true, intentId, status: 'resumed' }));
  listener.answer(intentId, humanAnswer).then(
    (report) => {
      out(jsonLine({ event: 'completed', intentId, blockers: report.blockers }));
    },
    (err: unknown) => {
      out(jsonLine({ event: 'error', intentId, message: String(err) }));
    },
  );
}

function handleStatus(listener: Listener, out: (line: string) => void): void {
  const raw = listener.status();
  const status: FrontDoorStatus = {
    running: raw.running,
    queued: raw.queued,
    parked: raw.parked.map((p) => ({
      intentId: p.id,
      question: p.question,
      deadline: p.deadline,
    })),
  };
  out(jsonLine(status));
}

// ── REPL ──────────────────────────────────────────────────────────────────────

export interface ReplOptions {
  listener: Listener;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Called when the REPL exits (user typed exit/quit or stdin closed). */
  onClose?: () => void;
}

/**
 * Start the REPL. Returns the readline Interface so callers can close it.
 *
 * The REPL and the HTTP server share `listener` — there is ONE brief
 * authority in the process (ADR-008).
 */
export function startRepl(opts: ReplOptions): Interface {
  const { listener, input = process.stdin, output = process.stdout } = opts;

  const isTTY = output === process.stdout && process.stdout.isTTY;

  function out(line: string): void {
    (output as NodeJS.WritableStream & { write: (s: string) => void }).write(line + '\n');
  }

  const rl = createInterface({
    input,
    output: isTTY ? output : undefined,
    terminal: isTTY,
    prompt: isTTY ? 'corellia> ' : '',
  });

  if (isTTY) {
    rl.prompt();
  }

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (isTTY) rl.prompt();
      return;
    }

    const spaceIdx = trimmed.indexOf(' ');
    const cmd = (spaceIdx < 0 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx < 0 ? '' : trimmed.slice(spaceIdx + 1).trim();

    switch (cmd) {
      case 'commission':
        void handleCommission(listener, args, out).then(() => {
          if (isTTY) rl.prompt();
        });
        break;

      case 'answer':
        void handleAnswer(listener, args, out).then(() => {
          if (isTTY) rl.prompt();
        });
        break;

      case 'status':
        handleStatus(listener, out);
        if (isTTY) rl.prompt();
        break;

      case 'help':
        out(
          jsonLine({
            commands: {
              'commission <json>': 'commission a new intent (CommissionInput JSON)',
              'answer <id> <text>': 'answer a parked intent',
              status: 'print FrontDoorStatus',
              help: 'list commands',
              'exit / quit': 'close the REPL',
            },
          }),
        );
        if (isTTY) rl.prompt();
        break;

      case 'exit':
      case 'quit':
        rl.close();
        break;

      default:
        out(jsonLine({ error: `unknown command: ${cmd}. Type 'help' for options.` }));
        if (isTTY) rl.prompt();
    }
  });

  rl.on('close', () => {
    opts.onClose?.();
  });

  return rl;
}
