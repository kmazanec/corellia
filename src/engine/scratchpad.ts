/**
 * Leaf working-memory bound (ADR-036).
 *
 * A leaf's step-loop transcript is append-only: every tool result (a whole file's
 * contents) is pushed as a `role: 'tool'` message and re-sent in full each step, so
 * broad reading balloons the context until the model's response truncates (build
 * run #8: ~117K tokens → truncated tool-call → JSON crash → block with 0 writes).
 *
 * This module bounds that working set with two pure mechanisms the engine wires
 * into `runStepLoop`:
 *   1. `evictTranscript` — when the transcript's estimated tokens cross a cap,
 *      compress the OLDEST `role: 'tool'` read results to a short stub, keeping the
 *      most-recent reads verbatim. The model may re-read an evicted path on demand.
 *   2. a `Scratchpad` — a small, always-retained note buffer the model curates via
 *      a `note` tool, so the distilled substance of a read survives eviction.
 *
 * Both are deliberately dependency-free and pure (the eviction mutates the array it
 * is given and reports what it evicted; the buffer is a plain object) so they unit-
 * test without the engine.
 */

import type { StepMessage, StepTranscript } from '../contract/brain.js';

// ── Token estimation ──────────────────────────────────────────────────────────

/**
 * A coarse token estimate for a string: ~4 chars/token, the standard rule of thumb.
 * The eviction bound is a safety floor, not an accounting figure, so an approximate
 * estimate is correct here — it never needs to match the provider's exact count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimated tokens for a whole transcript. */
export function transcriptTokens(transcript: StepTranscript): number {
  let total = 0;
  for (const m of transcript) {
    total += estimateTokens(m.content);
    if (m.role === 'assistant' && m.toolCalls) {
      for (const c of m.toolCalls) total += estimateTokens(JSON.stringify(c.args));
    }
  }
  return total;
}

// ── Eviction backstop ─────────────────────────────────────────────────────────

/**
 * The transcript token cap. Above this, the oldest tool reads are compressed.
 * Set well below the model's context/output limits so a tool-call response is never
 * truncated by transcript size (build #8 truncated near ~117K prompt tokens). The
 * cap bounds the PROMPT the leaf sends; it is not a budget lever (ADR-033).
 *
 * Raised 60K→140K (run live-self-bcc825bb): at 60K a build leaf evicted after only
 * ~6 of corellia's large source files and thrashed — 170 reads / 46 evictions / 0
 * writes, a re-read sawtooth that never converged. The mid build tier (DeepSeek V4
 * Pro) has a ~384K context, so 140K leaves ample headroom against truncation while
 * letting a cross-cutting change hold a real working set in view. Paired with
 * summarize-on-evict (a distilling stub, not a bare re-read invite) and ranged reads
 * so a single huge file cannot blow the cap alone.
 */
export const TRANSCRIPT_TOKEN_CAP = 140_000;

/** Keep at least this many of the most-recent `role: 'tool'` reads verbatim. */
export const KEEP_RECENT_READS = 8;

/** The stub a path's evicted content is replaced with. `lines` is best-effort. */
export function evictionStub(callId: string, lines: number): string {
  return (
    `[evicted: a tool result read earlier (~${lines} lines) has been dropped from ` +
    `context to bound working memory (ADR-036). Re-read the file if you need it ` +
    `again, or consult your notes.] (ref ${callId})`
  );
}

/**
 * The stub for an evicted read whose content was DISTILLED by the summarizer — it
 * carries the gist so the leaf retains orientation without re-reading. Falls back to
 * {@link evictionStub} when no summary is available.
 */
export function summarizedEvictionStub(callId: string, gist: string): string {
  return (
    `[evicted-summary: a longer tool result read earlier was distilled to bound ` +
    `working memory (ADR-036). Gist: ${gist} — re-read the file only if you need ` +
    `exact detail beyond this.] (ref ${callId})`
  );
}

/** Whether a message's content is already an eviction stub (idempotent guard). */
function isStub(content: string): boolean {
  return content.startsWith('[evicted:');
}

export interface EvictionResult {
  /** Whether any message was evicted this pass. */
  evicted: boolean;
  /** Tokens before / after, for the event + tests. */
  beforeTokens: number;
  afterTokens: number;
  /** The callIds whose content was stubbed (their re-read guard should be released). */
  evictedCallIds: string[];
}

/**
 * Bound the transcript in place: while it exceeds `cap`, replace the content of the
 * OLDEST non-stub `role: 'tool'` message (beyond the most-recent {@link KEEP_RECENT_READS})
 * with a stub, until under the cap or nothing more is evictable. Only `role: 'tool'`
 * read results are touched — `context` (the harness/goal/notes) and `assistant`
 * turns are never evicted. Returns what changed.
 */
