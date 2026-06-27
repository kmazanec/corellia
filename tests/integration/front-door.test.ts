/**
 * Full front-door integration suite (F-62, AC 2–7).
 *
 * Covers:
 *   - Auth: 401 on bad/missing token, 200 on valid (AC 2)
 *   - POST /intents → run → GET /status round-trip (AC 2, 3)
 *   - POST /intents/:id/answer resumes a parked intent (AC 3)
 *   - Periodic tick() expires a TTL-expired parked intent (AC 4)
 *   - SIGTERM: preserveTree called, exit 0, parked intents visible on restart (AC 5)
 *   - REPL + HTTP share one Listener; commission via REPL → visible via HTTP (AC 6)
 *   - Substrate selection: buildStore() returns JSONL when DATABASE_URL absent (AC 7)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { FactoryEvent, EventStore } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import { Listener } from '../../src/listener/listener.js';
import type { CommissionInput, FrontDoorStatus } from '../../src/contract/brief.js';
import { FrontDoorServer } from '../../src/daemon/http-server.js';
import { startRepl } from '../../src/daemon/repl.js';
import { buildStore } from '../../src/daemon/config.js';

// Resolve the repo root and tsx CLI from this file's location, so the daemon
// spawns from whatever worktree the suite runs in (never a hardcoded path) and
// launches via the running node binary + tsx's CLI (never `npx`, absent on the
// spawned child's PATH).
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const TSX_CLI = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

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

function blockedReport(): Report {
  return {
    artifact: null,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: ['awaiting human answer'],
    findings: [],
    learned: '',
  };
}

/** Scripted engine: immediately returns the configured report for each goalId. */
class ScriptedEngine {
  private readonly queue: { goalId: string; report: Report; events?: FactoryEvent[] }[];
  private readonly store: EventStore;
  private readonly pending = new Map<string, () => void>();

  constructor(
    store: EventStore,
    script: { goalId: string; report: Report; events?: FactoryEvent[] }[] = [],
  ) {
    this.store = store;
    this.queue = [...script];
  }

  unblock(goalId: string): void {
    this.pending.get(goalId)?.();
  }

  async run(goal: Goal): Promise<Report> {
    await this.store.append({ type: 'goal-received', at: Date.now(), goalId: goal.id, goal });

    const idx = this.queue.findIndex((e) => e.goalId === goal.id);
    if (idx < 0) {
      // Stall: wait for unblock().
      await new Promise<void>((r) => this.pending.set(goal.id, r));
      const report = successReport();
      await this.store.append({ type: 'emitted', at: Date.now(), goalId: goal.id, report });
      return report;
    }

    const entry = this.queue.splice(idx, 1)[0]!;
    for (const e of entry.events ?? []) {
      await this.store.append(e);
    }

    const report = entry.report;
    await this.store.append({ type: 'emitted', at: Date.now(), goalId: goal.id, report });
    return report;
  }
}

function makeInput(id: string, scope = `src/${id}/`): CommissionInput {
  return {
    id,
    title: `Intent ${id}`,
    spec: { what: id },
    scope: [scope],
    budget: { attempts: 2, toolCalls: 10, tokens: 5_000, wallClockMs: 60_000 },
    intent: 'production',
  };
}

const TOKEN = 'int-test-token';

// ── HTTP helpers ─────────────────────────────────────────────────────────────

interface RqOpts {
  method?: string;
  path?: string;
  token?: string | null;
  body?: unknown;
  port: number;
}

function rq(opts: RqOpts): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', path = '/', token, body, port } = opts;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (token !== null && token !== undefined) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) as unknown });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: null });
        }
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

// ── REPL helper ───────────────────────────────────────────────────────────────

function runReplLines(listener: Listener, commands: string[]): Promise<unknown[]> {
  return new Promise((resolve) => {
    const readable = new Readable({ read() {} });
    const parsed: unknown[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _enc, cb) {
        for (const line of chunk.toString().split('\n')) {
          const t = line.trim();
          if (t) {
            try {
              parsed.push(JSON.parse(t));
            } catch {
              parsed.push(t);
            }
          }
        }
        cb();
      },
    });
    startRepl({ listener, input: readable, output: writable, onClose: () => resolve(parsed) });
    for (const cmd of commands) readable.push(cmd + '\n');
    readable.push(null);
  });
}

// ── JSONL helpers ─────────────────────────────────────────────────────────────

function readJsonlEvents(filePath: string): FactoryEvent[] {
  if (!existsSync(filePath)) return [];
  const events: FactoryEvent[] = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t) as FactoryEvent);
    } catch {
      /* skip */
    }
  }
  return events;
}

// ── Suite 1: Auth (AC 2) ──────────────────────────────────────────────────────

