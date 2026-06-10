/**
 * The frozen shared contracts of the Corellia factory — the typed shapes,
 * interfaces, and the one handoff schema every layer is built on. Types only:
 * no engine, eventlog, eval, or brain behavior lives here.
 */

export type { Kind, Intent, Tier, Budget, MemoryPointer, Goal } from './goal.js';
export type { ChildPlan, DecisionBrief, Decision } from './decision.js';
export type { Artifact, Report } from './report.js';
export type { Finding, Verdict } from './verdict.js';
export type { FactoryEvent, EventStore } from './events.js';
export type { BrainContext, Brain } from './brain.js';
export type { DeterministicCheck, GoalTypeDef, Registry } from './goal-type.js';
export type { MemoryView } from './memory.js';
