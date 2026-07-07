/**
 * The OpenAI-compatible chat-completions wire codec — the default provider dialect
 * (OpenRouter, OpenAI, local OpenAI-shaped endpoints). It is the reference
 * {@link ProviderWire}: the request/response shapes here are exactly what the brain
 * spoke before the codec seam existed, so a model with no explicit provider tag
 * routes through this codec and its bytes are unchanged.
 *
 * Only the WIRE FORMAT lives here — URL suffix, bearer auth, the `messages`/`tools`
 * request body, and reading `choices[0]` / `usage` back. The retry/timeout/backoff
 * loop, prompt text, JSON repair, and non-delivery recovery all stay in the brain.
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

// ---------------------------------------------------------------------------
// OpenAI-compatible wire types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface WireJsonSchema {
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?:
    | { type: 'json_object' }
    | { type: 'json_schema'; json_schema: WireJsonSchema };
}

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** OpenRouter reports cost here when usage accounting is enabled. */
  cost?: number;
  /** OpenRouter/OpenAI prompt-cache breakdown. */
  prompt_tokens_details?: { cached_tokens?: number };
  /** DeepSeek-style prompt cache hit tokens (flat field on the usage object). */
  prompt_cache_hit_tokens?: number;
}

interface ChatChoice {
  message: { role: string; content: string };
  /** Provider truncation signal: 'length' means the output was cut off mid-stream. */
  finish_reason?: string;
}

interface ChatResponse {
  choices: ChatChoice[];
  usage?: ChatUsage;
}

interface WireToolParam {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface WireToolCallMessage {
  role: 'assistant';
  content: string | null;
  tool_calls: WireToolCall[];
}

interface WireToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | WireToolCallMessage
  | WireToolResultMessage;

interface StepRequest {
  model: string;
  messages: WireMessage[];
  tools?: WireToolParam[];
  response_format?: { type: 'json_object' };
  provider?: { order: string[]; allow_fallbacks: boolean };
}

interface StepChoiceMessage {
  role: string;
  content: string | null;
  tool_calls?: WireToolCall[];
}

interface StepChoice {
  message: StepChoiceMessage;
  finish_reason?: string;
}

interface StepResponse {
  choices: StepChoice[];
  usage?: ChatUsage;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * Extract provider-reported usage from a chat-completions response JSON.
 * When the response carries no usage block, returns {@link ZERO_USAGE}.
 * When tokens are present but cost is absent, returns usage without costUsd
 * so the engine can apply the conservative token-only ceiling fallback.
 */
export function readUsage(data: { usage?: ChatUsage }): Usage {
  const u = data.usage;
  if (!u) return ZERO_USAGE;
  const promptTokens = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;
  const cachedPromptTokens: number | undefined =
    u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? undefined;
  const base: Usage = {
    promptTokens,
    completionTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
  };
  return u.cost !== undefined ? { ...base, costUsd: u.cost } : base;
}

// ---------------------------------------------------------------------------
// Step request shaping — pure (transcript, tools, model) -> wire body
// ---------------------------------------------------------------------------

/**
 * Build the OpenAI-compatible chat-completions request body for one step.
 * Pure and deterministic: given the same inputs in the same order, produces
 * byte-identical JSON serialization (prefix stability).
 *
 * Transcript mapping:
 * - 'context' role: first message → system; subsequent → user
 * - 'assistant' with toolCalls → assistant with tool_calls[]
 * - 'assistant' with no toolCalls → plain assistant content message
 * - 'tool' → role:'tool' with tool_call_id
 *
 * Provider routing (F-64 / ADR-005): when `providerConfig` is supplied, it is
 * included as the `provider` field on the wire body, pinning the provider order
 * and cache-affinity setting for this tier's requests. Absent → field omitted
 * (wire-compatible: providers that do not understand the field ignore it).
 */
export function buildStepRequest(
  transcript: StepTranscript,
  tools: ToolDef[],
  model: string,
  outputSchema?: Record<string, unknown>,
  providerConfig?: { order: string[]; allow_fallbacks: boolean },
): StepRequest {
  let contextCount = 0;
  const messages: WireMessage[] = [];
  // On a TOOL-LESS request (the dedicated emit call), tool machinery must not
  // appear in the messages either: assistant `tool_calls` turns and tool-role
  // results sent with no `tools` defined is a shape providers' chat templating
  // wedges on — the emit hung at every tier across live-tail runs 1–15 while
  // the same transcript's tool-bearing exploration steps completed fine
  // (isolated by elimination: schema flattening, strict:false, and json_object
  // each left the hang in place). Render the history as plain text instead, so
  // the provider sees an ordinary chat.
  const plainTextHistory = tools.length === 0;

  for (const msg of transcript) {
    if (msg.role === 'context') {
      if (contextCount === 0) {
        messages.push({ role: 'system', content: msg.content });
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
          const wireCalls: WireToolCall[] = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          }));
          messages.push({
            role: 'assistant',
            content: msg.content,
            tool_calls: wireCalls,
          });
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
          role: 'tool',
          tool_call_id: msg.callId,
          content: msg.content,
        });
      }
    }
  }

  const wireTools: WireToolParam[] = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  // Apply a response_format ONLY on a tool-less step (the dedicated emit
  // call). Sending an output-schema grammar AND tools on the same request is a
  // contradiction — "your message must match the criteria schema" vs "call a
  // tool" — which providers handle inconsistently and which wedges/hangs the
  // request (run ee51401d). During exploration the model is free to call tools
  // or return a plain message.
  //
  // The mode is the lightweight `json_object`, NOT a `json_schema` grammar:
  // schema-constrained decode over a long step-loop prefill (tool-call history,
  // ~19 steps) hangs these providers outright at every tier, strict or not
  // (live-tail runs 13–14 isolated this; runs 1–12 died the same way). The
  // SCHEMA travels in the emit instruction text instead (step-loop-emit pushes
  // it into the transcript), and the deterministic gate (criteriaWellFormed
  // et al.) remains the real validator — a malformed emit takes the normal
  // retry path instead of a provider hang.
  const responseFormat: StepRequest['response_format'] =
    outputSchema !== undefined && wireTools.length === 0 ? { type: 'json_object' } : undefined;

  return {
    model,
    messages,
    // Omit an EMPTY tools array: providers disagree on `tools: []` (some
    // reject, some misbehave when tool history is present with no tools).
    ...(wireTools.length > 0 ? { tools: wireTools } : {}),
    ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
    // Provider routing: include only when per-tier config is present (F-64 / ADR-005).
    // Absent config → field absent → wire-compatible with providers that ignore it.
    ...(providerConfig !== undefined ? { provider: providerConfig } : {}),
  };
}

