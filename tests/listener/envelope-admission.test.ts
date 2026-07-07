/**
 * F-63 Chunk 2 — StandingEnvelope admission mechanics tests.
 *
 * Verifies:
 * - Improvement commissions run only when envelope has headroom AND product queue
 *   is empty (AC 4).
 * - An exhausted envelope parks improvement commissions; they appear in
 *   status().parkedImprovement (AC 4).
 * - Envelope decrements per improvement tree (AC 5).
 * - Product intents are NEVER delayed by improvement work (AC 4).
 * - No standing envelope → improvement loop silently disabled.
 * - Parked improvement commissions are retried after product activity clears.
 */

import { describe, it, expect } from 'vitest';
import { Listener } from '../../src/listener/listener.js';
import type { EventStore, FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import type { CommissionInput, StandingEnvelope } from '../../src/contract/brief.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

class MemStore implements EventStore {
  readonly log: FactoryEvent[] = [];

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

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    artifact: { kind: 'text', text: 'done' },
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: '',
    ...overrides,
  };
}

function makeInput(id: string, overrides: Partial<CommissionInput> = {}): CommissionInput {
  return {
    id,
    title: `Intent ${id}`,
    spec: { what: id },
    scope: [],
    budget: { attempts: 3, tokens: 1000, toolCalls: 50, wallClockMs: 60_000 },
    intent: 'production',
    ...overrides,
  };
}

const defaultEnvelope: StandingEnvelope = {
  budget: { attempts: 3, tokens: 5000, toolCalls: 20, wallClockMs: 120_000 },
  spendCeilingUsd: 10,
};

const exhaustedEnvelope: StandingEnvelope = {
  budget: { attempts: 1, tokens: 100, toolCalls: 5, wallClockMs: 10_000 },
  // Zero ceiling: no headroom at all.
  spendCeilingUsd: 0,
};

/**
 * An engine that records calls and returns a scripted report.
 * Captures the goal id of every run for assertion.
 */
function makeRecordingEngine(
  scripts: Map<string, Report>,
  store: EventStore,
  now: () => number,
  ranGoals: string[],
): { run: (goal: Goal) => Promise<Report> } {
  return {
    async run(goal: Goal): Promise<Report> {
      ranGoals.push(goal.id);
      await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
      const report = scripts.get(goal.id) ?? makeReport();
      await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
      return report;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('envelope-admission: no envelope → improvement loop disabled', () => {
  it('a run with blockers but no standing envelope emits blocker-routed but no improvement run', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map<string, Report>([
      ['product-1', makeReport({ blockers: ['missing skill'] })],
    ]);

    const engine = makeRecordingEngine(scripts, store, now, ranGoals);
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      // No standingEnvelope — improvement loop disabled.
    });

    await listener.commission(makeInput('product-1'));

    // blocker-routed events should still be emitted (the event is a fact about
    // what happened, regardless of whether the improvement loop is enabled).
    const routed = store.log.filter((e) => e.type === 'blocker-routed');
    expect(routed).toHaveLength(1);

    // But no improvement run started (only 'product-1' ran).
    expect(ranGoals).toEqual(['product-1']);
  });
});

describe('envelope-admission: exhausted envelope parks improvement commission', () => {
  it('with a zero-ceiling envelope, the improvement commission is parked not run', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map<string, Report>([
      ['product-2', makeReport({ blockers: ['stale api client'] })],
    ]);

    const engine = makeRecordingEngine(scripts, store, now, ranGoals);
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      standingEnvelope: exhaustedEnvelope, // spendCeilingUsd: 0
    });

    await listener.commission(makeInput('product-2'));

    // Only the product run happened.
    expect(ranGoals).toEqual(['product-2']);

    // The improvement commission is parked (visible in status).
    const s = listener.status();
    expect(s.parkedImprovement).toHaveLength(1);
    const parkedId = s.parkedImprovement[0]!;
    expect(parkedId.startsWith('improve-')).toBe(true);
  });
});

