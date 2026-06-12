/**
 * REPL mode tests: piped stdin drives commission, answer, and status against
 * the in-process Listener. Also pins the ADR-008 single-brief-authority
 * invariant: the REPL and the HTTP server share exactly one Listener instance.
 */

import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import type { FactoryEvent, EventStore } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import { Listener } from '../../src/listener/listener.js';
import type { CommissionInput } from '../../src/contract/brief.js';
import { startRepl } from '../../src/daemon/repl.js';
import { FrontDoorServer } from '../../src/daemon/http-server.js';

// ── Stubs ─────────────────────────────────────────────────────────────────────

class MemStore implements EventStore {
  private readonly log: FactoryEvent[] = [];

  async append(e: FactoryEvent): Promise<void> {
    this.log.push(e);
  }

  async list(f?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]> {
    if (!f) return [...this.log];
    return this.log.filter((e) => {
      if (f.goalId && e.goalId !== f.goalId) return false;
      if (f.type && e.type !== f.type) return false;
      return true;
    });
  }
}

function successReport(text = 'done'): Report {
  return {
    artifact: { kind: 'text', text },
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
  };
}

class ScriptedEngine {
  private readonly script: Map<string, Report>;
  private readonly store: EventStore;

  constructor(store: EventStore, script: { goalId: string; report: Report }[] = []) {
    this.store = store;
    this.script = new Map(script.map((s) => [s.goalId, s.report]));
  }

  async run(goal: Goal): Promise<Report> {
    await this.store.append({ type: 'goal-received', at: Date.now(), goalId: goal.id, goal });
    const report = this.script.get(goal.id) ?? successReport();
    await this.store.append({ type: 'emitted', at: Date.now(), goalId: goal.id, report });
    return report;
  }
}

function makeInput(id: string): CommissionInput {
  return {
    id,
    title: `Intent ${id}`,
    spec: {},
    scope: [`src/${id}/`],
    budget: { attempts: 1, toolCalls: 5, tokens: 1_000 },
  };
}

// ── Piped REPL helper ─────────────────────────────────────────────────────────

/**
 * Run a sequence of REPL commands by piping them into a Readable.
 * Returns all output lines (JSON strings) after the REPL closes.
 */
function runRepl(
  listener: Listener,
  commands: string[],
): Promise<string[]> {
  return new Promise((resolve) => {
    // Build a Readable that pushes each command then ends.
    const readable = new Readable({
      read() {},
    });

    const lines: string[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _enc, cb) {
        for (const line of chunk.toString('utf8').split('\n')) {
          const t = line.trim();
          if (t) lines.push(t);
        }
        cb();
      },
    });

    startRepl({
      listener,
      input: readable,
      output: writable,
      onClose: () => resolve(lines),
    });

    for (const cmd of commands) {
      readable.push(cmd + '\n');
    }
    readable.push(null); // EOF
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('REPL: status command', () => {
  it('returns FrontDoorStatus with empty arrays on a fresh listener', async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });

    const lines = await runRepl(listener, ['status', 'exit']);

    const statusLine = lines.find((l) => {
      try {
        const obj = JSON.parse(l) as Record<string, unknown>;
        return 'running' in obj && 'queued' in obj && 'parked' in obj;
      } catch {
        return false;
      }
    });
    expect(statusLine).toBeDefined();
    const status = JSON.parse(statusLine!) as { running: unknown[]; queued: unknown[]; parked: unknown[] };
    expect(status.running).toEqual([]);
    expect(status.queued).toEqual([]);
    expect(status.parked).toEqual([]);
  });
});

describe('REPL: commission command', () => {
  it('returns { ok: true, id } when a valid CommissionInput is provided', async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store, [
      { goalId: 'r1', report: successReport() },
    ]) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });

    const input = makeInput('r1');
    const lines = await runRepl(listener, [`commission ${JSON.stringify(input)}`, 'exit']);

    const okLine = lines.find((l) => {
      try {
        const obj = JSON.parse(l) as Record<string, unknown>;
        return obj['ok'] === true && obj['id'] === 'r1';
      } catch {
        return false;
      }
    });
    expect(okLine).toBeDefined();
  });

  it('returns an error when the argument is not valid JSON', async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });

    const lines = await runRepl(listener, ['commission not-json', 'exit']);
    const errLine = lines.find((l) => {
      try {
        const obj = JSON.parse(l) as Record<string, unknown>;
        return typeof obj['error'] === 'string' && (obj['error'] as string).includes('commission');
      } catch {
        return false;
      }
    });
    expect(errLine).toBeDefined();
  });
});

