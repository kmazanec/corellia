/**
 * Synthetic factory runs, for developing and testing without a live model.
 * {@link sampleRun} produces the event sequence of one plausible job: a root
 * goal splits into modules, each module decides, calls tools, produces, and
 * emits, and the root judges and emits. Every event is a real `FactoryEvent`,
 * so anything reading the log sees exactly what a real run writes. The
 * simulated engine (`./simulated-engine.ts`) plays these into a store; the
 * operator console's tests and simulator use them directly.
 */

import type { FactoryEvent } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';

export type SampleOutcome = 'done' | 'failed' | 'parked' | 'running';

export interface SampleRunOptions {
  jobId: string;
  title: string;
  /** Wall-clock of the first event. */
  startAt: number;
  /** Module titles; one child goal each. */
  modules?: string[];
  outcome?: SampleOutcome;
  /** ms between consecutive events. */
  stepMs?: number;
  /** The root goal as received, when the run is for a real commission. */
  rootGoal?: Goal;
}

const DEFAULT_MODULES = ['Contract and types', 'Core implementation', 'Tests and fixtures'];

export function sampleRun(opts: SampleRunOptions): FactoryEvent[] {
  const { jobId, title, startAt, outcome = 'done', stepMs = 1_500 } = opts;
  const modules = opts.modules ?? DEFAULT_MODULES;
  let at = startAt;
  const tick = (): number => (at += stepMs);
  const out: FactoryEvent[] = [];

  out.push({ type: 'goal-received', at, goalId: jobId, goal: opts.rootGoal ?? goal(jobId, null, 'feature', title) });
  out.push({
    type: 'decided',
    at: tick(),
    goalId: jobId,
    decision: {
      kind: 'split',
      children: modules.map((m, i) => ({
        localId: `m${i + 1}`,
        type: 'implement',
        title: m,
        spec: {},
        dependsOn: i === 0 ? [] : ['m1'],
        scope: [`src/${slug(m)}/**`],
        budgetShare: 1 / modules.length,
      })),
    },
    usage: usage(4_200, 900, 0.021),
  });

  modules.forEach((m, i) => {
    const childId = `${jobId}.${i + 1}`;
    const last = i === modules.length - 1;
    out.push({ type: 'child-spawned', at: tick(), goalId: jobId, childId, childType: 'implement', dependsOn: i === 0 ? [] : [`${jobId}.1`] });
    out.push({ type: 'goal-received', at: tick(), goalId: childId, goal: goal(childId, jobId, 'implement', m) });
    out.push({ type: 'decided', at: tick(), goalId: childId, decision: { kind: 'satisfy' }, usage: usage(2_100, 300, 0.008) });
    out.push({ type: 'tool-call', at: tick(), goalId: childId, tool: 'read_file', callId: `${childId}-c1`, outcome: 'ran', args: { path: `src/${slug(m)}/index.ts` } });
    out.push({ type: 'step', at: tick(), goalId: childId, index: 0, outputKind: 'tool-calls', usage: usage(6_800, 1_200, 0.031) });
    out.push({ type: 'tool-call', at: tick(), goalId: childId, tool: 'write_file', callId: `${childId}-c2`, outcome: 'ran', args: { path: `src/${slug(m)}/index.ts` } });

    if (last && outcome === 'running') return;
    if (last && outcome === 'parked') {
      const brief = {
        question: `Should "${m}" keep the existing public API or break it?`,
        options: ['Keep the API', 'Break it and migrate callers'],
        links: [],
        deadlineMs: 86_400_000,
        onTimeout: 'park' as const,
      };
      out.push({ type: 'blocked', at: tick(), goalId: childId, brief, resolution: 'park' });
      out.push({ type: 'parked', at: tick(), goalId: childId, brief, ttlMs: 86_400_000 });
      return;
    }

    out.push({ type: 'step', at: tick(), goalId: childId, index: 1, outputKind: 'artifact', usage: usage(7_400, 2_600, 0.044) });
    out.push({ type: 'produced', at: tick(), goalId: childId, usage: usage(0, 0, 0) });
    out.push({ type: 'deterministic-checked', at: tick(), goalId: childId, verdict: { pass: true, findings: [] } });
    const blockers = last && outcome === 'failed' ? ['typecheck failed in the generated module'] : [];
    out.push({ type: 'emitted', at: tick(), goalId: childId, report: report(blockers) });
  });

  if (outcome === 'running') return out;
  if (outcome === 'parked') {
    const parked = [...out].reverse().find((e) => e.type === 'parked');
    if (parked?.type === 'parked') out.push({ ...parked, at: tick(), goalId: jobId });
    return out;
  }

  out.push({ type: 'judge-verdict', at: tick(), goalId: jobId, judgeType: 'integration', tier: 'mid', verdict: { pass: outcome === 'done', findings: [] }, usage: usage(9_000, 700, 0.052) });
  out.push({ type: 'emitted', at: tick(), goalId: jobId, report: report(outcome === 'failed' ? ['module 3 blocked'] : []) });
  return out;
}

function goal(id: string, parentId: string | null, type: string, title: string): Goal {
  return {
    id,
    type,
    parentId,
    title,
    spec: {},
    intent: 'production',
    scope: parentId === null ? ['**'] : [`src/${slug(title)}/**`],
    budget: { attempts: 3, tokens: 200_000, toolCalls: 60, wallClockMs: 1_800_000 },
    memories: [],
  };
}

function report(blockers: string[]) {
  return { artifact: null, proof: [], lessons: [], memoriesUsed: [], blockers, findings: [], learned: '' };
}

function usage(promptTokens: number, completionTokens: number, costUsd: number) {
  return { promptTokens, completionTokens, costUsd };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