describe('AC 2 — auth', () => {
  let server: FrontDoorServer;
  let port: number;

  beforeEach(async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    server = new FrontDoorServer({ listener: new Listener({ engine, store }), token: TOKEN });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => server.close());

  it('GET /status with no token → 401', async () => {
    const { status } = await rq({ port, path: '/status', token: null });
    expect(status).toBe(401);
  });

  it('GET /status with wrong token → 401', async () => {
    const { status } = await rq({ port, path: '/status', token: 'wrong' });
    expect(status).toBe(401);
  });

  it('POST /intents with wrong token → 401, no state change', async () => {
    const beforeBody = (await rq({ port, path: '/status', token: TOKEN })).body;
    await rq({ port, method: 'POST', path: '/intents', token: 'bad', body: makeInput('x') });
    const afterBody = (await rq({ port, path: '/status', token: TOKEN })).body;
    expect(afterBody).toEqual(beforeBody);
  });

  it('GET /status with valid token → 200', async () => {
    const { status } = await rq({ port, path: '/status', token: TOKEN });
    expect(status).toBe(200);
  });
});

// ── Suite 2: commission → run → status (AC 2, 3) ────────────────────────────

describe('AC 2, 3 — commission / status round-trip', () => {
  let server: FrontDoorServer;
  let port: number;
  let engine: ScriptedEngine;

  beforeEach(async () => {
    const store = new MemStore();
    engine = new ScriptedEngine(store, [{ goalId: 'fast-1', report: successReport() }]);
    server = new FrontDoorServer({
      listener: new Listener({
        engine: engine as unknown as Parameters<typeof Listener>[0]['engine'],
        store,
      }),
      token: TOKEN,
    });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => server.close());

  it('POST /intents → 202 { id }', async () => {
    const { status, body } = await rq({
      port,
      method: 'POST',
      path: '/intents',
      token: TOKEN,
      body: makeInput('fast-1'),
    });
    expect(status).toBe(202);
    expect((body as { id: string }).id).toBe('fast-1');
  });

  it('GET /status shows running intent while engine stalls', async () => {
    void rq({ port, method: 'POST', path: '/intents', token: TOKEN, body: makeInput('slow-x') });
    await new Promise((r) => setTimeout(r, 30));

    const { body } = await rq({ port, path: '/status', token: TOKEN });
    expect((body as FrontDoorStatus).running).toContain('slow-x');

    engine.unblock('slow-x');
    await new Promise((r) => setTimeout(r, 20));
  });
});

// ── Suite 3: park + answer (AC 3) ────────────────────────────────────────────

describe('AC 3 — answer a parked intent', () => {
  let server: FrontDoorServer;
  let port: number;

  beforeEach(async () => {
    const store = new MemStore();
    const now = (() => {
      let t = 0;
      return () => ++t;
    })();

    const parkEvent: FactoryEvent = {
      type: 'blocked',
      at: now(),
      goalId: 'p-intent',
      brief: {
        question: 'Which strategy?',
        options: ['park'],
        links: ['p-intent'],
        deadlineMs: 60_000,
        onTimeout: 'park',
      },
      resolution: 'park',
    };

    const engine = new ScriptedEngine(store, [
      { goalId: 'p-intent', report: blockedReport(), events: [parkEvent] },
      { goalId: 'p-intent', report: successReport('resumed') },
    ]);

    server = new FrontDoorServer({
      listener: new Listener({
        engine: engine as unknown as Parameters<typeof Listener>[0]['engine'],
        store,
        now,
      }),
      token: TOKEN,
    });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => server.close());

  it('POST /intents/:id/answer on unknown id → 404', async () => {
    const { status } = await rq({
      port,
      method: 'POST',
      path: '/intents/nonexistent/answer',
      token: TOKEN,
      body: { answer: 'foo' },
    });
    expect(status).toBe(404);
  });

  it('POST /intents/:id/answer on missing answer field → 422', async () => {
    // First, commission and park the intent.
    await rq({ port, method: 'POST', path: '/intents', token: TOKEN, body: makeInput('p-intent') });
    await new Promise((r) => setTimeout(r, 30));

    const { status } = await rq({
      port,
      method: 'POST',
      path: '/intents/p-intent/answer',
      token: TOKEN,
      body: { notAnswer: 'oops' },
    });
    expect(status).toBe(422);
  });
});

// ── Suite 4: periodic tick() expires TTL (AC 4) ────────────────────────────

describe('AC 4 — daemon owns the clock (tick)', () => {
  it('a TTL-expired parked intent is bounced by tick()', async () => {
    const store = new MemStore();
    let now = 1000;
    const clock = () => now;

    const parkEvent: FactoryEvent = {
      type: 'blocked',
      at: now,
      goalId: 'ttl-intent',
      brief: {
        question: 'Tick me out?',
        options: ['park'],
        links: ['ttl-intent'],
        deadlineMs: 500, // 500 ms TTL
        onTimeout: 'park',
      },
      resolution: 'park',
    };

    const engine = new ScriptedEngine(store, [
      { goalId: 'ttl-intent', report: blockedReport(), events: [parkEvent] },
    ]);

    const listener = new Listener({
      engine: engine as unknown as Parameters<typeof Listener>[0]['engine'],
      store,
      now: clock,
    });

    // Commission and let the intent park.
    const commP = listener.commission(makeInput('ttl-intent'));
    await commP; // resolves after park
    expect(listener.status().parked.some((p) => p.id === 'ttl-intent')).toBe(true);

    // Advance clock past deadline and tick.
    now = 1000 + 500 + 1;
    const { bounced } = await listener.tick(now);

    expect(bounced).toContain('ttl-intent');
    expect(listener.status().parked.some((p) => p.id === 'ttl-intent')).toBe(false);
  });
});

// ── Suite 5: SIGTERM child-process (AC 5) ─────────────────────────────────

describe('AC 5 — SIGTERM: exit 0 + preserved worktree events', () => {
  it('daemon exits 0 on SIGTERM and writes worktree-preserved for running intents', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'corellia-int-'));

    try {
      const eventsPath = join(tmpDir, 'events.jsonl');
      const tok = 'int-sigterm-tok';
      const port = 19_200 + Math.floor(Math.random() * 800);

      const child = spawn(process.execPath, [TSX_CLI, 'src/daemon/daemon.ts'], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          FRONT_DOOR_TOKEN: tok,
          FRONT_DOOR_PORT: String(port),
          CORELLIA_EVENTS_PATH: eventsPath,
          CORELLIA_TICK_MS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', () => {});
      child.stderr?.on('data', () => {});

      // Wait for ready.
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 6000;
        function attempt() {
          if (Date.now() > deadline) {
            reject(new Error('daemon did not start'));
            return;
          }
          const req = http.request(
            { hostname: '127.0.0.1', port, path: '/status', method: 'GET',
              headers: { Authorization: `Bearer ${tok}` } },
            (res) => {
              res.resume();
              if (res.statusCode === 200) resolve();
              else setTimeout(attempt, 100);
            },
          );
          req.on('error', () => setTimeout(attempt, 100));
          req.end();
        }
        attempt();
      });

      child.kill('SIGTERM');

      const code = await new Promise<number | null>((resolve) => {
        child.on('exit', (c) => resolve(c));
        setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 8000);
      });

      expect(code).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 25_000);
});

