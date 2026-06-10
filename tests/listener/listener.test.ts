/**
 * Tests for Listener: scope-disjoint admission, parking + TTL, and resume.
 *
 * Most tests use a ScriptedEngine that accepts a queue of (goalId → Report)
 * overrides. The ScriptedEngine appends blocked events directly, which the
 * Listener's fallback event-scan path detects for backward compatibility.
 *
 * The final describe block uses a real Engine to verify the brief-seam design:
 * a scripted Brain that returns a block decision with onTimeout:'park' causes
 * the Engine to fire the Listener's active brief handler synchronously, which
 * records the park without any post-hoc event scanning.
 */

import { describe, it, expect } from 'vitest';
import { Listener } from '../../src/listener/listener.js';
import { Engine } from '../../src/engine/engine.js';
import type { EventStore, FactoryEvent } from '../../src/contract/events.js';
import type { Goal, MemoryPointer } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import type { CommissionInput } from '../../src/listener/listener.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  nonLeafTypeDef,
  textArtifact,
  passVerdict,
} from '../engine/stubs.js';
import type { Brain, BrainContext } from '../../src/contract/brain.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';

// ── In-memory async EventStore ─────────────────────────────────────────────

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

  types(): string[] {
    return this.log.map((e) => e.type);
  }
}

// ── ScriptedEngine ─────────────────────────────────────────────────────────

/**
 * Minimal Engine stand-in. For each run(), looks up the goal id in the script
 * queue to find what report to return and what extra events to append.
 * Falls back to a success report if nothing is scripted for this goal.
 */
class ScriptedEngine {
  private queue: { goalId?: string; report: Report; events?: FactoryEvent[] }[];
  private readonly store: EventStore;
  private readonly now: () => number;

  constructor(
    store: EventStore,
    script: { goalId?: string; report: Report; events?: FactoryEvent[] }[],
    now?: () => number,
  ) {
    this.store = store;
    this.queue = [...script];
    this.now = now ?? (() => Date.now());
  }

  async run(goal: Goal): Promise<Report> {
    await this.store.append({ type: 'goal-received', at: this.now(), goalId: goal.id, goal });

    const idx = this.queue.findIndex((e) => e.goalId === undefined || e.goalId === goal.id);
    const entry = idx >= 0 ? this.queue.splice(idx, 1)[0]! : { report: successReport() };

    for (const e of entry.events ?? []) {
      await this.store.append(e);
    }

    await this.store.append({ type: 'emitted', at: this.now(), goalId: goal.id, report: entry.report });
    return entry.report;
  }
}

// ── Factories ──────────────────────────────────────────────────────────────

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

function blockedReport(reason = 'needs human'): Report {
  return {
    artifact: null,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [reason],
    findings: [],
    learned: '',
  };
}

/** Build a 'blocked' FactoryEvent that signals the Listener to park. */
function parkBlockedEvent(
  goalId: string,
  at: number,
  question = 'What should I do?',
  deadlineMs = 5_000,
): Extract<FactoryEvent, { type: 'blocked' }> {
  return {
    type: 'blocked',
    at,
    goalId,
    brief: {
      question,
      options: ['park', 'bounce'],
      links: [goalId],
      deadlineMs,
      onTimeout: 'park',
    },
    resolution: 'park',
  };
}

function makeInput(
  id: string,
  scope: string[],
  overrides: Partial<CommissionInput> = {},
): CommissionInput {
  return {
    id,
    title: `Intent ${id}`,
    spec: { what: id },
    scope,
    budget: { attempts: 3, tokens: 1000, toolCalls: 50, wallClockMs: 60_000 },
    intent: 'production',
    ...overrides,
  };
}

// ── 1. Two disjoint intents run concurrently ───────────────────────────────

describe('scope-disjoint intents run concurrently', () => {
  it('both goals start before either finishes (interleaved execution)', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;

    const startedIds: string[] = [];
    let resolveA!: () => void;
    let resolveB!: () => void;

    // Custom engine that records when each goal starts and stalls until unlocked.
    const engine = {
      async run(goal: Goal): Promise<Report> {
        startedIds.push(goal.id);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        await new Promise<void>((res) => {
          if (goal.id === 'a') resolveA = res;
          else resolveB = res;
        });
        const report = successReport(goal.id);
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now });

    const promA = listener.commission(makeInput('a', ['src/moduleA']));
    const promB = listener.commission(makeInput('b', ['src/moduleB']));

    // Allow microtasks to run so both starts are initiated.
    await Promise.resolve();
    await Promise.resolve();

    // Both should have started — neither waited for the other.
    expect(startedIds).toContain('a');
    expect(startedIds).toContain('b');
    expect(listener.status().running).toContain('a');
    expect(listener.status().running).toContain('b');

    // Unlock both and confirm clean reports.
    resolveA();
    resolveB();
    const [repA, repB] = await Promise.all([promA, promB]);
    expect(repA.blockers).toHaveLength(0);
    expect(repB.blockers).toHaveLength(0);
  });
});