// ---------------------------------------------------------------------------
// The codec
// ---------------------------------------------------------------------------

function normalizeStepResponse(resp: StepResponse): WireStepResponse {
  const choice = resp.choices[0];
  if (!choice) throw new Error('LLM step returned no choices');
  const toolCalls: WireStepToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    argumentsJson: tc.function.arguments,
  }));
  return {
    message: {
      content: choice.message.content,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    },
    truncated: choice.finish_reason === 'length',
    usage: readUsage(resp),
  };
}

/** The OpenAI-compatible chat-completions codec — the default provider dialect. */
export const openAiWire: ProviderWire = {
  name: 'openai',

  url(baseUrl: string): string {
    return `${baseUrl}/chat/completions`;
  },

  headers(apiKey: string, extra: Record<string, string> | undefined): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extra,
    };
  },

  encodeCompletion(req: WireCompletionRequest): unknown {
    const responseFormat: ChatRequest['response_format'] =
      req.jsonMode === false
        ? undefined
        : req.jsonMode === true
          ? { type: 'json_object' }
          : {
              type: 'json_schema',
              json_schema: { name: req.jsonMode.schemaName, strict: false, schema: req.jsonMode.schema },
            };
    return {
      model: req.model,
      messages: req.messages,
      ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
    } satisfies ChatRequest;
  },

  decodeCompletion(body: unknown): WireCompletionResult {
    const data = body as ChatResponse;
    const content = data.choices[0]?.message?.content ?? '';
    const truncated = data.choices[0]?.finish_reason === 'length';
    return { content, usage: readUsage(data), truncated };
  },

  encodeStep(req: WireStepRequest): unknown {
    return buildStepRequest(req.transcript, req.tools, req.model, req.outputSchema, req.provider);
  },

  decodeStep(body: unknown): WireStepResponse {
    return normalizeStepResponse(body as StepResponse);
  },
};
