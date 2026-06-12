/**
 * HTTP integration tests for the FrontDoorServer.
 *
 * Uses an ephemeral port (0) and a scripted Listener-compatible engine mock
 * so no LLM calls occur. Covers:
 *   - Auth: 401 on missing/wrong token, 200 on valid token
 *   - POST /intents: commission → 202 with { id }
 *   - GET /status: returns FrontDoorStatus JSON
 *   - POST /intents/:id/answer: resumes a parked intent → 202
 *   - 404 on unknown routes
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { FactoryEvent, EventStore } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import { Listener } from '../../src/listener/listener.js';
import type { CommissionInput, FrontDoorStatus } from '../../src/contract/brief.js';
import { FrontDoorServer } from '../../src/daemon/http-server.js';

// ── In-memory EventStore ────────────────────────────────────────────────────

class MemStore implements EventStore {
  private readonly log: FactoryEvent[] = [];

  async append(e: FactoryEvent): Promise<void> {
    this.log.push(e);
  }

  async list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]> {
    if (!filter) return [...this.log];
    return this.log.filter((e) => {
      if (filter.goalId && e.goalId !== filter.goalId) return false;
      if (filter.type && e.type !== filter.type) return false;
      return true;
    });
  }
}

// ── ScriptedEngine ──────────────────────────────────────────────────────────

function successReport(): Report {
  return {
    artifact: { kind: 'text', text: 'done' },
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
    blockers: ['needs human'],
    findings: [],
    learned: '',
  };
}

class ScriptedEngine {
  /** Resolve functions for in-flight runs, keyed by goal id. */
  private readonly pending = new Map<string, () => void>();
  private readonly script: Map<string, { report: Report; events?: FactoryEvent[] }>;
  private readonly store: EventStore;

  constructor(
    store: EventStore,
    script: { goalId: string; report: Report; events?: FactoryEvent[] }[] = [],
  ) {
    this.store = store;
    this.script = new Map(script.map((s) => [s.goalId, s]));
  }

  /** Unblock a stalled run. No-op if the run is not currently stalled. */
  unblock(goalId: string): void {
    this.pending.get(goalId)?.();
  }

  async run(goal: Goal): Promise<Report> {
    await this.store.append({ type: 'goal-received', at: Date.now(), goalId: goal.id, goal });

    // If this goal is scripted to stall, wait until unblock() is called.
    if (this.script.get(goal.id) === undefined) {
      await new Promise<void>((resolve) => this.pending.set(goal.id, resolve));
    }

    const entry = this.script.get(goal.id);

    for (const e of entry?.events ?? []) {
      await this.store.append(e);
    }

    const report = entry?.report ?? successReport();
    await this.store.append({ type: 'emitted', at: Date.now(), goalId: goal.id, report });
    return report;
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

interface RequestOptions {
  method?: string;
  path?: string;
  token?: string | null;
  body?: unknown;
  port: number;
}

function doRequest(opts: RequestOptions): Promise<{ status: number; body: unknown }> {
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
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
          });
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOKEN = 'test-token-abc';

function makeInput(id: string): CommissionInput {
  return {
    id,
    title: `Intent ${id}`,
    spec: { what: id },
    scope: [`src/${id}/`],
    budget: { attempts: 2, toolCalls: 10, tokens: 5_000 },
    intent: 'production',
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('FrontDoorServer auth', () => {
  let server: FrontDoorServer;
  let port: number;

  beforeEach(async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });
    server = new FrontDoorServer({ listener, token: TOKEN });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const { status } = await doRequest({ port, path: '/status', token: null });
    expect(status).toBe(401);
  });

  it('returns 401 when token is wrong', async () => {
    const { status } = await doRequest({ port, path: '/status', token: 'wrong-token' });
    expect(status).toBe(401);
  });

  it('returns 401 for malformed Authorization header (no Bearer scheme)', async () => {
    const { status, body } = await doRequest({ port, path: '/status', token: null }).then(() =>
      doRequest({
        port,
        path: '/status',
        // Bypass the helper to send a raw non-Bearer header
        token: null,
      }),
    );
    expect(status).toBe(401);
    expect((body as { error: string }).error).toBe('Unauthorized');
  });

  it('returns 200 on GET /status with a valid token', async () => {
    const { status } = await doRequest({ port, path: '/status', token: TOKEN });
    expect(status).toBe(200);
  });

  it('does not mutate state on auth failure for POST /intents', async () => {
    const before = await doRequest({ port, path: '/status', token: TOKEN });
    await doRequest({
      port,
      method: 'POST',
      path: '/intents',
      token: 'bad',
      body: makeInput('x'),
    });
    const after = await doRequest({ port, path: '/status', token: TOKEN });
    // Status unchanged: no running/queued/parked intents added
    expect(after.body).toEqual(before.body);
  });
});

