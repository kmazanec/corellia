/**
 * Broker-level grant enforcement for the web tools (issue: web-fetch-tool).
 *
 * Pins:
 *   - GRANT_TOOL_MAP maps web_fetch → web.fetch and web_search → web.search.
 *   - research-external (the one starter type holding web.fetch) is GRANTED
 *     web_fetch by the broker.
 *   - A build-family type (implement) that lacks web.fetch is REFUSED web_fetch,
 *     and the refusal is logged, not thrown.
 *   - The refusal stands even though the ToolImpl is registered — the grant, not
 *     registration, is what confines the capability.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GRANT_TOOL_MAP } from '../../src/contract/tool.js';
import type { ToolCall } from '../../src/contract/tool.js';
import type { Goal } from '../../src/contract/goal.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { Broker } from '../../src/engine/broker.js';
import { createRegistry } from '../../src/library/registry.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { webFetchTool } from '../../src/engine/web-tools.js';
import type { WebFetchTransport, HostResolver } from '../../src/engine/web-tools.js';

const registry = createRegistry(starterTypes());

function makeGoal(type: string): Goal {
  return {
    id: 'g1',
    type,
    parentId: null,
    title: 'test',
    spec: {},
    intent: 'production',
    scope: ['src/'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
  };
}

const call: ToolCall = { id: 'c1', name: 'web_fetch', args: { url: 'https://example.com/' } };

const publicResolver: HostResolver = async () => ['93.184.216.34'];
const transport: WebFetchTransport = async () => ({
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/plain' : null) },
  text: async () => 'ok',
});

let store: InMemoryEventStore;
let broker: Broker;

beforeEach(() => {
  store = new InMemoryEventStore();
  broker = new Broker({
    root: '/tmp/does-not-matter',
    registry,
    store,
    // web_fetch IS registered — the grant check, not registration, is the gate.
    tools: [webFetchTool({ transport, resolve: publicResolver, env: {} })],
  });
});

describe('GRANT_TOOL_MAP — web tool entries', () => {
  it('maps web_fetch → web.fetch and web_search → web.search', () => {
    expect(GRANT_TOOL_MAP.web_fetch).toEqual(['web.fetch']);
    expect(GRANT_TOOL_MAP.web_search).toEqual(['web.search']);
  });

  it('web_fetch carries no file grant', () => {
    expect(GRANT_TOOL_MAP.web_fetch).not.toContain('fs.read');
    expect(GRANT_TOOL_MAP.web_fetch).not.toContain('fs.write');
  });
});

describe('Broker — web_fetch grant enforcement', () => {
  it('grants web_fetch to research-external (holds web.fetch)', async () => {
    const res = await broker.execute(makeGoal('research-external'), call);
    expect(res.ok).toBe(true);
    expect(res.output).toContain('ok');
  });

  it('refuses web_fetch for a build type (implement lacks web.fetch)', async () => {
    const res = await broker.execute(makeGoal('implement'), call);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('not granted');
    expect(res.output).toContain('web.fetch');
  });

  it('logs the refusal as a tool-call event, not a throw', async () => {
    await broker.execute(makeGoal('implement'), call);
    const events = await store.list({ type: 'tool-call' });
    const refusal = events.find((e) => e.type === 'tool-call' && e.tool === 'web_fetch');
    expect(refusal).toBeDefined();
    expect(refusal && 'outcome' in refusal ? refusal.outcome : undefined).toBe('refused');
  });
});