// ── 2. Overlapping intents serialize ──────────────────────────────────────

describe('overlapping intents serialize', () => {
  it('second intent starts only after first completes', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const order: string[] = [];

    const engine = {
      async run(goal: Goal): Promise<Report> {
        order.push(`start:${goal.id}`);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        const report = successReport(goal.id);
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        order.push(`end:${goal.id}`);
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now });

    // Both touch 'src/shared' — overlap triggers serialization.
    const p1 = listener.commission(makeInput('i1', ['src/shared']));
    const p2 = listener.commission(makeInput('i2', ['src/shared']));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.blockers).toHaveLength(0);
    expect(r2.blockers).toHaveLength(0);

    // i1 must fully complete before i2 starts.
    const startI2 = order.indexOf('start:i2');
    const endI1 = order.indexOf('end:i1');
    expect(endI1).toBeGreaterThanOrEqual(0);
    expect(startI2).toBeGreaterThan(endI1);
  });

  it('status reflects queued intent while first is running', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    let unlockA!: () => void;

    const engine = {
      async run(goal: Goal): Promise<Report> {
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        if (goal.id === 'a') {
          await new Promise<void>((res) => { unlockA = res; });
        }
        const report = successReport(goal.id);
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now });

    const pA = listener.commission(makeInput('a', ['src/overlap']));
    const pB = listener.commission(makeInput('b', ['src/overlap/sub']));  // overlaps 'a'

    await Promise.resolve();
    await Promise.resolve();

    expect(listener.status().running).toContain('a');
    expect(listener.status().queued).toContain('b');

    unlockA();
    await Promise.all([pA, pB]);

    expect(listener.status().queued).toHaveLength(0);
  });
});

// ── 3. Parking releases the scope reservation ──────────────────────────────

describe('parking releases the scope reservation', () => {
  it('an overlapping intent proceeds while the first is parked', async () => {
    const store = new MemStore();
    let tick = 100;
    const now = () => ++tick;

    const engine = {
      async run(goal: Goal): Promise<Report> {
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });

        if (goal.id === 'first') {
          // Append the park-blocked event the Listener looks for.
          await store.append(parkBlockedEvent(goal.id, now(), 'Awaiting human decision', 5_000));
          const report = blockedReport('Awaiting human decision');
          await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
          return report;
        }

        const report = successReport(goal.id);
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now, defaultTtlMs: 5_000 });

    const pFirst = listener.commission(makeInput('first', ['src/feature']));
    const pSecond = listener.commission(makeInput('second', ['src/feature/sub']));

    const [rFirst, rSecond] = await Promise.all([pFirst, pSecond]);

    // 'first' returned a blocked report (parked).
    expect(rFirst.blockers).toContain('Awaiting human decision');

    // 'second' ran successfully while 'first' was parked.
    expect(rSecond.blockers).toHaveLength(0);

    // 'first' shows in parked, not running.
    const s = listener.status();
    expect(s.parked.map((p) => p.id)).toContain('first');
    expect(s.running).not.toContain('first');
  });
});

// ── 4. answer() resumes with the answer visible to the brain ──────────────

describe('answer() resumes parked intent', () => {
  it('answer injects a trusted memory pointer that is visible to the re-run', async () => {
    const store = new MemStore();
    let tick = 200;
    const now = () => ++tick;

    const receivedMemories: MemoryPointer[][] = [];

    const engine = {
      async run(goal: Goal): Promise<Report> {
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        receivedMemories.push([...goal.memories]);

        if (goal.memories.length === 0) {
          // First run: park to ask a question.
          await store.append(parkBlockedEvent(goal.id, now(), 'Which strategy?', 5_000));
          const report = blockedReport('Which strategy?');
          await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
          return report;
        }

        // Re-run: answer pointer should be in memories.
        const report = successReport('answered');
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now, defaultTtlMs: 10_000 });

    // First commission: parks.
    const firstReport = await listener.commission(makeInput('q1', ['src/module']));
    expect(firstReport.blockers).toHaveLength(1);
    expect(listener.status().parked.map((p) => p.id)).toContain('q1');

    // Answer: should resume and complete.
    const resumeReport = await listener.answer('q1', 'Use strategy A');

    expect(resumeReport.blockers).toHaveLength(0);
    expect(resumeReport.artifact?.text).toBe('answered');

    // Verify the answer pointer was injected into the second run.
    const secondRunMemories = receivedMemories[1];
    expect(secondRunMemories).toBeDefined();
    expect(secondRunMemories!.length).toBeGreaterThan(0);

    const answerPointer = secondRunMemories!.find((m) => m.id === 'q1:answer');
    expect(answerPointer).toBeDefined();
    expect(answerPointer!.provenance).toBe('trusted');
    expect(answerPointer!.content).toContain('Which strategy?');
    expect(answerPointer!.content).toContain('Use strategy A');
  });

  it('answer on unknown id rejects', async () => {
    const store = new MemStore();
    const engine = {
      async run(): Promise<Report> { return successReport(); },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store });
    await expect(listener.answer('nonexistent', 'hi')).rejects.toThrow(/no parked intent/i);
  });
});

