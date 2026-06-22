/**
 * Tests for the three engine-level enforcement points introduced by the risk
 * and authority-gate work:
 *   1. Constructor throws on an unconstitutional library.
 *   2. Gated type + no onGate handler → blocked (fail-safe).
 *   3. onGate returning 'granted' → proceeds to emit.
 *   4. High-risk scope at entry → gate fires.
 *   5. Clean scope at entry, artifact touches .env-matching path → gate fires.
 * Plus coverage-gate tests :
 *   7. Missing knowledge → map-repo children spawned; all siblings depend on them.
 *   8. Fresh knowledge → gate passes, no extra children, no extra brain calls.
 *   9. Region-dive miss for code leaf → deep-dive-region dependency injected.
 *  10. SHA-drift + validate-pass → stale-validated event, proceed.
 *  11. SHA-drift + validate-fail → invalid event, refresh child injected.
 *  12. Learn-kind goals exempt from coverage gate.
 *  13. No knowledge wiring → byte-identical behavior (regression guard).
 * New gate tests (/3/5):
 *  14. injection-blows-validateSplit → blocked, not silently over-subdivided.
 *  15. double-spawn exact-count → stale+invalid category spawns EXACTLY one child.
 *  16. no-sandbox-with-knowledge → gate skipped, zero gate-checked events.
 *  17. fresh-pass brain-call count unchanged vs baseline (tightened).
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
import type { SandboxAssembly } from '../../src/engine/assembly.js';

// ── Fake sandbox assembly (for gate tests that require an active sandbox) ─────
// the coverage gate requires an active sandbox/assembly to obtain a
// real repoRoot. Tests that exercise gate behavior must inject a fake assembly.

function fakeAssembly(repoRoot = '/repo'): SandboxAssembly {
  return {
    broker: {
      async execute() {
        return { callId: 'x', ok: false, output: 'fakeAssembly: not used' };
      },
    },
    worktree: {
      treeId: 'test-tree',
      branch: 'test-branch',
      root: repoRoot,
      repoRoot,
      goalId: 'root',
    },
    checkContextFor(_goalId: string) {
      return undefined as never;
    },
  };
}

function injectAssembly(engine: Engine, assembly: SandboxAssembly): void {
  (engine as unknown as { _activeAssembly: SandboxAssembly })._activeAssembly = assembly;
}

// ── 1. Constructor throws on unconstitutional library ─────────────────────

describe('constructor — constitution check', () => {
  it('throws when a judge type has leafOnly: false', () => {
    const registry = buildRegistry([
      leafTypeDef({
        name: 'bad-judge',
        kind: 'judge',
        leafOnly: false,            // violates: judge types must be leaf-only
        tier: { default: 'low', ladder: ['low'] },
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
  // Existence of scope regions in the working tree (ADR-029 Decision 2). These
  // gate tests run against a fake repoRoot ('/repo') that has no real files, so
  // existence is injected. Default true: the regions these tests scope are
  // conceptually present (they predate the existence signal and validate the
  // dive logic itself). A test exercising greenfield/new-scope suppression
  // passes a predicate that returns false.
  regionExists: (repoRoot: string, region: string) => boolean = () => true,
): NonNullable<ConstructorParameters<typeof Engine>[0]['knowledge']> {
  const mintedChildren: ChildPlan[] = [];
  return {
    async query(_repoRoot: string) { return knowledge; },
    async headSha(_repoRoot: string) { return knowledge.headSha; },
    async validate(_artifact: KnowledgeArtifact) { return validateResult; },
    regionExists,
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
  it('spawns map-repo children and all siblings depend on them', async () => {
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
    injectAssembly(engine, fakeAssembly());

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
  it('gate passes with ok:true and no comprehension children', async () => {
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
    injectAssembly(engine, fakeAssembly());

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
  it('injects deep-dive-region child for leaf scope with no dive', async () => {
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
    injectAssembly(engine, fakeAssembly());

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
  it('emits stale-validated and proceeds without refresh child (pass path)', async () => {
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
    injectAssembly(engine, fakeAssembly());

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
  it('emits invalid and injects refresh child as dependency (fail path)', async () => {
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
    injectAssembly(engine, fakeAssembly());

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
  it('learn goals with no knowledge still pass the gate', async () => {
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
    injectAssembly(engine, fakeAssembly());

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

// ── 13. No knowledge wiring → byte-identical (regression guard) ────────

describe('coverage gate — knowledge-absent regression guard', () => {
  it('no knowledge wiring = no gate-checked events, no extra children', async () => {
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

// ── 14. injection-blows-validateSplit → blocked, not silently over-subdivided

describe('coverage gate — injection that exceeds attempt budget is blocked', () => {
  it('blocks when minted children push fan-out over attempt budget ()', async () => {
    const store = new MemoryEventStore();

    // Brain proposes 2 children with budgetShare ~0.5 each; budget.attempts = 3
    // Minting 2 comprehension children will push total to 4, exceeding attempts=3
    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child A', spec: {}, dependsOn: [], scope: [], budgetShare: 0.4 },
        { localId: 'b', type: 'leaf', title: 'child B', spec: {}, dependsOn: [], scope: [], budgetShare: 0.4 },
      ],
    };

    const brain = new ScriptedBrain().queueDecide(splitDecision);

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'map-repo' }),
    ]);

    // Empty knowledge → 2 comprehension children will be minted (architecture + stack)
    // 2 original + 2 minted = 4 children > attempts=3 → structural error
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(emptyKnowledge()),
    });
    injectAssembly(engine, fakeAssembly());

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 3, tokens: 10000, toolCalls: 100, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    // Must block — not silently proceed with over-budget fan-out
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers[0]).toMatch(/coverage.*(injection|invalid|structural)/i);
  });
});

describe('coverage gate — injection renormalizes budgetShares instead of blocking', () => {
  it('does not block when injected comprehension children push the share sum past 1', async () => {
    const store = new MemoryEventStore();

    // Brain children already sum their shares to 1.0. The coverage gate injects
    // two comprehension children at 0.1 each → raw sum 1.2 > 1. Before the
    // renormalization fix this failed the structural rule
    // ("budgetShares sum to 1.2000, must be ≤ 1") and blocked the whole split;
    // now the shares are scaled to sum to 1 and the run proceeds.
    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child A', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
        { localId: 'b', type: 'leaf', title: 'child B', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('A'))
      .queueProduce(textArtifact('B'))
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
    injectAssembly(engine, fakeAssembly());

    // attempts high enough that the count rule is satisfied — only the
    // share-sum rule is under test here.
    const goal = makeGoal({ type: 'splitter', budget: { attempts: 10, tokens: 10000, toolCalls: 100, wallClockMs: 60000 } });
    const report = await engine.run(goal);

    // No structural block — the over-1 share sum was renormalized, not rejected.
    expect(report.blockers).toHaveLength(0);
    const spawnEvents = await store.list({ type: 'child-spawned' });
    const childTypes = spawnEvents.map((e) => (e as { childType: string }).childType);
    expect(childTypes).toContain('map-repo');
  });
});

// ── 15. double-spawn exact-count — stale+invalid category → EXACTLY one child

describe('coverage gate — invalid category yields exactly one refresh child', () => {
  it('spawns exactly one map-repo child for an invalid stale category ()', async () => {
    const store = new MemoryEventStore();

    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child A', spec: {}, dependsOn: [], scope: [], budgetShare: 0.3 },
      ],
    };

    const brain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('refreshed'))
      .queueProduce(textArtifact('done'));

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
      leafTypeDef({ name: 'map-repo' }),
    ]);

    // architecture is stale and invalid (validate=false); stack is fresh.
    // Without , checkpointVerifyArtifacts mints one refresh child for
    // architecture AND coverageCheck would flag architecture as missing and
    // mintComprehension would mint a second child — two children for the same
    // category. must ensure only one map-repo child is spawned.
    const staleInvalidKnowledge: KnowledgeForCoverage = {
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
      knowledge: knowledgeWiring(staleInvalidKnowledge, false), // validate=false → invalid
    });
    injectAssembly(engine, fakeAssembly());

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 10, tokens: 10000, toolCalls: 100, wallClockMs: 60000 },
    });
    await engine.run(goal);

    // Exactly one map-repo child must be spawned for the architecture category
    const spawnEvents = await store.list({ type: 'child-spawned' });
    const mapRepoChildren = spawnEvents.filter(
      (e) => (e as { childType: string }).childType === 'map-repo',
    );
    expect(mapRepoChildren).toHaveLength(1);
  });
});

// ── 16. no-sandbox-with-knowledge → gate skipped, zero gate-checked events

describe('coverage gate — no sandbox skips gate entirely', () => {
  it('skips gate when knowledge is wired but no sandbox is active ()', async () => {
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

    // Knowledge wired but NO sandbox injected — gate must be skipped entirely
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(emptyKnowledge()),
      // no sandbox option → _activeAssembly stays undefined
    });
    // Deliberately NOT calling injectAssembly

    const goal = makeGoal({
      type: 'splitter',
      budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 },
    });
    const report = await engine.run(goal);

    // Gate skipped → no gate-checked events emitted
    const gateEvents = await store.list({ type: 'gate-checked' });
    expect(gateEvents).toHaveLength(0);

    // No knowledge-checked events either
    const checkedEvents = await store.list({ type: 'knowledge-checked' });
    expect(checkedEvents).toHaveLength(0);

    // Split proceeds normally (knowledge gaps ignored without sandbox)
    expect(report.blockers).toHaveLength(0);
  });
});

// ── 17. fresh-pass asserts brain call count unchanged vs baseline

describe('coverage gate — fresh knowledge does not add brain calls vs no-wiring baseline', () => {
  it('brain call count with fresh knowledge equals baseline (tightened)', async () => {
    const splitDecision = {
      kind: 'split' as const,
      children: [
        { localId: 'a', type: 'leaf', title: 'child', spec: {}, dependsOn: [], scope: [], budgetShare: 0.5 },
      ],
    };

    const registry = buildRegistry([
      nonLeafTypeDef({ name: 'splitter' }),
      leafTypeDef({ name: 'leaf' }),
    ]);

    // Baseline: no knowledge wiring
    let baselineCalls = 0;
    const baseBrain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('done'));
    const origDecide = baseBrain.decide.bind(baseBrain);
    baseBrain.decide = async (...args) => { baselineCalls++; return origDecide(...args); };

    const baseEngine = new Engine({
      registry,
      brain: baseBrain,
      store: new MemoryEventStore(),
      memory: new NoopMemoryView(),
    });

    await baseEngine.run(makeGoal({
      type: 'splitter',
      budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 },
    }));

    // With fresh knowledge: should produce identical brain call count
    let wiredCalls = 0;
    const wiredBrain = new ScriptedBrain()
      .queueDecide(splitDecision)
      .queueProduce(textArtifact('done'));
    const origDecide2 = wiredBrain.decide.bind(wiredBrain);
    wiredBrain.decide = async (...args) => { wiredCalls++; return origDecide2(...args); };

    const wiredEngine = new Engine({
      registry,
      brain: wiredBrain,
      store: new MemoryEventStore(),
      memory: new NoopMemoryView(),
      knowledge: knowledgeWiring(freshKnowledge()),
    });
    injectAssembly(wiredEngine, fakeAssembly());

    await wiredEngine.run(makeGoal({
      type: 'splitter',
      budget: { attempts: 5, tokens: 10000, toolCalls: 50, wallClockMs: 60000 },
    }));

    expect(wiredCalls).toBe(baselineCalls);
  });
});
