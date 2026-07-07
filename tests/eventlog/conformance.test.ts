/**
 * Tests for the event-log conformance checker (src/eventlog/conformance.ts).
 *
 * The checker replays a run's log and asserts the runtime conduct invariants the
 * constitution cannot catch at lint time. These tests build synthetic logs — a
 * clean one that passes, and one deliberately corrupted per invariant that
 * produces exactly that invariant's violation — and, as an integration
 * assertion, run the checker over the greeting e2e's real event stream.
 */

import { describe, it, expect } from 'vitest';

import {
  checkConformance,
  formatConformance,
  type ConformanceViolation,
} from '../../src/eventlog/conformance.js';
import { parseConformArgs, runConform } from '../../src/eventlog/conform-cli.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { Engine } from '../../src/engine/engine.js';
import { createRegistry } from '../../src/library/registry.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { ScriptedBrain } from '../../src/brains/scripted.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { Artifact } from '../../src/contract/report.js';
import type { DecisionBrief } from '../../src/contract/decision.js';
import type { EventStore } from '../../src/contract/events.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const pass: Verdict = { pass: true, findings: [] };

function goal(id: string, type: string): Goal {
  return {
    id,
    type,
    parentId: null,
    title: `goal ${id}`,
    spec: {},
    intent: 'production',
    scope: [],
    budget: { attempts: 1, tokens: 0, toolCalls: 0, wallClockMs: 0 },
    memories: [],
  };
}

function received(id: string, type: string, at: number): FactoryEvent {
  return { type: 'goal-received', at, goalId: id, goal: goal(id, type) };
}

function det(id: string, at: number): FactoryEvent {
  return { type: 'deterministic-checked', at, goalId: id, verdict: pass };
}

function verdict(id: string, judgeType: string, at: number): FactoryEvent {
  return { type: 'judge-verdict', at, goalId: id, judgeType, verdict: pass, tier: 'mid' };
}

function filesTouched(id: string, at: number): FactoryEvent {
  return { type: 'files-touched', at, goalId: id, scope: ['x/'], files: [{ path: 'x/a.ts', inScope: true }] };
}

function brief(deadlineMs: number): DecisionBrief {
  return { question: 'q?', options: ['a', 'b'], links: [], deadlineMs, onTimeout: 'deny' };
}

/** A clean, well-formed log exercising every invariant's happy path. */
function cleanLog(): FactoryEvent[] {
  return [
    received('g1', 'implement', 1),
    det('g1', 2),
    verdict('g1', 'critique-code', 3),
    filesTouched('g1', 4), // an implement (make) goal writing — allowed.
    { type: 'round-started', at: 5, goalId: 'root', round: 1, spentUsd: 1.0, roundWallClockMs: 1000 },
    { type: 'round-started', at: 6, goalId: 'root', round: 2, spentUsd: 2.5, roundWallClockMs: 1000 },
    { type: 'ceiling-reached', at: 7, goalId: 'root', spentUsd: 3.0, ceilingUsd: 5.0 },
    { type: 'blocked', at: 8, goalId: 'g1', brief: brief(60_000), resolution: 'answered' },
    { type: 'parked', at: 9, goalId: 'g1', brief: brief(60_000), ttlMs: 30_000 },
    { type: 'worktree-created', at: 10, goalId: 'g1', treeId: 't1', branch: 'b1', path: '/w/t1' },
    { type: 'branch-pushed', at: 11, goalId: 'g1', treeId: 't1', branch: 'b1', remote: 'origin' },
    { type: 'worktree-collected', at: 12, goalId: 'g1', treeId: 't1', branch: 'b1', commits: ['abc'] },
  ];
}

// A registry with the real kind mapping, for the judge-write invariant.
const registry = createRegistry(starterTypes());

// ── Clean log passes ────────────────────────────────────────────────────────────

describe('checkConformance — clean log', () => {
  it('a well-formed log produces no violations', () => {
    expect(checkConformance(cleanLog(), { registry })).toEqual([]);
  });

  it('formatConformance renders PASS for an empty violation list', () => {
    expect(formatConformance([])).toBe('PASS');
  });
});

// ── (a) deterministic-before-judge ───────────────────────────────────────────────

