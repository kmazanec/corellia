import { describe, expect, it } from 'vitest';
import type { Budget } from '../../src/contract/goal.js';
import type { StepTranscript } from '../../src/contract/brain.js';
import {
  stepLoopFailureArtifact,
  stepLoopFailureVerdict,
  stepLoopTranscriptFinding,
} from '../../src/engine/step-loop-result.js';

const budget: Budget = {
  attempts: 1,
  tokens: 1,
  toolCalls: 1,
  wallClockMs: 1,
};

describe('step loop result helpers', () => {
  it('builds a compact advisory transcript finding from the transcript tail', () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'start' },
      { role: 'assistant', content: 'read', toolCalls: [{ id: 'c1', name: 'read_file', args: {} }] },
      { role: 'tool', callId: 'c1', content: 'x'.repeat(160) },
    ];

    expect(stepLoopTranscriptFinding(transcript)).toMatchObject({
      title:
        'step-loop-transcript:' +
        JSON.stringify([
          { role: 'context', content: 'start' },
          { role: 'assistant', calls: ['read_file'] },
          { role: 'tool', content: 'x'.repeat(120) },
        ]),
      gating: false,
    });
  });

  it('returns null when there is no transcript evidence', () => {
    expect(stepLoopTranscriptFinding([])).toBeNull();
  });

  it('serializes transcript failures as text artifacts', () => {
    const transcript: StepTranscript = [{ role: 'context', content: 'start' }];

    expect(stepLoopFailureArtifact(transcript)).toEqual({
      kind: 'text',
      text: JSON.stringify(transcript),
    });
  });

  it('uses distinct failure signatures for non-logical step incidents', () => {
    expect(stepLoopFailureVerdict({
      kind: 'failed',
      error: 'bad json',
      failKind: 'malformed',
      budget,
      transcript: [],
    })).toMatchObject({
      pass: false,
      failureSignature: 'step-loop:malformed',
      findings: [{ title: 'Step loop failed: bad json' }],
    });

    expect(stepLoopFailureVerdict({
      kind: 'exhausted',
      budget,
      transcript: [],
    })).toMatchObject({
      pass: false,
      failureSignature: 'step-loop:exhausted',
      findings: [{ title: 'Tool-call budget exhausted in step loop' }],
    });
  });
});
