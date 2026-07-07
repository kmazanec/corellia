/**
 * Live-smoke verdict — the pure, deterministic assertion logic behind
 * `npm run smoke:live`.
 *
 * The smoke script runs ONE greeting-sized goal end-to-end against a real model
 * and then asks this module: did the run satisfy the cheap invariants a smoke is
 * allowed to assert? Keeping the judgement here — a pure function over the event
 * log plus the emitted report — means the script's pass/fail logic is testable
 * without spending a cent: a unit test feeds it a synthetic event log and checks
 * the verdict. The script itself only does I/O (build engine, run, write files);
 * every yes/no lives here.
 *
 * The invariants are deliberately minimal (a smoke, not a spec test):
 *   1. The tree completed — it emitted a final report with no blockers.
 *   2. An artifact exists on that report.
 *   3. Deterministic checks preceded the judge for every judged leaf (the
 *      cheap-gate-before-expensive-judge discipline the loop is built on).
 *   4. Spend stayed at or below the declared cap (derived from the event log,
 *      the same source the real ceiling reads).
 *
 * @module smoke/verdict
 */

import type { FactoryEvent } from '../contract/events.js';
import type { Report } from '../contract/report.js';
import { costSummary } from '../eventlog/projections.js';

/** One named invariant and whether the run satisfied it. */
export interface SmokeCheck {
  name: string;
  ok: boolean;
  /** Human-readable detail — the "why" printed on failure (and on pass, for the log). */
  detail: string;
}

/** The overall smoke verdict: pass only when every check passed. */
export interface SmokeVerdict {
  pass: boolean;
  checks: SmokeCheck[];
  /** The tree's total reported spend in USD, or undefined when the log reported no cost. */
  spentUsd: number | undefined;
}

export interface AssessSmokeInput {
  /** The full event log the run wrote. */
  events: FactoryEvent[];
  /** The report the engine returned, or null if the run threw before emitting one. */
  report: Report | null;
  /** The dollar ceiling the run declared. Spend at or below this passes. */
  capUsd: number;
}

/**
 * Judge a completed (or crashed) live-smoke run against the cheap invariants.
 *
 * Pure: no I/O, no clock, no environment. Every field it reads comes from the
 * two inputs, so a test can reproduce any verdict from a synthetic event log.
 */
export function assessSmoke(input: AssessSmokeInput): SmokeVerdict {
  const { events, report, capUsd } = input;

  const checks: SmokeCheck[] = [
    treeCompletedCheck(report),
    artifactExistsCheck(report),
    deterministicBeforeJudgeCheck(events),
    spendWithinCapCheck(events, capUsd),
  ];

  const spentUsd = costSummary(events).tree.costUsd;

  return {
    pass: checks.every((c) => c.ok),
    checks,
    spentUsd,
  };
}

// ── Individual checks ──────────────────────────────────────────────────────────

/** 1. The tree completed: a report came back and it carries no blockers. */
function treeCompletedCheck(report: Report | null): SmokeCheck {
  if (report === null) {
    return {
      name: 'tree-completed',
      ok: false,
      detail: 'no report emitted — the run threw before returning (blocked/failed/crashed)',
    };
  }
  if (report.blockers.length > 0) {
    return {
      name: 'tree-completed',
      ok: false,
      detail: `report carried ${report.blockers.length} blocker(s): ${report.blockers.join('; ')}`,
    };
  }
  return { name: 'tree-completed', ok: true, detail: 'report emitted with no blockers' };
}

/** 2. An artifact exists on the report. */
function artifactExistsCheck(report: Report | null): SmokeCheck {
  if (report === null) {
    return { name: 'artifact-exists', ok: false, detail: 'no report, so no artifact' };
  }
  if (report.artifact === null) {
    return { name: 'artifact-exists', ok: false, detail: 'report.artifact is null' };
  }
  const files = report.artifact.kind === 'files' ? report.artifact.files?.length ?? 0 : 0;
  const summary =
    report.artifact.kind === 'files' ? `${files} file(s)` : `text (${report.artifact.text?.length ?? 0} chars)`;
  return { name: 'artifact-exists', ok: true, detail: `artifact present: ${summary}` };
}

/**
 * 3. For every leaf that produced BOTH a deterministic-checked and a judge-verdict
 * event, the first deterministic check appears before the first judge verdict.
 * A leaf with deterministic checks but no judge (deterministic gating stopped it
 * short) is fine — the cheap gate did its job. A run with no deterministic checks
 * at all is a red flag: the loop's cheap-gate rung never ran.
 */
function deterministicBeforeJudgeCheck(events: FactoryEvent[]): SmokeCheck {
  const leafIds = new Set(
    events.filter((e) => e.type === 'deterministic-checked').map((e) => e.goalId),
  );

  if (leafIds.size === 0) {
    return {
      name: 'deterministic-before-judge',
      ok: false,
      detail: 'no deterministic-checked events — the cheap-gate rung never ran',
    };
  }

  for (const goalId of leafIds) {
    const firstDetIdx = events.findIndex(
      (e) => e.type === 'deterministic-checked' && e.goalId === goalId,
    );
    const firstJudgeIdx = events.findIndex(
      (e) => e.type === 'judge-verdict' && e.goalId === goalId,
    );

    // No judge for this goal — deterministic gate stopped it short, which is fine.
    if (firstJudgeIdx === -1) continue;

    if (firstDetIdx >= firstJudgeIdx) {
      return {
        name: 'deterministic-before-judge',
        ok: false,
        detail: `goal ${goalId}: judge-verdict (index ${firstJudgeIdx}) preceded deterministic-checked (index ${firstDetIdx})`,
      };
    }
  }

  return {
    name: 'deterministic-before-judge',
    ok: true,
    detail: `deterministic checks preceded judge for all ${leafIds.size} judged leaf/leaves`,
  };
}

/**
 * 4. Tree spend, derived from the event log, is at or below the cap. When the
 * endpoint reported no cost at all, we cannot confirm spend — treat that as a
 * fail so a cost-silent run can never masquerade as a cheap pass.
 */
function spendWithinCapCheck(events: FactoryEvent[], capUsd: number): SmokeCheck {
  const spentUsd = costSummary(events).tree.costUsd;

  if (spentUsd === undefined) {
    return {
      name: 'spend-within-cap',
      ok: false,
      detail: 'event log reported no cost — cannot confirm spend stayed under the cap',
    };
  }

  if (spentUsd > capUsd) {
    return {
      name: 'spend-within-cap',
      ok: false,
      detail: `spent $${spentUsd.toFixed(4)} > cap $${capUsd.toFixed(4)}`,
    };
  }

  return {
    name: 'spend-within-cap',
    ok: true,
    detail: `spent $${spentUsd.toFixed(4)} ≤ cap $${capUsd.toFixed(4)}`,
  };
}
