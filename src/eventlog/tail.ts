/**
 * Follow a JSONL event log as it grows — the read side of `corellia logs
 * --follow`. Tracks a byte offset into the file, reads only the bytes appended
 * since the last read, splits complete lines, and holds any trailing partial
 * line (a half-written append at the tail) until the rest arrives. It never
 * re-reads what it has already yielded.
 *
 * Detection of new bytes is fs.watch when the platform delivers change events,
 * with a polling interval as an always-correct fallback (fs.watch is
 * best-effort and misses events on some filesystems). Both paths funnel through
 * the same offset-advancing read, so a spurious or missed watch event only
 * changes latency, never correctness.
 */

import { watch, type FSWatcher } from 'node:fs';
import { open, stat } from 'node:fs/promises';

/** One appended line, already parsed from JSON. Invalid lines are dropped. */
export type LineHandler = (value: unknown) => void;

export interface TailOptions {
  /** Start from byte 0 (replay the whole file first) or from the current end. */
  from?: 'start' | 'end';
  /** Polling fallback interval in ms (default 250). */
  pollMs?: number;
}

/**
 * A running tail. `stop()` releases the watcher and the poll timer; the returned
 * promise from `follow` resolves once stopped.
 */
export interface Tail {
  stop(): void;
  done: Promise<void>;
}

/**
 * Read all bytes of `path` after `fromOffset`, returning the parsed values of
 * every *complete* line plus the new offset and any leftover partial line.
 *
 * The partial line is the bytes after the final newline; the caller carries it
 * forward and prepends it to the next read so a value split across two reads is
 * reassembled. Bytes that do not parse as JSON are skipped (a crashed writer can
 * leave a corrupt tail; ADR-003 durability is the store's job, not the reader's).
 */
export async function readAppendedLines(
  path: string,
  fromOffset: number,
  carry: string,
): Promise<{ values: unknown[]; offset: number; carry: string }> {
  const info = await stat(path);
  // A truncated/rotated file (size shrank) resets the offset to avoid reading
  // stale bytes from a shorter file.
  const start = info.size < fromOffset ? 0 : fromOffset;
  const prefix = info.size < fromOffset ? '' : carry;

  if (info.size === start) {
    return { values: [], offset: start, carry: prefix };
  }

  const handle = await open(path, 'r');
  try {
    const length = info.size - start;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const text = prefix + buffer.subarray(0, bytesRead).toString('utf8');

    const lastNewline = text.lastIndexOf('\n');
    const complete = lastNewline >= 0 ? text.slice(0, lastNewline) : '';
    const nextCarry = lastNewline >= 0 ? text.slice(lastNewline + 1) : text;

    const values: unknown[] = [];
    for (const line of complete.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        values.push(JSON.parse(trimmed));
      } catch {
        // Skip a corrupt line — the tail must not stall on bad bytes.
      }
    }

    return { values, offset: start + bytesRead, carry: nextCarry };
  } finally {
    await handle.close();
  }
}

/**
 * Follow a JSONL file, invoking `onValue` for each newly-appended parsed line.
 * Returns a {@link Tail} handle; call `stop()` to end it.
 *
 * With `from: 'start'` the existing contents are read first, then new appends;
 * with `from: 'end'` (the default) only appends after the call are delivered.
 */
export function follow(path: string, onValue: LineHandler, opts: TailOptions = {}): Tail {
  const pollMs = opts.pollMs ?? 250;
  const fromStart = opts.from === 'start';

  let offset = 0;
  let carry = '';
  let stopped = false;
  let draining = false;
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // Serialize reads: fs.watch and the poll timer can both fire; a re-entrant
  // read would double-count bytes. `draining` gates a single in-flight read and
  // a `pending` re-run if a trigger arrived mid-read.
  let pending = false;
  const drain = async (): Promise<void> => {
    if (stopped) return;
    if (draining) {
      pending = true;
      return;
    }
    draining = true;
    try {
      do {
        pending = false;
        const result = await readAppendedLines(path, offset, carry).catch(() => undefined);
        if (!result) break; // File not present yet — a later trigger retries.
        offset = result.offset;
        carry = result.carry;
        for (const value of result.values) {
          if (stopped) break;
          onValue(value);
        }
      } while (pending && !stopped);
    } finally {
      draining = false;
    }
  };

  const init = async (): Promise<void> => {
    if (!fromStart) {
      try {
        const info = await stat(path);
        offset = info.size;
      } catch {
        offset = 0; // File not created yet — start at 0 when it appears.
      }
    }

    try {
      watcher = watch(path, () => {
        void drain();
      });
      watcher.on('error', () => {
        // A watch error (e.g. file not yet present) is non-fatal — polling covers it.
      });
    } catch {
      // Platform/file without watch support — polling is the sole trigger.
    }

    timer = setInterval(() => {
      void drain();
    }, pollMs);

    await drain();
  };

  void init();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (watcher) watcher.close();
      if (timer) clearInterval(timer);
      resolveDone();
    },
    done,
  };
}
