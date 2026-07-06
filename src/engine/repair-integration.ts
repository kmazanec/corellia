import type { ChildPlan } from '../contract/decision.js';
import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { MemoryView } from '../contract/memory.js';
import type { Report } from '../contract/report.js';
import type { Finding, Verdict } from '../contract/verdict.js';
import {
  appendChildSpawnedEvents,
  buildSplitChildGoals,
} from './split-children.js';

/**
 * The repair rung at the parent's integrate edge (ADR-047). `judge-integration`
 * finds real cross-module seam bugs, but a leaf is scoped to one area and cannot
 * fix across the seam — so an integration failure used to be terminal. This is the
 * integrate-edge analogue of the leaf repair rung (ADR-006): fail → repair first.
 * The fixer is not a new type — it is `implement` with the judge's prescriptions
 * as its spec, spawned as an ordinary child scoped to the UNION of the failing
 * children's scopes, then the integration judge re-runs once. One repair per
 * integrate; a second failure follows today's escalate/block path.
 */

const REPAIR_LOCAL_ID = 'repair-integration';

export interface IntegrationRepairOutcome {
  /** Whether a repair child was spawned and run (the cue for the caller to re-judge). */
  repaired: boolean;
}

/**
 * Whether a failed integration verdict is repairable at this edge. A verdict is
 * repairable when it carries at least one gating finding and NONE of its findings
 * is `escalated`. An escalated finding needs a frozen-contract change or a
 * re-architecture — the human's call, not a fixer's — so it skips the rung
 * straight to block, exactly as the verdict contract prescribes.
 */
export function isRepairableIntegrationVerdict(verdict: Verdict | undefined): boolean {
  if (verdict === undefined || verdict.pass) return false;
  if (verdict.findings.some((finding) => finding.escalated === true)) return false;
  return verdict.findings.some((finding) => finding.gating);
}

/**
 * Run one integration repair: spawn an `implement` child fed the verdict's
 * findings verbatim, scoped to the union of the failing children's scopes, run it
 * to completion, and record a `repair-applied` event with the prescriptions used.
 * The caller re-runs the integration judge on the repaired tree.
 *
 * Returns `repaired: false` without spawning anything when the verdict is not
 * repairable (no gating findings, or an escalated finding present).
 */
export async function repairIntegration(params: {
  goal: Goal;
  verdict: Verdict | undefined;
  children: ChildPlan[];
  memory: MemoryView;
  store: EventStore;
  now: () => number;
  runChild: (goal: Goal) => Promise<Report>;
}): Promise<IntegrationRepairOutcome> {
  if (!isRepairableIntegrationVerdict(params.verdict)) {
    return { repaired: false };
  }
  const verdict = params.verdict!;

  const repairPlan = integrationRepairPlan(params.goal, verdict, params.children);
  const [repairGoal] = await buildSplitChildGoals({
    parent: params.goal,
    children: [repairPlan],
    memory: params.memory,
  });
  await appendChildSpawnedEvents({
    parent: params.goal,
    children: [repairPlan],
    childGoals: [repairGoal!],
    store: params.store,
    now: params.now,
  });

  await params.runChild(repairGoal!);

  await params.store.append({
    type: 'repair-applied',
    at: params.now(),
    goalId: repairGoal!.id,
    prescriptions: repairPrescriptions(verdict),
  });

  return { repaired: true };
}

/**
 * The `implement` child that fixes the seam: scoped to the union of every failing
 * child's scope, with the judge's findings rendered verbatim into a
 * `{ description }` spec (the readable spec convention). It depends on no sibling —
 * it runs against the already-integrated tree the judge just failed.
 */
function integrationRepairPlan(
  goal: Goal,
  verdict: Verdict,
  children: ChildPlan[],
): ChildPlan {
  return {
    localId: REPAIR_LOCAL_ID,
    type: 'implement',
    title: `Repair integration seam for "${goal.title}"`,
    spec: { description: repairDescription(goal, verdict) },
    dependsOn: [],
    scope: unionScope(children),
    budgetShare: 1,
  };
}

/**
 * The union of every child's scope — the seam a cross-cutting fix is allowed to
 * touch. Deduplicated, order-stable. A child with an empty scope contributes
 * nothing; if every child is unscoped the union is empty, which the scope gate
 * reads as "no scope declared: allow all" — the same allow-all a normal unscoped
 * goal gets, so the repair is never left unable to reach the code it must fix.
 */
export function unionScope(children: ChildPlan[]): string[] {
  const seen = new Set<string>();
  const union: string[] = [];
  for (const child of children) {
    for (const path of child.scope) {
      if (seen.has(path)) continue;
      seen.add(path);
      union.push(path);
    }
  }
  return union;
}

function repairDescription(goal: Goal, verdict: Verdict): string {
  const findingsBlock = verdict.findings
    .map((finding) => `- ${renderFinding(finding)}`)
    .join('\n');
  return (
    `The integration judge failed the assembled work for "${goal.title}". ` +
    `Fix the cross-module seam bugs it found, editing across the affected modules ` +
    `as needed. Do not re-scope the goal or change frozen contracts — apply the ` +
    `localized fixes below and leave the rest of the assembled work intact.\n\n` +
    `Integration findings:\n${findingsBlock}`
  );
}

function renderFinding(finding: Finding): string {
  const prescription = finding.prescription ? ` — fix: ${finding.prescription}` : '';
  return `[${finding.dimension}/${finding.severity}] ${finding.title}${prescription}`;
}

function repairPrescriptions(verdict: Verdict): string[] {
  return verdict.findings
    .filter((finding) => finding.gating)
    .map((finding) => finding.prescription ?? finding.title);
}
