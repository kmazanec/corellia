/**
 * The frozen shared contracts of the Corellia factory — the typed shapes,
 * interfaces, and the one handoff schema every layer is built on. Types only:
 * no engine, eventlog, eval, or brain behavior lives here.
 */

export type { Kind, Intent, Tier, Budget, MemoryPointer, Goal, Usage, Metered, TransportIncident } from './goal.js';
export { ZERO_USAGE } from './goal.js';
export type { ChildPlan, DecisionBrief, Decision } from './decision.js';
export type { Artifact, Report } from './report.js';
export type { Finding, Verdict } from './verdict.js';
export type { FactoryEvent, EventStore } from './events.js';
export type { BrainContext, Brain, StepMessage, StepTranscript, StepOutput } from './brain.js';
export type { DeterministicCheck, CheckContext, GoalTypeDef, Registry } from './goal-type.js';
export type { ToolDef, ToolCall, ToolResult, ToolImpl, ToolBroker, ScriptResult } from './tool.js';
export { GRANT_TOOL_MAP } from './tool.js';
export type { CommissionInput, ParkedBrief, FrontDoorStatus, StandingEnvelope } from './brief.js';
export type { MemoryView } from './memory.js';
export type { SplitMemo, PatternStore } from './pattern.js';
export type { RiskClass, SensitivityFact } from './risk.js';
export type { KnowledgeCategory, KnowledgePointer, KnowledgeArtifact, DiveFact, RegionFacts } from './knowledge.js';
