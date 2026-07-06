import { describe, expect, it } from 'vitest';
import type { Brain } from '../../src/contract/brain.js';
import type { ChildPlan } from '../../src/contract/decision.js';
import type { Goal } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Report } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import {
  isRepairableIntegrationVerdict,
  unionScope,
} from '../../src/engine/repair-integration.js';
import { runSplitRound } from '../../src/engine/split-round.js';
import {
  buildRegistry,
  failVerdict,
  makeGoal,
  MemoryEventStore,
  NoopMemoryView,
  nonLeafTypeDef,
  passVerdict,
  textArtifact,
} from './stubs.js';

const child = (overrides: Partial<ChildPlan> & Pick<ChildPlan, 'localId'>): ChildPlan => ({
  localId: overrides.localId,
  type: overrides.type ?? 'leaf',
  title: overrides.title ?? overrides.localId,
  spec: overrides.spec ?? {},
  dependsOn: overrides.dependsOn ?? [],
  scope: overrides.scope ?? [],
  budgetShare: overrides.budgetShare ?? 0.5,
});

const report = (overrides: Partial<Report> = {}): Report => ({
  artifact: textArtifact('child'),
  proof: [],
  lessons: [],
  memoriesUsed: [],
  blockers: [],
  findings: [],
  learned: '',
  ...overrides,
});

/** A brain whose integration judge returns each queued verdict in turn. */
function judgeSequenceBrain(verdicts: Verdict[]): Brain {
  let i = 0;
  return {
    async decide() {
      throw new Error('not expected');
    },
    async produce() {
      throw new Error('not expected');
    },
    async judge() {
      const verdict = verdicts[Math.min(i, verdicts.length - 1)]!;
      i += 1;
      return { value: verdict, usage: ZERO_USAGE };
    },
    async repair() {
      throw new Error('not expected');
    },
    async step() {
      throw new Error('not expected');
    },
  };
}

function registryWithIntegrationJudge() {
  return buildRegistry([
    nonLeafTypeDef({ name: 'splitter' }),
    nonLeafTypeDef({ name: 'judge-integration' }),
  ]);
}

function baseRoundParams(overrides: {
  store: MemoryEventStore;
  brain: Brain;
  children: ChildPlan[];
  runChild: (goal: Goal) => Promise<Report>;
}) {
  return {
    goal: makeGoal({ id: 'root', type: 'splitter' }),
    children: overrides.children,
    memory: new NoopMemoryView(),
    registry: registryWithIntegrationJudge(),
    brain: overrides.brain,
    goldenCapture: false,
    store: overrides.store,
    now: () => 42,
    activeRepoRoot: undefined,
    worktree: undefined,
    factsForRegions: undefined,
    headSha: undefined,
    checkContext: undefined,
    persist: async () => {},
    runChild: overrides.runChild,
  };
}

describe('isRepairableIntegrationVerdict', () => {
  it('is repairable when a failed verdict has a gating, non-escalated finding', () => {
    expect(isRepairableIntegrationVerdict(failVerdict('seam bug'))).toBe(true);
  });

  it('is not repairable for a passing verdict', () => {
    expect(isRepairableIntegrationVerdict(passVerdict())).toBe(false);
  });

  it('is not repairable when no finding is gating', () => {
    const advisoryOnly: Verdict = {
      pass: false,
      findings: [{ title: 'nit', dimension: 'efficiency', severity: 'low', gating: false }],
    };
    expect(isRepairableIntegrationVerdict(advisoryOnly)).toBe(false);
  });

  it('is not repairable when ANY finding is escalated (frozen-contract change)', () => {
    expect(isRepairableIntegrationVerdict(failVerdict('needs contract change', undefined, true))).toBe(false);
  });

  it('is not repairable when the verdict is absent', () => {
    expect(isRepairableIntegrationVerdict(undefined)).toBe(false);
  });
});

describe('unionScope', () => {
  it('unions child scopes, deduplicated and order-stable', () => {
    const union = unionScope([
      child({ localId: 'a', scope: ['src/guardrails', 'src/shared'] }),
      child({ localId: 'b', scope: ['src/orchestrator', 'src/shared'] }),
    ]);
    expect(union).toEqual(['src/guardrails', 'src/shared', 'src/orchestrator']);
  });

  it('is empty when no child declares a scope', () => {
    expect(unionScope([child({ localId: 'a' }), child({ localId: 'b' })])).toEqual([]);
  });
});

