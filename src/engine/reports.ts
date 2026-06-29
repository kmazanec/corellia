import type { DecisionBrief } from '../contract/decision.js';
import type { Budget, Goal } from '../contract/goal.js';
import type { Artifact, Report } from '../contract/report.js';
import type { RiskClass } from '../contract/risk.js';
import type { Finding } from '../contract/verdict.js';

export function blockedReport(
  reason: string,
  findings: string[] = [],
  salvagedArtifact: Artifact | null = null,
): Report {
  return {
    // A blocked make leaf may still have written partial work to the worktree;
    // carry it as a draft artifact so a resume starts from the partial work
    // instead of an empty worktree, rather than discarding it as null.
    artifact: salvagedArtifact,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [reason],
    findings,
    learned: '',
  };
}

export function buildReport(goal: Goal, artifact: Artifact): Report {
  return {
    artifact,
    proof: [],
    lessons: [],
    memoriesUsed: goal.memories.map((memory) => memory.id),
    blockers: [],
    findings: [],
    learned: '',
  };
}

export function gateDeniedBrief(
  goal: Goal,
  risk: RiskClass,
  typeLevelGate: boolean,
): DecisionBrief {
  const reason = typeLevelGate
    ? `type "${goal.type}" carries a type-level authority gate`
    : `instance risk is "${risk}" (scope touches a sensitive surface)`;
  return {
    question: `Goal "${goal.title}" requires authority grant: ${reason}. Grant or deny?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
    teaching: {
      finding: reason,
      confidence: 'high',
      costs: 'grant: goal proceeds; deny: goal is blocked; park: goal waits for human decision (TTL applies)',
      recommendation: 'deny',
    },
  };
}

export function unknownTypeBrief(goal: Goal): DecisionBrief {
  return {
    question: `Unknown goal type: "${goal.type}". How should this goal be handled?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

export function exhaustedBrief(goal: Goal, dim: keyof Budget): DecisionBrief {
  return {
    question: `Goal "${goal.title}" exhausted its ${dim} budget. How should it be handled?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

export function escalatedBrief(goal: Goal, finding: Finding): DecisionBrief {
  return {
    question: `Goal "${goal.title}" has an escalated finding requiring human decision: "${finding.title}"`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

export function isomorphicBrief(goal: Goal, signature: string): DecisionBrief {
  return {
    question: `Goal "${goal.title}" is repeating the same failure (signature: "${signature}"). Needs human resolution.`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

export function nonConvergenceBrief(goal: Goal): DecisionBrief {
  return {
    question: `Goal "${goal.title}" failed at the highest tier with no actionable repair — it cannot converge. How should it be handled?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}
