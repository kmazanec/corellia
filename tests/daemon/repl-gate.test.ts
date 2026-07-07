/**
 * The daemon's REPL opt-in gate: the REPL starts ONLY when CORELLIA_REPL=1 AND
 * stdin is a TTY (double-gated), so headless and container runs — the default —
 * are never affected. When it does start it shares the daemon's single Listener
 * (ADR-008) and a start failure never propagates into daemon startup.
 */

import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import type { EventStore, FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import { Listener } from '../../src/listener/listener.js';
import { maybeStartRepl, replEnabled } from '../../src/daemon/repl.js';

class MemStore implements EventStore {
  private readonly log: FactoryEvent[] = [];
  async append(e: FactoryEvent): Promise<void> {
    this.log.push(e);
  }
  async list(f?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]> {
    if (!f) return [...this.log];
    return this.log.filter((e) => (!f.goalId || e.goalId === f.goalId) && (!f.type || e.type === f.type));
  }
}

function makeListener(): Listener {
  const store = new MemStore();
  const engine = {
    async run(_goal: Goal): Promise<Report> {
      return {
        artifact: { kind: 'text', text: 'ok' },
        proof: [],
        lessons: [],
        memoriesUsed: [],
        blockers: [],
        findings: [],
        learned: '',
      } satisfies Report;
    },
  } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;
  return new Listener({ engine, store });
}

describe('replEnabled — double gate', () => {
  it('is true only when CORELLIA_REPL=1 AND stdin is a TTY', () => {
    expect(replEnabled({ env: { CORELLIA_REPL: '1' }, stdinIsTTY: true })).toBe(true);
  });

  it('is false when the flag is unset, even on a TTY', () => {
    expect(replEnabled({ env: {}, stdinIsTTY: true })).toBe(false);
  });

  it('is false when stdin is not a TTY, even with the flag set (container/piped run)', () => {
    expect(replEnabled({ env: { CORELLIA_REPL: '1' }, stdinIsTTY: false })).toBe(false);
  });

  it('is false for any non-"1" flag value', () => {
    expect(replEnabled({ env: { CORELLIA_REPL: 'true' }, stdinIsTTY: true })).toBe(false);
    expect(replEnabled({ env: { CORELLIA_REPL: '0' }, stdinIsTTY: true })).toBe(false);
  });
});

describe('maybeStartRepl — headless default is untouched', () => {
  it('does not start (returns undefined) on the default headless path', () => {
    const rl = maybeStartRepl({ listener: makeListener(), env: {}, stdinIsTTY: false });
    expect(rl).toBeUndefined();
  });

  it('does not start with the flag set but no TTY (container run)', () => {
    const rl = maybeStartRepl({ listener: makeListener(), env: { CORELLIA_REPL: '1' }, stdinIsTTY: false });
    expect(rl).toBeUndefined();
  });
});

describe('maybeStartRepl — starts on flag+TTY, sharing the listener', () => {
  it('starts a REPL that drives the SAME listener, then closes cleanly', async () => {
    const listener = makeListener();
    const input = new Readable({ read() {} });
    const lines: string[] = [];
    const output = new Writable({
      write(chunk: Buffer, _enc, cb) {
        for (const l of chunk.toString('utf8').split('\n')) {
          const t = l.trim();
          if (t) lines.push(t);
        }
        cb();
      },
    });

    const closed = new Promise<void>((resolve) => {
      const rl = maybeStartRepl({
        listener,
        env: { CORELLIA_REPL: '1' },
        stdinIsTTY: true,
        input,
        output,
        onClose: () => resolve(),
        log: () => {},
      });
      expect(rl).toBeDefined();
    });

    // A `status` command must resolve against the shared listener.
    input.push('status\n');
    input.push('exit\n');
    input.push(null);
    await closed;

    const status = lines.map((l) => JSON.parse(l)).find((o) => Array.isArray(o.running));
    expect(status).toBeDefined();
    expect(status).toMatchObject({ running: [], queued: [], parked: [] });
  });
});
