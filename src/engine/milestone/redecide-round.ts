import type { Brain, BrainContext } from '../../contract/brain.js';
import type { ChildPlan } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Goal, Tier, Usage } from '../../contract/goal.js';
import type { Registry } from '../../contract/goal-type.js';
import type { Artifact } from '../../contract/report.js';
import type { Finding, Verdict } from '../../contract/verdict.js';
import { validateSplit } from '../split-validation.js';
import { diffBodiesWithinScope } from '../worktree.js';
import type { RoundAssessment } from './round-assessment.js';

export type RoundReDecision =
  | { children: ChildPlan[] }
  | { halt: true };

export async function reDecideMilestoneRound(params: {
  goal: Goal;
  priorAssessment: RoundAssessment;
  priorRoundRef: string | null;
  worktreeRoot: string | undefined;
  registry: Registry;
  brain: Brain;
  store: EventStore;
  now: () => number;
  decideSkill: string | undefined;
  tier: Tier;
  debitUsage: (usage: Usage) => void;
}): Promise<RoundReDecision> {
  const decideResult = await params.brain.decide(
    params.goal,
    reDecisionContext(params),
  );
  params.debitUsage(decideResult.usage);

  await params.store.append({
    type: 'decided',
    at: params.now(),
    goalId: params.goal.id,
    decision: decideResult.value,
    usage: decideResult.usage,
  });

  const decision = decideResult.value;
  if (decision.kind !== 'split') {
    return { halt: true };
  }

  const structureError = validateSplit(
    decision.children,
    (type) => (params.registry.has(type) ? params.registry.get(type) : undefined),
  );
  return structureError === null
    ? { children: decision.children }
    : { halt: true };
}

function reDecisionContext(params: {
  goal: Goal;
  priorAssessment: RoundAssessment;
  priorRoundRef: string | null;
  worktreeRoot: string | undefined;
  decideSkill: string | undefined;
  tier: Tier;
}): BrainContext {
  return {
    tier: params.tier,
    memories: params.goal.memories,
    ...(params.decideSkill ? { skill: params.decideSkill } : {}),
    priorAttempt: {
      artifact: diffBodiesArtifact(params),
      verdict: reDecisionVerdict(params.priorAssessment),
    },
  };
}

function diffBodiesArtifact(params: {
  goal: Goal;
  priorRoundRef: string | null;
  worktreeRoot: string | undefined;
}): Artifact | null {
  if (params.worktreeRoot === undefined || params.priorRoundRef === null) {
    return null;
  }

  const bodies = diffBodiesWithinScope(
    params.worktreeRoot,
    params.goal.scope,
    params.priorRoundRef,
  );
  const text = bodies
    .map((body) => `--- ${body.path}${body.truncated ? ' (truncated)' : ''} ---\n${body.body}`)
    .join('\n\n');

  return text.length > 0 ? { kind: 'text', text } : null;
}

function reDecisionVerdict(priorAssessment: RoundAssessment): Verdict {
  return {
    pass: false,
    findings: [
      ...unmetCriterionFindings(priorAssessment),
      ...priorAssessment.judgeVerdict.findings,
    ],
  };
}

function unmetCriterionFindings(priorAssessment: RoundAssessment): Finding[] {
  return priorAssessment.checkResults
    .filter((result) => !result.ok)
    .map((result) => ({
      title: `Unmet criterion ${result.id}`,
      dimension: 'spec' as const,
      severity: 'high' as const,
      gating: true,
      prescription: result.detail,
    }));
}
