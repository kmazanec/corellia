/**
 * A scripted brain whose responses are pre-loaded at construction time.
 * Each method's responses are keyed first by goal title, with fallback to
 * goal type; arrays are consumed in order across successive calls, and the
 * last element repeats once the array is exhausted.
 *
 * Designed for tests and deterministic simulations: the exact sequence of
 * results is declared upfront, so every call is auditable and reproducible.
 */

import type { Brain, BrainContext, StepOutput, StepTranscript } from '../contract/brain.js';
import type { Goal, Metered, Usage } from '../contract/goal.js';
import { ZERO_USAGE } from '../contract/goal.js';
import type { Decision } from '../contract/decision.js';
import type { Artifact } from '../contract/report.js';
import type { ToolDef } from '../contract/tool.js';
import type { Verdict } from '../contract/verdict.js';

/**
 * A value paired with optional synthetic usage for test scripting. When usage
 * is absent the brain returns {@link ZERO_USAGE}. Additive to the Script shape:
 * existing entries keyed by plain value still work (no usage = zero).
 */
export interface WithUsage<T> {
  value: T;
  usage?: Usage;
}

/**
 * The script shape passed to ScriptedBrain. Arrays are consumed in order;
 * the last element repeats once the array is exhausted. All fields are
 * optional — a missing key for a given goal causes a loud runtime error.
 *
 * Each entry may be a plain value (zero usage) or a {@link WithUsage} wrapper
 * carrying synthetic usage for accounting tests.
 */
export interface Script {
  decide?: Record<string, Array<Decision | WithUsage<Decision>>>;
  produce?: Record<string, Array<Artifact | WithUsage<Artifact>>>;
  judge?: Record<string, Array<Verdict | WithUsage<Verdict>>>;
  repair?: Record<string, Array<Artifact | WithUsage<Artifact>>>;
  step?: Record<string, StepOutput[]>;
}

/** Mutable state tracking how many times each key has been consumed. */
type Counters = Map<string, number>;

/** Unwrap a script entry that may be a plain value or a WithUsage wrapper. */
function unwrap<T>(entry: T | WithUsage<T>): { value: T; usage: Usage } {
  if (entry !== null && typeof entry === 'object' && 'value' in (entry as object) && 'usage' in (entry as object)) {
    const w = entry as WithUsage<T>;
    return { value: w.value, usage: w.usage ?? ZERO_USAGE };
  }
  if (entry !== null && typeof entry === 'object' && 'value' in (entry as object)) {
    const w = entry as WithUsage<T>;
    if ('value' in w) {
      return { value: w.value, usage: w.usage ?? ZERO_USAGE };
    }
  }
  return { value: entry as T, usage: ZERO_USAGE };
}

function isWithUsage<T>(entry: T | WithUsage<T>): entry is WithUsage<T> {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    'value' in (entry as object) &&
    !(
      'kind' in (entry as object) ||
      'pass' in (entry as object) ||
      'files' in (entry as object) ||
      'text' in (entry as object)
    )
  );
}

function nextFromMetered<T>(
  script: Record<string, Array<T | WithUsage<T>>> | undefined,
  method: string,
  goalTitle: string,
  goalType: string,
  counters: Counters,
): { value: T; usage: Usage } {
  if (script === undefined) {
    throw new Error(
      `ScriptedBrain: no script for method "${method}" — add an entry keyed by ` +
        `title "${goalTitle}" or type "${goalType}".`,
    );
  }
  const key = goalTitle in script ? goalTitle : goalType in script ? goalType : undefined;
  if (key === undefined) {
    throw new Error(
      `ScriptedBrain: no script entry for method "${method}" with title ` +
        `"${goalTitle}" or type "${goalType}". Known keys: ${Object.keys(script).join(', ') || '(none)'}.`,
    );
  }
  const entries = script[key];
  if (entries === undefined || entries.length === 0) {
    throw new Error(
      `ScriptedBrain: script entry for method "${method}" key "${key}" is empty.`,
    );
  }
  const counterKey = `${method}:${key}`;
  const idx = counters.get(counterKey) ?? 0;
  const entry = entries[Math.min(idx, entries.length - 1)] as T | WithUsage<T>;
  counters.set(counterKey, idx + 1);
  if (isWithUsage(entry)) {
    return { value: entry.value, usage: entry.usage ?? ZERO_USAGE };
  }
  return { value: entry as T, usage: ZERO_USAGE };
}

