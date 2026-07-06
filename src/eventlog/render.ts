/**
 * Human-readable renderings of the event log for the `corellia logs` CLI.
 *
 * The log IS the trace (ADR-003); these functions turn `FactoryEvent`s into the
 * two views the CLI shows: a per-goal replay of a finished log, and a compact
 * one-line-per-event stream for the live `--follow` tail. Both are pure string
 * builders over already-parsed events — no I/O, no store — so they are shared by
 * the replay path and the follow path without duplicating the describe logic.
 */

import type { FactoryEvent } from '../contract/events.js';
import type { SignalTier, TierToolCallStats } from './projections.js';
import { renderTree, costSummary, toolCallSignal } from './projections.js';

/** A verdict's pass/fail plus its gating findings, condensed to one clause. */
function verdictLine(v: {
  pass: boolean;
  findings: { title: string; gating: boolean; severity: string }[];
}): string {
  if (v.pass) return 'PASS';
  const gating = v.findings.filter((f) => f.gating).map((f) => `[${f.severity}] ${f.title}`);
  return `FAIL — ${gating.length > 0 ? gating.join('; ') : v.findings.map((f) => f.title).join('; ')}`;
}

/**
 * One human-readable line describing an event, or null to omit it from the
 * per-goal detail view (e.g. the goal-received header is printed separately).
 */
export function describeEvent(e: FactoryEvent): string | null {
  switch (e.type) {
    case 'goal-received':
      return null; // Header is printed per goal.
    case 'decided':
      return `decided: ${e.decision.kind}${e.decision.kind === 'split' ? ` (${e.decision.children.length} children)` : ''}`;
    case 'child-spawned':
      return `spawned child: ${e.childType} (${e.childId})`;
    case 'pattern-consulted':
      return `pattern: ${e.status}`;
    case 'step':
      return `step ${e.index}: ${e.outputKind}`;
    case 'tool-call': {
      const detail = e.reason ? ` — ${e.reason}` : '';
      return `tool-call: ${e.tool} → ${e.outcome}${detail}`;
    }
    case 'script-ran':
      return `script-ran: ${e.command} → exit ${e.exitStatus}`;
    case 'capture-ran':
      return `capture-ran: ${e.captureName} (${e.kind}) → ${e.ok ? 'ok' : 'FAILED'}`;
    case 'deterministic-checked':
      return `deterministic: ${verdictLine(e.verdict)}`;
    case 'judge-verdict':
      return `judge(${e.judgeType}) @${e.tier}: ${verdictLine(e.verdict)}`;
    case 'repair-applied':
      return `repair: ${e.prescriptions.join('; ')}`;
    case 'tier-escalated':
      return `tier: ${e.from} → ${e.to}`;
    case 'knowledge-written':
      return `knowledge-written: ${e.artifact.category} (${e.artifact.pointers.length} pointers)`;
    case 'knowledge-facts-written':
      return `knowledge-facts: ${e.facts.region} (${e.facts.facts.length} facts)`;
    case 'knowledge-checked':
      return `knowledge-checked: ${e.category} → ${e.outcome}`;
    case 'gate-checked':
      return `gate-checked: ${e.ok ? 'ok' : `missing [${e.missing.join(', ')}]`}`;
    case 'budget-exhausted':
      return `⚠ budget-exhausted: ${e.dimension}`;
    case 'transport-retry':
      return `transport-retry: ${e.detail}`;
    case 'malformation-reprompt':
      return `malformation-reprompt: ${e.detail}`;
    case 'context-evicted':
      return `context-evicted: ${e.detail}`;
    case 'dependency-degraded':
      return `dependency-degraded: ${e.dependency} — ${e.blocker}`;
    case 'blocked':
      return `✗ BLOCKED (${e.resolution}): ${e.brief.question}`;
    case 'emitted':
      return `emitted: ${e.report.blockers.length > 0 ? `BLOCKERS [${e.report.blockers.join(' | ')}]` : 'ok'}`;
    case 'ceiling-reached':
      return `⚠ ceiling: $${e.spentUsd.toFixed(4)} / $${e.ceilingUsd.toFixed(2)}`;
    case 'round-started':
      return `round ${e.round} started ($${e.spentUsd.toFixed(4)} spent)`;
    case 'round-assessed':
      return `round ${e.round} assessed: ${e.passingCount}/${e.criteriaTotal} → ${e.outcome}`;
    case 'worktree-created':
      return `worktree: ${e.branch} @ ${e.path}`;
    case 'worktree-collected':
      return `worktree-collected: ${e.branch} (${e.commits.length} commits)`;
    case 'worktree-preserved':
      return `worktree-preserved: ${e.branch} — ${e.reason}`;
    case 'branch-pushed':
      return `branch-pushed: ${e.branch} → ${e.remote}`;
    case 'pr-opened':
      return `pr-opened: ${e.url}`;
    case 'blocker-routed':
      return `blocker-routed: ${e.commissionId}`;
    case 'risk-classified':
      return `risk: ${e.risk}`;
    case 'gate-decision':
      return `gate-decision: ${e.resolution}`;
    case 'parked':
      return `parked (ttl ${e.ttlMs}ms): ${e.brief.question}`;
    case 'resumed':
      return `resumed: ${e.answer}`;
    case 'pattern-recorded':
      return `pattern-recorded: ${e.shape} → ${e.outcome}`;
    case 'pattern-trust-signed':
      return `pattern-trust: ${e.shape} ${e.from} → ${e.to}`;
    case 'memory-written':
      return `memory-written: ${e.pointer.id}`;
    case 'memory-reinforced':
      return `memory-reinforced: ${e.memoryId} → ${e.outcome}`;
    case 'produced':
      return `produced (${e.usage.promptTokens}+${e.usage.completionTokens} tok)`;
    case 'golden-candidate':
      return `golden-candidate: ${e.judgeType} (${e.verdictPass ? 'pass' : 'fail'})`;
    case 'worktree-reaped':
      return `worktree-reaped: ${e.path}${e.branch ? ` (${e.branch})` : ''} — ${e.reason}`;
    case 'files-touched': {
      const out = e.files.filter((f) => !f.inScope).length;
      return `files-touched: ${e.files.length} file(s)${out > 0 ? `, ${out} OUT OF SCOPE` : ', all in scope'}`;
    }
  }
}

