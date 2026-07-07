/**
 * The Anthropic Messages API wire codec — the second concrete {@link ProviderWire},
 * speaking POST /v1/messages directly against api.anthropic.com instead of the
 * OpenAI-compatible chat-completions shape. It exists so the models the factory
 * leans on hardest (the Anthropic family) can be reached direct — for provider
 * redundancy against an OpenRouter outage, and to unlock direct pricing — without
 * cloning the brain. Only the WIRE FORMAT differs; the retry/timeout/backoff loop,
 * prompt text, JSON repair, and non-delivery recovery all stay in {@link LlmBrain}.
 *
 * Dialect differences from the OpenAI codec this maps across:
 *  - Auth: `x-api-key` + `anthropic-version` headers, not a bearer token.
 *  - `max_tokens` is REQUIRED on every request (OpenAI defaults it).
 *  - `system` is a top-level field, not a `messages` entry with role 'system'.
 *  - Tool calls are `tool_use` content BLOCKS in the assistant turn, and tool
 *    results are `tool_result` blocks in a following user turn — not a dedicated
 *    'tool' role with a flat string.
 *  - Usage is `{ input_tokens, output_tokens, cache_read_input_tokens }`; the API
 *    reports no dollar cost, so {@link readAnthropicUsage} returns tokens only and
 *    the engine applies its measured token→cost path (ADR-017) exactly as it does
 *    for any token-only endpoint.
 *  - There is no `response_format`; JSON-output modes rely on the prompt
 *    instruction the brain already emits (the emit/decide/judge prompts carry the
 *    shape in text), and the brain's `stripJsonEnvelope` tolerates a fenced reply.
 *
 * Prompt caching is deliberately OUT of scope here (a follow-on): no
 * `cache_control` breakpoints are emitted. `cache_read_input_tokens` is still READ
 * back into {@link Usage.cachedPromptTokens} so the cost summary is correct if a
 * cache ever warms, but this codec never asks for caching.
 */

import { ZERO_USAGE, type Usage } from '../contract/goal.js';
import type { StepTranscript } from '../contract/brain.js';
import type { ToolDef } from '../contract/tool.js';
import type {
  ProviderWire,
  WireCompletionRequest,
  WireCompletionResult,
  WireStepRequest,
  WireStepResponse,
  WireStepToolCall,
} from './provider-wire.js';

/** The Anthropic API version header value pinned by this adapter (stable, model-independent). */
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * The `max_tokens` the adapter sends when the brain does not specify one. The
 * Messages API rejects a request without `max_tokens`; the brain's completion
 * path carries no token cap of its own, so a generous default lets a large
 * structured artifact finish without an artificial mid-stream cut. The provider
 * still bounds real runaway by the tree deadline (ADR-046) and per-request
 * timeout, so a high ceiling here is safe.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 32_000;

// ---------------------------------------------------------------------------
// Anthropic Messages API wire types
// ---------------------------------------------------------------------------

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicToolParam {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicToolParam[];
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  /** Prompt tokens served from the cache, when caching is in play. */
  cache_read_input_tokens?: number;
}

interface AnthropicResponseBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content?: AnthropicResponseBlock[];
  /** 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'. 'max_tokens' means truncated. */
  stop_reason?: string;
  usage?: AnthropicUsage;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * Read Anthropic usage into the provider-agnostic {@link Usage}. The Messages API
 * reports no dollar cost, so `costUsd` is omitted — the engine applies its measured
 * token→cost ceiling exactly as it does for any token-only endpoint (ADR-017).
 * `cache_read_input_tokens` maps to {@link Usage.cachedPromptTokens} so a warmed
 * cache is credited if caching is ever enabled (a follow-on).
 */
export function readAnthropicUsage(data: { usage?: AnthropicUsage }): Usage {
  const u = data.usage;
  if (!u) return ZERO_USAGE;
  const promptTokens = u.input_tokens ?? 0;
  const completionTokens = u.output_tokens ?? 0;
  const cachedPromptTokens = u.cache_read_input_tokens;
  return {
    promptTokens,
    completionTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
  };
}

// ---------------------------------------------------------------------------
// Transcript → Anthropic messages
// ---------------------------------------------------------------------------

/**
 * Split a {@link StepTranscript} into the Anthropic `system` string and the
 * `messages` array. The transcript's roles map to the Messages API shape:
 * - the FIRST 'context' message becomes the top-level `system` string; later
 *   'context' messages become user turns (the brain uses them for follow-up
 *   instructions, mirroring the OpenAI codec's first-context-is-system rule).
 * - an 'assistant' turn with tool calls becomes an assistant message whose
 *   content is `text` + `tool_use` blocks; without tool calls it is a plain
 *   assistant string.
 * - a 'tool' result becomes a USER message carrying a single `tool_result` block
 *   (the Messages API delivers tool output through the user turn, not a 'tool' role).
 *
 * On a TOOL-LESS request (the dedicated emit call) the history is rendered as
 * plain text, mirroring the OpenAI codec: assistant tool-call turns and tool
 * results are flattened into readable user/assistant strings so the provider sees
 * an ordinary chat and the emit does not wedge on tool machinery with no tools.
 */