function nextFrom<T>(
  script: Record<string, T[]> | undefined,
  method: string,
  goalTitle: string,
  goalType: string,
  counters: Counters,
): T {
  if (script === undefined) {
    throw new Error(
      `ScriptedBrain: no script for method "${method}" — add an entry keyed by ` +
        `title "${goalTitle}" or type "${goalType}".`,
    );
  }
  // Prefer title over type.
  const key = goalTitle in script ? goalTitle : goalType in script ? goalType : undefined;
  if (key === undefined) {
    throw new Error(
      `ScriptedBrain: no script entry for method "${method}" with title ` +
        `"${goalTitle}" or type "${goalType}". Known keys: ${Object.keys(script).join(', ') || '(none)'}.`,
    );
  }
  const entries = script[key];
  if (entries === undefined || entries.length === 0) {
    throw new Error(
      `ScriptedBrain: script entry for method "${method}" key "${key}" is empty.`,
    );
  }
  const counterKey = `${method}:${key}`;
  const idx = counters.get(counterKey) ?? 0;
  // Clamp to last element once the array is exhausted.
  const entry = entries[Math.min(idx, entries.length - 1)];
  counters.set(counterKey, idx + 1);
  return entry as T;
}

/**
 * A Brain whose responses are driven entirely by a script declared at
 * construction. Useful for testing engine logic: declare exactly what each
 * goal will decide, produce, have judged, and how it will be repaired.
 *
 * Repair falls back, when unscripted, to a naive default: the input artifact
 * with every prescription appended as a trailing comment line in the first file.
 */
export class ScriptedBrain implements Brain {
  private readonly script: Script;
  private readonly counters: Counters = new Map();

  constructor(script: Script) {
    this.script = script;
  }

  async decide(goal: Goal, _ctx: BrainContext): Promise<Metered<Decision>> {
    return nextFromMetered(this.script.decide, 'decide', goal.title, goal.type, this.counters);
  }

  async produce(goal: Goal, _ctx: BrainContext): Promise<Metered<Artifact>> {
    return nextFromMetered(this.script.produce, 'produce', goal.title, goal.type, this.counters);
  }

  async judge(
    goal: Goal,
    _subject: Artifact,
    _rubric: string,
    _ctx: BrainContext,
  ): Promise<Metered<Verdict>> {
    return nextFromMetered(this.script.judge, 'judge', goal.title, goal.type, this.counters);
  }

  async repair(
    goal: Goal,
    artifact: Artifact,
    prescriptions: string[],
    _ctx: BrainContext,
  ): Promise<Metered<Artifact>> {
    if (
      this.script.repair !== undefined &&
      (goal.title in this.script.repair || goal.type in this.script.repair)
    ) {
      return nextFromMetered(this.script.repair, 'repair', goal.title, goal.type, this.counters);
    }
    return { value: this.repairValue(goal, artifact, prescriptions), usage: ZERO_USAGE };
  }

  private repairValue(_goal: Goal, artifact: Artifact, prescriptions: string[]): Artifact {
    // Naive default: append each prescription as a trailing comment to the
    // first file in the artifact. For text artifacts, append to the text body.
    if (artifact.kind === 'files') {
      const files = artifact.files ?? [];
      if (files.length === 0) {
        return artifact;
      }
      const [first, ...rest] = files;
      if (first === undefined) return artifact;
      const commentLines = prescriptions.map((p) => `// ${p}`).join('\n');
      const updated = {
        ...first,
        content: first.content + (first.content.endsWith('\n') ? '' : '\n') + commentLines,
      };
      return { ...artifact, files: [updated, ...rest] };
    }

    // kind === 'text'
    const commentLines = prescriptions.map((p) => `// ${p}`).join('\n');
    const sep = artifact.text?.endsWith('\n') ? '' : '\n';
    return { ...artifact, text: (artifact.text ?? '') + sep + commentLines };
  }

  async step(
    goal: Goal,
    _transcript: StepTranscript,
    _tools: ToolDef[],
    _ctx: BrainContext,
  ): Promise<StepOutput> {
    const value = nextFrom(this.script.step, 'step', goal.title, goal.type, this.counters);
    return value;
  }
}