// ── 5. tick() bounces past-TTL parked intents ─────────────────────────────

describe('tick() TTL sweep', () => {
  it('past-deadline parked intent is bounced and removed', async () => {
    const store = new MemStore();
    let tick = 300;
    const now = () => ++tick;

    const engine = {
      async run(goal: Goal): Promise<Report> {
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        await store.append(parkBlockedEvent(goal.id, now(), 'Needs decision', 1_000));
        const report = blockedReport('Needs decision');
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now, defaultTtlMs: 1_000 });

    await listener.commission(makeInput('ttl1', ['src/ttl']));

    // Confirm parked.
    expect(listener.status().parked.map((p) => p.id)).toContain('ttl1');
    const deadline = listener.status().parked.find((p) => p.id === 'ttl1')!.deadline;

    // Tick before deadline — no bounce.
    const before = listener.tick(deadline - 1);
    expect(before.bounced).toHaveLength(0);
    expect(listener.status().parked.map((p) => p.id)).toContain('ttl1');

    // Tick at deadline — bounced.
    const after = listener.tick(deadline);
    expect(after.bounced).toContain('ttl1');
    expect(listener.status().parked.map((p) => p.id)).not.toContain('ttl1');

    // A 'blocked' event with resolution 'bounce' was appended.
    const bounceEvents = await store.list({ type: 'blocked' });
    const bounceEv = (bounceEvents as Extract<FactoryEvent, { type: 'blocked' }>[]).find(
      (e) => e.resolution === 'bounce',
    );
    expect(bounceEv).toBeDefined();
  });

  it('tick() does not bounce before the deadline', async () => {
    const store = new MemStore();
    let tick = 400;
    const now = () => ++tick;

    const engine = {
      async run(goal: Goal): Promise<Report> {
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        await store.append(parkBlockedEvent(goal.id, now(), 'Still deciding', 10_000));
        const report = blockedReport('Still deciding');
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now, defaultTtlMs: 10_000 });

    await listener.commission(makeInput('ttl2', ['src/safe']));
    expect(listener.status().parked).toHaveLength(1);

    // Tick well before deadline.
    const result = listener.tick(now() + 100);
    expect(result.bounced).toHaveLength(0);
    expect(listener.status().parked).toHaveLength(1);
  });
});

// ── 6. Three disjoint intents all run concurrently ────────────────────────

describe('three-way disjoint concurrency', () => {
  it('all three start before any finishes', async () => {
    const store = new MemStore();
    let tick = 500;
    const now = () => ++tick;

    const started: string[] = [];
    const resolvers: Record<string, () => void> = {};

    const engine = {
      async run(goal: Goal): Promise<Report> {
        started.push(goal.id);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        await new Promise<void>((res) => { resolvers[goal.id] = res; });
        const report = successReport(goal.id);
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now });

    const pA = listener.commission(makeInput('dA', ['src/a']));
    const pB = listener.commission(makeInput('dB', ['src/b']));
    const pC = listener.commission(makeInput('dC', ['src/c']));

    // Allow the event loop to start all three.
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toContain('dA');
    expect(started).toContain('dB');
    expect(started).toContain('dC');

    resolvers['dA']!();
    resolvers['dB']!();
    resolvers['dC']!();
    const reports = await Promise.all([pA, pB, pC]);
    expect(reports.every((r) => r.blockers.length === 0)).toBe(true);
  });
});

// ── 7. answer queues when scope is contested on resume ────────────────────