describe('REPL: answer command', () => {
  it('returns an error when the intent is not parked', async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });

    const lines = await runRepl(listener, ['answer nonexistent my answer', 'exit']);
    const errLine = lines.find((l) => {
      try {
        const obj = JSON.parse(l) as Record<string, unknown>;
        return typeof obj['error'] === 'string' && (obj['error'] as string).includes('nonexistent');
      } catch {
        return false;
      }
    });
    expect(errLine).toBeDefined();
  });

  it('returns an error when answer text is missing', async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });

    // Provide intentId but no answer text.
    const lines = await runRepl(listener, ['answer someId', 'exit']);
    const errLine = lines.find((l) => {
      try {
        const obj = JSON.parse(l) as Record<string, unknown>;
        return typeof obj['error'] === 'string';
      } catch {
        return false;
      }
    });
    expect(errLine).toBeDefined();
  });
});

describe('REPL: unknown command', () => {
  it('returns an error message with help hint', async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });

    const lines = await runRepl(listener, ['badcmd', 'exit']);
    const errLine = lines.find((l) => {
      try {
        const obj = JSON.parse(l) as Record<string, unknown>;
        return typeof obj['error'] === 'string' && (obj['error'] as string).includes('unknown');
      } catch {
        return false;
      }
    });
    expect(errLine).toBeDefined();
  });
});

describe('ADR-008: single-brief-authority invariant', () => {
  it('REPL and HTTP server share exactly one Listener instance', async () => {
    // Construct one Listener. Wire BOTH the HTTP server and the REPL to it.
    // Commission via the REPL → the HTTP server's GET /status sees the result.
    // This proves there is no second Listener: one park, one running map.
    const store = new MemStore();

    // Stalling engine: the intent starts running but does not finish until
    // we explicitly check status. No need to unblock since the test only
    // checks running state.
    let unblock!: () => void;
    const engine = {
      async run(goal: Goal): Promise<Report> {
        await store.append({ type: 'goal-received', at: Date.now(), goalId: goal.id, goal });
        await new Promise<void>((r) => {
          unblock = r;
        });
        const report = successReport();
        await store.append({ type: 'emitted', at: Date.now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as Parameters<typeof Listener>[0]['engine'];

    const listener = new Listener({ engine, store });

    // Start the HTTP server on the same listener.
    const httpServer = new FrontDoorServer({ listener, token: 'test-tok' });
    await httpServer.listen();
    const httpPort = httpServer.port;

    try {
      // Commission via REPL.
      const input = makeInput('shared-i1');
      const replLines: string[] = [];
      const replDone = new Promise<void>((res) => {
        const readable = new Readable({ read() {} });
        const writable = new Writable({
          write(chunk: Buffer, _enc, cb) {
            for (const l of chunk.toString().split('\n')) {
              if (l.trim()) replLines.push(l.trim());
            }
            cb();
          },
        });
        startRepl({
          listener,
          input: readable,
          output: writable,
          onClose: res,
        });
        readable.push(`commission ${JSON.stringify(input)}\n`);
        readable.push('exit\n');
        readable.push(null);
      });

      await replDone;
      // Give the commission promise a tick to reach the engine.
      await new Promise((r) => setTimeout(r, 20));

      // HTTP GET /status on the same listener should show 'shared-i1' as running.
      const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const req = require('node:http').request(
          {
            hostname: '127.0.0.1',
            port: httpPort,
            path: '/status',
            method: 'GET',
            headers: { Authorization: 'Bearer test-tok' },
          },
          (res: typeof import('node:http').IncomingMessage) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              resolve({
                status: res.statusCode ?? 0,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
              });
            });
          },
        );
        req.on('error', reject);
        req.end();
      });

      expect(response.status).toBe(200);
      const s = response.body as { running: string[] };
      expect(s.running).toContain('shared-i1');

      // Exactly one listener: commission via REPL is visible via HTTP.
      // The REPL lines should confirm the commission was accepted.
      const okLine = replLines.find((l) => {
        try {
          const obj = JSON.parse(l) as Record<string, unknown>;
          return obj['ok'] === true && obj['id'] === 'shared-i1';
        } catch {
          return false;
        }
      });
      expect(okLine).toBeDefined();
    } finally {
      // Cleanup
      unblock?.();
      await new Promise((r) => setTimeout(r, 20));
      await httpServer.close();
    }
  });
});
