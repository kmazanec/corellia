/**
 * End-to-end test: the greeting tree runs deterministically using InMemoryEventStore.
 *
 * Assertions verify:
 *   - The run emits a final passing report (no blockers).
 *   - A repair-applied event occurred (the control loop was exercised).
 *   - The contract child completed (emitted) before both implement children started
 *     (received) — dependency sequencing is correct.
 *   - renderTree output contains all three child titles.
 *   - Deterministic checks ran before any judge-verdict for each leaf goal.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { Engine } from '../../src/engine/engine.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import { renderTree } from '../../src/eventlog/projections.js';
import { createRegistry } from '../../src/library/registry.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { ScriptedBrain } from '../../src/brains/scripted.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { Goal } from '../../src/contract/goal.js';
import type { FactoryEvent } from '../../src/contract/events.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const formatMjs: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/format.mjs',
      content: `export const GREETING_TEMPLATE = (name) => \`Hello, \${name}!\`;\nexport const FAREWELL_TEMPLATE = (name) => \`Goodbye, \${name}!\`;\n`,
    },
  ],
};

const helloV1: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/hello.mjs',
      // Deliberately wrong import binding — triggers critique-code failure
      content: `import { GREETING } from './format.mjs';\nconst name = process.argv[2] ?? 'world';\nprocess.stdout.write(GREETING(name) + '\\n');\n`,
    },
  ],
};

const helloV2: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/hello.mjs',
      content: `import { GREETING_TEMPLATE } from './format.mjs';\nconst name = process.argv[2] ?? 'world';\nprocess.stdout.write(GREETING_TEMPLATE(name) + '\\n');\n`,
    },
  ],
};

const farewellV1: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/farewell.mjs',
      content: `import { FAREWELL_TEMPLATE } from './format.mjs';\nconst name = process.argv[2] ?? 'world';\nprocess.stdout.write(FAREWELL_TEMPLATE(name) + '\\n');\n`,
    },
  ],
};

const pass: Verdict = { pass: true, findings: [] };

const helloV1Verdict: Verdict = {
  pass: false,
  findings: [
    {
      title: 'Wrong import binding: GREETING is not exported by format.mjs',
      dimension: 'spec',
      severity: 'high',
      gating: true,
      prescription: 'Replace GREETING with GREETING_TEMPLATE in the import statement',
    },
  ],
};

function makeRootGoal(): Goal {
  return {
    id: 'greeting-demo',
    type: 'deliver-intent',
    parentId: null,
    title: 'Ship a greeting CLI',
    spec: { description: 'A CLI that prints a greeting and farewell' },
    intent: 'production',
    scope: ['out/greeting/'],
    budget: {
      attempts: 5,
      tokens: 50_000,
      toolCalls: 100,
      wallClockMs: 300_000,
    },
    memories: [],
  };
}

function makeBrain(): ScriptedBrain {
  return new ScriptedBrain({
    decide: {
      'Ship a greeting CLI': [
        {
          kind: 'split',
          children: [
            {
              localId: 'contract',
              type: 'freeze-contract',
              title: 'Freeze greeting format contract',
              spec: {},
              dependsOn: [],
              scope: ['out/greeting/'],
              budgetShare: 0.2,
            },
            {
              localId: 'hello-cmd',
              type: 'implement',
              title: 'Implement hello command',
              spec: {},
              dependsOn: ['contract'],
              scope: ['out/greeting/'],
              budgetShare: 0.35,
            },
            {
              localId: 'farewell-cmd',
              type: 'implement',
              title: 'Implement farewell command',
              spec: {},
              dependsOn: ['contract'],
              scope: ['out/greeting/'],
              budgetShare: 0.35,
            },
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
      // judge-split and judge-integration are both invoked with the root goal
      'Ship a greeting CLI': [pass, pass],
      'Freeze greeting format contract': [pass],
      // critique-code for hello-cmd: fail first (repair rung), then pass on recheck
      'Implement hello command': [helloV1Verdict, pass],
      'Implement farewell command': [pass],
    },
    repair: {
      'Implement hello command': [helloV2],
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('greeting e2e', () => {
  let store: InMemoryEventStore;
  let report: Awaited<ReturnType<Engine['run']>>;

  beforeEach(async () => {
    store = new InMemoryEventStore();
    const brain = makeBrain();
    const registry = createRegistry(starterTypes());
    const memory = { query: async () => [] };

    const engine = new Engine({ registry, brain, store, memory });
    report = await engine.run(makeRootGoal());
  });

  // 1. Final report passes (no blockers) ─────────────────────────────────────

  it('emits a final passing report', () => {
    expect(report.blockers).toHaveLength(0);
    expect(report.artifact).not.toBeNull();
  });

  // 2. Repair rung was exercised ─────────────────────────────────────────────

  it('emits at least one repair-applied event', async () => {
    const repairs = await store.list({ type: 'repair-applied' });
    expect(repairs.length).toBeGreaterThanOrEqual(1);
  });

  // 3. Contract child completes before implement children start ──────────────
  //
  // "Completed" = emitted event for the contract goal.
  // "Started"   = goal-received event for each implement child.
  // Both implement children depend on contract, so the engine awaits
  // contract's Promise before spawning either of them.

  it('contract child emits before implement children are received', async () => {
    const events: FactoryEvent[] = await store.list();

    const contractGoalId = 'greeting-demo/contract';
    const helloGoalId = 'greeting-demo/hello-cmd';
    const farewellGoalId = 'greeting-demo/farewell-cmd';

    const contractEmittedIdx = events.findIndex(
      (e) => e.type === 'emitted' && e.goalId === contractGoalId,
    );
    const helloReceivedIdx = events.findIndex(
      (e) => e.type === 'goal-received' && e.goalId === helloGoalId,
    );
    const farewellReceivedIdx = events.findIndex(
      (e) => e.type === 'goal-received' && e.goalId === farewellGoalId,
    );

    expect(contractEmittedIdx).toBeGreaterThan(-1);
    expect(helloReceivedIdx).toBeGreaterThan(-1);
    expect(farewellReceivedIdx).toBeGreaterThan(-1);

    // Contract must have emitted before either implement child was received
    expect(contractEmittedIdx).toBeLessThan(helloReceivedIdx);
    expect(contractEmittedIdx).toBeLessThan(farewellReceivedIdx);
  });

  // 4. renderTree contains all three child titles ────────────────────────────

  it('renderTree contains all three child titles', async () => {
    const tree = renderTree(await store.list());
    expect(tree).toContain('Freeze greeting format contract');
    expect(tree).toContain('Implement hello command');
    expect(tree).toContain('Implement farewell command');
  });

  // 5. Deterministic checks ran before any judge-verdict for each leaf ────────
  //
  // For each leaf goal that has both deterministic-checked and judge-verdict
  // events, the first deterministic-checked must appear before the first
  // judge-verdict in the overall event log.

  it('deterministic checks precede judge verdicts for each leaf', async () => {
    const events: FactoryEvent[] = await store.list();

    // Collect all goal IDs that have at least one deterministic-checked event
    const leafIds = new Set(
      events
        .filter((e) => e.type === 'deterministic-checked')
        .map((e) => e.goalId),
    );

    for (const goalId of leafIds) {
      const firstDetIdx = events.findIndex(
        (e) => e.type === 'deterministic-checked' && e.goalId === goalId,
      );
      const firstJudgeIdx = events.findIndex(
        (e) => e.type === 'judge-verdict' && e.goalId === goalId,
      );

      if (firstJudgeIdx === -1) {
        // No judge for this goal (deterministic check may have failed or no judgeType).
        // This is fine — deterministic gating worked correctly.
        continue;
      }

      expect(firstDetIdx).toBeLessThan(firstJudgeIdx);
    }
  });
});