describe('answer queues when scope is contested on resume', () => {
  it('resumed intent waits for the contesting runner to finish', async () => {
    const store = new MemStore();
    let tick = 600;
    const now = () => ++tick;
    let unlockContest!: () => void;

    // 'parked-one' parks first. While it is parked, 'contest' runs and holds the scope.
    // When answer() is called, 'contest' is still running, so 'parked-one' queues.
    const engine = {
      async run(goal: Goal): Promise<Report> {
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });

        if (goal.id === 'parked-one' && goal.memories.length === 0) {
          // First run: park.
          await store.append(parkBlockedEvent(goal.id, now(), 'Wait for input', 5_000));
          const report = blockedReport('Wait for input');
          await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
          return report;
        }

        if (goal.id === 'contest') {
          // Stall until unlocked.
          await new Promise<void>((res) => { unlockContest = res; });
          const report = successReport('contest-done');
          await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
          return report;
        }

        // Resume run of 'parked-one'.
        const report = successReport('resumed-done');
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({ engine, store, now, defaultTtlMs: 5_000 });

    // Commission 'parked-one'; it parks immediately.
    const pParked = listener.commission(makeInput('parked-one', ['src/shared']));
    await pParked;

    // Commission 'contest' which overlaps.
    const pContest = listener.commission(makeInput('contest', ['src/shared']));
    await Promise.resolve();
    await Promise.resolve();

    // 'contest' is running; now call answer() — 'parked-one' should queue.
    const pResume = listener.answer('parked-one', 'go ahead');
    await Promise.resolve();
    await Promise.resolve();

    expect(listener.status().queued).toContain('parked-one');

    // Unlock 'contest'.
    unlockContest();
    await pContest;

    // 'parked-one' should now run and complete.
    const resumeReport = await pResume;
    expect(resumeReport.blockers).toHaveLength(0);
    expect(resumeReport.artifact?.text).toBe('resumed-done');
  });
});

// ── 8. Real Engine + Real Listener: brief-seam integration test ───────────

describe('real Engine + Listener: brief-seam park and resume', () => {
  it('park recorded synchronously via brief handler; scope released; answer() resumes and completes', async () => {
    const store = new MemoryEventStore();
    let tick = 700;
    const now = () => ++tick;

    // Track how many times the brain's decide was called and what memories
    // were visible, so we can verify the answer pointer arrives on re-entry.
    const decideCalls: { memoriesCount: number }[] = [];

    // A brain that on its first decide returns block-with-park, then on the
    // second decide (after answer()) returns satisfy so the leaf can produce.
    const brain: Brain = {
      async decide(_goal: Goal, _ctx: BrainContext) {
        decideCalls.push({ memoriesCount: _goal.memories.length });
        if (decideCalls.length === 1) {
          // First run: block and request a park.
          return {
            kind: 'block' as const,
            brief: {
              question: 'Which output format?',
              options: ['park'],
              links: [_goal.id],
              deadlineMs: 5_000,
              onTimeout: 'park' as const,
            },
          };
        }
        // Re-entry after answer: satisfy the goal.
        return { kind: 'satisfy' as const };
      },
      async produce(_goal: Goal, _ctx: BrainContext): Promise<Artifact> {
        return textArtifact('real-output');
      },
      async judge(_goal: Goal, _subject: Artifact, _rubric: string, _ctx: BrainContext): Promise<Verdict> {
        return passVerdict();
      },
      async repair(_goal: Goal, _artifact: Artifact, _prescriptions: string[], _ctx: BrainContext): Promise<Artifact> {
        return textArtifact('repaired');
      },
    };

    // Registry needs a 'deliver-intent' type (what Listener always commissions)
    // and a leaf for satisfy path. deliver-intent is non-leaf so the brain's
    // decide is consulted; on re-entry it returns satisfy and the attempt loop runs.
    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'deliver-intent' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      now,
    });

    const listener = new Listener({ engine, store, now, defaultTtlMs: 10_000 });

    // First commission: the brain blocks with park; Listener should record park
    // synchronously via the brief-seam handler (no event-scan needed).
    const firstReport = await listener.commission({
      id: 'intent-park',
      title: 'Park test intent',
      spec: { what: 'test' },
      scope: ['src/park-test'],
      budget: { attempts: 5, tokens: 10_000, toolCalls: 50, wallClockMs: 60_000 },
      intent: 'production',
    });

    // First run returns a blocked report.
    expect(firstReport.blockers).toHaveLength(1);

    // Listener has parked the intent and released the scope reservation.
    const s = listener.status();
    expect(s.parked.map((p) => p.id)).toContain('intent-park');
    expect(s.running).not.toContain('intent-park');

    // Answer resumes the intent; second decide sees memories with the answer.
    const resumeReport = await listener.answer('intent-park', 'JSON format');

    expect(resumeReport.blockers).toHaveLength(0);
    expect(resumeReport.artifact?.text).toBe('real-output');

    // Brain was called twice: once to park, once to satisfy on resume.
    expect(decideCalls).toHaveLength(2);

    // On re-entry the answer pointer was injected as a memory.
    expect(decideCalls[1]!.memoriesCount).toBeGreaterThan(0);

    // The listener has no parked or running intents after completion.
    expect(listener.status().parked).toHaveLength(0);
    expect(listener.status().running).toHaveLength(0);

    // A 'parked' event was written to the store.
    const parkedEvents = await store.list({ type: 'parked' });
    expect(parkedEvents).toHaveLength(1);

    // A 'resumed' event was written when answer() was called.
    const resumedEvents = await store.list({ type: 'resumed' });
    expect(resumedEvents).toHaveLength(1);
  });
});
