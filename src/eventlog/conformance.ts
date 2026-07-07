/**
 * Conformance: replay a run's event log and assert the runtime invariants the
 * constitution cannot catch at lint time. The constitution
 * (src/library/constitution.ts) guards the library's *shape* — grant ceilings,
 * judge-no-write, on_timeout presence — before a PR merges. This projection
 * guards a run's *conduct* after the fact: did the deterministic gate actually
 * precede the judge, did a judge-kind goal actually stay hands-off, did spend
 * stay monotone and under its ceiling, does every human touchpoint carry the
 * safe-default fields, are worktrees well-nested. It is one more pure projection
 * over `FactoryEvent[]` (DESIGN.md, "the event log — the substrate under
 * everything"): no model calls, no I/O — the cheapest possible audit.
 *
 * This module is the orchestration index: it binds the kind resolver and runs
 * each invariant's own check module (src/eventlog/conformance/*.ts), each of
 * which owns one invariant and the honest note on what the event vocabulary lets
 * it check. Adding an invariant is adding a module and a line here.
 */

import type { FactoryEvent } from '../contract/events.js';
import type { Registry } from '../contract/goal-type.js';
import type { ConformanceViolation, KindResolver } from './conformance/types.js';
import { checkDeterministicBeforeJudge } from './conformance/ordering.js';
import { checkNoJudgeAuthoredWrites } from './conformance/judge-writes.js';
import { checkSpend } from './conformance/spend.js';
import { checkTouchpoints } from './conformance/touchpoints.js';
import { checkWorktreeLifecycle } from './conformance/worktree.js';

export type {
  ConformanceInvariant,
  ConformanceViolation,
  KindResolver,
} from './conformance/types.js';

/** Options for {@link checkConformance}. */
export interface ConformanceOptions {
  /**
   * The run's registry, used to resolve a goal-type name to its kind for the
   * no-judge-authored-writes invariant. When omitted, that invariant falls back
   * to the core judge-type naming convention and its detail flags the fallback.
   */
  registry?: Registry;
  /**
   * An explicit name→kind resolver, taking precedence over {@link registry}.
   * Lets a caller supply a synthetic kind map in a test without a full registry.
   */
  resolveKind?: KindResolver;
}

/**
 * Replay `events` and return every conformance violation, in a stable order
 * (grouped by invariant in the order the checks run, each already index-ordered).
 * An empty array means the run conformed to every checkable invariant.
 */
export function checkConformance(
  events: FactoryEvent[],
  opts: ConformanceOptions = {},
): ConformanceViolation[] {
  const resolveKind = kindResolverFrom(opts);

  return [
    ...checkDeterministicBeforeJudge(events),
    ...checkNoJudgeAuthoredWrites(events, resolveKind),
    ...checkSpend(events),
    ...checkTouchpoints(events),
    ...checkWorktreeLifecycle(events),
  ];
}

/** Resolve the kind resolver: explicit resolver wins, else the registry, else none. */
function kindResolverFrom(opts: ConformanceOptions): KindResolver | undefined {
  if (opts.resolveKind) return opts.resolveKind;
  if (opts.registry) {
    const { registry } = opts;
    return (name) => (registry.has(name) ? registry.get(name).kind : undefined);
  }
  return undefined;
}

/**
 * Format a violation list for human display: PASS when empty, else one line per
 * violation prefixed by its invariant key. Shared by the CLI and any caller that
 * wants the same rendering.
 */
export function formatConformance(violations: ConformanceViolation[]): string {
  if (violations.length === 0) return 'PASS';
  const lines = [`FAIL — ${violations.length} violation${violations.length === 1 ? '' : 's'}:`];
  for (const v of violations) {
    lines.push(`  [${v.invariant}] ${v.detail}`);
  }
  return lines.join('\n');
}