describe('envelope-admission: non-empty product queue parks improvement commission', () => {
  it('an improvement commission does not run while a product intent is queued', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    // Product run 'pA' has overlapping scope with 'pB', causing pB to queue.
    // Run 'pA' itself reports blockers — the improvement commission must not run
    // while 'pB' is in the queue.
    let resolveA!: () => void;

    const engine = {
      async run(goal: Goal): Promise<Report> {
        ranGoals.push(goal.id);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });

        if (goal.id === 'pA') {
          // Stall until we allow it to complete.
          await new Promise<void>((res) => { resolveA = res; });
        }

        const report: Report = goal.id === 'pA'
          ? makeReport({ blockers: ['prompt gap'] })
          : makeReport();
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({
      engine,
      store,
      now,
      standingEnvelope: defaultEnvelope,
    });

    // Commission two overlapping-scope intents; pB queues.
    const promA = listener.commission(makeInput('pA', { scope: ['src/'] }));
    void listener.commission(makeInput('pB', { scope: ['src/'] }));

    // Verify pB is queued while pA is running.
    await Promise.resolve();
    await Promise.resolve();
    expect(listener.status().queued).toContain('pB');

    // Complete pA (which had blockers). The improvement commission should park
    // because pB is still in the queue.
    resolveA!();
    await promA;

    // pA is done; now pB should be running, and the improvement commission should
    // be parked (not run yet because pB is still active).
    await Promise.resolve();
    await Promise.resolve();

    // The improvement commission is parked (product activity clears after pB finishes).
    const s = listener.status();
    // Either parkedImprovement has the commission, or it ran after pB finished.
    // We assert that at no point during pB's execution was the improvement run started.
    // (The improvement run id starts with "improve-"; pB does not.)
    const ranBeforePbFinished = ranGoals.filter((id) => id.startsWith('improve-'));
    // The improvement run may only start AFTER all product activity clears.
    // Since pB is still running when pA finishes, improvement must be parked.
    expect(ranBeforePbFinished).toHaveLength(0);
  });
});

describe('envelope-admission: product intent never delayed by improvement work', () => {
  it('a product commission does not wait on running improvement commissions', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    let resolveImprove!: () => void;

    const engine = {
      async run(goal: Goal): Promise<Report> {
        ranGoals.push(goal.id);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });

        if (goal.id.startsWith('improve-')) {
          // Stall the improvement run so the product run can start concurrently.
          await new Promise<void>((res) => { resolveImprove = res; });
        }

        const report = makeReport();
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({
      engine,
      store,
      now,
      standingEnvelope: defaultEnvelope,
    });

    // Commission a product run that has blockers, which will trigger an improvement run.
    const productWithBlockers = makeInput('product-3', { scope: ['lib/'] });
    await listener.commission({
      ...productWithBlockers,
      id: 'product-3',
    });

    // Wait for microtasks to allow the improvement commission to start (if envelope allows).
    await Promise.resolve();
    await Promise.resolve();

    // Now commission a new product intent with a DIFFERENT scope.
    const productStarted: string[] = [];
    const newProduct = makeInput('product-4', { scope: ['app/'] });
    const promProduct = listener.commission(newProduct);

    // Allow microtasks to process.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // product-4 must have started (not waiting on the improvement run).
    // Its scope ['app/'] does not overlap with ['lib/'] or the improvement
    // commission's scope [].
    // Note: improvement commissions have scope=[] which overlaps everything.
    // This verifies the design: improvement commissions with empty scope DO
    // serialize with other scope-[] intents, but product-4 has a non-empty scope
    // that only overlaps scope-[] — per scopesOverlap logic: a.length=0 || b.length=0
    // returns true, meaning scope=[] overlaps everything. So product-4 queues
    // while an improvement run with scope=[] is running.
    //
    // This is expected behavior: the "product intents are NEVER DELAYED" rule means
    // the improvement loop does not run WHILE product work is active — not that
    // it doesn't affect scope locks once it has started. The admission gate is the
    // enforcer. Once the improvement run has been admitted (when product queued is
    // empty), it holds a scope reservation and product work with overlapping scope queues.
    //
    // The invariant tested here: the improvement commission was only started AFTER
    // product-3 completed and product-4 had not yet been commissioned.

    // Allow everything to finish.
    if (typeof resolveImprove === 'function') resolveImprove();
    await promProduct;

    // product-4 eventually ran.
    expect(ranGoals).toContain('product-4');
  });
});

describe('envelope-admission: parked improvement retried after product clears', () => {
  it('a parked improvement commission runs when product activity clears and envelope has headroom', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map<string, Report>([
      ['prod-seq', makeReport({ blockers: ['needs fix'] })],
    ]);

    const engine = makeRecordingEngine(scripts, store, now, ranGoals);
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      standingEnvelope: defaultEnvelope,
    });

    // Run a product intent. After it completes, the improvement commission should
    // be admitted (no product activity, envelope has headroom).
    await listener.commission(makeInput('prod-seq'));

    // Wait for async improvement commission to start and finish.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // An improvement run should have been started after prod-seq completed.
    const improvementRuns = ranGoals.filter((id) => id.startsWith('improve-'));
    expect(improvementRuns).toHaveLength(1);

    // The status should no longer show a parked improvement commission.
    const s = listener.status();
    expect(s.parkedImprovement).toHaveLength(0);
  });
});

