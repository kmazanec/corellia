/**
 * Tests for F-64 Chunk 2: duplicate-call guard at the engine.ts per-call seam.
 *
 * The guard refuses byte-identical (name + canonicalized-args) re-reads of
 * read-only tools within the same attempt. Key properties verified:
 *
 * AC 3: byte-identical read-only call → refused with reason, NOT debited from
 *       toolCalls counter, tool-call event outcome:'refused'.
 * AC 4: run_script repeats always allowed; write_file to path X invalidates
 *       the guard for X so a subsequent read_file of X is allowed.
 *
 * Uses the same Engine + stubs pattern as step-loop.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/engine.js';
import {
  MemoryEventStore,
  NoopMemoryView,
  buildRegistry,
  leafTypeDef,
  makeGoal,
  textArtifact,
} from './stubs.js';
import { FakeBroker } from './stubs.js';
import type { ToolCall, ToolResult } from '../../src/contract/tool.js';
import type { StepOutput } from '../../src/contract/brain.js';
import type { Brain, BrainContext, StepTranscript } from '../../src/contract/brain.js';
import type { ToolDef } from '../../src/contract/tool.js';
import type { Goal } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolGrantedType() {
  return leafTypeDef({
    name: 'implement',
    grants: ['fs.read', 'fs.write', 'test.run_scoped'],
  });
}

function makeGoalWithBudget(toolCalls: number = 20) {
  return makeGoal({
    type: 'implement',
    budget: { attempts: 3, tokens: 100000, toolCalls, wallClockMs: 120000 },
  });
}

/** A read_file ToolCall. */
function readCall(id: string, path: string): ToolCall {
  return { id, name: 'read_file', args: { path } };
}

/** A write_file ToolCall. */
function writeCall(id: string, path: string, content = 'new content'): ToolCall {
  return { id, name: 'write_file', args: { path, content } };
}

/** A run_script ToolCall. */
function runCall(id: string, script = 'test'): ToolCall {
  return { id, name: 'run_script', args: { script } };
}

/**
 * Build a Brain that plays through a scripted sequence of StepOutputs.
 * The last output is repeated if the queue is exhausted.
 */
function scriptedStepBrain(steps: StepOutput[]): Brain {
  let idx = 0;
  return {
    async decide() { throw new Error('not used'); },
    async produce() { throw new Error('not used'); },
    async judge() { throw new Error('not used'); },
    async repair() { throw new Error('not used'); },
    async step(_goal: Goal, _transcript: StepTranscript, _tools: ToolDef[], _ctx: BrainContext): Promise<StepOutput> {
      const out = steps[Math.min(idx++, steps.length - 1)];
      if (!out) throw new Error('scriptedStepBrain: no more steps');
      return out;
    },
  };
}

function toolCallsStep(...calls: ToolCall[]): StepOutput {
  return { kind: 'tool-calls', calls, usage: ZERO_USAGE };
}

function artifactStep(): StepOutput {
  return { kind: 'artifact', artifact: textArtifact('done'), usage: ZERO_USAGE };
}

function successResult(callId: string, output = 'file contents'): ToolResult {
  return { callId, ok: true, output };
}

// ---------------------------------------------------------------------------
// AC 3: byte-identical read-only call refused without budget debit
// ---------------------------------------------------------------------------

