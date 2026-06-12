/**
 * Minimal stub implementations of the contract interfaces for tests.
 * These never import from features being built concurrently.
 */

import type { Goal, MemoryPointer, Metered } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Artifact, Report } from '../../src/contract/report.js';
import type { ToolBroker, ToolCall, ToolDef, ToolResult } from '../../src/contract/tool.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { FactoryEvent, EventStore } from '../../src/contract/events.js';
import type { Brain, BrainContext, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { DeterministicCheck, GoalTypeDef, Registry } from '../../src/contract/goal-type.js';
import type { MemoryView } from '../../src/contract/memory.js';

// ── FakeBroker ────────────────────────────────────────────────────────────

/**
 * A scripted ToolBroker test double. Returns scripted ToolResults in the order
 * they were provided; the last result repeats once the list is exhausted.
 * Records every call for assertion. Never imports the real broker.
 */
export class FakeBroker implements ToolBroker {
  private readonly results: ToolResult[];
  private callCount = 0;
  readonly calls: Array<{ goal: Goal; call: ToolCall }> = [];

  constructor(results: ToolResult[]) {
    this.results = results;
  }

  async execute(goal: Goal, call: ToolCall): Promise<ToolResult> {
    this.calls.push({ goal, call });
    const idx = Math.min(this.callCount, this.results.length - 1);
    this.callCount++;
    const result = this.results[idx];
    if (result === undefined) {
      // No scripted results — return a refusal
      return { callId: call.id, ok: false, output: 'FakeBroker: no scripted result' };
    }
    // Return the scripted result, but use the actual call's id for correlation
    return { ...result, callId: call.id };
  }
}

// ── EventStore stub ───────────────────────────────────────────────────────

export class MemoryEventStore implements EventStore {
  private readonly log: FactoryEvent[] = [];

  async append(e: FactoryEvent): Promise<void> {
    this.log.push(e);
  }

  async list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): Promise<FactoryEvent[]> {
    if (!filter) return [...this.log];
    return this.log.filter((e) => {
      if (filter.goalId && e.goalId !== filter.goalId) return false;
      if (filter.type && e.type !== filter.type) return false;
      return true;
    });
  }

  types(): string[] {
    return this.log.map((e) => e.type);
  }
}

// ── MemoryView stub ───────────────────────────────────────────────────────

export class NoopMemoryView implements MemoryView {
  async query(_topic: string, _scope: string[]): Promise<MemoryPointer[]> {
    return [];
  }
}

export class FixedMemoryView implements MemoryView {
  constructor(private readonly pointers: MemoryPointer[]) {}
  async query(_topic: string, _scope: string[]): Promise<MemoryPointer[]> {
    return this.pointers;
  }
}

// ── Registry builder ──────────────────────────────────────────────────────

export function buildRegistry(defs: GoalTypeDef[]): Registry {
  const map = new Map(defs.map((d) => [d.name, d]));
  return {
    get(name: string): GoalTypeDef {
      const def = map.get(name);
      if (!def) throw new Error(`Unknown type: ${name}`);
      return def;
    },
    has(name: string): boolean {
      return map.has(name);
    },
    names(): string[] {
      return [...map.keys()];
    },
  };
}

// ── GoalTypeDef factories ─────────────────────────────────────────────────

export function leafTypeDef(overrides: Partial<GoalTypeDef> = {}): GoalTypeDef {
  return {
    name: 'leaf',
    kind: 'make',
    family: 'test',
    leafOnly: true,
    tier: { default: 'low', ladder: ['low', 'mid', 'high'] },
    deterministic: [],
    judgeType: null,
    grants: [],
    ...overrides,
  };
}

export function nonLeafTypeDef(overrides: Partial<GoalTypeDef> = {}): GoalTypeDef {
  return {
    name: 'splitter',
    kind: 'make',
    family: 'test',
    leafOnly: false,
    tier: { default: 'low', ladder: ['low', 'mid', 'high'] },
    deterministic: [],
    judgeType: null,
    grants: [],
    ...overrides,
  };
}

// ── Deterministic check factories ─────────────────────────────────────────

export function alwaysPassCheck(name = 'always-pass'): DeterministicCheck {
  return {
    name,
    async run(_goal: Goal, _artifact: Artifact | null) {
      return { ok: true, detail: '' };
    },
  };
}

export function alwaysFailCheck(name = 'always-fail', detail = 'check failed'): DeterministicCheck {
  return {
    name,
    async run(_goal: Goal, _artifact: Artifact | null) {
      return { ok: false, detail };
    },
  };
}

export function failThenPassCheck(name = 'fail-once'): DeterministicCheck {
  let callCount = 0;
  return {
    name,
    async run(_goal: Goal, _artifact: Artifact | null) {
      callCount++;
      return callCount <= 1
        ? { ok: false, detail: `${name} failed on attempt ${callCount}` }
        : { ok: true, detail: '' };
    },
  };
}

// ── Brain stubs ───────────────────────────────────────────────────────────

/**
 * The raw, un-metered shape a test brain may declare: classic methods return
 * their plain values. {@link rawBrain} wraps each return in a zero-usage
 * {@link Metered} envelope and supplies a throwing `step`, so a test can author
 * brain behavior without repeating the metering boilerplate.
 */
