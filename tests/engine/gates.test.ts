/**
 * Tests for the three engine-level enforcement points introduced by the risk
 * and authority-gate work:
 *   1. Constructor throws on an unconstitutional library.
 *   2. Gated type + no onGate handler → blocked (fail-safe).
 *   3. onGate returning 'granted' → proceeds to emit.
 *   4. High-risk scope at entry → gate fires.
 *   5. Clean scope at entry, artifact touches .env-matching path → gate fires.
 * Plus coverage-gate tests (F-45):
 *   7. Missing knowledge → map-repo children spawned; all siblings depend on them.
 *   8. Fresh knowledge → gate passes, no extra children, no extra brain calls.
 *   9. Region-dive miss for code leaf → deep-dive-region dependency injected.
 *  10. SHA-drift + validate-pass → stale-validated event, proceed.
 *  11. SHA-drift + validate-fail → invalid event, refresh child injected.
 *  12. Learn-kind goals exempt from coverage gate.
 *  13. No knowledge wiring → byte-identical behavior (regression guard).
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
import type { KnowledgeForCoverage } from '../../src/library/coverage.js';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { KnowledgeArtifact } from '../../src/contract/knowledge.js';

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

// ── Coverage gate helper factories ────────────────────────────────────────────

const HEAD_SHA = 'headsha1';

function freshKnowledge(): KnowledgeForCoverage {
  return {
    headSha: HEAD_SHA,
    artifacts: [
      { category: 'architecture', generatedAtSha: HEAD_SHA, repoRoot: '' },
      { category: 'stack', generatedAtSha: HEAD_SHA, repoRoot: '' },
      { category: 'conventions', generatedAtSha: HEAD_SHA, repoRoot: '' },
    ],
    regionFacts: [],
  };
}

function emptyKnowledge(): KnowledgeForCoverage {
  return { headSha: HEAD_SHA, artifacts: [], regionFacts: [] };
}

function knowledgeWiring(
  knowledge: KnowledgeForCoverage,
  validateResult = true,
): NonNullable<ConstructorParameters<typeof Engine>[0]['knowledge']> {
  const mintedChildren: ChildPlan[] = [];
  return {
    async query(_repoRoot: string) { return knowledge; },
    async headSha(_repoRoot: string) { return knowledge.headSha; },
    async validate(_artifact: KnowledgeArtifact) { return validateResult; },
    mintComprehension(missing) {
      const children: ChildPlan[] = missing.map((m, i) => ({
        localId: `comprehension-${m.region ?? m.category}-${i}`,
        type: m.region !== undefined ? 'deep-dive-region' : 'map-repo',
        title: m.region !== undefined
          ? `Deep-dive region ${m.region}`
          : `Map repo for ${m.category}`,
        spec: {},
        dependsOn: [],
        scope: [],
        budgetShare: 0.1,
      }));
      mintedChildren.push(...children);
      return children;
    },
  };
}

// ── 7. Missing knowledge → map-repo children spawned; siblings depend on them ─

describe('coverage gate — missing knowledge spawns map-repo children', () => {
  it('spawns map-repo children and all siblings depend on them (AC-1)', async () => {
    const store = new MemoryEventStore();

    // Two leaf children the brain proposes
    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child A', spec: {}, dependsOn: [], scope: [], budgetShare: 0.3 },
        { localId: 'b', type: 'leaf', title: 'child B', spec: {}, dependsOn: [], scope: [], budgetShare: 0.3 },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      // Both leaf children will run and produce
      .queueProduce(textArtifact('A'))
      .queueProduce(textArtifact('B'))
      // map-repo children also produce
      .queueProduce(textArtifact('map-arch'))
      .queueProduce(textArtifact('map-stack'));

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'map-repo' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(emptyKnowledge()),
    });

    const goal = makeGoal({ type: 'splitter', budget: { attempts: 10, tokens: 10000, toolCalls: 100, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // Gate-checked event should exist with ok: false
    const gateEvents = await store.list({ type: 'gate-checked' });
    expect(gateEvents.length).toBeGreaterThan(0);
    const gateEvent = gateEvents[0] as { ok: boolean; missing: string[] };
    expect(gateEvent.ok).toBe(false);
    expect(gateEvent.missing.length).toBeGreaterThan(0);

    // child-spawned events should include comprehension children
    const spawnEvents = await store.list({ type: 'child-spawned' });
    const childTypes = spawnEvents.map((e) => (e as { childType: string }).childType);
    expect(childTypes).toContain('map-repo');

    // Each original child ('a', 'b') should depend on the comprehension child(ren)
    // The child-spawned events for the original children should have dependsOn
    // that includes the comprehension children's ids
    const comprChildIds = spawnEvents
      .filter((e) => (e as { childType: string }).childType === 'map-repo')
      .map((e) => (e as { childId: string }).childId);

    const origChildSpawns = spawnEvents.filter(
      (e) => ['leaf'].includes((e as { childType: string }).childType),
    );

    for (const spawn of origChildSpawns) {
      const deps = (spawn as { dependsOn: string[] }).dependsOn;
      for (const comprId of comprChildIds) {
        expect(deps).toContain(comprId);
      }
    }

    expect(report.blockers).toHaveLength(0);
  });
});

// ── 8. Fresh knowledge → gate passes, no extra children ─────────────────────

describe('coverage gate — fresh knowledge passes without extra brain calls', () => {
  it('gate passes with ok:true and no comprehension children (AC-2)', async () => {
    const store = new MemoryEventStore();

    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child A', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
      ],
    };

    let brainCallCount = 0;
    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('done'));

    const originalDecide = brain.decide.bind(brain);
    brain.decide = async (...args) => {
      brainCallCount++;
      return originalDecide(...args);
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // Fresh knowledge satisfying root-split (architecture + stack)
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(freshKnowledge()),
    });

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 },
    });
    await engine.run(goal);

    const gateEvents = await store.list({ type: 'gate-checked' });
    expect(gateEvents.length).toBeGreaterThan(0);
    const gateEvent = gateEvents[0] as { ok: boolean; missing: string[] };
    expect(gateEvent.ok).toBe(true);
    expect(gateEvent.missing).toHaveLength(0);

    // Only 1 brain decide call (the split itself) — no extra for gate
    expect(brainCallCount).toBe(1);

    // No map-repo children spawned
    const spawnEvents = await store.list({ type: 'child-spawned' });
    const childTypes = spawnEvents.map((e) => (e as { childType: string }).childType);
    expect(childTypes).not.toContain('map-repo');
  });
});

// ── 9. Region-dive miss for code leaf ────────────────────────────────────────

describe('coverage gate — region-dive miss for code leaf', () => {
  it('injects deep-dive-region child for leaf scope with no dive (AC-3)', async () => {
    const store = new MemoryEventStore();

    const splitDecision = {
      kind: 'split' as const,
      children: [
        {
          localId: 'impl',
          type: 'leaf',
          title: 'implement payment',
          spec: {},
          dependsOn: [],
          scope: ['src/payments'],   // scope region needing a dive
          budgetShare: 0.5,
        },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('done'))   // deep-dive child
      .queueProduce(textArtifact('impl'));  // impl child

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'deep-dive-region' }),
    ]);

    // Knowledge has architecture + conventions (fresh) but no region facts
    const knowledge: KnowledgeForCoverage = {
      headSha: HEAD_SHA,
      artifacts: [
        { category: 'architecture', generatedAtSha: HEAD_SHA, repoRoot: '' },
        { category: 'conventions', generatedAtSha: HEAD_SHA, repoRoot: '' },
      ],
      regionFacts: [],
    };

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(knowledge),
    });

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 10, tokens: 10000, toolCalls: 100, wallClockMs: 60000 },
    });
    await engine.run(goal);

    const spawnEvents = await store.list({ type: 'child-spawned' });
    const childTypes = spawnEvents.map((e) => (e as { childType: string }).childType);
    expect(childTypes).toContain('deep-dive-region');

    // The impl child depends on the deep-dive child
    const diveChildren = spawnEvents.filter(
      (e) => (e as { childType: string }).childType === 'deep-dive-region',
    ).map((e) => (e as { childId: string }).childId);

    const implSpawn = spawnEvents.find(
      (e) => (e as { childType: string }).childType === 'leaf',
    );
    expect(implSpawn).toBeDefined();
    const implDeps = (implSpawn as { dependsOn: string[] }).dependsOn;
    for (const diveId of diveChildren) {
      expect(implDeps).toContain(diveId);
    }
  });
});

// ── 10. SHA-drift + validate-pass → stale-validated ──────────────────────────

describe('coverage gate — SHA-drift validate-pass path', () => {
  it('emits stale-validated and proceeds without refresh child (AC-4 pass path)', async () => {
    const store = new MemoryEventStore();

    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child A', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('done'));

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // Stale artifact (SHA mismatch) — validate returns true (still good)
    const staleKnowledge: KnowledgeForCoverage = {
      headSha: HEAD_SHA,
      artifacts: [
        { category: 'architecture', generatedAtSha: 'old-sha', repoRoot: '' },
        { category: 'stack', generatedAtSha: HEAD_SHA, repoRoot: '' },
      ],
      regionFacts: [],
    };

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(staleKnowledge, true), // validate returns true
    });

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 },
    });
    await engine.run(goal);

    const checkedEvents = await store.list({ type: 'knowledge-checked' });
    expect(checkedEvents.length).toBeGreaterThan(0);
    const staleValidated = checkedEvents.find(
      (e) => (e as { outcome: string }).outcome === 'stale-validated',
    );
    expect(staleValidated).toBeDefined();

    // No refresh (map-repo) children spawned for the stale artifact
    const spawnEvents = await store.list({ type: 'child-spawned' });
    const childTypes = spawnEvents.map((e) => (e as { childType: string }).childType);
    expect(childTypes).not.toContain('map-repo');
  });
});

// ── 11. SHA-drift + validate-fail → refresh child injected ──────────────────

describe('coverage gate — SHA-drift validate-fail path', () => {
  it('emits invalid and injects refresh child as dependency (AC-4 fail path)', async () => {
    const store = new MemoryEventStore();

    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child A', spec: {}, dependsOn: [], scope: [], budgetShare: 0.3 },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('refresh'))   // refresh child
      .queueProduce(textArtifact('done'));      // original child

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'map-repo' }),
    ]);

    // Stale artifact — validate returns false (needs refresh)
    const staleKnowledge: KnowledgeForCoverage = {
      headSha: HEAD_SHA,
      artifacts: [
        { category: 'architecture', generatedAtSha: 'very-old-sha', repoRoot: '' },
        { category: 'stack', generatedAtSha: HEAD_SHA, repoRoot: '' },
      ],
      regionFacts: [],
    };

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(staleKnowledge, false), // validate returns false
    });

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 10, tokens: 10000, toolCalls: 100, wallClockMs: 60000 },
    });
    await engine.run(goal);

    // Invalid event must be emitted
    const checkedEvents = await store.list({ type: 'knowledge-checked' });
    const invalidEvent = checkedEvents.find(
      (e) => (e as { outcome: string }).outcome === 'invalid',
    );
    expect(invalidEvent).toBeDefined();

    // Refresh child (map-repo) must be spawned
    const spawnEvents = await store.list({ type: 'child-spawned' });
    const childTypes = spawnEvents.map((e) => (e as { childType: string }).childType);
    expect(childTypes).toContain('map-repo');

    // Original child must depend on the refresh child
    const refreshIds = spawnEvents
      .filter((e) => (e as { childType: string }).childType === 'map-repo')
      .map((e) => (e as { childId: string }).childId);

    const origSpawn = spawnEvents.find(
      (e) => (e as { childType: string }).childType === 'leaf',
    );
    expect(origSpawn).toBeDefined();
    const origDeps = (origSpawn as { dependsOn: string[] }).dependsOn;
    for (const rId of refreshIds) {
      expect(origDeps).toContain(rId);
    }
  });
});

// ── 12. Learn-kind goals exempt ───────────────────────────────────────────────

describe('coverage gate — learn-kind exemption', () => {
  it('learn goals with no knowledge still pass the gate (AC-5)', async () => {
    const store = new MemoryEventStore();

    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'learn child', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('learned'));

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'map-repo', kind: 'learn' }),
      leafTypeDef({ name: 'leaf', kind: 'learn' }),
    ]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(emptyKnowledge()),
    });

    const goal = makeGoal({
      type: 'map-repo',
      budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 },
    });
    await engine.run(goal);

    // Gate-checked event should have ok: true for learn goals
    const gateEvents = await store.list({ type: 'gate-checked' });
    expect(gateEvents.length).toBeGreaterThan(0);
    const gateEvent = gateEvents[0] as { ok: boolean };
    expect(gateEvent.ok).toBe(true);

    // No comprehension children spawned
    const spawnEvents = await store.list({ type: 'child-spawned' });
    const childTypes = spawnEvents.map((e) => (e as { childType: string }).childType);
    expect(childTypes).not.toContain('map-repo');
  });
});

// ── 13. No knowledge wiring → byte-identical (regression guard, AC-6) ────────

describe('coverage gate — knowledge-absent regression guard', () => {
  it('no knowledge wiring = no gate-checked events, no extra children (AC-6)', async () => {
    const store = new MemoryEventStore();

    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('done'));

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // No knowledge option at all
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      // knowledge: undefined  ← deliberately absent
    });

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    // No gate-checked events
    const gateEvents = await store.list({ type: 'gate-checked' });
    expect(gateEvents).toHaveLength(0);

    // No knowledge-checked events
    const checkedEvents = await store.list({ type: 'knowledge-checked' });
    expect(checkedEvents).toHaveLength(0);

    // Report succeeds normally
    expect(report.blockers).toHaveLength(0);
  });
});
