import type { Budget } from '../contract/goal.js';
import type { Artifact } from '../contract/report.js';
import type { Finding, Verdict } from '../contract/verdict.js';
import type { StepTranscript } from '../contract/brain.js';

export type StepLoopFailKind = 'failed' | 'malformed' | 'transport';

export type StepLoopResult =
  | { kind: 'artifact'; artifact: Artifact; budget: Budget; transcript: StepTranscript; tokensUsed: number }
  | { kind: 'exhausted'; budget: Budget; transcript: StepTranscript }
  | { kind: 'failed'; error: string; failKind?: StepLoopFailKind; budget: Budget; transcript: StepTranscript }
  | { kind: 'ceiling'; budget: Budget; transcript: StepTranscript };

export type StepLoopTerminalFailure = Extract<StepLoopResult, { kind: 'exhausted' | 'failed' }>;

export function stepLoopTranscriptFinding(transcript: StepTranscript): Finding | null {
  const tail = transcript.slice(-8).map((message) => {
    if (message.role === 'assistant') {
      return { role: message.role, calls: message.toolCalls?.map((call) => call.name) ?? [] };
    }
    if (message.role === 'context') {
      return { role: message.role, content: message.content };
    }
    return { role: message.role, content: message.content.slice(0, 120) };
  });

  if (tail.length === 0) return null;

  return {
    title: `step-loop-transcript:${JSON.stringify(tail)}`,
    dimension: 'spec',
    severity: 'low',
    gating: false,
  };
}

export function stepLoopFailureArtifact(transcript: StepTranscript): Artifact {
  return {
    kind: 'text',
    text: JSON.stringify(transcript),
  };
}

export function stepLoopFailureVerdict(result: StepLoopTerminalFailure): Verdict {
  return {
    pass: false,
    findings: [
      {
        title: stepLoopFailureTitle(result),
        dimension: 'spec',
        severity: 'high',
        gating: true,
      },
    ],
    failureSignature: stepLoopFailureSignature(result),
  };
}

function stepLoopFailureTitle(result: StepLoopTerminalFailure): string {
  return result.kind === 'exhausted'
    ? 'Tool-call budget exhausted in step loop'
    : `Step loop failed: ${result.error}`;
}

function stepLoopFailureSignature(result: StepLoopTerminalFailure): string {
  if (result.kind === 'exhausted') return 'step-loop:exhausted';
  return `step-loop:${result.failKind && result.failKind !== 'failed' ? result.failKind : 'failed'}`;
}
