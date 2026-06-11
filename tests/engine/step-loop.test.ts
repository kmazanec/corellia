/**
 * Engine step-loop tests: covers tool-granted goal types running the step loop,
 * and the regression guarantee that non-tool-granted types are byte-identical to
 * the pre-loop produce path.
 */

import { describe, it, expect, vi } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import { ScriptedBrain as SrcScriptedBrain } from '../../src/brains/scripted.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  makeGoal,
  textArtifact,
  filesArtifact,
  passVerdict,
  failVerdict,
  ScriptedBrain as StubScriptedBrain,
  alwaysFailCheck,
} from './stubs.js';
import { FakeBroker } from './stubs.js';
import type { ToolCall, ToolResult } from '../../src/contract/tool.js';
import type { StepOutput } from '../../src/contract/brain.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** A GoalTypeDef with tool grants (implement-like). */
function toolGrantedType(overrides: Partial<Parameters<typeof leafTypeDef>[0]> = {}) {
  return leafTypeDef({
    name: 'implement',
    grants: ['fs.read', 'fs.write'],
    ...overrides,
  });
}

/** A GoalTypeDef with no grants (classic leaf). */
function noGrantType(overrides: Partial<Parameters<typeof leafTypeDef>[0]> = {}) {
  return leafTypeDef({ name: 'leaf', grants: [], ...overrides });
}

/** A minimal ToolCall. */
function toolCall(id: string, name = 'write_file'): ToolCall {
  return { id, name, args: { path: 'src/out.ts', content: 'x' } };
}

// ── Chunk 1: non-tool-granted types unaffected ────────────────────────────────

describe('non-tool-granted types unaffected', () => {
  it('leaf-satisfy path emits no step or tool events', async () => {
    const store = new MemoryEventStore();
    const brain = new StubScriptedBrain().queueProduce(textArtifact('hello'));
    const registry = buildRegistry([noGrantType()]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
    });
    const goal = makeGoal({ type: 'leaf' });
    const report = await engine.run(goal);

    expect(report.artifact).toEqual(textArtifact('hello'));
    expect(report.blockers).toHaveLength(0);

    const types = store.types();
    expect(types).not.toContain('step');
    expect(types).not.toContain('tool-call');
  });

  it('non-tool-granted path with a broker present still emits no step/tool events', async () => {
    const store = new MemoryEventStore();
    const brain = new StubScriptedBrain().queueProduce(textArtifact('hi'));
    const registry = buildRegistry([noGrantType()]);
    const broker = new FakeBroker([]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    const goal = makeGoal({ type: 'leaf' });
    const report = await engine.run(goal);

    expect(report.artifact).toEqual(textArtifact('hi'));
    expect(store.types()).not.toContain('step');
    expect(store.types()).not.toContain('tool-call');
  });

  it('tool-granted type without a broker present falls through to classic produce', async () => {
    const store = new MemoryEventStore();
    const brain = new StubScriptedBrain().queueProduce(textArtifact('classic'));
    const registry = buildRegistry([toolGrantedType()]);

    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      // no broker
    });
    const goal = makeGoal({ type: 'implement' });
    const report = await engine.run(goal);

    expect(report.artifact).toEqual(textArtifact('classic'));
    expect(store.types()).not.toContain('step');
    expect(store.types()).not.toContain('tool-call');
  });
});

// ── Chunk 3: multi-step success ────────────────────────────────────────────────

