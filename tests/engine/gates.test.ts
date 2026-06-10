/**
 * Tests for the three engine-level enforcement points introduced by the risk
 * and authority-gate work:
 *   1. Constructor throws on an unconstitutional library.
 *   2. Gated type + no onGate handler → blocked (fail-safe).
 *   3. onGate returning 'granted' → proceeds to emit.
 *   4. High-risk scope at entry → gate fires.
 *   5. Clean scope at entry, artifact touches .env-matching path → gate fires.
 */

import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  nonLeafTypeDef,
  ScriptedBrain,
  makeGoal,
  textArtifact,
  filesArtifact,
  passVerdict,
} from './stubs.js';
import type { SensitivityFact } from '../../src/contract/risk.js';

// ── 1. Constructor throws on unconstitutional library ─────────────────────

describe('constructor — constitution check', () => {
  it('throws when a judge type has leafOnly: false', () => {
    const registry = buildRegistry([
      leafTypeDef({
        name: 'bad-judge',
        kind: 'judge',
        leafOnly: false,            // violates: judge types must be leaf-only
        tier: { default: 'haiku', ladder: ['haiku'] },
      }),
    ]);
    expect(() => new Engine({
      registry,
      brain: new ScriptedBrain(),
      store: new MemoryEventStore(),
      memory: new NoopMemoryView(),
    })).toThrow(/constitution/i);
  });

  it('does not throw for a well-formed registry', () => {
    const registry = buildRegistry([leafTypeDef()]);
    expect(() => new Engine({
      registry,
      brain: new ScriptedBrain(),
      store: new MemoryEventStore(),
      memory: new NoopMemoryView(),
    })).not.toThrow();
  });
});

// ── 2. Gated type + no onGate → blocked (fail-safe) ──────────────────────

describe('authority gate — gated type, no handler', () => {
  it('blocks without calling onGate when onGate is absent', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain(); // no produce queued — should not reach it
    const registry = buildRegistry([
      leafTypeDef({
        name: 'deploy-type',
        gated: true,               // type-level authority gate
      }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      // no onGate → defaults to 'denied'
    });

    const goal = makeGoal({ type: 'deploy-type' });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/authority gate denied/i);

    const gateEvents = await store.list({ type: 'gate-decision' });
    expect(gateEvents).toHaveLength(1);
    expect((gateEvents[0] as { resolution: string }).resolution).toBe('denied');
  });
});

// ── 3. onGate returning 'granted' → goal proceeds ────────────────────────

describe('authority gate — onGate grants', () => {
  it('allows the goal to proceed when onGate returns granted', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(textArtifact('deployed'));
    const registry = buildRegistry([
      leafTypeDef({
        name: 'deploy-type',
        gated: true,
      }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      onGate: async () => 'granted',
    });

    const goal = makeGoal({ type: 'deploy-type' });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).toEqual(textArtifact('deployed'));

    const gateEvents = await store.list({ type: 'gate-decision' });
    expect(gateEvents).toHaveLength(1);
    expect((gateEvents[0] as { resolution: string }).resolution).toBe('granted');
  });
});

// ── 4. High-risk scope at entry → gate fires ─────────────────────────────

describe('authority gate — high-risk scope at entry', () => {
  it('fires the gate when goal scope touches a high-risk sensitivity pattern', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain(); // should not reach produce

    const sensitivity: SensitivityFact[] = [
      { pattern: 'auth', reason: 'auth is sensitive', risk: 'high' },
    ];

    const registry = buildRegistry([leafTypeDef({ name: 'impl' })]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sensitivity,
      // no onGate → defaults to 'denied'
    });

    const goal = makeGoal({
      type: 'impl',
      scope: ['src/auth/session.ts'],   // high-risk scope
    });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);

    const gateEvents = await store.list({ type: 'gate-decision' });
    expect(gateEvents).toHaveLength(1);
    expect((gateEvents[0] as { resolution: string }).resolution).toBe('denied');

    const riskEvents = await store.list({ type: 'risk-classified' });
    expect(riskEvents.length).toBeGreaterThan(0);
    expect((riskEvents[0] as { risk: string }).risk).toBe('high');
  });

  it('does not fire the gate when scope is low-risk', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(textArtifact('ok'));

    const sensitivity: SensitivityFact[] = [
      { pattern: 'auth', reason: 'auth is sensitive', risk: 'high' },
    ];

    const registry = buildRegistry([leafTypeDef({ name: 'impl' })]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sensitivity,
    });

    const goal = makeGoal({
      type: 'impl',
      scope: ['src/utils/helpers.ts'],  // clean scope
    });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);

    const gateEvents = await store.list({ type: 'gate-decision' });
    expect(gateEvents).toHaveLength(0);
  });
});