export interface RawBrain {
  decide(goal: Goal, ctx: BrainContext): Promise<Decision>;
  produce(goal: Goal, ctx: BrainContext): Promise<Artifact>;
  judge(goal: Goal, subject: Artifact, rubric: string, ctx: BrainContext): Promise<Verdict>;
  repair(goal: Goal, artifact: Artifact, prescriptions: string[], ctx: BrainContext): Promise<Artifact>;
}

/** Adapt a raw-returning test brain into the metered {@link Brain} contract. */
export function rawBrain(raw: RawBrain): Brain {
  return {
    async decide(goal, ctx) {
      return { value: await raw.decide(goal, ctx), usage: ZERO_USAGE };
    },
    async produce(goal, ctx) {
      return { value: await raw.produce(goal, ctx), usage: ZERO_USAGE };
    },
    async judge(goal, subject, rubric, ctx) {
      return { value: await raw.judge(goal, subject, rubric, ctx), usage: ZERO_USAGE };
    },
    async repair(goal, artifact, prescriptions, ctx) {
      return { value: await raw.repair(goal, artifact, prescriptions, ctx), usage: ZERO_USAGE };
    },
    async step(): Promise<StepOutput> {
      throw new Error('rawBrain.step: not used in these tests');
    },
  };
}

type Metered_<T> = { value: T; usage: import('../../src/contract/goal.js').Usage };

export class ScriptedBrain implements Brain {
  private decideQueue: Metered_<Decision>[] = [];
  private produceQueue: Metered_<Artifact>[] = [];
  private judgeQueue: Metered_<Verdict>[] = [];
  private repairQueue: Metered_<Artifact>[] = [];

  queueDecide(...decisions: Decision[]): this {
    this.decideQueue.push(...decisions.map((d) => ({ value: d, usage: ZERO_USAGE })));
    return this;
  }

  queueDecideWithUsage(decision: Decision, usage: import('../../src/contract/goal.js').Usage): this {
    this.decideQueue.push({ value: decision, usage });
    return this;
  }

  queueProduce(...artifacts: Artifact[]): this {
    this.produceQueue.push(...artifacts.map((a) => ({ value: a, usage: ZERO_USAGE })));
    return this;
  }

  queueProduceWithUsage(artifact: Artifact, usage: import('../../src/contract/goal.js').Usage): this {
    this.produceQueue.push({ value: artifact, usage });
    return this;
  }

  queueJudge(...verdicts: Verdict[]): this {
    this.judgeQueue.push(...verdicts.map((v) => ({ value: v, usage: ZERO_USAGE })));
    return this;
  }

  queueJudgeWithUsage(verdict: Verdict, usage: import('../../src/contract/goal.js').Usage): this {
    this.judgeQueue.push({ value: verdict, usage });
    return this;
  }

  queueRepair(...artifacts: Artifact[]): this {
    this.repairQueue.push(...artifacts.map((a) => ({ value: a, usage: ZERO_USAGE })));
    return this;
  }

  queueRepairWithUsage(artifact: Artifact, usage: import('../../src/contract/goal.js').Usage): this {
    this.repairQueue.push({ value: artifact, usage });
    return this;
  }

  async decide(_goal: Goal, _ctx: BrainContext): Promise<Metered<Decision>> {
    const d = this.decideQueue.shift();
    if (!d) throw new Error('ScriptedBrain: no more decide results queued');
    return d;
  }

  async produce(_goal: Goal, _ctx: BrainContext): Promise<Metered<Artifact>> {
    const a = this.produceQueue.shift();
    if (!a) throw new Error('ScriptedBrain: no more produce results queued');
    return a;
  }

  async judge(_goal: Goal, _subject: Artifact, _rubric: string, _ctx: BrainContext): Promise<Metered<Verdict>> {
    const v = this.judgeQueue.shift();
    if (!v) throw new Error('ScriptedBrain: no more judge results queued');
    return v;
  }

  async repair(_goal: Goal, _artifact: Artifact, _prescriptions: string[], _ctx: BrainContext): Promise<Metered<Artifact>> {
    const a = this.repairQueue.shift();
    if (!a) throw new Error('ScriptedBrain: no more repair results queued');
    return a;
  }

  async step(
    _goal: Goal,
    _transcript: StepTranscript,
    _tools: ToolDef[],
    _ctx: BrainContext,
  ): Promise<StepOutput> {
    throw new Error('ScriptedBrain.step: not used in these tests');
  }
}

// ── Goal factories ────────────────────────────────────────────────────────

export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    type: 'leaf',
    parentId: null,
    title: 'test goal',
    spec: {},
    intent: 'production',
    scope: [],
    budget: {
      attempts: 5,
      tokens: 1000,
      toolCalls: 50,
      wallClockMs: 60_000,
    },
    memories: [],
    ...overrides,
  };
}

// ── Artifact factories ────────────────────────────────────────────────────

export function textArtifact(text = 'output'): Artifact {
  return { kind: 'text', text };
}

export function filesArtifact(files: { path: string; content: string }[]): Artifact {
  return { kind: 'files', files };
}

// ── Verdict factories ─────────────────────────────────────────────────────

export function passVerdict(): Verdict {
  return { pass: true, findings: [] };
}

export function failVerdict(
  title = 'failure',
  prescription?: string,
  escalated?: boolean,
  failureSignature?: string,
): Verdict {
  return {
    pass: false,
    findings: [
      {
        title,
        dimension: 'spec',
        severity: 'high',
        gating: true,
        ...(prescription ? { prescription } : {}),
        ...(escalated ? { escalated } : {}),
      },
    ],
    ...(failureSignature ? { failureSignature } : {}),
  };
}
