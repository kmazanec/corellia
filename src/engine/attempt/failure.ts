import type { Brain, BrainContext } from '../../contract/brain.js';
import type { DecisionBrief } from '../../contract/decision.js';
import type { EventStore } from '../../contract/events.js';
import type { Budget, Goal, Tier, Usage } from '../../contract/goal.js';
import type { Artifact, Report } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';
import {
  blockedReport,
  escalatedBrief,
  isomorphicBrief,
  nonConvergenceBrief,
} from '../reports.js';

export type AttemptFailureResolution =
  | { kind: 'repaired'; artifact: Artifact; budget: Budget }
  | { kind: 'escalated'; tier: Tier; budget: Budget }
  | { kind: 'blocked'; report: Report };

type BriefResolution = 'deny' | 'park' | 'bounce' | 'answered';

export async function resolveAttemptFailure(params: {
  goal: Goal;
  artifact: Artifact;
  verdict: Verdict;
  budget: Budget;
  tier: Tier;
  tierIndex: number;
  tierLadder: Tier[];
  priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined;
  /** Partial work salvaged from the worktree, carried on a blocked report so a
   * resume starts from the partial diff instead of an empty worktree. */
  salvagedArtifact: Artifact | null;
  brain: Brain;
  store: EventStore;
  now: () => number;
  onBrief: ((brief: DecisionBrief) => Promise<BriefResolution>) | undefined;
  debitUsage: (usage: Usage) => void;
  hasReachedCeiling: () => boolean;
  onCeilingReached: () => Promise<Report>;
}): Promise<AttemptFailureResolution> {
  const escalatedFinding = params.verdict.findings.find(
    (finding) => finding.gating && finding.escalated,
  );
  if (escalatedFinding !== undefined) {
    return blockWithReport({
      goal: params.goal,
      store: params.store,
      now: params.now,
      onBrief: params.onBrief,
      report: blockedReport(
        `Escalated finding requires human decision: ${escalatedFinding.title}`,
        params.verdict.findings.map((finding) => finding.title),
        params.salvagedArtifact,
      ),
      brief: escalatedBrief(params.goal, escalatedFinding),
    });
  }

  if (isomorphicFailure(params.priorAttempt, params.verdict)) {
    return blockWithReport({
      goal: params.goal,
      store: params.store,
      now: params.now,
      onBrief: params.onBrief,
      report: blockedReport(
        `Isomorphic failure detected (signature: ${params.verdict.failureSignature}) — escalating to block`,
        params.verdict.findings.map((finding) => finding.title),
        params.salvagedArtifact,
      ),
      brief: isomorphicBrief(params.goal, params.verdict.failureSignature!),
    });
  }

  const prescriptions = prescribedRepairs(params.verdict);
  if (prescriptions.length > 0) {
    // repair is best-effort: a throw here (canonically a provider timeout —
    // live-tail run 12: "child threw: The operation was aborted due to
    // timeout" killed the tree from this exact call) must not propagate out
    // of the attempt loop. On failure, fall through to the tier ladder — the
    // next rung is a different model that can re-attempt from scratch.
    let repairResult: Awaited<ReturnType<typeof params.brain.repair>> | null = null;
    try {
      repairResult = await params.brain.repair(
        params.goal,
        params.artifact,
        prescriptions,
        { tier: params.tier, memories: params.goal.memories } satisfies BrainContext,
      );
    } catch {
      repairResult = null;
    }

    if (repairResult !== null) {
      params.debitUsage(repairResult.usage);
      await params.store.append({
        type: 'repair-applied',
        at: params.now(),
        goalId: params.goal.id,
        prescriptions,
        usage: repairResult.usage,
      });

      if (params.hasReachedCeiling()) {
        return { kind: 'blocked', report: await params.onCeilingReached() };
      }

      return {
        kind: 'repaired',
        artifact: repairResult.value,
        budget: params.budget,
      };
    }
  }

  const nextTier = params.tierLadder[params.tierIndex + 1];
  if (nextTier !== undefined) {
    await params.store.append({
      type: 'tier-escalated',
      at: params.now(),
      goalId: params.goal.id,
      from: params.tier,
      to: nextTier,
    });
    return { kind: 'escalated', tier: nextTier, budget: params.budget };
  }

  // A transport failure at the TOP rung gets exactly one same-tier retry: the
  // fault was the endpoint, not the model, and for a single-rung type (e.g.
  // author-acceptance-criteria, ladder ['high']) with a subdivided attempt
  // budget of 1, a lone provider hang was otherwise instantly terminal —
  // live-tail run 16 died exactly here. A SECOND consecutive transport failure
  // (visible via priorAttempt's signature) falls through and blocks honestly.
  if (
    params.verdict.failureSignature === 'step-loop:transport' &&
    params.priorAttempt?.verdict.failureSignature !== 'step-loop:transport'
  ) {
    return { kind: 'escalated', tier: params.tier, budget: params.budget };
  }

  const brief = nonConvergenceBrief(params.goal);
  return blockWithReport({
    goal: params.goal,
    store: params.store,
    now: params.now,
    onBrief: params.onBrief,
    // Carry the last verdict's findings: a bare "cannot converge" hides WHY
    // (run 9's blocker gave no hint the cause was a provider timeout).
    report: blockedReport(
      brief.question,
      params.verdict.findings.map((finding) => finding.title),
      params.salvagedArtifact,
    ),
    brief,
  });
}

function isomorphicFailure(
  priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined,
  verdict: Verdict,
): boolean {
  // A transport failure (provider timeout/unreachable, surviving the adapter's
  // retries) says nothing about the SUBJECT — two in a row is a flaky provider
  // window, not the model repeating a mistake. Exempt it from isomorphism; the
  // attempt budget and the tier ladder (a different model per rung) bound the
  // retries instead. (provider-timeout-isomorphic-block; live-tail runs 1/7/9.)
  if (verdict.failureSignature === 'step-loop:transport') return false;
  return priorAttempt !== undefined
    && verdict.failureSignature !== undefined
    && priorAttempt.verdict.failureSignature === verdict.failureSignature;
}

function prescribedRepairs(verdict: Verdict): string[] {
  return verdict.findings
    .filter((finding) => finding.gating && finding.prescription !== undefined && !finding.escalated)
    .map((finding) => finding.prescription!);
}

async function blockWithReport(params: {
  goal: Goal;
  store: EventStore;
  now: () => number;
  onBrief: ((brief: DecisionBrief) => Promise<BriefResolution>) | undefined;
  report: Report;
  brief: DecisionBrief;
}): Promise<Extract<AttemptFailureResolution, { kind: 'blocked' }>> {
  const resolution = params.onBrief
    ? await params.onBrief(params.brief)
    : params.brief.onTimeout;
  await params.store.append({
    type: 'blocked',
    at: params.now(),
    goalId: params.goal.id,
    brief: params.brief,
    resolution,
  });
  await params.store.append({
    type: 'emitted',
    at: params.now(),
    goalId: params.goal.id,
    report: params.report,
  });
  return { kind: 'blocked', report: params.report };
}
