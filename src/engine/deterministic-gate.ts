import type { EventStore } from '../contract/events.js';
import type { Budget, Goal } from '../contract/goal.js';
import type { CheckContext, DeterministicCheck } from '../contract/goal-type.js';
import type { Artifact } from '../contract/report.js';
import type { Finding, Verdict } from '../contract/verdict.js';
import { consumeN } from './budget.js';

export interface DeterministicGateResult {
  verdict: Verdict | null;
  budget: Budget;
  toolCallsExhausted: boolean;
  toolCallsUsed: number;
}

export async function runDeterministicGate(params: {
  goal: Goal;
  artifact: Artifact | null;
  checks: readonly DeterministicCheck[];
  budget: Budget;
  checkContext: CheckContext | undefined;
  store: EventStore;
  now: () => number;
}): Promise<DeterministicGateResult> {
  if (params.checks.length === 0) {
    return {
      verdict: null,
      budget: params.budget,
      toolCallsExhausted: false,
      toolCallsUsed: 0,
    };
  }

  const findings: Finding[] = [];
  let allOk = true;
  let toolCallsUsed = 0;

  for (const check of params.checks) {
    toolCallsUsed++;
    const result = await check.run(params.goal, params.artifact, params.checkContext);
    if (!result.ok) {
      allOk = false;
      findings.push({
        title: `${check.name}: ${result.detail}`,
        dimension: 'spec',
        severity: 'high',
        gating: true,
        ...(result.prescription !== undefined ? { prescription: result.prescription } : {}),
      });
    }
  }

  const consumed = consumeN(params.budget, 'toolCalls', toolCallsUsed);
  const verdict: Verdict = {
    pass: allOk,
    findings,
    ...(allOk ? {} : { failureSignature: deterministicFailureSignature(findings) }),
  };

  await params.store.append({
    type: 'deterministic-checked',
    at: params.now(),
    goalId: params.goal.id,
    verdict,
  });

  return {
    verdict,
    budget: consumed.budget,
    toolCallsExhausted: consumed.exhausted,
    toolCallsUsed,
  };
}

function deterministicFailureSignature(findings: Finding[]): string {
  return `deterministic:${findings.map((finding) => finding.title).join(',')}`;
}