// ── 5. Clean entry scope, artifact touches sensitive path → gate fires ─────

describe('authority gate — emission risk re-check', () => {
  it('fires the gate when artifact paths escape into sensitive territory', async () => {
    const store = new MemoryEventStore();

    // Artifact writes to .env — not declared in scope
    const sensitiveArtifact = filesArtifact([
      { path: 'src/components/button.tsx', content: 'ok' },
      { path: '.env.production', content: 'SECRET=leaked' },
    ]);

    const brain = new ScriptedBrain().queueProduce(sensitiveArtifact);

    const sensitivity: SensitivityFact[] = [
      { pattern: '.env', reason: 'env files carry live secrets', risk: 'high' },
    ];

    const registry = buildRegistry([leafTypeDef({ name: 'impl' })]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sensitivity,
      // no onGate → defaults to 'denied'
    });

    const goal = makeGoal({
      type: 'impl',
      scope: ['src/components/button.tsx'],   // clean scope — no .env declared
    });
    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/emission/i);

    const gateEvents = await store.list({ type: 'gate-decision' });
    expect(gateEvents).toHaveLength(1);

    // Two risk-classified events: one at entry (low), one at emission (high)
    const riskEvents = await store.list({ type: 'risk-classified' });
    expect(riskEvents.length).toBe(2);
    expect((riskEvents[0] as { risk: string }).risk).toBe('low');
    expect((riskEvents[1] as { risk: string }).risk).toBe('high');
  });

  it('does not fire at emission when artifact paths stay clean', async () => {
    const store = new MemoryEventStore();

    const cleanArtifact = filesArtifact([
      { path: 'src/components/button.tsx', content: 'ok' },
    ]);

    const brain = new ScriptedBrain().queueProduce(cleanArtifact);

    const sensitivity: SensitivityFact[] = [
      { pattern: '.env', reason: 'env files carry live secrets', risk: 'high' },
    ];

    const registry = buildRegistry([leafTypeDef({ name: 'impl' })]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sensitivity,
    });

    const goal = makeGoal({
      type: 'impl',
      scope: ['src/components/button.tsx'],
    });
    const report = await engine.run(goal);

    expect(report.blockers).toHaveLength(0);

    const gateEvents = await store.list({ type: 'gate-decision' });
    expect(gateEvents).toHaveLength(0);
  });

  it('does not re-fire the gate when entry scope was already high (already gated)', async () => {
    const store = new MemoryEventStore();
    const gateCallCount = { n: 0 };

    // Artifact also touches .env — but entry was already high-risk
    const sensitiveArtifact = filesArtifact([
      { path: '.env.production', content: 'already gated' },
    ]);

    const brain = new ScriptedBrain().queueProduce(sensitiveArtifact);

    const sensitivity: SensitivityFact[] = [
      { pattern: '.env', reason: 'env files carry live secrets', risk: 'high' },
    ];

    const registry = buildRegistry([leafTypeDef({ name: 'impl' })]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sensitivity,
      onGate: async () => {
        gateCallCount.n++;
        return 'granted';
      },
    });

    const goal = makeGoal({
      type: 'impl',
      scope: ['.env.production'],   // entry scope is already high-risk
    });
    await engine.run(goal);

    // Gate should fire exactly once (at entry), not twice
    expect(gateCallCount.n).toBe(1);
  });
});

// ── 6. risk-classified events appended ────────────────────────────────────

describe('risk-classified event logging', () => {
  it('appends a risk-classified event on every run', async () => {
    const store = new MemoryEventStore();
    const brain = new ScriptedBrain().queueProduce(textArtifact('ok'));
    const registry = buildRegistry([leafTypeDef()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
    });

    const goal = makeGoal({ scope: [] });
    await engine.run(goal);

    const riskEvents = await store.list({ type: 'risk-classified' });
    expect(riskEvents.length).toBeGreaterThan(0);
    expect((riskEvents[0] as { risk: string }).risk).toBe('low');
  });
});
