import type { EventStore } from '../../contract/events.js';
import type { Goal } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { RiskClass, SensitivityFact } from '../../contract/risk.js';
import type { DecisionBrief } from '../../contract/decision.js';
import { classifyRisk } from '../../library/risk.js';
import { runAuthorityGate } from '../authority-gate.js';

export async function checkEmissionAuthority(params: {
  goal: Goal;
  artifact: Artifact;
  entryRisk: RiskClass;
  sensitivity: readonly SensitivityFact[];
  store: EventStore;
  now: () => number;
  onGate: ((goal: Goal, risk: RiskClass) => Promise<'granted' | 'denied'>) | undefined;
  onBrief: ((brief: DecisionBrief) => Promise<'deny' | 'park' | 'bounce' | 'answered'>) | undefined;
}): Promise<Report | null> {
  if (params.artifact.kind !== 'files' || !params.artifact.files || params.artifact.files.length === 0) {
    return null;
  }

  const artifactPaths = params.artifact.files.map((file) => file.path);
  const emitRisk = classifyRisk(artifactPaths, [...params.sensitivity]);
  await params.store.append({
    type: 'risk-classified',
    at: params.now(),
    goalId: params.goal.id,
    risk: emitRisk,
  });

  return runAuthorityGate({
    shouldGate: emitRisk === 'high' && params.entryRisk !== 'high',
    goal: params.goal,
    risk: emitRisk,
    typeGated: false,
    store: params.store,
    now: params.now,
    onGate: params.onGate,
    onBrief: params.onBrief,
    deniedMessage: (brief) =>
      `Authority gate denied at emission (artifact touched sensitive paths): ${brief.question}`,
  });
}
