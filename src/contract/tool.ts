/**
 * The tool contract: one typed shape per tool, and one broker that mediates
 * every call. Tool definitions are data; execution lives broker-side, keyed by
 * name. The engine's step loop owns budget debiting; the broker enforces grants
 * and scope, records events, and executes tools — two enforcement points for
 * budget would be zero.
 *
 * A refusal is data, never an exception: the broker returns a {@link ToolResult}
 * with `ok: false` and a stated reason. The transcript and the event log both
 * record it, so the leaf sees why it was denied and so does the human.
 */

import type { Goal } from './goal.js';

/**
 * A tool the broker can execute, described as data. The `parameters` field is a
 * JSON-Schema object describing the tool's arguments; it mirrors the standard
 * provider tool-calling shape so adapters translate rather than reshape.
 */
export interface ToolDef {
  /** The tool's unique name, e.g. `read_file`; the broker dispatches on it. */
  name: string;
  /** A human/model-readable description of what the tool does and when to use it. */
  description: string;
  /** JSON-Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

/**
 * A request to run one tool, as emitted by a brain step. The `id` correlates the
 * call with its {@link ToolResult} in the transcript, mirroring the wire shape.
 */
export interface ToolCall {
  /** Correlation id, echoed back on the matching {@link ToolResult}. */
  id: string;
  /** The name of the tool to run; must resolve in the broker's dispatch table. */
  name: string;
  /** The tool arguments, validated against the tool's JSON-Schema parameters. */
  args: Record<string, unknown>;
}

/**
 * The outcome of one tool call. A refusal — a missing grant, an out-of-scope
 * write, an exhausted budget — is `ok: false` with the reason in `output`, never
 * a thrown exception. The leaf reads its own refusal and adapts.
 */
export interface ToolResult {
  /** The id of the {@link ToolCall} this result answers. */
  callId: string;
  /** Whether the tool ran successfully; `false` is a refusal or a tool error. */
  ok: boolean;
  /** The tool output on success, or the refusal/error reason on failure. */
  output: string;
}

/**
 * One registration entry in the broker's dispatch table. The broker enforces
 * grants, scope, debit, and events around `execute`; the impl only performs the
 * effect and reports `{ ok, output }`. The dispatch table is an injectable
 * `ToolImpl[]` so the V1 tool set — and any later tool — is wired at assembly,
 * never reached for at runtime.
 */
export interface ToolImpl {
  /** The data description the broker exposes to brains and matches calls against. */
  def: ToolDef;
  /**
   * Perform the tool's effect for a goal with already-validated args, reporting
   * success or a tool-level failure. The broker has already checked grant and
   * scope and debited the budget before calling this.
   */
  execute(goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }>;
}

/**
 * The single mediator for every tool call. One instance per tree, bound to that
 * tree's sandbox root (ADR-016). `execute` checks the goal-type's exact grant,
 * checks write paths against the goal's scope, appends a tool event, then runs
 * the tool — and returns a refusal as a {@link ToolResult}, never a throw. The
 * engine's step loop is the sole debitor of the toolCalls budget; the broker
 * enforces grants/scope and records events.
 */
export interface ToolBroker {
  /** Mediate one tool call for a goal, returning its result or a refusal. */
  execute(goal: Goal, call: ToolCall): Promise<ToolResult>;
}

/**
 * The result of running a repo-declared script (e.g. a test entry point) in the
 * tree's sandbox. `output` is the truncated tail surfaced to the model; the
 * `fullOutput` is retained for the event log and artifacts.
 */
export interface ScriptResult {
  /** Whether the script exited successfully (exit status 0 and no timeout). */
  ok: boolean;
  /** The process exit status, or null when the process was killed/timed out. */
  exitStatus: number | null;
  /** The truncated, model-facing output (typically the tail of the stream). */
  output: string;
  /** The complete captured output, retained for the log and artifacts. */
  fullOutput: string;
  /** Wall-clock duration of the run in milliseconds. */
  durationMs: number;
  /** Whether the run was killed for exceeding its time bound. */
  timedOut: boolean;
}

/**
 * The grant each V1 tool requires: any one of the listed capability grants
 * suffices to run it. Grants stay at the capability vocabulary level
 * (GOAL-TYPES.md / ADR-013); the broker reads a goal-type's grants verbatim and
 * checks them against this map — there is no side channel.
 */
export const GRANT_TOOL_MAP = {
  read_file: ['fs.read'],
  list_dir: ['fs.read'],
  search: ['fs.read'],
  head_sha: ['fs.read'],
  write_file: ['fs.write'],
  delete_file: ['fs.write'],
  run_script: ['test.run_scoped', 'test.run_impacted'],
  find_symbol: ['retrieval.api', 'fs.read'],
  find_exemplar: ['retrieval.api', 'fs.read'],
  conventions_for: ['retrieval.api', 'fs.read'],
  stack_versions: ['retrieval.api', 'fs.read'],
  impact: ['retrieval.api', 'fs.read'],
  // The PR-opening boundary (ADR-025): a granted leaf pushes its branch and
  // opens exactly one PR. The ToolImpls are registered in assembly by F-61; the
  // grant map entries are inert until then.
  push_branch: ['repo.branch'],
  open_pr: ['repo.pr'],
  // The issue-filing capability (ADR-034): a brokered write tool scoped to
  // docs/issues/, available to any goal type that holds the grant.
  file_issue: ['docs.issues.write'],
} as const satisfies Record<string, readonly string[]>;