/** A short goalId for one-liners: the last dash-segment, capped. */
export function shortGoalId(goalId: string): string {
  const tail = goalId.slice(goalId.lastIndexOf('-') + 1);
  const pick = tail.length > 0 ? tail : goalId;
  return pick.length > 8 ? pick.slice(0, 8) : pick;
}

/** A wall-clock `HH:MM:SS` for an event's `at` (local time). */
export function formatClock(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * One compact line for the `--follow` stream:
 * `HH:MM:SS  <goal>  <type>  <detail>`. The detail reuses describeEvent (which
 * already carries the tier / tool / verdict / block reason), falling back to the
 * bare type for events describeEvent omits from the detail view.
 */
export function followLine(e: FactoryEvent): string {
  // goal-received has no describeEvent line (its header is printed separately in
  // replay); in the stream, show the goal opening with its type and title.
  const detail =
    e.type === 'goal-received'
      ? `goal-received: [${e.goal.type}] ${e.goal.title}`
      : (describeEvent(e) ?? e.type);
  return `${formatClock(e.at)}  ${shortGoalId(e.goalId).padEnd(8)}  ${detail}`;
}

/** The full replay of a finished log: goal tree + per-goal detail (+ optional cost). */
export function renderReplay(
  events: FactoryEvent[],
  opts: { goalFilter?: string; typeFilter?: string; cost?: boolean } = {},
): string {
  const out: string[] = [];
  out.push('── goal tree ──────────────────────────────────────────────────────────────');
  out.push(renderTree(events));
  out.push('');

  const signal = renderToolCallSignal(events);
  if (signal !== '') {
    out.push(signal);
    out.push('');
  }

  // Index goal metadata (id → title/type) from goal-received events, in first-seen order.
  const meta = new Map<string, { title: string; type: string }>();
  const order: string[] = [];
  for (const e of events) {
    if (e.type === 'goal-received') {
      if (!meta.has(e.goalId)) order.push(e.goalId);
      meta.set(e.goalId, { title: e.goal.title, type: e.goal.type });
    }
  }

  out.push('── per-goal detail ──────────────────────────────────────────────────────────');
  for (const goalId of order) {
    const m = meta.get(goalId);
    if (!m) continue;
    if (opts.goalFilter && !goalId.includes(opts.goalFilter) && !m.title.includes(opts.goalFilter)) {
      continue;
    }
    out.push(`\n● [${m.type}] ${m.title}`);
    out.push(`  ${goalId}`);
    for (const e of events) {
      if (e.goalId !== goalId) continue;
      if (opts.typeFilter && e.type !== opts.typeFilter) continue;
      const line = describeEvent(e);
      if (line) out.push(`    ${line}`);
    }
  }

  if (opts.cost) {
    out.push('');
    out.push('── cost ───────────────────────────────────────────────────────────────────');
    const summary = costSummary(events);
    const t = summary.tree;
    const dollars = t.costUsd !== undefined ? ` — $${t.costUsd.toFixed(4)}` : '';
    out.push(`tree: ${t.promptTokens} prompt + ${t.completionTokens} completion tokens${dollars}`);
  }

  return out.join('\n');
}

/**
 * The per-tier model-capability signal (ADR-044): a tier whose steps routinely
 * emit unparseable tool calls is failing tool calls, and the fix is to re-tag or
 * replace that tier's catalog model. Returns '' when the log holds nothing
 * tool-loop-shaped, so replay output stays clean for non-agentic logs. The
 * events carry no model id — the operator maps tier → model via the run config.
 */
export function renderToolCallSignal(events: FactoryEvent[]): string {
  const MALFORMATION_FLAG_THRESHOLD = 0.2;
  const signal = toolCallSignal(events);
  const order: SignalTier[] = ['low', 'mid', 'high', 'unknown'];
  const active = order.filter((tier) => {
    const s = signal.byTier[tier];
    return s.steps > 0 || s.malformations > 0 || s.transportRetries > 0 || s.escalationsFrom > 0;
  });
  if (active.length === 0) return '';

  const out: string[] = [];
  out.push('── per-tier tool-call signal ──────────────────────────────────────────────');
  for (const tier of active) {
    const s = signal.byTier[tier];
    out.push(`  ${tier.padEnd(8)} ${describeTierSignal(s)}`);
    if (s.malformationRate !== undefined && s.malformationRate >= MALFORMATION_FLAG_THRESHOLD) {
      out.push(
        `           ⚠ this tier is failing tool calls ` +
          `(${(s.malformationRate * 100).toFixed(0)}% of steps malformed) — ` +
          `consider re-tagging or replacing its model in the catalog.`,
      );
    }
  }
  return out.join('\n');
}

function describeTierSignal(s: TierToolCallStats): string {
  const rate = s.malformationRate !== undefined ? `${(s.malformationRate * 100).toFixed(0)}%` : '—';
  return (
    `steps=${s.steps} malformed=${s.malformations} (${rate}) ` +
    `retries=${s.transportRetries} tools=${s.toolCallsRan}/${s.toolCallsRan + s.toolCallsRefused} ` +
    `escalated-from=${s.escalationsFrom}`
  );
}