describe('repair-integration rung through runSplitRound', () => {
  it('integration fails then repair passes: spawns an implement repair child with union scope + findings, root emits', async () => {
    const store = new MemoryEventStore();
    // First integration judge fails (repairable); the re-judge after repair passes.
    const brain = judgeSequenceBrain([
      failVerdict('guardrails reject core inputs', 'accept single/MFJ/MFS/HoH'),
      passVerdict(),
    ]);
    const ranGoals: Goal[] = [];

    const round = await runSplitRound(
      baseRoundParams({
        store,
        brain,
        children: [
          child({ localId: 'guardrails', scope: ['src/guardrails'] }),
          child({ localId: 'orchestrator', scope: ['src/orchestrator'] }),
        ],
        async runChild(childGoal: Goal) {
          ranGoals.push(childGoal);
          return report();
        },
      }),
    );

    // The repair child was spawned as an ordinary implement child and run.
    const repairGoal = ranGoals.find((g) => g.id === 'root/repair-integration')!;
    expect(repairGoal).toBeDefined();
    const spawned = await store.list({ type: 'child-spawned' });
    const repairSpawn = spawned.find((e) => (e as { childId: string }).childId === 'root/repair-integration');
    expect(repairSpawn).toMatchObject({ childType: 'implement', dependsOn: [] });

    // Its scope is the union of the failing children's scopes, and the findings
    // (with prescription) reached its spec verbatim.
    expect(repairGoal.type).toBe('implement');
    expect(repairGoal.scope).toEqual(['src/guardrails', 'src/orchestrator']);
    const description = (repairGoal.spec as { description: string }).description;
    expect(description).toContain('guardrails reject core inputs');
    expect(description).toContain('accept single/MFJ/MFS/HoH');

    // A repair-applied event records the prescriptions used.
    const repairApplied = await store.list({ type: 'repair-applied' });
    expect(repairApplied).toMatchObject([
      { goalId: 'root/repair-integration', prescriptions: ['accept single/MFJ/MFS/HoH'] },
    ]);

    // The re-judge passed, so the round does not carry an integration blocker.
    expect(round.report.blockers).toEqual([]);
  });

  it('repair fails again: the round blocks as it does today (one repair per integrate)', async () => {
    const store = new MemoryEventStore();
    // Both the initial judge and the re-judge fail.
    const brain = judgeSequenceBrain([
      failVerdict('seam bug persists'),
      failVerdict('seam bug persists'),
    ]);
    const repairRuns: string[] = [];

    const round = await runSplitRound(
      baseRoundParams({
        store,
        brain,
        children: [child({ localId: 'a', scope: ['src/a'] })],
        async runChild(childGoal: Goal) {
          if (childGoal.id === 'root/repair-integration') repairRuns.push(childGoal.id);
          return report();
        },
      }),
    );

    // Exactly one repair child ran; the re-judge failed and the round blocks.
    expect(repairRuns).toHaveLength(1);
    expect(round.report.blockers).toEqual(['Integration eval failed: seam bug persists']);
    // Only one repair child was spawned — the rung does not loop.
    const spawned = await store.list({ type: 'child-spawned' });
    expect(spawned.filter((e) => (e as { childType: string }).childType === 'implement')).toHaveLength(1);
  });

  it('escalated finding: no repair child is spawned — it skips straight to block', async () => {
    const store = new MemoryEventStore();
    const brain = judgeSequenceBrain([failVerdict('needs a frozen-contract change', undefined, true)]);
    let repairRan = false;

    const round = await runSplitRound(
      baseRoundParams({
        store,
        brain,
        children: [child({ localId: 'a', scope: ['src/a'] })],
        async runChild(childGoal: Goal) {
          if (childGoal.id === 'root/repair-integration') repairRan = true;
          return report();
        },
      }),
    );

    // No repair child spawned or run — the escalated finding goes straight to block.
    expect(repairRan).toBe(false);
    const spawned = await store.list({ type: 'child-spawned' });
    expect(spawned.filter((e) => (e as { childId: string }).childId === 'root/repair-integration')).toEqual([]);
    expect(await store.list({ type: 'repair-applied' })).toEqual([]);
    expect(round.report.blockers).toEqual(['Integration eval failed: needs a frozen-contract change']);
  });
});
