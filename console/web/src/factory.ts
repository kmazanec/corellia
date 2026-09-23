/**
 * The web app's import boundary into the factory and the control plane
 * (ADR-050). The browser runs the same goal-tree and cost projections the CLI
 * and server run, so a live tree is folded client-side from the event stream.
 * Everything here is pure: type imports, or projections with no Node deps.
 */

export type { FactoryEvent } from '../../../src/contract/events.js';
export type { Goal } from '../../../src/contract/goal.js';
export { projectGoalTree, type GoalState, type GoalTreeNode } from '../../../src/eventlog/goal-tree.js';
export { costSummary, type UsageTotals } from '../../../src/eventlog/projections.js';
export type { AppType } from '../../server/src/api/app.js';
export type { JobStatus, JobView as Job } from '../../server/src/read-model/job-view.js';
export type { WorkerRecord } from '../../../src/contract/jobs.js';
export type Fleet = ReturnType<typeof import('../../server/src/api/fleet-routes.js').fleetView>;