describe('checkConformance — deterministic-before-judge', () => {
  it('flags a gate that ran after the judge verdict', () => {
    const events: FactoryEvent[] = [
      received('g1', 'implement', 1),
      verdict('g1', 'critique-code', 2), // judge first …
      det('g1', 3), // … gate after — reordered.
    ];
    const v = checkConformance(events, { registry });
    expect(v).toHaveLength(1);
    expect(v[0]!.invariant).toBe('deterministic-before-judge');
    expect(v[0]!.goalId).toBe('g1');
    expect(v[0]!.indices).toEqual([2, 1]);
  });

  it('does not flag a judge-only goal (no per-goal deterministic gate)', () => {
    const events: FactoryEvent[] = [received('g1', 'implement', 1), verdict('g1', 'critique-code', 2)];
    expect(onlyInvariant(checkConformance(events, { registry }), 'deterministic-before-judge')).toEqual([]);
  });
});

// ── (b) no judge-authored writes ─────────────────────────────────────────────────

describe('checkConformance — no-judge-authored-writes', () => {
  it('flags a judge-kind goal that authored a write (kind from registry)', () => {
    const events: FactoryEvent[] = [
      received('j1', 'critique-code', 1), // a judge-kind goal spawned as its own goal …
      filesTouched('j1', 2), // … that then wrote — forbidden.
    ];
    const v = onlyInvariant(checkConformance(events, { registry }), 'no-judge-authored-writes');
    expect(v).toHaveLength(1);
    expect(v[0]!.goalId).toBe('j1');
    expect(v[0]!.indices).toEqual([1]);
    expect(v[0]!.detail).not.toContain('naming convention');
  });

  it('does not flag a make-kind goal writing', () => {
    const events: FactoryEvent[] = [received('g1', 'implement', 1), filesTouched('g1', 2)];
    expect(onlyInvariant(checkConformance(events, { registry }), 'no-judge-authored-writes')).toEqual([]);
  });

  it('falls back to the naming convention when no registry is supplied, and flags it', () => {
    const events: FactoryEvent[] = [received('j1', 'critique-code', 1), filesTouched('j1', 2)];
    const v = onlyInvariant(checkConformance(events), 'no-judge-authored-writes');
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toContain('naming convention');
  });
});

// ── (c) spend monotone and ≤ ceiling ─────────────────────────────────────────────

describe('checkConformance — spend', () => {
  it('flags spend that decreased between checkpoints', () => {
    const events: FactoryEvent[] = [
      { type: 'round-started', at: 1, goalId: 'root', round: 1, spentUsd: 3.0, roundWallClockMs: 1 },
      { type: 'round-started', at: 2, goalId: 'root', round: 2, spentUsd: 1.5, roundWallClockMs: 1 },
    ];
    const v = onlyInvariant(checkConformance(events), 'spend-monotone');
    expect(v).toHaveLength(1);
    expect(v[0]!.indices).toEqual([0, 1]);
  });

  it('flags spend that exceeded the declared ceiling', () => {
    const events: FactoryEvent[] = [
      { type: 'round-started', at: 1, goalId: 'root', round: 1, spentUsd: 7.0, roundWallClockMs: 1 },
      { type: 'ceiling-reached', at: 2, goalId: 'root', spentUsd: 8.0, ceilingUsd: 5.0 },
    ];
    const v = onlyInvariant(checkConformance(events), 'spend-under-ceiling');
    // Both the round-started ($7) and the ceiling-reached ($8) exceed $5.
    expect(v.map((x) => x.detail)).toEqual([
      expect.stringContaining('$7'),
      expect.stringContaining('$8'),
    ]);
  });

  it('skips the ceiling check honestly when the log carries no ceiling', () => {
    const events: FactoryEvent[] = [
      { type: 'round-started', at: 1, goalId: 'root', round: 1, spentUsd: 100, roundWallClockMs: 1 },
    ];
    expect(onlyInvariant(checkConformance(events), 'spend-under-ceiling')).toEqual([]);
  });
});

// ── (d) briefs carry deadlines; parks carry ttls ─────────────────────────────────