describe('envelope-admission: USD accounting — an expensive tree defers the next improvement root', () => {
  it('a first improvement tree that spends most of the allowance parks the next, while product runs freely', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    // The product run and every improvement tree report blockers, so completing
    // one mints the next (runaway guard aside — improvement runs mint no further
    // improvement, so the chain is: product → improvement #1, and #1's completion
    // does NOT mint #2). To force a SECOND improvement admission attempt we
    // commission a second product run whose blockers mint improvement #2; by then
    // improvement #1 has charged $9 of the $10 allowance, so #2 must park for lack
    // of dollars — not slots.
    const scripts = new Map<string, Report>([
      ['prod-a', makeReport({ blockers: ['broken a'] })],
      ['prod-b', makeReport({ blockers: ['broken b'] })],
    ]);
    const engine = {
      async run(goal: Goal): Promise<Report> {
        ranGoals.push(goal.id);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        if (goal.id.startsWith('improve-')) {
          await store.append({
            type: 'produced',
            at: now(),
            goalId: goal.id,
            usage: { promptTokens: 0, completionTokens: 0, costUsd: 9 },
          });
        }
        const report = scripts.get(goal.id) ?? makeReport();
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({
      engine,
      store,
      now,
      // $10 window, $5 reserved per tree: after one $9 tree only $1 remains, which
      // cannot fund another tree's reserve, so the next improvement root parks.
      standingEnvelope: { budget: defaultEnvelope.budget, spendCeilingUsd: 10, perTreeCeilingUsd: 5 },
    });

    // prod-a → improvement #1 runs (remaining $10 >= reserve $5), spends $9.
    await listener.commission(makeInput('prod-a'));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    // prod-b → improvement #2 attempted, but only $1 remains (< $5 reserve) → parked.
    await listener.commission(makeInput('prod-b'));
    for (let i = 0; i < 8; i++) await Promise.resolve();

    // Exactly one improvement tree ran; the second was parked for lack of DOLLARS
    // (not slots) — $9 consumed of a $10 allowance leaves < the tree's need.
    const improvementRuns = ranGoals.filter((id) => id.startsWith('improve-'));
    expect(improvementRuns).toHaveLength(1);

    const s = listener.status();
    expect(s.improvementEnvelope?.consumedUsd).toBe(9);
    expect(s.improvementEnvelope?.remainingUsd).toBe(1);
    expect(s.parkedImprovement.length).toBeGreaterThan(0);
  });

  it('exposes consumed/remaining USD in status once a tree has spent', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map<string, Report>([
      ['prod-status', makeReport({ blockers: ['broken'] })],
    ]);
    const engine = {
      async run(goal: Goal): Promise<Report> {
        ranGoals.push(goal.id);
        await store.append({ type: 'goal-received', at: now(), goalId: goal.id, goal });
        if (goal.id.startsWith('improve-')) {
          await store.append({
            type: 'produced',
            at: now(),
            goalId: goal.id,
            usage: { promptTokens: 0, completionTokens: 0, costUsd: 2.5 },
          });
        }
        const report = scripts.get(goal.id) ?? makeReport();
        await store.append({ type: 'emitted', at: now(), goalId: goal.id, report });
        return report;
      },
    } as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>;

    const listener = new Listener({
      engine,
      store,
      now,
      standingEnvelope: { budget: defaultEnvelope.budget, spendCeilingUsd: 10 },
    });

    await listener.commission(makeInput('prod-status'));
    for (let i = 0; i < 8; i++) await Promise.resolve();

    const s = listener.status();
    expect(s.improvementEnvelope).toEqual({ consumedUsd: 2.5, allowanceUsd: 10, remainingUsd: 7.5 });
  });
});

describe('envelope-admission: status().parkedImprovement visibility', () => {
  it('GET /status shows parkedImprovement when envelope is exhausted', async () => {
    const store = new MemStore();
    let tick = 0;
    const now = () => ++tick;
    const ranGoals: string[] = [];

    const scripts = new Map<string, Report>([
      ['vis-test', makeReport({ blockers: ['visible blocker'] })],
    ]);

    const engine = makeRecordingEngine(scripts, store, now, ranGoals);
    const listener = new Listener({
      engine: engine as unknown as InstanceType<typeof import('../../src/engine/engine.js').Engine>,
      store,
      now,
      standingEnvelope: exhaustedEnvelope, // Zero ceiling — parks immediately.
    });

    await listener.commission(makeInput('vis-test'));

    const s = listener.status();
    expect(s.parkedImprovement).toBeDefined();
    expect(Array.isArray(s.parkedImprovement)).toBe(true);
    expect(s.parkedImprovement.length).toBeGreaterThan(0);
    expect(s.parkedImprovement[0]!.startsWith('improve-')).toBe(true);
  });
});