describe('duplicate guard — read-only call refused on repeat (AC 3)', () => {
  it('refuses the second byte-identical read_file call and does NOT debit toolCalls', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);

    // Step 1: read the same file twice, then finish.
    // The second read is a duplicate and should be refused without budget debit.
    const broker = new FakeBroker([successResult('r1'), successResult('r2')], store);

    const brain = scriptedStepBrain([
      // Step 1: two reads of the same file
      toolCallsStep(readCall('r1', 'src/main.ts'), readCall('r2', 'src/main.ts')),
      // Step 2: artifact (done)
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });

    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    // Two tool-call events should be emitted: one 'ran', one 'refused'
    expect(events).toHaveLength(2);
    const ranEvt = events.find((e) => e.type === 'tool-call' && (e as { outcome: string }).outcome === 'ran');
    const refusedEvt = events.find((e) => e.type === 'tool-call' && (e as { outcome: string }).outcome === 'refused');
    expect(ranEvt).toBeDefined();
    expect(refusedEvt).toBeDefined();

    // The refused event carries a reason mentioning duplicate / earlier result
    const reason = (refusedEvt as { reason?: string }).reason ?? '';
    expect(reason.toLowerCase()).toMatch(/duplicate|already/);
  });

  it('refused call has outcome:refused on the tool-call event', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([successResult('r1')], store);

    const brain = scriptedStepBrain([
      toolCallsStep(readCall('r1', 'src/foo.ts'), readCall('r2', 'src/foo.ts')),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    const refusedEvt = events.find((e) => (e as { outcome: string }).outcome === 'refused');
    expect(refusedEvt).toBeDefined();
    expect((refusedEvt as { tool: string }).tool).toBe('read_file');
    expect((refusedEvt as { callId: string }).callId).toBe('r2');
  });

  it('refused call does not debit toolCalls — broker is called only once for a duplicated read', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([successResult('r1')], store);

    const brain = scriptedStepBrain([
      // Two identical reads — second should be refused without broker call
      toolCallsStep(readCall('r1', 'src/bar.ts'), readCall('r2', 'src/bar.ts')),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    // The broker should have been called exactly once (the first read_file).
    // The duplicate was refused before reaching the broker.
    expect(broker.calls).toHaveLength(1);
    expect(broker.calls[0]?.call.name).toBe('read_file');
    expect(broker.calls[0]?.call.id).toBe('r1');
  });

  it('refused result is appended to transcript so brain can see why it was denied', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([successResult('r1')], store);
    const capturedTranscripts: import('../../src/contract/brain.js').StepTranscript[] = [];
    let callCount = 0;

    const brain: Brain = {
      async decide() { throw new Error('not used'); },
      async produce() { throw new Error('not used'); },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step(_goal, transcript) {
        capturedTranscripts.push([...transcript]);
        callCount++;
        if (callCount === 1) {
          return toolCallsStep(readCall('r1', 'src/x.ts'), readCall('r2', 'src/x.ts'));
        }
        return artifactStep();
      },
    };

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    // Second step should see two tool results in transcript (one ran, one refused)
    const secondTranscript = capturedTranscripts[1];
    expect(secondTranscript).toBeDefined();
    const toolMessages = (secondTranscript ?? []).filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    // The second tool message (refused) mentions the duplicate reason
    const refusedMsg = toolMessages[1];
    const content = refusedMsg && 'content' in refusedMsg ? refusedMsg.content : '';
    expect(content.toLowerCase()).toMatch(/duplicate|already/);
  });

  it('guards all read-only tool types — list_dir duplicate is refused', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([successResult('l1', 'dir listing')], store);

    const brain = scriptedStepBrain([
      toolCallsStep(
        { id: 'l1', name: 'list_dir', args: { path: 'src/' } },
        { id: 'l2', name: 'list_dir', args: { path: 'src/' } },
      ),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    const refusedEvt = events.find((e) => (e as { outcome: string }).outcome === 'refused');
    expect(refusedEvt).toBeDefined();
    expect((refusedEvt as { tool: string }).tool).toBe('list_dir');
  });

  it('different args → not a duplicate → both calls run', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([
      successResult('r1', 'contents of a'),
      successResult('r2', 'contents of b'),
    ], store);

    const brain = scriptedStepBrain([
      // Two reads of DIFFERENT files — both should run
      toolCallsStep(readCall('r1', 'src/a.ts'), readCall('r2', 'src/b.ts')),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    expect(events).toHaveLength(2);
    expect(events.every((e) => (e as { outcome: string }).outcome === 'ran')).toBe(true);
    expect(broker.calls).toHaveLength(2);
  });

  it('arg key ordering does not defeat the guard — canonicalization catches same-content objects', async () => {
    // The LLM may emit args with different key order across calls.
    // The guard must canonicalize to catch these as duplicates.
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([successResult('r1')], store);

    const brain = scriptedStepBrain([
      toolCallsStep(
        // First call: { path: 'src/z.ts', encoding: 'utf8' }
        { id: 'r1', name: 'read_file', args: { path: 'src/z.ts', encoding: 'utf8' } },
        // Second call: same args, different key order
        { id: 'r2', name: 'read_file', args: { encoding: 'utf8', path: 'src/z.ts' } },
      ),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    const refusedEvt = events.find((e) => (e as { outcome: string }).outcome === 'refused');
    expect(refusedEvt).toBeDefined();
    // Broker called only once — the duplicate was caught by canonicalization
    expect(broker.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC 4: run_script repeats always allowed
// ---------------------------------------------------------------------------

describe('duplicate guard — run_script repeats always allowed (AC 4)', () => {
  it('run_script with identical args is NOT refused — repeats are required for red→green', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([
      successResult('s1', 'FAIL: test failed'),
      successResult('s2', 'PASS: all tests pass'),
    ], store);

    const brain = scriptedStepBrain([
      // Run the same script twice — both must run through
      toolCallsStep(runCall('s1', 'test'), runCall('s2', 'test')),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    // Both script runs should have outcome:'ran'
    expect(events).toHaveLength(2);
    expect(events.every((e) => (e as { outcome: string }).outcome === 'ran')).toBe(true);
    expect(broker.calls).toHaveLength(2);
  });

  it('run_script repeat across steps is also allowed', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([
      successResult('s1', 'FAIL'),
      { callId: 'w1', ok: true, output: 'wrote' },
      successResult('s2', 'PASS'),
    ], store);

    const brain = scriptedStepBrain([
      toolCallsStep(runCall('s1', 'test')),   // Step 1: run tests
      toolCallsStep(writeCall('w1', 'src/fix.ts'), runCall('s2', 'test')), // Step 2: write + run again
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const toolCallEvents = await store.list({ type: 'tool-call' });
    const runEvents = toolCallEvents.filter((e) => (e as { tool: string }).tool === 'run_script');
    // Both run_script calls should have run
    expect(runEvents).toHaveLength(2);
    expect(runEvents.every((e) => (e as { outcome: string }).outcome === 'ran')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 4: write_file invalidates the guard for the written path
// ---------------------------------------------------------------------------

describe('duplicate guard — write_file invalidates guard for written path (AC 4)', () => {
  it('re-read of a file AFTER a write_file to the same path is allowed (not refused)', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([
      successResult('r1', 'old content'),
      { callId: 'w1', ok: true, output: 'wrote' },
      successResult('r2', 'new content'),
    ], store);

    const brain = scriptedStepBrain([
      // Step 1: read the file
      toolCallsStep(readCall('r1', 'src/target.ts')),
      // Step 2: write to the same file, then re-read it
      toolCallsStep(writeCall('w1', 'src/target.ts', 'updated'), readCall('r2', 'src/target.ts')),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    // All three calls should have ran (no refusal)
    expect(events).toHaveLength(3);
    expect(events.every((e) => (e as { outcome: string }).outcome === 'ran')).toBe(true);
  });

  it('re-read without an intervening write IS refused', async () => {
    // Baseline: without a write, the second read of the same path is refused.
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([successResult('r1', 'content')], store);

    const brain = scriptedStepBrain([
      toolCallsStep(readCall('r1', 'src/check.ts')),
      toolCallsStep(readCall('r2', 'src/check.ts')),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    const refusedEvt = events.find((e) => (e as { outcome: string }).outcome === 'refused');
    expect(refusedEvt).toBeDefined();
    expect((refusedEvt as { callId: string }).callId).toBe('r2');
  });

  it('write_file invalidates only the written path — unrelated path still guarded', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoalWithBudget(10);
    const broker = new FakeBroker([
      successResult('r1', 'content a'),
      successResult('r2', 'content b'),
      { callId: 'w1', ok: true, output: 'wrote' },
      successResult('r3', 'content a new'),
      // r4 (re-read of src/b.ts) will be refused
    ], store);

    const brain = scriptedStepBrain([
      // Step 1: read two different files
      toolCallsStep(readCall('r1', 'src/a.ts'), readCall('r2', 'src/b.ts')),
      // Step 2: write to src/a.ts, then re-read src/a.ts (OK) and src/b.ts (refused)
      toolCallsStep(
        writeCall('w1', 'src/a.ts', 'updated'),
        readCall('r3', 'src/a.ts'),
        readCall('r4', 'src/b.ts'),
      ),
      artifactStep(),
    ]);

    const engine = new Engine({
      registry: buildRegistry([toolGrantedType()]),
      brain,
      store,
      memory: new NoopMemoryView(),
      broker,
    });
    await engine.run(goal);

    const events = await store.list({ type: 'tool-call' });
    const refusedEvents = events.filter((e) => (e as { outcome: string }).outcome === 'refused');
    // Only src/b.ts re-read should be refused
    expect(refusedEvents).toHaveLength(1);
    expect((refusedEvents[0] as { callId: string }).callId).toBe('r4');
    // src/a.ts re-read (r3) should have ran
    const r3Event = events.find((e) => (e as { callId: string }).callId === 'r3');
    expect((r3Event as { outcome: string } | undefined)?.outcome).toBe('ran');
  });
});
