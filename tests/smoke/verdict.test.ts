/**
 * Deterministic unit test for the live-smoke assertion logic.
 *
 * assessSmoke is the pure verdict behind `npm run smoke:live`. This test feeds it
 * synthetic event logs and reports and asserts the pass/fail verdict for each
 * invariant, so the script's judgement is provable without any real spend.
 */

import { describe, it, expect } from 'vitest';

import { assessSmoke } from '../../src/smoke/verdict.js';
import type { FactoryEvent } from '../../src/contract/events.js';
import type { Report } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { Usage } from '../../src/contract/goal.js';

// ── Synthetic-event builders ────────────────────────────────────────────────────

const GOAL = 'smoke-greeting/leaf';

const pass: Verdict = { pass: true, findings: [] };

function detChecked(goalId = GOAL, at = 1): FactoryEvent {
  return { type: 'deterministic-checked', at, goalId, verdict: pass };
}

function judgeVerdict(goalId = GOAL, at = 2, usage?: Usage): FactoryEvent {
  return {
    type: 'judge-verdict',
    at,
    goalId,
    judgeType: 'critique-code',
    verdict: pass,
    tier: 'low',
    ...(usage ? { usage } : {}),
  };
}

/** A `produced` event carries the run's cost — the source costSummary reads for spend. */
function produced(goalId = GOAL, at = 3, usage: Usage = { promptTokens: 100, completionTokens: 50, costUsd: 0.01 }): FactoryEvent {
  return { type: 'produced', at, goalId, usage };
}

function passingReport(): Report {
  return {
    artifact: { kind: 'files', files: [{ path: 'greeting.mjs', content: 'x' }] },
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [],
    findings: [],
    learned: 'built a greeting CLI',
  };
}

/** A healthy run: det check before judge, an artifact, no blockers, spend under cap. */
function healthyEvents(): FactoryEvent[] {
  return [detChecked(GOAL, 1), judgeVerdict(GOAL, 2), produced(GOAL, 3)];
}

// ── Happy path ───────────────────────────────────────────────────────────────

describe('assessSmoke — passing run', () => {
  it('passes when every invariant holds', () => {
    const verdict = assessSmoke({ events: healthyEvents(), report: passingReport(), capUsd: 0.25 });
    expect(verdict.pass).toBe(true);
    expect(verdict.checks.every((c) => c.ok)).toBe(true);
    expect(verdict.spentUsd).toBeCloseTo(0.01);
  });
});

// ── 1. tree-completed ─────────────────────────────────────────────────────────

describe('assessSmoke — tree-completed', () => {
  it('fails when no report was emitted (run threw)', () => {
    const verdict = assessSmoke({ events: healthyEvents(), report: null, capUsd: 0.25 });
    expect(verdict.pass).toBe(false);
    const check = verdict.checks.find((c) => c.name === 'tree-completed');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('no report');
  });

  it('fails when the report carries blockers', () => {
    const report = { ...passingReport(), blockers: ['scope insufficient'] };
    const verdict = assessSmoke({ events: healthyEvents(), report, capUsd: 0.25 });
    expect(verdict.pass).toBe(false);
    const check = verdict.checks.find((c) => c.name === 'tree-completed');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('scope insufficient');
  });
});

// ── 2. artifact-exists ──────────────────────────────────────────────────────────

describe('assessSmoke — artifact-exists', () => {
  it('fails when the report artifact is null', () => {
    const report = { ...passingReport(), artifact: null };
    const verdict = assessSmoke({ events: healthyEvents(), report, capUsd: 0.25 });
    expect(verdict.pass).toBe(false);
    const check = verdict.checks.find((c) => c.name === 'artifact-exists');
    expect(check?.ok).toBe(false);
  });

  it('accepts a text artifact', () => {
    const report: Report = { ...passingReport(), artifact: { kind: 'text', text: 'hello' } };
    const verdict = assessSmoke({ events: healthyEvents(), report, capUsd: 0.25 });
    const check = verdict.checks.find((c) => c.name === 'artifact-exists');
    expect(check?.ok).toBe(true);
  });
});

// ── 3. deterministic-before-judge ───────────────────────────────────────────────

describe('assessSmoke — deterministic-before-judge', () => {
  it('fails when a judge verdict precedes the deterministic check for a leaf', () => {
    // judge at index 0, det at index 1 — inverted order.
    const events = [judgeVerdict(GOAL, 1), detChecked(GOAL, 2), produced(GOAL, 3)];
    const verdict = assessSmoke({ events, report: passingReport(), capUsd: 0.25 });
    expect(verdict.pass).toBe(false);
    const check = verdict.checks.find((c) => c.name === 'deterministic-before-judge');
    expect(check?.ok).toBe(false);
  });

  it('fails when no deterministic checks ran at all', () => {
    const events = [judgeVerdict(GOAL, 1), produced(GOAL, 2)];
    const verdict = assessSmoke({ events, report: passingReport(), capUsd: 0.25 });
    const check = verdict.checks.find((c) => c.name === 'deterministic-before-judge');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('never ran');
  });

  it('passes a leaf that had a deterministic check but no judge (cheap gate stopped it)', () => {
    // det check present, no judge for this goal — a valid deterministic-gated stop.
    const events = [detChecked(GOAL, 1), produced(GOAL, 2)];
    const verdict = assessSmoke({ events, report: passingReport(), capUsd: 0.25 });
    const check = verdict.checks.find((c) => c.name === 'deterministic-before-judge');
    expect(check?.ok).toBe(true);
  });
});

// ── 4. spend-within-cap ─────────────────────────────────────────────────────────

describe('assessSmoke — spend-within-cap', () => {
  it('fails when reported spend exceeds the cap', () => {
    const events = [detChecked(GOAL, 1), judgeVerdict(GOAL, 2), produced(GOAL, 3, { promptTokens: 1, completionTokens: 1, costUsd: 0.5 })];
    const verdict = assessSmoke({ events, report: passingReport(), capUsd: 0.25 });
    expect(verdict.pass).toBe(false);
    const check = verdict.checks.find((c) => c.name === 'spend-within-cap');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('0.5000');
  });

  it('passes when spend equals the cap exactly', () => {
    const events = [detChecked(GOAL, 1), judgeVerdict(GOAL, 2), produced(GOAL, 3, { promptTokens: 1, completionTokens: 1, costUsd: 0.25 })];
    const verdict = assessSmoke({ events, report: passingReport(), capUsd: 0.25 });
    const check = verdict.checks.find((c) => c.name === 'spend-within-cap');
    expect(check?.ok).toBe(true);
  });

  it('fails when the log reports no cost at all (cannot confirm spend)', () => {
    const events = [detChecked(GOAL, 1), judgeVerdict(GOAL, 2), produced(GOAL, 3, { promptTokens: 100, completionTokens: 50 })];
    const verdict = assessSmoke({ events, report: passingReport(), capUsd: 0.25 });
    const check = verdict.checks.find((c) => c.name === 'spend-within-cap');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('no cost');
    expect(verdict.spentUsd).toBeUndefined();
  });
});
