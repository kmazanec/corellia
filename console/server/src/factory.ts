/**
 * The console's one import boundary into the factory (ADR-050).
 *
 * The console may depend on the factory; the factory never depends on the
 * console. Every factory symbol the console uses passes through this module,
 * so the coupling is listed in one place and can move to a published package
 * without touching the rest of the console.
 */

export type { FactoryEvent } from '../../../src/contract/events.js';
export type { Goal } from '../../../src/contract/goal.js';
export { parseFactoryEvent } from '../../../src/contract/event-parser.js';
export {
  projectGoalTree,
  type GoalState,
  type GoalTreeNode,
} from '../../../src/eventlog/goal-tree.js';
export { costSummary, traceStats, type UsageTotals } from '../../../src/eventlog/projections.js';
export { loadDotEnv } from '../../../src/env.js';
export type {
  ClaimedJob,
  JobBrief,
  JobCommandResult,
  JobQueue,
  JobRecord,
  JobState,
  WorkerLink,
  WorkerRecord,
} from '../../../src/contract/jobs.js';
export type { CommissionInput } from '../../../src/contract/brief.js';
export { TERMINAL_JOB_STATES } from '../../../src/contract/jobs.js';
export { MemoryJobQueue } from '../../../src/substrate/memory-job-queue.js';
export { ensureJobSchema, PgWorkerLink } from '../../../src/substrate/pg-worker-link.js';
export { sampleRun, type SampleOutcome } from '../../../src/dev/sample-run.js';
export { PgEventStore } from '../../../src/substrate/pg-event-store.js';
