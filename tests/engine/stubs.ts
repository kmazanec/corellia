/**
 * Minimal stub implementations of the contract interfaces for tests.
 * These never import from features being built concurrently.
 */

import type { Goal, MemoryPointer } from '../../src/contract/goal.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Artifact, Report } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { FactoryEvent, EventStore } from '../../src/contract/events.js';
import type { Brain, BrainContext } from '../../src/contract/brain.js';
import type { DeterministicCheck, GoalTypeDef, Registry } from '../../src/contract/goal-type.js';
import type { MemoryView } from '../../src/contract/memory.js';

// ── EventStore stub ───────────────────────────────────────────────────────

export class MemoryEventStore implements EventStore {
  private readonly log: FactoryEvent[] = [];

  append(e: FactoryEvent): void {
    this.log.push(e);
  }

  list(filter?: { goalId?: string; type?: FactoryEvent['type'] }): FactoryEvent[] {
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
  query(_topic: string, _scope: string[]): MemoryPointer[] {
    return [];
  }
}

export class FixedMemoryView implements MemoryView {
  constructor(private readonly pointers: MemoryPointer[]) {}
  query(_topic: string, _scope: string[]): MemoryPointer[] {
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
    tier: { default: 'haiku', ladder: ['haiku', 'sonnet', 'opus'] },
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
    tier: { default: 'haiku', ladder: ['haiku', 'sonnet', 'opus'] },
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

export class ScriptedBrain implements Brain {
  private decideQueue: Decision[] = [];
  private produceQueue: Artifact[] = [];
  private judgeQueue: Verdict[] = [];
  private repairQueue: Artifact[] = [];

  queueDecide(...decisions: Decision[]): this {
    this.decideQueue.push(...decisions);
    return this;
  }

  queueProduce(...artifacts: Artifact[]): this {
    this.produceQueue.push(...artifacts);
    return this;
  }

  queueJudge(...verdicts: Verdict[]): this {
    this.judgeQueue.push(...verdicts);
    return this;
  }

  queueRepair(...artifacts: Artifact[]): this {
    this.repairQueue.push(...artifacts);
    return this;
  }

  async decide(_goal: Goal, _ctx: BrainContext): Promise<Decision> {
    const d = this.decideQueue.shift();
    if (!d) throw new Error('ScriptedBrain: no more decide results queued');
    return d;
  }

  async produce(_goal: Goal, _ctx: BrainContext): Promise<Artifact> {
    const a = this.produceQueue.shift();
    if (!a) throw new Error('ScriptedBrain: no more produce results queued');
    return a;
  }

  async judge(_goal: Goal, _subject: Artifact, _rubric: string, _ctx: BrainContext): Promise<Verdict> {
    const v = this.judgeQueue.shift();
    if (!v) throw new Error('ScriptedBrain: no more judge results queued');
    return v;
  }

  async repair(_goal: Goal, _artifact: Artifact, _prescriptions: string[], _ctx: BrainContext): Promise<Artifact> {
    const a = this.repairQueue.shift();
    if (!a) throw new Error('ScriptedBrain: no more repair results queued');
    return a;
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