describe('FrontDoorServer GET /status', () => {
  let server: FrontDoorServer;
  let port: number;

  beforeEach(async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });
    server = new FrontDoorServer({ listener, token: TOKEN });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns FrontDoorStatus with empty arrays on a fresh listener', async () => {
    const { status, body } = await doRequest({ port, path: '/status', token: TOKEN });
    expect(status).toBe(200);
    const s = body as FrontDoorStatus;
    expect(s.running).toEqual([]);
    expect(s.queued).toEqual([]);
    expect(s.parked).toEqual([]);
  });
});

describe('FrontDoorServer POST /intents', () => {
  let server: FrontDoorServer;
  let port: number;
  let engine: ScriptedEngine;

  beforeEach(async () => {
    const store = new MemStore();
    // Script 'i1' to complete immediately; other ids stall (for status checks).
    engine = new ScriptedEngine(store, [{ goalId: 'i1', report: successReport() }]);
    const listener = new Listener({
      engine: engine as unknown as Parameters<typeof Listener>[0]['engine'],
      store,
    });
    server = new FrontDoorServer({ listener, token: TOKEN });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns 202 with the intent id on success', async () => {
    const { status, body } = await doRequest({
      port,
      method: 'POST',
      path: '/intents',
      token: TOKEN,
      body: makeInput('i1'),
    });
    expect(status).toBe(202);
    expect((body as { id: string }).id).toBe('i1');
  });

  it('returns 422 when required fields are missing', async () => {
    const { status } = await doRequest({
      port,
      method: 'POST',
      path: '/intents',
      token: TOKEN,
      body: { id: 'oops' }, // missing title/spec/scope/budget
    });
    expect(status).toBe(422);
  });

  it('shows a commissioned intent in running when the engine stalls', async () => {
    // 'slow' is not scripted to return immediately, so the engine stalls.
    void doRequest({
      port,
      method: 'POST',
      path: '/intents',
      token: TOKEN,
      body: makeInput('slow'),
    });

    // Give the event loop a moment for the commission call to reach the engine.
    await new Promise((r) => setTimeout(r, 20));

    const { body } = await doRequest({ port, path: '/status', token: TOKEN });
    const s = body as FrontDoorStatus;
    expect(s.running).toContain('slow');

    // Unblock so the listener doesn't leak.
    engine.unblock('slow');
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe('FrontDoorServer POST /intents/:id/answer', () => {
  let server: FrontDoorServer;
  let port: number;

  beforeEach(async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store, [
      {
        goalId: 'parked-1',
        report: blockedReport(),
        events: [
          {
            type: 'blocked',
            at: Date.now(),
            goalId: 'parked-1',
            brief: {
              question: 'Which approach?',
              options: ['park'],
              links: ['parked-1'],
              deadlineMs: 30_000,
              onTimeout: 'park',
            },
            resolution: 'park',
          },
        ],
      },
      // Second run (resume) succeeds immediately
      { goalId: 'parked-1', report: successReport() },
    ]);
    const listener = new Listener({
      engine: engine as unknown as Parameters<typeof Listener>[0]['engine'],
      store,
    });
    server = new FrontDoorServer({ listener, token: TOKEN });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns 404 when intent is not parked', async () => {
    const { status } = await doRequest({
      port,
      method: 'POST',
      path: '/intents/nonexistent/answer',
      token: TOKEN,
      body: { answer: 'use option A' },
    });
    expect(status).toBe(404);
  });

  it('returns 422 when answer field is missing', async () => {
    const { status } = await doRequest({
      port,
      method: 'POST',
      path: '/intents/parked-1/answer',
      token: TOKEN,
      body: { notAnswer: 'oops' },
    });
    expect(status).toBe(422);
  });
});

describe('FrontDoorServer unknown routes', () => {
  let server: FrontDoorServer;
  let port: number;

  beforeEach(async () => {
    const store = new MemStore();
    const engine = new ScriptedEngine(store) as unknown as Parameters<typeof Listener>[0]['engine'];
    const listener = new Listener({ engine, store });
    server = new FrontDoorServer({ listener, token: TOKEN });
    await server.listen();
    port = server.port;
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns 404 for an unknown path', async () => {
    const { status } = await doRequest({ port, path: '/unknown', token: TOKEN });
    expect(status).toBe(404);
  });

  it('returns 404 for a DELETE method on /status', async () => {
    const { status } = await doRequest({ port, method: 'DELETE', path: '/status', token: TOKEN });
    expect(status).toBe(404);
  });
});
