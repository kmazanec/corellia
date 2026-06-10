/**
 * Tests for ScriptedBrain.
 */

import { describe, it, expect } from 'vitest';
import { ScriptedBrain } from '../../src/brains/scripted.js';
import type { Goal } from '../../src/contract/goal.js';
import type { BrainContext } from '../../src/contract/brain.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';

const baseGoal: Goal = {
  id: 'g1',
  type: 'implement',
  parentId: null,
  title: 'Write the widget',
  spec: {},
  intent: 'production',
  scope: ['src/'],
  budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
  memories: [],
};

const ctx: BrainContext = {
  tier: 'sonnet',
  memories: [],
};

const satisfyDecision: Decision = { kind: 'satisfy' };

const passVerdict: Verdict = { pass: true, findings: [] };
const failVerdict: Verdict = {
  pass: false,
  findings: [
    { title: 'Missing test', dimension: 'spec', severity: 'high', gating: true, prescription: 'Add a test.' },
  ],
};

const fileArtifact: Artifact = {
  kind: 'files',
  files: [{ path: 'src/widget.ts', content: 'export const x = 1;' }],
};

const textArtifact: Artifact = { kind: 'text', text: 'hello' };

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

describe('ScriptedBrain.decide', () => {
  it('returns the scripted decision for a goal title', async () => {
    const brain = new ScriptedBrain({ decide: { 'Write the widget': [satisfyDecision] } });
    const result = await brain.decide(baseGoal, ctx);
    expect(result).toEqual(satisfyDecision);
  });

  it('falls back to type key when title is absent', async () => {
    const brain = new ScriptedBrain({ decide: { implement: [satisfyDecision] } });
    const result = await brain.decide(baseGoal, ctx);
    expect(result).toEqual(satisfyDecision);
  });

  it('prefers title key over type key', async () => {
    const typeDec: Decision = { kind: 'split', children: [] };
    const brain = new ScriptedBrain({
      decide: {
        'Write the widget': [satisfyDecision],
        implement: [typeDec],
      },
    });
    const result = await brain.decide(baseGoal, ctx);
    expect(result.kind).toBe('satisfy');
  });

  it('consumes decisions in order', async () => {
    const split: Decision = { kind: 'split', children: [] };
    const brain = new ScriptedBrain({ decide: { 'Write the widget': [satisfyDecision, split] } });
    expect((await brain.decide(baseGoal, ctx)).kind).toBe('satisfy');
    expect((await brain.decide(baseGoal, ctx)).kind).toBe('split');
  });

  it('repeats the last element once exhausted', async () => {
    const brain = new ScriptedBrain({ decide: { 'Write the widget': [satisfyDecision] } });
    await brain.decide(baseGoal, ctx);
    const r = await brain.decide(baseGoal, ctx);
    expect(r.kind).toBe('satisfy');
  });

  it('throws a loud error when neither title nor type are scripted', async () => {
    const brain = new ScriptedBrain({ decide: {} });
    await expect(brain.decide(baseGoal, ctx)).rejects.toThrow('Write the widget');
  });

  it('throws when the decide script is absent entirely', async () => {
    const brain = new ScriptedBrain({});
    await expect(brain.decide(baseGoal, ctx)).rejects.toThrow('decide');
  });
});

// ---------------------------------------------------------------------------
// produce
// ---------------------------------------------------------------------------

describe('ScriptedBrain.produce', () => {
  it('returns the scripted artifact', async () => {
    const brain = new ScriptedBrain({ produce: { 'Write the widget': [fileArtifact] } });
    const result = await brain.produce(baseGoal, ctx);
    expect(result).toEqual(fileArtifact);
  });

  it('throws when key is missing', async () => {
    const brain = new ScriptedBrain({ produce: {} });
    await expect(brain.produce(baseGoal, ctx)).rejects.toThrow('Write the widget');
  });

  it('cycles through multiple artifacts', async () => {
    const a2: Artifact = { kind: 'text', text: 'v2' };
    const brain = new ScriptedBrain({ produce: { 'Write the widget': [fileArtifact, a2] } });
    const r1 = await brain.produce(baseGoal, ctx);
    const r2 = await brain.produce(baseGoal, ctx);
    expect(r1.kind).toBe('files');
    expect(r2.kind).toBe('text');
    // Third call should repeat last.
    const r3 = await brain.produce(baseGoal, ctx);
    expect(r3.kind).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// judge
// ---------------------------------------------------------------------------

describe('ScriptedBrain.judge', () => {
  it('returns the scripted verdict', async () => {
    const brain = new ScriptedBrain({ judge: { 'Write the widget': [passVerdict] } });
    const result = await brain.judge(baseGoal, fileArtifact, 'rubric', ctx);
    expect(result.pass).toBe(true);
  });

  it('models a fail-then-pass sequence', async () => {
    const brain = new ScriptedBrain({
      judge: { 'Write the widget': [failVerdict, passVerdict] },
    });
    const r1 = await brain.judge(baseGoal, fileArtifact, 'rubric', ctx);
    const r2 = await brain.judge(baseGoal, fileArtifact, 'rubric', ctx);
    expect(r1.pass).toBe(false);
    expect(r2.pass).toBe(true);
  });

  it('throws when key is absent', async () => {
    const brain = new ScriptedBrain({ judge: {} });
    await expect(brain.judge(baseGoal, fileArtifact, 'rubric', ctx)).rejects.toThrow('judge');
  });
});

// ---------------------------------------------------------------------------
// repair — scripted path
// ---------------------------------------------------------------------------

describe('ScriptedBrain.repair (scripted)', () => {
  it('returns scripted repair artifact', async () => {
    const repaired: Artifact = {
      kind: 'files',
      files: [{ path: 'src/widget.ts', content: 'export const x = 2; // fixed' }],
    };
    const brain = new ScriptedBrain({ repair: { 'Write the widget': [repaired] } });
    const result = await brain.repair(baseGoal, fileArtifact, ['fix x'], ctx);
    expect(result).toEqual(repaired);
  });
});

// ---------------------------------------------------------------------------
// repair — naive default
// ---------------------------------------------------------------------------

describe('ScriptedBrain.repair (naive default)', () => {
  it('appends prescriptions as comment lines to the first file', async () => {
    const brain = new ScriptedBrain({});
    const result = await brain.repair(
      baseGoal,
      fileArtifact,
      ['Add a test.', 'Use strict equality.'],
      ctx,
    );
    expect(result.kind).toBe('files');
    const first = result.files?.[0];
    expect(first?.content).toContain('// Add a test.');
    expect(first?.content).toContain('// Use strict equality.');
    // Original content is preserved.
    expect(first?.content).toContain('export const x = 1;');
  });

  it('appends prescriptions to text artifacts', async () => {
    const brain = new ScriptedBrain({});
    const result = await brain.repair(baseGoal, textArtifact, ['Say world instead.'], ctx);
    expect(result.kind).toBe('text');
    expect(result.text).toContain('hello');
    expect(result.text).toContain('// Say world instead.');
  });

  it('handles an empty prescriptions list gracefully', async () => {
    const brain = new ScriptedBrain({});
    const result = await brain.repair(baseGoal, fileArtifact, [], ctx);
    expect(result.kind).toBe('files');
    // Content should not have trailing comment lines but the file is preserved.
    expect(result.files?.[0]?.content).toContain('export const x = 1;');
  });
});