describe('checkConformance — briefs and parks', () => {
  it('flags a blocked brief with a non-positive deadline', () => {
    const events: FactoryEvent[] = [
      { type: 'blocked', at: 1, goalId: 'g1', brief: brief(0), resolution: 'deny' },
    ];
    const v = onlyInvariant(checkConformance(events), 'brief-carries-deadline');
    expect(v).toHaveLength(1);
    expect(v[0]!.goalId).toBe('g1');
  });

  it('flags a parked goal with a non-positive ttl', () => {
    const events: FactoryEvent[] = [
      { type: 'parked', at: 1, goalId: 'g1', brief: brief(60_000), ttlMs: 0 },
    ];
    const v = onlyInvariant(checkConformance(events), 'park-carries-ttl');
    expect(v).toHaveLength(1);
  });
});

// ── (e) worktree lifecycle well-nested ───────────────────────────────────────────

describe('checkConformance — worktree-well-nested', () => {
  it('flags a worktree used before it was created', () => {
    const events: FactoryEvent[] = [
      { type: 'worktree-collected', at: 1, goalId: 'g1', treeId: 't1', branch: 'b', commits: [] },
    ];
    const v = onlyInvariant(checkConformance(events), 'worktree-well-nested');
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toContain('never created');
  });

  it('flags use-after-remove (a push after the tree was collected)', () => {
    const events: FactoryEvent[] = [
      { type: 'worktree-created', at: 1, goalId: 'g1', treeId: 't1', branch: 'b', path: '/w' },
      { type: 'worktree-collected', at: 2, goalId: 'g1', treeId: 't1', branch: 'b', commits: [] },
      { type: 'branch-pushed', at: 3, goalId: 'g1', treeId: 't1', branch: 'b', remote: 'origin' },
    ];
    const v = onlyInvariant(checkConformance(events), 'worktree-well-nested');
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toContain('after it was already collected');
  });

  it('does not flag a re-created worktree id after a clean teardown', () => {
    const events: FactoryEvent[] = [
      { type: 'worktree-created', at: 1, goalId: 'g1', treeId: 't1', branch: 'b', path: '/w' },
      { type: 'worktree-collected', at: 2, goalId: 'g1', treeId: 't1', branch: 'b', commits: [] },
      { type: 'worktree-created', at: 3, goalId: 'g2', treeId: 't1', branch: 'b', path: '/w' },
      { type: 'worktree-collected', at: 4, goalId: 'g2', treeId: 't1', branch: 'b', commits: [] },
    ];
    expect(onlyInvariant(checkConformance(events), 'worktree-well-nested')).toEqual([]);
  });
});

// ── Multiple corruptions at once ─────────────────────────────────────────────────

describe('checkConformance — several violations', () => {
  it('reports each corrupted invariant independently', () => {
    const events: FactoryEvent[] = [
      received('j1', 'critique-code', 1),
      filesTouched('j1', 2), // judge write
      { type: 'round-started', at: 3, goalId: 'root', round: 1, spentUsd: 5, roundWallClockMs: 1 },
      { type: 'round-started', at: 4, goalId: 'root', round: 2, spentUsd: 2, roundWallClockMs: 1 }, // spend drop
      { type: 'blocked', at: 5, goalId: 'g1', brief: brief(-1), resolution: 'deny' }, // bad deadline
    ];
    const kinds = new Set(checkConformance(events, { registry }).map((x) => x.invariant));
    expect(kinds).toEqual(
      new Set(['no-judge-authored-writes', 'spend-monotone', 'brief-carries-deadline']),
    );
  });
});

// ── CLI ──────────────────────────────────────────────────────────────────────────

describe('conform CLI', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { log: (l: string) => out.push(l), error: (l: string) => err.push(l), out, err };
  };
  const storeOf = (events: FactoryEvent[]): EventStore => ({
    append: async () => {},
    list: async () => events,
  });

  it('prints PASS and exits 0 on a clean log', async () => {
    const c = io();
    const { code } = await runConform(parseConformArgs(['x.jsonl']), c, {}, { makeStore: () => storeOf(cleanLog()) });
    expect(code).toBe(0);
    expect(c.out.join('\n')).toContain('PASS');
  });

  it('prints the violations and exits 1 on a corrupted log', async () => {
    const c = io();
    const corrupted: FactoryEvent[] = [received('j1', 'critique-code', 1), filesTouched('j1', 2)];
    const { code } = await runConform(parseConformArgs(['x.jsonl']), c, {}, { makeStore: () => storeOf(corrupted) });
    expect(code).toBe(1);
    expect(c.err.join('\n')).toContain('no-judge-authored-writes');
  });

  it('rejects an unknown option with exit 2', async () => {
    const c = io();
    const { code } = await runConform(parseConformArgs(['--bogus']), c, {});
    expect(code).toBe(2);
    expect(c.err.join('\n')).toContain('unknown option');
  });
});

