/**
 * Tests for the leaf working-memory bound (ADR-036): token estimation, transcript
 * eviction (oldest tool reads compressed to stubs, recent reads + notes kept), and
 * the model-curated scratchpad.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  transcriptTokens,
  evictTranscript,
  evictionStub,
  newScratchpad,
  addNote,
  renderScratchpad,
  KEEP_RECENT_READS,
} from '../../src/engine/scratchpad.js';
import type { StepTranscript } from '../../src/contract/brain.js';

// A tool message whose content is `n` chars (≈ n/4 tokens).
const toolMsg = (callId: string, chars: number): StepTranscript[number] => ({
  role: 'tool',
  callId,
  content: 'x'.repeat(chars),
});

describe('estimateTokens / transcriptTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });

  it('sums across a transcript including assistant tool-call args', () => {
    const t: StepTranscript = [
      { role: 'context', content: 'x'.repeat(40) }, // 10
      { role: 'tool', callId: 'a', content: 'x'.repeat(80) }, // 20
    ];
    expect(transcriptTokens(t)).toBe(30);
  });
});

describe('evictTranscript', () => {
  it('does nothing when under the cap', () => {
    const t: StepTranscript = [toolMsg('a', 100), toolMsg('b', 100)];
    const r = evictTranscript(t, 1_000_000);
    expect(r.evicted).toBe(false);
    expect(r.evictedCallIds).toEqual([]);
    expect(t[0]!.content).toBe('x'.repeat(100));
  });

  it('compresses the oldest tool reads to stubs until under the cap', () => {
    // 6 reads of ~250 tokens each (1000 chars) = ~1500 tokens; cap 800.
    const t: StepTranscript = Array.from({ length: 6 }, (_, i) => toolMsg(`c${i}`, 1000));
    const before = transcriptTokens(t);
    const r = evictTranscript(t, 800, KEEP_RECENT_READS);
    expect(r.evicted).toBe(true);
    expect(r.beforeTokens).toBe(before);
    expect(r.afterTokens).toBeLessThanOrEqual(before);
    // Oldest were evicted; the evicted callIds are the oldest ones.
    expect(r.evictedCallIds[0]).toBe('c0');
    // The most-recent KEEP_RECENT_READS are untouched (still full content).
    expect(t[5]!.content).toBe('x'.repeat(1000));
    expect(t[4]!.content).toBe('x'.repeat(1000));
    // The oldest is now a stub.
    expect((t[0] as { content: string }).content.startsWith('[evicted:')).toBe(true);
  });

  it('never evicts context or assistant messages — only tool reads', () => {
    const t: StepTranscript = [
      { role: 'context', content: 'x'.repeat(4000) }, // big, but protected
      { role: 'assistant', content: '', toolCalls: [] },
      toolMsg('old', 4000),
      toolMsg('r1', 100),
      toolMsg('r2', 100),
      toolMsg('r3', 100),
      toolMsg('r4', 100),
    ];
    evictTranscript(t, 200, KEEP_RECENT_READS);
    expect(t[0]!.role).toBe('context');
    expect(t[0]!.content).toBe('x'.repeat(4000)); // context never touched
    expect(t[1]!.role).toBe('assistant');
  });

  it('is idempotent — a second pass does not re-stub an already-stubbed read', () => {
    const t: StepTranscript = Array.from({ length: 6 }, (_, i) => toolMsg(`c${i}`, 1000));
    const r1 = evictTranscript(t, 800);
    const stubbedAfterFirst = t.filter((m) => m.content.startsWith('[evicted:')).length;
    const r2 = evictTranscript(t, 800);
    const stubbedAfterSecond = t.filter((m) => m.content.startsWith('[evicted:')).length;
    expect(stubbedAfterSecond).toBe(stubbedAfterFirst);
    expect(r2.evictedCallIds.length).toBeLessThanOrEqual(r1.evictedCallIds.length);
  });

  it('evictionStub names the ref and notes a re-read is possible', () => {
    const stub = evictionStub('call-9', 812);
    expect(stub).toContain('812');
    expect(stub).toContain('call-9');
    expect(stub.toLowerCase()).toContain('re-read');
  });
});

describe('scratchpad', () => {
  it('addNote ignores empty/whitespace and keeps real notes', () => {
    const pad = newScratchpad();
    expect(addNote(pad, '   ')).toBe(false);
    expect(addNote(pad, '')).toBe(false);
    expect(addNote(pad, 'collectTree is at engine.ts ~563')).toBe(true);
    expect(pad.notes).toHaveLength(1);
  });

  it('renderScratchpad is empty with no notes, and lists notes when present', () => {
    const pad = newScratchpad();
    expect(renderScratchpad(pad)).toBe('');
    addNote(pad, 'first');
    addNote(pad, 'second');
    const r = renderScratchpad(pad);
    expect(r).toContain('YOUR NOTES');
    expect(r).toContain('1. first');
    expect(r).toContain('2. second');
  });
});