export function evictTranscript(
  transcript: StepTranscript,
  cap: number = TRANSCRIPT_TOKEN_CAP,
  keepRecent: number = KEEP_RECENT_READS,
): EvictionResult {
  const beforeTokens = transcriptTokens(transcript);
  const evictedCallIds: string[] = [];

  if (beforeTokens <= cap) {
    return { evicted: false, beforeTokens, afterTokens: beforeTokens, evictedCallIds };
  }

  // Indices of evictable tool messages (non-stub), oldest first.
  const toolIdxs: number[] = [];
  transcript.forEach((m, i) => {
    if (m.role === 'tool' && !isStub(m.content)) toolIdxs.push(i);
  });

  // Prefer to protect the most-recent `keepRecent` reads, evicting older ones
  // first. But the cap is a hard bound: if still over after evicting the
  // unprotected reads, keep going into the recent set (oldest-first) — a single
  // read larger than the cap must still be stubbed, or the transcript could never
  // be bounded (build #8: one 117K-token surface). The very newest read is evicted
  // last, so the model usually retains its latest read.
  const preferredEvictable = toolIdxs.slice(0, Math.max(0, toolIdxs.length - keepRecent));
  const evictOrder = [...preferredEvictable, ...toolIdxs.slice(preferredEvictable.length)];

  for (const idx of evictOrder) {
    if (transcriptTokens(transcript) <= cap) break;
    const msg = transcript[idx] as Extract<StepMessage, { role: 'tool' }>;
    const lines = msg.content.split('\n').length;
    transcript[idx] = { role: 'tool', callId: msg.callId, content: evictionStub(msg.callId, lines) };
    evictedCallIds.push(msg.callId);
  }

  return {
    evicted: evictedCallIds.length > 0,
    beforeTokens,
    afterTokens: transcriptTokens(transcript),
    evictedCallIds,
  };
}

/**
 * Like {@link evictTranscript}, but each evicted read is replaced with a DISTILLED
 * stub: `summarize(content)` produces a gist that survives in context, so the leaf
 * keeps orientation without re-reading (ADR-036; run live-self-bcc825bb). The
 * selection logic (oldest-first, protect the recent `keepRecent`, the cap is a hard
 * bound) is identical to the sync path. If `summarize` throws for a given read, that
 * read falls back to the blind stub — eviction must never fail the step. Returns the
 * same {@link EvictionResult} plus the total tokens the summarizer call(s) spent.
 */
export async function evictTranscriptWithSummary(
  transcript: StepTranscript,
  summarize: (text: string) => Promise<{ gist: string; tokens: number }>,
  cap: number = TRANSCRIPT_TOKEN_CAP,
  keepRecent: number = KEEP_RECENT_READS,
): Promise<EvictionResult & { summaryTokens: number }> {
  const beforeTokens = transcriptTokens(transcript);
  const evictedCallIds: string[] = [];
  let summaryTokens = 0;

  if (beforeTokens <= cap) {
    return { evicted: false, beforeTokens, afterTokens: beforeTokens, evictedCallIds, summaryTokens };
  }

  const toolIdxs: number[] = [];
  transcript.forEach((m, i) => {
    if (m.role === 'tool' && !isStub(m.content)) toolIdxs.push(i);
  });
  const preferredEvictable = toolIdxs.slice(0, Math.max(0, toolIdxs.length - keepRecent));
  const evictOrder = [...preferredEvictable, ...toolIdxs.slice(preferredEvictable.length)];

  for (const idx of evictOrder) {
    if (transcriptTokens(transcript) <= cap) break;
    const msg = transcript[idx] as Extract<StepMessage, { role: 'tool' }>;
    const lines = msg.content.split('\n').length;
    let stub: string;
    try {
      const { gist, tokens } = await summarize(msg.content);
      summaryTokens += tokens;
      stub = gist.trim().length > 0
        ? summarizedEvictionStub(msg.callId, gist.trim())
        : evictionStub(msg.callId, lines);
    } catch {
      // Summarizer failed — never fail eviction; fall back to the blind stub.
      stub = evictionStub(msg.callId, lines);
    }
    transcript[idx] = { role: 'tool', callId: msg.callId, content: stub };
    evictedCallIds.push(msg.callId);
  }

  return {
    evicted: evictedCallIds.length > 0,
    beforeTokens,
    afterTokens: transcriptTokens(transcript),
    evictedCallIds,
    summaryTokens,
  };
}

// ── Scratchpad (model-curated notes) ────────────────────────────────────────────

/**
 * A small note buffer the leaf curates via the `note` tool. Notes are the distilled
 * substance a read leaves behind; they are always injected into the transcript (near
 * the top, as a `context` message) so they survive eviction of the raw reads. The
 * buffer is per-leaf state, NOT a worktree write — it never reaches the product diff.
 */
export interface Scratchpad {
  notes: string[];
}

export function newScratchpad(): Scratchpad {
  return { notes: [] };
}

/** Append a note. Empty/whitespace notes are ignored. Returns whether it landed. */
export function addNote(pad: Scratchpad, text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  pad.notes.push(t);
  return true;
}

/** Render the scratchpad as the `context` block injected into the transcript. */
export function renderScratchpad(pad: Scratchpad): string {
  if (pad.notes.length === 0) return '';
  const body = pad.notes.map((n, i) => `  ${i + 1}. ${n}`).join('\n');
  return (
    `YOUR NOTES (your durable working memory — distilled from what you have read; ` +
    `raw reads may be evicted to bound context, but these persist):\n${body}`
  );
}
