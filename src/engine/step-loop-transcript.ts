import type { StepTranscript } from '../contract/brain.js';
import type { EventStore } from '../contract/events.js';
import type { Goal, Usage } from '../contract/goal.js';
import {
  evictTranscript,
  evictTranscriptWithSummary,
  renderScratchpad,
  type EvictionResult,
  type Scratchpad,
} from './scratchpad.js';
import { releaseGuardForCallId, type ReadOutputCache } from './step-loop-guards.js';

const NOTE_PREFIX = 'YOUR NOTES';

export interface BoundedTranscriptParams {
  goal: Goal;
  transcript: StepTranscript;
  scratchpad: Scratchpad;
  store: EventStore;
  now: () => number;
  seenCalls: Set<string>;
  callKeyByCallId: Map<string, string>;
  readOutputCache: ReadOutputCache;
  summarizeRead: ((text: string) => Promise<{ value: string; usage: Usage }>) | undefined;
  debitUsage: (usage: Usage) => void;
  cap?: number;
}

export interface TruncatedTranscriptParams {
  goal: Goal;
  transcript: StepTranscript;
  scratchpad: Scratchpad;
  store: EventStore;
  now: () => number;
  seenCalls: Set<string>;
  callKeyByCallId: Map<string, string>;
  readOutputCache: ReadOutputCache;
  cap?: number;
}

export function syncScratchpadMessage(transcript: StepTranscript, pad: Scratchpad): void {
  const rendered = renderScratchpad(pad);
  if (rendered.length === 0) return;
  const idx = transcript.findIndex((message) => message.role === 'context' && message.content.startsWith(NOTE_PREFIX));
  if (idx >= 0) {
    (transcript[idx] as { role: 'context'; content: string }).content = rendered;
  } else {
    transcript.splice(1, 0, { role: 'context', content: rendered });
  }
}

export async function boundStepLoopTranscript(params: BoundedTranscriptParams): Promise<void> {
  syncScratchpadMessage(params.transcript, params.scratchpad);
  const eviction = await evictBoundedTranscript(params);
  if (eviction.evicted) {
    await emitContextEvicted(params, eviction, eviction.summarized ? 'summarized' : 'stubbed');
  }
}

export async function evictTranscriptAfterTruncation(params: TruncatedTranscriptParams): Promise<void> {
  syncScratchpadMessage(params.transcript, params.scratchpad);
  const eviction = evictTranscript(params.transcript, params.cap);
  if (eviction.evicted) {
    await emitContextEvicted(params, eviction, 'stubbed (post-truncation)');
  }
}

async function evictBoundedTranscript(
  params: BoundedTranscriptParams,
): Promise<EvictionResult & { summarized: boolean }> {
  if (params.summarizeRead === undefined) {
    return { ...evictTranscript(params.transcript, params.cap), summarized: false };
  }

  const result = await evictTranscriptWithSummary(
    params.transcript,
    async (text) => {
      const metered = await params.summarizeRead!(text);
      params.debitUsage(metered.usage);
      return { gist: metered.value, tokens: metered.usage.completionTokens };
    },
    params.cap,
  );
  return { ...result, summarized: result.evicted };
}

async function emitContextEvicted(
  params: Pick<BoundedTranscriptParams, 'goal' | 'store' | 'now' | 'seenCalls' | 'callKeyByCallId' | 'readOutputCache'>,
  eviction: EvictionResult,
  mode: string,
): Promise<void> {
  for (const callId of eviction.evictedCallIds) {
    releaseGuardForCallId(params.seenCalls, params.callKeyByCallId, callId, params.readOutputCache);
  }
  await params.store.append({
    type: 'context-evicted',
    at: params.now(),
    goalId: params.goal.id,
    detail: `${eviction.beforeTokens}→${eviction.afterTokens} est. tokens; ${eviction.evictedCallIds.length} read(s) ${mode}`,
  });
}