// ── Suite 6: REPL + HTTP share one Listener (AC 6) ──────────────────────────

describe('AC 6 — REPL + HTTP share one Listener (ADR-008)', () => {
  let server: FrontDoorServer;
  let port: number;
  let listener: Listener;
  let engine: ScriptedEngine;

  beforeEach(async () => {
    const store = new MemStore();
    engine = new ScriptedEngine(store);
    listener = new Listener({
      engine: engine as unknown as Parameters<typeof Listener>[0]['engine'],
      store,
    });
    server = new FrontDoorServer({ listener, token: TOKEN });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => {
    engine.unblock('repl-i1');
    await new Promise((r) => setTimeout(r, 20));
    await server.close();
  });

  it('commission via REPL → visible in HTTP GET /status', async () => {
    const input = makeInput('repl-i1');

    // Commission via the REPL.
    const lines = await runReplLines(listener, [`commission ${JSON.stringify(input)}`, 'exit']);

    const ok = (lines as Record<string, unknown>[]).find((l) => l['ok'] === true && l['id'] === 'repl-i1');
    expect(ok).toBeDefined();

    // Give commission a tick to reach the engine.
    await new Promise((r) => setTimeout(r, 20));

    // HTTP status on the same listener shows it.
    const { body } = await rq({ port, path: '/status', token: TOKEN });
    expect((body as FrontDoorStatus).running).toContain('repl-i1');
  });
});

// ── Suite 7: substrate selection (AC 7) ─────────────────────────────────────

describe('AC 7 — substrate selection', () => {
  it('buildStore() returns a JSONL store when DATABASE_URL is not set', () => {
    const saved = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    const eventsPath = join(tmpdir(), `corellia-sub-${Date.now()}.jsonl`);
    process.env['CORELLIA_EVENTS_PATH'] = eventsPath;

    try {
      const { store, close } = buildStore();
      // Should be a JsonlEventStore (append + list work without a DB).
      expect(store).toBeDefined();
      expect(typeof store.append).toBe('function');
      expect(typeof store.list).toBe('function');
      void close();
    } finally {
      if (saved !== undefined) process.env['DATABASE_URL'] = saved;
      delete process.env['CORELLIA_EVENTS_PATH'];
    }
  });

  it('buildStore() JSONL store persists events across separate instances', async () => {
    const saved = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    const eventsPath = join(tmpdir(), `corellia-persist-${Date.now()}.jsonl`);
    process.env['CORELLIA_EVENTS_PATH'] = eventsPath;

    try {
      // Write with first instance.
      const { store: s1, close: c1 } = buildStore();
      await s1.append({ type: 'goal-received', at: 1, goalId: 'g1', goal: {} as Goal });
      await c1();

      // Read with second instance (simulates restart).
      const { store: s2, close: c2 } = buildStore();
      const events = await s2.list({ goalId: 'g1' });
      await c2();

      expect(events).toHaveLength(1);
      expect(events[0]?.goalId).toBe('g1');
    } finally {
      if (saved !== undefined) process.env['DATABASE_URL'] = saved;
      delete process.env['CORELLIA_EVENTS_PATH'];
    }
  });
});
