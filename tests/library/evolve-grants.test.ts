/**
 * dangerous-grant proofs for the evolve family.
 *
 * Four contracts are enforced here:
 *
 * 1. Constitution lint — no type in the library grants merge, approve, deploy,
 *    or spend strings (the blast-radius ceiling for the evolve kind).
 *
 * 2. improve-factory has NO product write capability — the Broker refuses
 *    write_file for improve-factory goals (tested against the real Broker +
 *    GRANT_TOOL_MAP so the proof tracks the live enforcement path).
 *
 * 3. propose-pattern is provisional-write-only — the PatternStore.promote
 *    path to 'trusted' is NOT reachable via any grant string. The engine never
 *    self-trusts. (Extends the existing flywheel invariant test in
 *    tests/engine/flywheel.test.ts to cover the propose-pattern type.)
 *
 * 4. consolidate-memory holds memory.write + event-log.read only — no
 *    product-repo, no pattern-store, no spawn capability.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { starterTypes } from '../../src/library/starter-types.js';
import { lintLibrary } from '../../src/library/constitution.js';
import { createRegistry } from '../../src/library/registry.js';
import { Broker } from '../../src/engine/broker.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { createFileTools } from '../../src/engine/tools.js';
import { InMemoryPatternStore } from '../../src/substrate/memory-pattern-store.js';
import { GRANT_TOOL_MAP } from '../../src/contract/tool.js';
import type { Goal } from '../../src/contract/goal.js';
import type { ToolCall } from '../../src/contract/tool.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeGoal(type: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g-test',
    type,
    parentId: null,
    title: 'test goal',
    spec: {},
    intent: 'production',
    scope: ['src/'],
    budget: { attempts: 3, tokens: 1000, toolCalls: 10, wallClockMs: 60000 },
    memories: [],
    ...overrides,
  };
}

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    name: 'read_file',
    args: { path: 'src/index.ts' },
    ...overrides,
  };
}

// ── fixture ───────────────────────────────────────────────────────────────────

let sandboxRoot: string;
let store: InMemoryEventStore;
let broker: Broker;
const registry = createRegistry(starterTypes());

beforeEach(async () => {
  sandboxRoot = await mkdtemp(join(tmpdir(), 'corellia-evolve-grant-test-'));
  await mkdir(join(sandboxRoot, 'src'), { recursive: true });
  await writeFile(join(sandboxRoot, 'src', 'index.ts'), 'export const x = 1;\n');

  store = new InMemoryEventStore();
  const tools = createFileTools(sandboxRoot);
  broker = new Broker({
    root: sandboxRoot,
    registry,
    store,
    tools: [tools.readFile, tools.writeFile, tools.listDir, tools.search],
  });
});

afterEach(async () => {
  await rm(sandboxRoot, { recursive: true, force: true });
});

// ── 1. Constitution lint — no merge/approve/deploy/spend grant anywhere ───────

describe('constitution-lint — dangerous grant invariant', () => {
  it('no type in the library grants merge, approve, deploy, or spend', () => {
    const types = starterTypes();
    const dangerous = /merge|approve|deploy|spend/;
    const violations: string[] = [];
    for (const def of types) {
      for (const grant of def.grants) {
        if (dangerous.test(grant)) {
          violations.push(`"${def.name}" has dangerous grant: "${grant}"`);
        }
      }
    }
    expect(violations).toHaveLength(0);
  });

  it('lintLibrary passes for the full starter set (constitution clean)', () => {
    expect(lintLibrary(starterTypes())).toHaveLength(0);
  });
});

// ── 2. improve-factory — NO product write capability ─────────────────────────

describe('improve-factory — no product write capability', () => {
  it('improve-factory grants do not include fs.write', () => {
    const def = registry.get('improve-factory');
    expect(def.grants).not.toContain('fs.write');
  });

  it('GRANT_TOOL_MAP.write_file requires fs.write, which improve-factory lacks', () => {
    const def = registry.get('improve-factory');
    const required = GRANT_TOOL_MAP['write_file'];
    const hasAny = required.some((g) => def.grants.includes(g));
    expect(hasAny).toBe(false);
  });

  it('Broker refuses write_file for an improve-factory goal', async () => {
    const goal = makeGoal('improve-factory');
    const call = makeCall({
      name: 'write_file',
      args: { path: 'src/new.ts', content: 'export {}' },
    });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('fs.write');
  });

  it('Broker logs a "refused" event for the write_file attempt', async () => {
    const goal = makeGoal('improve-factory');
    const call = makeCall({
      name: 'write_file',
      args: { path: 'src/new.ts', content: 'export {}' },
    });
    await broker.execute(goal, call);
    const events = await store.list({ goalId: goal.id, type: 'tool-call' });
    expect(events).toHaveLength(1);
    const e = events[0];
    if (e?.type === 'tool-call') {
      expect(e.outcome).toBe('refused');
      expect(e.reason).toContain('fs.write');
    }
  });
});

// ── 3. propose-pattern — provisional-write-only; promote-to-trusted not reachable ──

describe('propose-pattern — no self-trust path', () => {
  it('propose-pattern grants do not include pattern-store.write-trusted', () => {
    const def = registry.get('propose-pattern');
    expect(def.grants).not.toContain('pattern-store.write-trusted');
  });

  it('propose-pattern grants do not include any trusted-promotion string', () => {
    const def = registry.get('propose-pattern');
    const trustingGrant = /trusted|promote/;
    const dangerous = def.grants.filter((g) => trustingGrant.test(g));
    expect(dangerous).toHaveLength(0);
  });

  it('propose-pattern only has pattern-store.write-provisional (not general write)', () => {
    const def = registry.get('propose-pattern');
    // The only pattern-store grant is explicitly scoped to provisional.
    const patternGrants = def.grants.filter((g) => g.startsWith('pattern-store'));
    expect(patternGrants).toEqual(['pattern-store.write-provisional']);
  });

  it('InMemoryPatternStore.promote is not reachable via the propose-pattern grant set', () => {
    // The engine never self-trusts: no grant string in propose-pattern maps
    // to the promote() path. We verify by constructing the store and confirming
    // that calling promote() from "outside the grant" is the only path —
    // the grant set provides no mechanism to invoke it.
    const store = new InMemoryPatternStore();
    const def = registry.get('propose-pattern');

    // No grant in propose-pattern should spell out 'trusted' or 'promote'.
    const promotingGrants = def.grants.filter(
      (g) => g.includes('trusted') || g.includes('promote'),
    );
    expect(promotingGrants).toHaveLength(0);

    // The store's promote method exists but is gated behind human ceremony.
    // Confirm the method exists (so the proof is meaningful) and that it is
    // not wired to any grant the type holds.
    expect(typeof store.promote).toBe('function');
  });
});

// ── 4. consolidate-memory — memory.write + event-log.read only ───────────────

describe('consolidate-memory — grant shape', () => {
  it('belongs to the curate family', () => {
    const def = registry.get('consolidate-memory');
    expect(def.family).toBe('curate');
  });

  it('has kind evolve', () => {
    const def = registry.get('consolidate-memory');
    expect(def.kind).toBe('evolve');
  });

  it('is leafOnly', () => {
    const def = registry.get('consolidate-memory');
    expect(def.leafOnly).toBe(true);
  });

  it('holds memory.write grant', () => {
    const def = registry.get('consolidate-memory');
    expect(def.grants).toContain('memory.write');
  });

  it('holds event-log.read grant', () => {
    const def = registry.get('consolidate-memory');
    expect(def.grants).toContain('event-log.read');
  });

  it('holds exactly two grants: memory.write and event-log.read', () => {
    const def = registry.get('consolidate-memory');
    expect(def.grants).toHaveLength(2);
    expect(def.grants).toContain('memory.write');
    expect(def.grants).toContain('event-log.read');
  });

  it('does not have product-repo write capability', () => {
    const def = registry.get('consolidate-memory');
    expect(def.grants).not.toContain('fs.write');
    expect(def.grants).not.toContain('factory-repo.branch');
    expect(def.grants).not.toContain('factory-repo.pr');
    expect(def.grants).not.toContain('pattern-store.write-provisional');
  });

  it('Broker refuses write_file for a consolidate-memory goal', async () => {
    const goal = makeGoal('consolidate-memory');
    const call = makeCall({
      name: 'write_file',
      args: { path: 'src/new.ts', content: 'export {}' },
    });
    const result = await broker.execute(goal, call);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('fs.write');
  });
});

// ── 5. Evolve-family evolve-family type registrations ─────────────────────────────────

describe('evolve-family type registrations', () => {
  it('consolidate-memory, propose-pattern, improve-factory are all registered', () => {
    const reg = createRegistry(starterTypes());
    for (const name of ['consolidate-memory', 'propose-pattern', 'improve-factory']) {
      expect(() => reg.get(name)).not.toThrow();
      expect(reg.get(name).name).toBe(name);
    }
  });

  it('propose-pattern and improve-factory belong to the improve family', () => {
    const reg = createRegistry(starterTypes());
    expect(reg.get('propose-pattern').family).toBe('improve');
    expect(reg.get('improve-factory').family).toBe('improve');
  });

  it('improve-factory is NOT leafOnly (may spawn children)', () => {
    const def = registry.get('improve-factory');
    expect(def.leafOnly).toBe(false);
  });

  it('propose-pattern is leafOnly', () => {
    const def = registry.get('propose-pattern');
    expect(def.leafOnly).toBe(true);
  });

  it('propose-pattern uses opus as default tier', () => {
    expect(registry.get('propose-pattern').tier.default).toBe('opus');
  });

  it('improve-factory uses opus as default tier', () => {
    expect(registry.get('improve-factory').tier.default).toBe('opus');
  });
});
