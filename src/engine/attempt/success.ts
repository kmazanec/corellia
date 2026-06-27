import type { EventStore } from '../../contract/events.js';
import type { Goal } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import { buildReport } from '../reports.js';

export async function emitSuccessfulArtifact(params: {
  goal: Goal;
  artifact: Artifact;
  store: EventStore;
  now: () => number;
  persist: (goal: Goal, artifact: Artifact) => Promise<void>;
}): Promise<Report> {
  await params.persist(params.goal, params.artifact);
  const report = buildReport(params.goal, params.artifact);
  await params.store.append({
    type: 'emitted',
    at: params.now(),
    goalId: params.goal.id,
    report,
  });
  return report;
}
