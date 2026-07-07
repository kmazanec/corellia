/**
 * Tests for the Anthropic Messages API wire codec (anthropicWire). Pure encode/
 * decode over the codec's normalized request/response contract — no network. The
 * codec is the one place the Anthropic dialect lives; these tests pin the request
 * encoding (system/messages/tools/max_tokens), the response decoding (text +
 * tool_use), the usage→Usage mapping, and truncation detection.
 */

import { describe, it, expect } from 'vitest';
import {
  anthropicWire,
  readAnthropicUsage,
  buildAnthropicMessages,
  ANTHROPIC_VERSION,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
} from '../../src/brains/anthropic-wire.js';
import type { StepTranscript } from '../../src/contract/brain.js';
import type { ToolDef } from '../../src/contract/tool.js';

const tools: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

// ---------------------------------------------------------------------------
// URL + headers
// ---------------------------------------------------------------------------

describe('anthropicWire: url + headers', () => {
  it('posts to /messages under the resolved baseUrl', () => {
    expect(anthropicWire.url('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages');
  });

  it('sends x-api-key + anthropic-version, not a bearer token', () => {
    const h = anthropicWire.headers('sk-ant-key', undefined);
    expect(h['x-api-key']).toBe('sk-ant-key');
    expect(h['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Authorization']).toBeUndefined();
  });

  it('merges brain-level extra headers', () => {
    const h = anthropicWire.headers('k', { 'X-Title': 'Corellia' });
    expect(h['X-Title']).toBe('Corellia');
    expect(h['x-api-key']).toBe('k');
  });
});

// ---------------------------------------------------------------------------
// Completion request encoding
// ---------------------------------------------------------------------------

describe('anthropicWire: encodeCompletion', () => {
  it('always includes the required max_tokens', () => {
    const body = anthropicWire.encodeCompletion({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'hi' }],
      jsonMode: false,
    }) as { max_tokens: number };
    expect(body.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS);
  });

  it('lifts system messages into the top-level system field', () => {
    const body = anthropicWire.encodeCompletion({
      model: 'claude-opus-4-8',
      messages: [
        { role: 'system', content: 'You are a judge.' },
        { role: 'user', content: 'evaluate this' },
      ],
      jsonMode: false,
    }) as { system?: string; messages: { role: string; content: string }[] };
    expect(body.system).toBe('You are a judge.');
    // The system message must NOT remain in messages (Anthropic rejects role:system there).
    expect(body.messages).toEqual([{ role: 'user', content: 'evaluate this' }]);
  });

  it('concatenates multiple system messages', () => {
    const body = anthropicWire.encodeCompletion({
      model: 'm',
      messages: [
        { role: 'system', content: 'A' },
        { role: 'user', content: 'q' },
        { role: 'system', content: 'B' },
      ],
      jsonMode: false,
    }) as { system?: string };
    expect(body.system).toBe('A\n\nB');
  });

  it('omits system when there is no system message', () => {
    const body = anthropicWire.encodeCompletion({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
      jsonMode: false,
    }) as { system?: string };
    expect(body.system).toBeUndefined();
  });

  it('does not emit a response_format field (Anthropic has none) even in json mode', () => {
    const body = anthropicWire.encodeCompletion({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
      jsonMode: { schemaName: 'decision', schema: { type: 'object' } },
    }) as Record<string, unknown>;
    expect(body['response_format']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Completion response decoding
// ---------------------------------------------------------------------------

describe('anthropicWire: decodeCompletion', () => {
  it('joins text blocks into content', () => {
    const decoded = anthropicWire.decodeCompletion({
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(decoded.content).toBe('Hello world');
    expect(decoded.truncated).toBe(false);
    expect(decoded.usage.promptTokens).toBe(10);
    expect(decoded.usage.completionTokens).toBe(5);
  });

  it('flags truncation on stop_reason max_tokens', () => {
    const decoded = anthropicWire.decodeCompletion({
      content: [{ type: 'text', text: 'partial' }],
      stop_reason: 'max_tokens',
    });
    expect(decoded.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step request encoding (tools + transcript)
// ---------------------------------------------------------------------------

describe('anthropicWire: encodeStep', () => {
  it('encodes tools as {name, description, input_schema} and lifts the first context to system', () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'system prompt' },
      { role: 'context', content: 'a follow-up instruction' },
    ];
    const body = anthropicWire.encodeStep({
      model: 'claude-opus-4-8',
      transcript,
      tools,
      outputSchema: undefined,
      provider: undefined,
    }) as {
      system?: string;
      messages: { role: string; content: unknown }[];
      tools?: { name: string; description: string; input_schema: unknown }[];
      max_tokens: number;
    };
    expect(body.system).toBe('system prompt');
    expect(body.messages).toEqual([{ role: 'user', content: 'a follow-up instruction' }]);
    expect(body.tools).toEqual([
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ]);
    expect(body.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS);
  });

  it('encodes an assistant tool-call turn as text + tool_use blocks', () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'sys' },
      { role: 'assistant', content: 'let me read it', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'x.ts' } }] },
      { role: 'tool', callId: 'c1', content: 'file contents' },
    ];
    const body = anthropicWire.encodeStep({
      model: 'm',
      transcript,
      tools,
      outputSchema: undefined,
      provider: undefined,
    }) as { messages: { role: string; content: unknown }[] };

    // assistant turn: text block + tool_use block
    expect(body.messages[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me read it' },
        { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'x.ts' } },
      ],
    });
    // tool result: user turn with a tool_result block
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'file contents' }],
    });
  });

  it('omits the tools field on a tool-less (emit) step and renders history as plain text', () => {
    const transcript: StepTranscript = [
      { role: 'context', content: 'sys' },
      { role: 'assistant', content: 'read', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'x' } }] },
      { role: 'tool', callId: 'c1', content: 'body' },
    ];
    const body = anthropicWire.encodeStep({
      model: 'm',
      transcript,
      tools: [],
      outputSchema: { type: 'object' },
      provider: undefined,
    }) as { tools?: unknown; messages: { role: string; content: unknown }[] };
    expect(body.tools).toBeUndefined();
    // History flattened to plain strings — no tool_use / tool_result blocks.
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'read\n[called tools: read_file({"path":"x"})]' });
    expect(body.messages[1]).toEqual({ role: 'user', content: '[tool result c1]\nbody' });
  });

  it('drops the OpenRouter provider pin (no Anthropic-direct counterpart)', () => {
    const body = anthropicWire.encodeStep({
      model: 'm',
      transcript: [{ role: 'context', content: 'sys' }],
      tools,
      outputSchema: undefined,
      provider: { order: ['Anthropic'], allow_fallbacks: false },
    }) as Record<string, unknown>;
    expect(body['provider']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Step response decoding
// ---------------------------------------------------------------------------

describe('anthropicWire: decodeStep', () => {
  it('decodes tool_use blocks into normalized tool calls with JSON-string args', () => {
    const decoded = anthropicWire.decodeStep({
      content: [
        { type: 'text', text: 'calling' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/x.ts' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    expect(decoded.message.content).toBe('calling');
    expect(decoded.message.toolCalls).toEqual([
      { id: 'toolu_1', name: 'read_file', argumentsJson: '{"path":"src/x.ts"}' },
    ]);
    expect(decoded.truncated).toBe(false);
    expect(decoded.usage.promptTokens).toBe(100);
  });

  it('normalizes a pure-tool-call turn (no text) to content null', () => {
    const decoded = anthropicWire.decodeStep({
      content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }],
      stop_reason: 'tool_use',
    });
    expect(decoded.message.content).toBeNull();
    expect(decoded.message.toolCalls).toHaveLength(1);
  });

  it('decodes a plain text response with no tool calls', () => {
    const decoded = anthropicWire.decodeStep({
      content: [{ type: 'text', text: '```out/x.ts\nconsole.log(1)\n```' }],
      stop_reason: 'end_turn',
    });
    expect(decoded.message.content).toContain('console.log(1)');
    expect(decoded.message.toolCalls).toBeUndefined();
  });

  it('flags truncation on stop_reason max_tokens', () => {
    const decoded = anthropicWire.decodeStep({
      content: [{ type: 'text', text: 'cut' }],
      stop_reason: 'max_tokens',
    });
    expect(decoded.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

describe('readAnthropicUsage', () => {
  it('maps input/output tokens and omits costUsd (Anthropic reports no cost)', () => {
    const usage = readAnthropicUsage({ usage: { input_tokens: 200, output_tokens: 40 } });
    expect(usage.promptTokens).toBe(200);
    expect(usage.completionTokens).toBe(40);
    expect(usage.costUsd).toBeUndefined();
  });

  it('surfaces cache_read_input_tokens as cachedPromptTokens', () => {
    const usage = readAnthropicUsage({
      usage: { input_tokens: 300, output_tokens: 10, cache_read_input_tokens: 250 },
    });
    expect(usage.cachedPromptTokens).toBe(250);
  });

  it('returns ZERO_USAGE when no usage block is present', () => {
    const usage = readAnthropicUsage({});
    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildAnthropicMessages (system split)
// ---------------------------------------------------------------------------

describe('buildAnthropicMessages', () => {
  it('makes the first context the system string and later contexts user turns', () => {
    const { system, messages } = buildAnthropicMessages(
      [
        { role: 'context', content: 'sys' },
        { role: 'context', content: 'more' },
      ],
      false,
    );
    expect(system).toBe('sys');
    expect(messages).toEqual([{ role: 'user', content: 'more' }]);
  });

  it('drops an empty assistant text block, keeping only the tool_use block', () => {
    const { messages } = buildAnthropicMessages(
      [
        { role: 'context', content: 'sys' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', args: {} }] },
      ],
      false,
    );
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'c1', name: 't', input: {} }],
    });
  });
});
