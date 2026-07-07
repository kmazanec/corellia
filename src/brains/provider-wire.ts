/**
 * The provider-wire codec seam: the one place a concrete provider's HTTP wire
 * format lives. {@link LlmBrain} owns the retry/timeout/backoff discipline, the
 * prompt construction, the JSON repair, and the non-delivery recovery — all
 * provider-agnostic. What is NOT agnostic is the shape of the request body, the
 * URL, the auth headers, and how usage/content is read back. A {@link ProviderWire}
 * captures exactly that and nothing more, so a second provider (Anthropic's
 * Messages API) joins by supplying a codec, not by cloning the brain.
 *
 * The two operations the brain performs over the wire:
 *   - a COMPLETIONS call (decide/produce/judge/repair/summarize): messages + an
 *     optional JSON-output mode → `{ content, usage, truncated }`.
 *   - a STEP call (the agentic tool loop): a transcript + tool defs → a normalized
 *     {@link WireStepResponse} the brain translates into tool-calls or an artifact.
 *
 * A codec decodes each provider's raw response into these NORMALIZED shapes, so
 * the brain's translation/usage code (`translateStepResponse`, the completions
 * content/truncation read) is written once against the normalized shape and never
 * learns a provider's dialect.
 */

import type { Usage } from '../contract/goal.js';
import type { StepTranscript } from '../contract/brain.js';
import type { ToolDef } from '../contract/tool.js';

// ---------------------------------------------------------------------------
// Normalized wire shapes — the codec's OUTPUT, the brain's INPUT
// ---------------------------------------------------------------------------

/** A completions result after the codec has read the provider's response. */
export interface WireCompletionResult {
  /** The assistant text (already provider-detail-free; control-token stripping is the brain's). */
  content: string;
  /** Provider-reported usage for this call. */
  usage: Usage;
  /** True when the provider signalled the output was cut off at the token limit. */
  truncated: boolean;
}

/** One tool call in a normalized step response (provider-independent). */
export interface WireStepToolCall {
  id: string;
  /** The tool name. */
  name: string;
  /** The raw arguments STRING as the provider emitted it (JSON text); the brain parses it. */
  argumentsJson: string;
}

/** The normalized message on a step response's first choice. */
export interface WireStepChoiceMessage {
  content: string | null;
  toolCalls?: WireStepToolCall[];
}

/**
 * A step response after the codec has normalized the provider's shape into a
 * single-choice message plus a truncation signal and usage. The brain's
 * translateStepResponse consumes exactly this — it never sees a provider's own
 * `choices[]`/`content[]` layout.
 */
export interface WireStepResponse {
  message: WireStepChoiceMessage;
  /** True when the provider signalled a length cutoff on this response. */
  truncated: boolean;
  usage: Usage;
}

/** What a completions call needs from the caller to encode a request body. */
export interface WireCompletionRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  /**
   * `false` → free-form text. `true` → provider JSON-object mode. An object →
   * schema-constrained JSON (name + schema). A codec that cannot honour a mode
   * degrades gracefully (Anthropic has no response_format; it relies on the
   * prompt instruction, exactly as the OpenAI json path already does downstream).
   */
  jsonMode: boolean | { schemaName: string; schema: Record<string, unknown> };
}

/** What a step call needs from the caller to encode a request body. */
export interface WireStepRequest {
  model: string;
  transcript: StepTranscript;
  tools: ToolDef[];
  outputSchema: Record<string, unknown> | undefined;
  /** OpenRouter provider-routing pin (ADR-005). Only the OpenAI codec emits it. */
  provider: { order: string[]; allow_fallbacks: boolean } | undefined;
}

/**
 * A concrete provider's HTTP wire format. The brain holds one per resolved model
 * and delegates URL, headers, and body encode/decode to it; everything else
 * (retry, timeout, backoff, prompt text, JSON repair) stays in the brain.
 */
export interface ProviderWire {
  /** A short stable id for diagnostics/tests, e.g. 'openai' or 'anthropic'. */
  readonly name: string;

  /** The full URL for a completions/step POST, given the resolved baseUrl. */
  url(baseUrl: string): string;

  /** Auth + content headers for a request, given the resolved api key and any brain-level extras. */
  headers(apiKey: string, extra: Record<string, string> | undefined): Record<string, string>;

  /** Encode a completions request into the provider's wire body. */
  encodeCompletion(req: WireCompletionRequest): unknown;

  /** Decode a provider completions response body into the normalized result. */
  decodeCompletion(body: unknown): WireCompletionResult;

  /** Encode a step request into the provider's wire body. */
  encodeStep(req: WireStepRequest): unknown;

  /** Decode a provider step response body into the normalized step response. */
  decodeStep(body: unknown): WireStepResponse;
}