// ── Integration: the greeting e2e's real event stream conforms ───────────────────

describe('checkConformance — greeting e2e real stream', () => {
  it('the greeting run produces a conformant log', async () => {
    const store = new InMemoryEventStore();
    const brain = greetingBrain();
    const engine = new Engine({ registry, brain, store, memory: { query: async () => [] } });
    await engine.run(greetingRoot());

    const events = await store.list();
    const violations = checkConformance(events, { registry });
    expect(violations, formatConformance(violations)).toEqual([]);
  });
});

// ── Local greeting fixtures (mirrors tests/e2e/greeting.test.ts) ──────────────────

function greetingRoot(): Goal {
  return {
    id: 'greeting-demo',
    type: 'deliver-intent',
    parentId: null,
    title: 'Ship a greeting CLI',
    spec: { description: 'A CLI that prints a greeting and farewell' },
    intent: 'production',
    scope: ['out/greeting/'],
    budget: { attempts: 5, tokens: 50_000, toolCalls: 100, wallClockMs: 300_000 },
    memories: [],
  };
}

function greetingBrain(): ScriptedBrain {
  const formatMjs: Artifact = {
    kind: 'files',
    files: [{ path: 'out/greeting/format.mjs', content: 'export const GREETING_TEMPLATE = (n) => `Hello, ${n}!`;\nexport const FAREWELL_TEMPLATE = (n) => `Goodbye, ${n}!`;\n' }],
  };
  const helloV1: Artifact = {
    kind: 'files',
    files: [{ path: 'out/greeting/hello.mjs', content: "import { GREETING } from './format.mjs';\nconst name = process.argv[2] ?? 'world';\nprocess.stdout.write(GREETING(name) + '\\n');\n" }],
  };
  const helloV2: Artifact = {
    kind: 'files',
    files: [{ path: 'out/greeting/hello.mjs', content: "import { GREETING_TEMPLATE } from './format.mjs';\nconst name = process.argv[2] ?? 'world';\nprocess.stdout.write(GREETING_TEMPLATE(name) + '\\n');\n" }],
  };
  const farewellV1: Artifact = {
    kind: 'files',
    files: [{ path: 'out/greeting/farewell.mjs', content: "import { FAREWELL_TEMPLATE } from './format.mjs';\nconst name = process.argv[2] ?? 'world';\nprocess.stdout.write(FAREWELL_TEMPLATE(name) + '\\n');\n" }],
  };
  const helloV1Verdict: Verdict = {
    pass: false,
    findings: [{ title: 'Wrong import binding', dimension: 'spec', severity: 'high', gating: true, prescription: 'Use GREETING_TEMPLATE' }],
  };
  return new ScriptedBrain({
    decide: {
      'Ship a greeting CLI': [
        {
          kind: 'split',
          children: [
            { localId: 'contract', type: 'freeze-contract', title: 'Freeze greeting format contract', spec: {}, dependsOn: [], scope: ['out/greeting/'], budgetShare: 0.2 },
            { localId: 'hello-cmd', type: 'implement', title: 'Implement hello command', spec: {}, dependsOn: ['contract'], scope: ['out/greeting/'], budgetShare: 0.35 },
            { localId: 'farewell-cmd', type: 'implement', title: 'Implement farewell command', spec: {}, dependsOn: ['contract'], scope: ['out/greeting/'], budgetShare: 0.35 },
          ],
        },
      ],
    },
    produce: {
      'Freeze greeting format contract': [formatMjs],
      'Implement hello command': [helloV1],
      'Implement farewell command': [farewellV1],
    },
    judge: {
      'Ship a greeting CLI': [pass, pass],
      'Freeze greeting format contract': [pass],
      'Implement hello command': [helloV1Verdict, pass],
      'Implement farewell command': [pass],
    },
    repair: { 'Implement hello command': [helloV2] },
  });
}

// ── Utility ──────────────────────────────────────────────────────────────────────

/** The violations of exactly one invariant, for focused assertions. */
function onlyInvariant(
  violations: ConformanceViolation[],
  invariant: ConformanceViolation['invariant'],
): ConformanceViolation[] {
  return violations.filter((v) => v.invariant === invariant);
}