export function buildAnthropicMessages(
  transcript: StepTranscript,
  plainTextHistory: boolean,
): { system: string | undefined; messages: AnthropicMessage[] } {
  let system: string | undefined;
  let contextCount = 0;
  const messages: AnthropicMessage[] = [];

  for (const msg of transcript) {
    if (msg.role === 'context') {
      if (contextCount === 0) {
        system = msg.content;
      } else {
        messages.push({ role: 'user', content: msg.content });
      }
      contextCount++;
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        if (plainTextHistory) {
          const callsText = msg.toolCalls
            .map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`)
            .join(', ');
          messages.push({
            role: 'assistant',
            content: `${msg.content}\n[called tools: ${callsText}]`.trim(),
          });
        } else {
          const blocks: AnthropicContentBlock[] = [];
          if (msg.content.trim().length > 0) {
            blocks.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
          }
          messages.push({ role: 'assistant', content: blocks });
        }
      } else {
        messages.push({ role: 'assistant', content: msg.content });
      }
    } else {
      if (plainTextHistory) {
        messages.push({
          role: 'user',
          content: `[tool result ${msg.callId}]\n${msg.content}`,
        });
      } else {
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.callId, content: msg.content }],
        });
      }
    }
  }

  return { system, messages };
}

/** Map {@link ToolDef}s to Anthropic tool params (input_schema is the JSON Schema). */
function buildAnthropicTools(tools: ToolDef[]): AnthropicToolParam[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ---------------------------------------------------------------------------
// Response → normalized shapes
// ---------------------------------------------------------------------------

/** Concatenate all `text` blocks of an Anthropic response into one string. */
function joinTextBlocks(blocks: AnthropicResponseBlock[] | undefined): string {
  if (!blocks) return '';
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

/** Extract the tool_use blocks of an Anthropic response as normalized step tool calls. */
function readToolCalls(blocks: AnthropicResponseBlock[] | undefined): WireStepToolCall[] {
  if (!blocks) return [];
  const calls: WireStepToolCall[] = [];
  for (const b of blocks) {
    if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      // The brain parses argumentsJson with JSON.parse; the API already delivers a
      // structured `input` object, so re-serialize it to the string the brain expects.
      calls.push({ id: b.id, name: b.name, argumentsJson: JSON.stringify(b.input ?? {}) });
    }
  }
  return calls;
}

// ---------------------------------------------------------------------------
// The codec
// ---------------------------------------------------------------------------

/** The Anthropic Messages API codec. */
export const anthropicWire: ProviderWire = {
  name: 'anthropic',

  url(baseUrl: string): string {
    return `${baseUrl}/messages`;
  },

  headers(apiKey: string, extra: Record<string, string> | undefined): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      ...extra,
    };
  },

  encodeCompletion(req: WireCompletionRequest): unknown {
    // The completion messages carry roles 'system' | 'user' | 'assistant'. Anthropic
    // takes `system` as a top-level string (not a message), so lift every 'system'
    // message out and concatenate them, and pass the rest through as user/assistant.
    // jsonMode has no wire counterpart on Anthropic — the brain's prompt already
    // states the required shape in text, and stripJsonEnvelope tolerates a fence.
    const systemParts: string[] = [];
    const messages: AnthropicMessage[] = [];
    for (const m of req.messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const system = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;
    return {
      model: req.model,
      max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      ...(system !== undefined ? { system } : {}),
      messages,
    } satisfies AnthropicRequest;
  },

  decodeCompletion(body: unknown): WireCompletionResult {
    const data = body as AnthropicResponse;
    return {
      content: joinTextBlocks(data.content),
      usage: readAnthropicUsage(data),
      truncated: data.stop_reason === 'max_tokens',
    };
  },

  encodeStep(req: WireStepRequest): unknown {
    const anthropicTools = buildAnthropicTools(req.tools);
    // Mirror the OpenAI codec: a tool-less step (the dedicated emit call) renders
    // history as plain text so no tool machinery appears with no tools declared.
    const plainTextHistory = req.tools.length === 0;
    const { system, messages } = buildAnthropicMessages(req.transcript, plainTextHistory);
    return {
      model: req.model,
      max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      ...(system !== undefined ? { system } : {}),
      messages,
      // Omit an empty tools array (parity with the OpenAI codec, and the Messages
      // API rejects `tools: []`).
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    } satisfies AnthropicRequest;
    // NOTE: req.provider (OpenRouter routing pin) is intentionally dropped — it is
    // an OpenRouter concept with no Anthropic-direct counterpart.
  },

  decodeStep(body: unknown): WireStepResponse {
    const data = body as AnthropicResponse;
    const toolCalls = readToolCalls(data.content);
    const text = joinTextBlocks(data.content);
    return {
      message: {
        // A tool-use turn may carry no text; normalize an empty string to null so
        // the brain's translate treats it as a pure tool-call turn.
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      truncated: data.stop_reason === 'max_tokens',
      usage: readAnthropicUsage(data),
    };
  },
};