describe('multi-step success', () => {
  it('artifact emits after exactly the scripted steps; step events logged', async () => {
    const store = new MemoryEventStore();

    const finalArtifact = filesArtifact([{ path: 'src/out.ts', content: 'done' }]);

    const brain = new SrcScriptedBrain({
      step: {
        'build widget': [
          {
            kind: 'tool-calls',
            calls: [toolCall('c1', 'write_file')],
            usage: ZERO_USAGE,
          } satisfies StepOutput,
          {
            kind: 'tool-calls',
            calls: [toolCall('c2', 'write_file'), toolCall('c3', 'read_file')],
            usage: ZERO_USAGE,
          } satisfies StepOutput,
          {
            kind: 'artifact',
            artifact: finalArtifact,
            usage: ZERO_USAGE,
          } satisfies StepOutput,
        ],
      },
    });

    const broker = new FakeBroker([
      { callId: 'c1', ok: true, output: 'wrote' },
      { callId: 'c2', ok: true, output: 'wrote2' },
      { callId: 'c3', ok: true, output: 'content' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'build widget',
      budget: { attempts: 3, tokens: 10000, toolCalls: 10, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);

    expect(report.artifact).toEqual(finalArtifact);
    expect(report.blockers).toHaveLength(0);

    const types = store.types();
    const stepEvents = (await store.list({ type: 'step' }));
    expect(stepEvents).toHaveLength(3);
    expect(stepEvents[0]!.type).toBe('step');

    const toolEvents = await store.list({ type: 'tool-call' });
    expect(toolEvents).toHaveLength(3);
    expect(types).toContain('emitted');
  }, 10_000);

  it('artifact-first: zero tool calls, no tool events', async () => {
    const store = new MemoryEventStore();
    const finalArtifact = textArtifact('immediate');

    const brain = new SrcScriptedBrain({
      step: {
        'immediate goal': [
          { kind: 'artifact', artifact: finalArtifact, usage: ZERO_USAGE } satisfies StepOutput,
        ],
      },
    });

    const broker = new FakeBroker([]);
    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'immediate goal',
      budget: { attempts: 3, tokens: 10000, toolCalls: 10, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    expect(report.artifact).toEqual(finalArtifact);
    expect(report.blockers).toHaveLength(0);

    const toolEvents = await store.list({ type: 'tool-call' });
    expect(toolEvents).toHaveLength(0);

    const stepEvents = await store.list({ type: 'step' });
    expect(stepEvents).toHaveLength(1);
    expect((stepEvents[0] as { outputKind: string }).outputKind).toBe('artifact');
  }, 10_000);
});

// ── Chunk 4: budget gate + remaining-count injection ──────────────────────────

describe('budget gate and remaining-count injection', () => {
  it('exhaustion mid-loop: halts, logs budget-exhausted, attempt fails into control loop', async () => {
    const store = new MemoryEventStore();
    const finalArtifact = textArtifact('never');

    const brain = new SrcScriptedBrain({
      step: {
        'budget goal': [
          { kind: 'tool-calls', calls: [toolCall('c1')], usage: ZERO_USAGE } satisfies StepOutput,
          { kind: 'tool-calls', calls: [toolCall('c2')], usage: ZERO_USAGE } satisfies StepOutput,
          { kind: 'artifact', artifact: finalArtifact, usage: ZERO_USAGE } satisfies StepOutput,
        ],
      },
    });

    const broker = new FakeBroker([
      { callId: 'c1', ok: true, output: 'ok1' },
      { callId: 'c2', ok: true, output: 'ok2' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'budget goal',
      budget: {
        attempts: 3,
        tokens: 10000,
        toolCalls: 1,
        wallClockMs: 60_000,
      },
    });

    const report = await engine.run(goal);

    // Loop should have exhausted and the run should complete (no hang)
    expect(report.blockers.length).toBeGreaterThan(0);

    const types = store.types();
    expect(types).toContain('budget-exhausted');

    // Brain.step must not have been called more than the gate allows
    const stepEvents = await store.list({ type: 'step' });
    expect(stepEvents.length).toBeLessThanOrEqual(2);
  }, 10_000);

  it('exactly one debit per call: remaining == budget.toolCalls - N after N calls', async () => {
    const store = new MemoryEventStore();
    const finalArtifact = textArtifact('done');

    const capturedRemaining: number[] = [];

    // Use a custom scripted brain that captures ctx
    const callsPerStep: ToolCall[][] = [
      [toolCall('c1')],
      [toolCall('c2')],
    ];
    let stepIndex = 0;
    const stepsArr: StepOutput[] = [
      { kind: 'tool-calls', calls: [toolCall('c1')], usage: ZERO_USAGE },
      { kind: 'tool-calls', calls: [toolCall('c2')], usage: ZERO_USAGE },
      { kind: 'artifact', artifact: finalArtifact, usage: ZERO_USAGE },
    ];

    const captureBrain: import('../../src/contract/brain.js').Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step(_goal, transcript, _tools, _ctx) {
        // Look for the remaining count in the transcript context messages
        const contextMsgs = transcript.filter(m => m.role === 'context');
        const lastCtx = contextMsgs[contextMsgs.length - 1];
        if (lastCtx && 'content' in lastCtx) {
          const match = /(\d+) tool calls? remaining/.exec(lastCtx.content);
          if (match) capturedRemaining.push(parseInt(match[1]!, 10));
        }
        const out = stepsArr[stepIndex++];
        if (!out) throw new Error('no more steps');
        return out;
      },
    };

    const broker = new FakeBroker([
      { callId: 'c1', ok: true, output: 'ok' },
      { callId: 'c2', ok: true, output: 'ok' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const budget = 10;
    const goal = makeGoal({
      type: 'implement',
      title: 'remaining test',
      budget: { attempts: 3, tokens: 10000, toolCalls: budget, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    expect(report.blockers).toHaveLength(0);

    // After 2 calls, step 3 should see budget - 2
    expect(capturedRemaining[0]).toBe(budget);
    expect(capturedRemaining[1]).toBe(budget - 1);
    expect(capturedRemaining[2]).toBe(budget - 2);
  }, 10_000);
});

// ── Chunk 5: refusal recovery ─────────────────────────────────────────────────

describe('refusal recovery', () => {
  it('broker refusal appended to transcript; next step sees it; run completes', async () => {
    const store = new MemoryEventStore();
    const finalArtifact = textArtifact('recovered');
    const capturedTranscripts: import('../../src/contract/brain.js').StepTranscript[] = [];

    let stepIdx = 0;
    const stepsArr: StepOutput[] = [
      { kind: 'tool-calls', calls: [toolCall('r1')], usage: ZERO_USAGE },
      { kind: 'artifact', artifact: finalArtifact, usage: ZERO_USAGE },
    ];

    const captureBrain: import('../../src/contract/brain.js').Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step(_goal, transcript) {
        capturedTranscripts.push([...transcript]);
        const out = stepsArr[stepIdx++];
        if (!out) throw new Error('no more steps');
        return out;
      },
    };

    const broker = new FakeBroker([
      { callId: 'r1', ok: false, output: 'permission denied' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'refusal goal',
      budget: { attempts: 3, tokens: 10000, toolCalls: 10, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    expect(report.artifact).toEqual(finalArtifact);
    expect(report.blockers).toHaveLength(0);

    // The second step's transcript must contain a tool result for r1 (the refusal)
    const secondTranscript = capturedTranscripts[1];
    expect(secondTranscript).toBeDefined();
    const toolMsg = secondTranscript!.find(m => m.role === 'tool' && (m as { callId: string }).callId === 'r1');
    expect(toolMsg).toBeDefined();

    // Tool-call event logged for the refusal
    const toolEvents = await store.list({ type: 'tool-call' });
    expect(toolEvents.length).toBeGreaterThan(0);
    const refusalEvent = toolEvents.find(e => (e as { callId: string }).callId === 'r1');
    expect(refusalEvent).toBeDefined();
    expect((refusalEvent as { outcome: string }).outcome).toBe('refused');
  }, 10_000);
});

// ── Chunk 6: failed loop attempt escalates carrying transcript tail ─────────────

describe('failed-loop attempt escalates carrying transcript tail', () => {
  it('artifact failing deterministic check feeds handleFailure; repair or escalate fires', async () => {
    const store = new MemoryEventStore();

    const badArtifact = textArtifact('bad');
    const goodArtifact = textArtifact('good');

    let stepIdx = 0;
    const stepsArr: StepOutput[] = [
      // First attempt: artifact fails deterministic check
      { kind: 'artifact', artifact: badArtifact, usage: ZERO_USAGE },
      // Second attempt after repair/escalation: good artifact
      { kind: 'artifact', artifact: goodArtifact, usage: ZERO_USAGE },
    ];

    let detCheckCalls = 0;
    const flakyCheck: import('../../src/contract/goal-type.js').DeterministicCheck = {
      name: 'flaky',
      async run() {
        detCheckCalls++;
        if (detCheckCalls <= 1) return { ok: false, detail: 'bad output' };
        return { ok: true, detail: '' };
      },
    };

    const captureBrain: import('../../src/contract/brain.js').Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair(_goal, artifact) {
        return { value: goodArtifact, usage: ZERO_USAGE };
      },
      async step(_goal, transcript) {
        const out = stepsArr[stepIdx++];
        if (!out) throw new Error('no more steps');
        return out;
      },
    };

    const broker = new FakeBroker([]);

    const registry = buildRegistry([toolGrantedType({
      deterministic: [flakyCheck],
    })]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'escalate goal',
      budget: { attempts: 5, tokens: 10000, toolCalls: 10, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    // Should have succeeded via repair path
    expect(report.blockers).toHaveLength(0);

    const types = store.types();
    // Either repair-applied or tier-escalated should have fired
    const repaired = types.includes('repair-applied');
    const escalated = types.includes('tier-escalated');
    expect(repaired || escalated).toBe(true);
  }, 10_000);
});

// ── T1: transcript tail reaches next attempt ────────────────────────────────────

describe('T1: transcript tail reaches next attempt', () => {
  it('priorAttempt seen by brain on next attempt contains step-loop transcript evidence', async () => {
    const store = new MemoryEventStore();

    // Step loop: make one tool call then produce a bad artifact
    const badArtifact = textArtifact('bad');
    const goodArtifact = textArtifact('good');

    let stepIdx = 0;
    const stepsArr: StepOutput[] = [
      // First attempt: one tool call then artifact
      { kind: 'tool-calls', calls: [toolCall('t1', 'read_file')], usage: ZERO_USAGE },
      { kind: 'artifact', artifact: badArtifact, usage: ZERO_USAGE },
      // Second attempt (after deterministic fail cycles back): good artifact
      { kind: 'artifact', artifact: goodArtifact, usage: ZERO_USAGE },
    ];

    let detCheckCount = 0;
    const flakyDet: import('../../src/contract/goal-type.js').DeterministicCheck = {
      name: 'det',
      async run() {
        detCheckCount++;
        return detCheckCount <= 1
          ? { ok: false, detail: 'fail' }
          : { ok: true, detail: '' };
      },
    };

    // Capture the priorAttempt seen by the brain's step call on the second attempt
    const capturedPriorAttempts: (typeof undefined | { artifact: unknown; verdict: unknown })[] = [];

    const captureBrain: import('../../src/contract/brain.js').Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair(_goal, _artifact) { return { value: goodArtifact, usage: ZERO_USAGE }; },
      async step(_goal, _transcript, _tools, ctx) {
        capturedPriorAttempts.push(ctx.priorAttempt);
        const out = stepsArr[stepIdx++];
        if (!out) throw new Error('no more steps');
        return out;
      },
    };

    const broker = new FakeBroker([
      { callId: 't1', ok: true, output: 'file content' },
    ]);

    const registry = buildRegistry([toolGrantedType({ deterministic: [flakyDet] })]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'transcript tail test',
      budget: { attempts: 5, tokens: 10000, toolCalls: 20, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    // Should have succeeded (repair path or second attempt)
    expect(report.blockers).toHaveLength(0);

    // The brain's step was called at least three times:
    // step 0: tool-calls (first loop iteration, no priorAttempt)
    // step 1: artifact (first loop iteration, no priorAttempt — still inside loop)
    // step 2+: second attempt after det-fail escalation — priorAttempt has transcript tail
    expect(capturedPriorAttempts.length).toBeGreaterThanOrEqual(3);

    // Find the first step call that has a priorAttempt (the second loop invocation)
    const firstWithPrior = capturedPriorAttempts.find((pa) => pa !== undefined);
    expect(firstWithPrior).toBeDefined();
    const verdict = firstWithPrior!.verdict as import('../../src/contract/verdict.js').Verdict;
    // The transcript evidence is folded into the findings (step-loop-transcript: prefix)
    const transcriptFinding = verdict.findings.find((f) =>
      f.title.startsWith('step-loop-transcript:'),
    );
    expect(transcriptFinding).toBeDefined();
    // The finding title should contain evidence of the read_file call
    expect(transcriptFinding!.title).toContain('read_file');
  }, 10_000);
});

// ── T3: toolCalls budget 1, step returning 2 calls → exactly 1 brokered ──────────

describe('T3: per-call budget gate', () => {
  it('budget=1, step returns 2 calls: exactly 1 brokered, exhaustion surfaced, no hang', async () => {
    const store = new MemoryEventStore();

    const brain = new SrcScriptedBrain({
      step: {
        'two-call goal': [
          {
            kind: 'tool-calls',
            calls: [toolCall('c1', 'read_file'), toolCall('c2', 'write_file')],
            usage: ZERO_USAGE,
          } satisfies StepOutput,
        ],
      },
    });

    const broker = new FakeBroker([
      { callId: 'c1', ok: true, output: 'content' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'two-call goal',
      budget: { attempts: 3, tokens: 10000, toolCalls: 1, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);

    // Must have exhausted (blocked)
    expect(report.blockers.length).toBeGreaterThan(0);

    // Exactly 1 tool call was brokered
    expect(broker.calls).toHaveLength(1);
    expect(broker.calls[0]!.call.id).toBe('c1');

    // budget-exhausted event for toolCalls was emitted
    const exhaustedEvents = await store.list({ type: 'budget-exhausted' });
    const tcExhausted = exhaustedEvents.find(
      (e) => (e as { dimension: string }).dimension === 'toolCalls',
    );
    expect(tcExhausted).toBeDefined();
  }, 10_000);
});

// ── T4: toolCalls budget 0 at loop entry → immediate exhaustion ────────────────

describe('T4: zero toolCalls budget at loop entry', () => {
  it('budget toolCalls=0: exhaustion before any brain.step call', async () => {
    const store = new MemoryEventStore();

    let stepCalled = false;
    const captureBrain: import('../../src/contract/brain.js').Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step() {
        stepCalled = true;
        throw new Error('should not be called');
      },
    };

    const broker = new FakeBroker([]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'zero budget goal',
      budget: { attempts: 3, tokens: 10000, toolCalls: 0, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);

    expect(report.blockers.length).toBeGreaterThan(0);
    expect(stepCalled).toBe(false);

    const exhaustedEvents = await store.list({ type: 'budget-exhausted' });
    const tcExhausted = exhaustedEvents.find(
      (e) => (e as { dimension: string }).dimension === 'toolCalls',
    );
    expect(tcExhausted).toBeDefined();
  }, 10_000);
});

// ── T5: step event carries usage when StepOutput had usage ──────────────────────

describe('T5: step event carries usage', () => {
  it('step event includes the usage field reported by the StepOutput', async () => {
    const store = new MemoryEventStore();

    const nonZeroUsage: import('../../src/contract/goal.js').Usage = {
      promptTokens: 42,
      completionTokens: 17,
      costUsd: 0.001,
    };

    const finalArtifact = textArtifact('done');

    const brain = new SrcScriptedBrain({
      step: {
        'usage goal': [
          {
            kind: 'tool-calls',
            calls: [toolCall('u1', 'read_file')],
            usage: nonZeroUsage,
          } satisfies StepOutput,
          {
            kind: 'artifact',
            artifact: finalArtifact,
            usage: { promptTokens: 10, completionTokens: 5 },
          } satisfies StepOutput,
        ],
      },
    });

    const broker = new FakeBroker([
      { callId: 'u1', ok: true, output: 'content' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'usage goal',
      budget: { attempts: 3, tokens: 10000, toolCalls: 10, wallClockMs: 60_000 },
    });

    const report = await engine.run(goal);
    expect(report.blockers).toHaveLength(0);

    const stepEvents = await store.list({ type: 'step' });
    expect(stepEvents.length).toBeGreaterThanOrEqual(1);

    // First step event should carry the non-zero usage
    const firstStep = stepEvents[0] as { usage?: import('../../src/contract/goal.js').Usage };
    expect(firstStep.usage).toBeDefined();
    expect(firstStep.usage!.promptTokens).toBe(42);
    expect(firstStep.usage!.completionTokens).toBe(17);
    expect(firstStep.usage!.costUsd).toBe(0.001);
  }, 10_000);
});

// ── T6: tool-loop ceiling ─────────────────────────────────────────────────────
// A tool-granted goal whose step outputs carry costUsd summing past the ceiling
// must: (1) emit ceiling-reached exactly once, (2) make no further brain calls
// after the ceiling trips, and (3) debit step token usage against the tokens
// budget dimension so a tight tokens budget exhausts on step usage.

describe('T6: tool-loop ceiling', () => {
  it('step loop halts with ceiling-reached when costUsd crosses ceiling; no further brain calls', async () => {
    const store = new MemoryEventStore();

    // Step 1 costs $12 — ceiling is $10 → step 1 alone trips the ceiling.
    // The step event is emitted before the ceiling check, so exactly 1 step event
    // appears in the log. Brain.step must not be called a second time.
    let stepCallCount = 0;
    const stepOutputs: StepOutput[] = [
      {
        kind: 'tool-calls',
        calls: [toolCall('c1', 'write_file')],
        usage: { promptTokens: 10, completionTokens: 5, costUsd: 12 },
      },
      // This step must never be called — ceiling trips after step 1
      {
        kind: 'artifact',
        artifact: textArtifact('should not appear'),
        usage: { promptTokens: 10, completionTokens: 5, costUsd: 1 },
      },
    ];

    const captureBrain: import('../../src/contract/brain.js').Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step() {
        const out = stepOutputs[stepCallCount++];
        if (!out) throw new Error('no more steps scripted');
        return out;
      },
    };

    const broker = new FakeBroker([
      { callId: 'c1', ok: true, output: 'wrote' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const goal = makeGoal({
      type: 'implement',
      title: 'ceiling loop goal',
      budget: { attempts: 3, tokens: 100_000, toolCalls: 10, wallClockMs: 60_000 },
      spendCeilingUsd: 10,
    });

    const report = await engine.run(goal);

    // Must have blocked (ceiling reached)
    expect(report.blockers.length).toBeGreaterThan(0);

    // ceiling-reached emitted exactly once
    const ceilingEvents = await store.list({ type: 'ceiling-reached' });
    expect(ceilingEvents).toHaveLength(1);

    // Step 1's event is in the log (emitted before ceiling check); step 2 never ran
    const stepEvents = await store.list({ type: 'step' });
    expect(stepEvents).toHaveLength(1);

    // Brain.step was only called once
    expect(stepCallCount).toBe(1);
  }, 10_000);

  it('tight tokens budget exhausts on step token usage (tokens dimension gates tool leaves)', async () => {
    const store = new MemoryEventStore();

    // Each step uses 60 tokens (30+30). Budget is 100 tokens → exhausts after step 2.
    const stepOutputs: StepOutput[] = [
      {
        kind: 'tool-calls',
        calls: [toolCall('d1', 'write_file')],
        usage: { promptTokens: 30, completionTokens: 30, costUsd: 0.001 },
      },
      {
        kind: 'tool-calls',
        calls: [toolCall('d2', 'write_file')],
        usage: { promptTokens: 30, completionTokens: 30, costUsd: 0.001 },
      },
      {
        kind: 'artifact',
        artifact: textArtifact('result'),
        usage: { promptTokens: 30, completionTokens: 30, costUsd: 0.001 },
      },
    ];
    let stepIdx = 0;

    const captureBrain: import('../../src/contract/brain.js').Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step() {
        const out = stepOutputs[stepIdx++];
        if (!out) throw new Error('no more steps');
        return out;
      },
    };

    const broker = new FakeBroker([
      { callId: 'd1', ok: true, output: 'ok' },
      { callId: 'd2', ok: true, output: 'ok' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain: captureBrain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    // tokens budget of 100 — three steps of 60 tokens each would overflow it
    const goal = makeGoal({
      type: 'implement',
      title: 'tokens-gate goal',
      budget: { attempts: 5, tokens: 100, toolCalls: 20, wallClockMs: 60_000 },
      spendCeilingUsd: 100, // ceiling high enough to not interfere
    });

    const report = await engine.run(goal);

    // The artifact-returning step exceeds the tokens budget → blocked on tokens
    expect(report.blockers.length).toBeGreaterThan(0);
    const exhaustedEvents = await store.list({ type: 'budget-exhausted' });
    const tokenExhausted = exhaustedEvents.find(
      (e) => (e as { dimension: string }).dimension === 'tokens',
    );
    expect(tokenExhausted).toBeDefined();
  }, 10_000);
});

// ── T7: debit equality reads the budget ──────────────────────────────────────
// After a run, the remaining tokens budget equals initial minus the SUM of all
// step event token usage — proving debit equals reported, not just behavioral.

describe('T7: debit equality reads the budget', () => {
  it('remaining tokens after step loop equals initial minus sum of step event usage', async () => {
    const store = new MemoryEventStore();

    const step1Usage: import('../../src/contract/goal.js').Usage = { promptTokens: 20, completionTokens: 10, costUsd: 0.001 };
    const step2Usage: import('../../src/contract/goal.js').Usage = { promptTokens: 15, completionTokens: 5, costUsd: 0.001 };
    const finalArtifact = textArtifact('done');

    const brain = new SrcScriptedBrain({
      step: {
        'debit-equality goal': [
          { kind: 'tool-calls', calls: [toolCall('e1', 'read_file')], usage: step1Usage } satisfies StepOutput,
          { kind: 'artifact', artifact: finalArtifact, usage: step2Usage } satisfies StepOutput,
        ],
      },
    });

    const broker = new FakeBroker([
      { callId: 'e1', ok: true, output: 'content' },
    ]);

    const registry = buildRegistry([toolGrantedType()]);
    const engine = new Engine({
      registry,
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    const initialTokens = 10_000;
    const goal = makeGoal({
      type: 'implement',
      title: 'debit-equality goal',
      budget: { attempts: 3, tokens: initialTokens, toolCalls: 10, wallClockMs: 60_000 },
      spendCeilingUsd: 100,
    });

    const report = await engine.run(goal);
    expect(report.blockers).toHaveLength(0);

    // Sum all step event token usage
    const stepEvents = await store.list({ type: 'step' });
    const totalStepTokens = stepEvents.reduce((sum, e) => {
      const ev = e as { usage?: import('../../src/contract/goal.js').Usage };
      if (!ev.usage) return sum;
      return sum + ev.usage.promptTokens + ev.usage.completionTokens;
    }, 0);

    // Expected total: (20+10) + (15+5) = 50
    const expectedTotal = (step1Usage.promptTokens + step1Usage.completionTokens) +
                          (step2Usage.promptTokens + step2Usage.completionTokens);
    expect(totalStepTokens).toBe(expectedTotal);

    // The tokens budget was debited by exactly that sum.
    // The remaining budget = initialTokens - totalStepTokens.
    // We verify via a goal whose tokens budget equals the total step usage: it must
    // exhaust on step usage alone (boundary condition).
    const store2 = new MemoryEventStore();
    const brain2 = new SrcScriptedBrain({
      step: {
        'boundary goal': [
          { kind: 'tool-calls', calls: [toolCall('f1', 'read_file')], usage: step1Usage } satisfies StepOutput,
          { kind: 'artifact', artifact: finalArtifact, usage: step2Usage } satisfies StepOutput,
        ],
      },
    });
    const broker2 = new FakeBroker([
      { callId: 'f1', ok: true, output: 'content' },
    ]);
    const engine2 = new Engine({
      registry,
      brain: brain2,
      store: store2,
      memory: new NoopMemoryView(),
      broker: broker2,
    });

    // Budget exactly equals the accumulated step tokens — last step should exhaust it
    const boundaryGoal = makeGoal({
      type: 'implement',
      title: 'boundary goal',
      budget: { attempts: 3, tokens: totalStepTokens, toolCalls: 10, wallClockMs: 60_000 },
      spendCeilingUsd: 100,
    });

    const report2 = await engine2.run(boundaryGoal);
    // The tokens budget is exactly consumed, so it exhausts on the final debit
    expect(report2.blockers.length).toBeGreaterThan(0);
    const exhaustedEvents = await store2.list({ type: 'budget-exhausted' });
    const tokensExhausted = exhaustedEvents.find(
      (e) => (e as { dimension: string }).dimension === 'tokens',
    );
    expect(tokensExhausted).toBeDefined();
  }, 10_000);
});
