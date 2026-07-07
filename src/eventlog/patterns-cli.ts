/**
 * `corellia trust` / `corellia distrust` / `corellia patterns` — the operator
 * surface for the split-memo flywheel (DESIGN.md "Memoized splits").
 *
 *   patterns            list every recorded memo with its trust plane and stats,
 *                       so an operator can see what is worth trusting.
 *   trust <shape>       promote a memo provisional → trusted. This is the AUTHORITY
 *                       GAP: no eval, recurrence count, or outcome statistic may do
 *                       this on its own (DESIGN.md). It is a deliberate human act,
 *                       recorded with --by provenance in the log.
 *   distrust <shape>    demote a memo trusted → provisional. Demotion is deliberate
 *                       too — a memo flagged by golden divergence is demoted by
 *                       decision, not silent decay.
 *
 * Trust changes append a `pattern-trust-signed` event to the SAME event log the
 * daemon reads, so a restarted daemon (or the next tick, for Pg) sees the new
 * trust plane and walks a newly-trusted memo verbatim. Argument parsing is
 * dependency-free; scripts/corellia.ts dispatches argv here.
 */

import type { EventStore } from '../contract/events.js';
import type { PatternStore, SplitMemo } from '../contract/pattern.js';
import { promotePatternTrust } from '../engine/pattern-trust.js';
import type { LogsConsole } from './logs-cli.js';

/** The goalId stamped on operator-initiated trust events — not a real goal. */
export const OPERATOR_GOAL_ID = 'operator:cli';

// ── patterns (list candidates) ──────────────────────────────────────────────

/**
 * Render every memo as a table an operator can scan: shape, trust plane, and the
 * recurrence/outcome stats that make a promotion candidate legible. Sorted by
 * uses descending so the most-exercised (best-evidenced) shapes surface first.
 */
export async function runPatternsList(patterns: PatternStore, io: LogsConsole): Promise<number> {
  const memos = [...(await patterns.list())].sort((a, b) => b.uses - a.uses);

  if (memos.length === 0) {
    io.log('No split memos recorded yet. Run some goals through the factory first.');
    return 0;
  }

  io.log(`\n${memos.length} split memo(s):\n`);
  io.log('  status       uses  ok  fail  shape');
  io.log('  ─────────────────────────────────────────────────────────────');
  for (const m of memos) {
    io.log(
      `  ${m.status.padEnd(11)}  ${String(m.uses).padStart(4)}  ${String(m.successes).padStart(2)}  ${String(m.failures).padStart(4)}  ${m.shape}`,
    );
  }
  io.log('');
  io.log('  Promote a provisional memo you trust:  corellia trust "<shape>" --by <name>');
  io.log('  Demote a trusted memo under review:    corellia distrust "<shape>" --by <name>');
  io.log('');
  return 0;
}

// ── trust / distrust (promotion & demotion) ─────────────────────────────────

export interface TrustArgs {
  shape: string | undefined;
  by: string | undefined;
  rationale: string | undefined;
}

/**
 * Parse argv for `trust`/`distrust`: the first non-flag token is the shape;
 * `--by <name>` names the human signing off; `--rationale <text>` is optional.
 */
export function parseTrustArgs(argv: readonly string[]): TrustArgs {
  let shape: string | undefined;
  let by: string | undefined;
  let rationale: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--by') {
      by = argv[++i];
    } else if (arg === '--rationale') {
      rationale = argv[++i];
    } else if (arg !== undefined && !arg.startsWith('-') && shape === undefined) {
      shape = arg;
    }
  }

  return { shape, by, rationale };
}

/**
 * Run `trust` or `distrust`. Appends the `pattern-trust-signed` event (via
 * promotePatternTrust, which writes the event before mutating the store) with
 * the signer's name — the authority-gap provenance the design requires. Fails
 * with a clear message when the shape is unknown or `--by` is missing.
 */
export async function runTrust(
  to: 'trusted' | 'provisional',
  args: TrustArgs,
  patterns: PatternStore,
  store: EventStore,
  io: LogsConsole,
  now: () => number = Date.now,
): Promise<number> {
  const verb = to === 'trusted' ? 'trust' : 'distrust';

  if (args.shape === undefined) {
    io.error(`corellia ${verb}: a memo shape is required`);
    io.error(`  usage: corellia ${verb} "<shape>" --by <name> [--rationale <text>]`);
    io.error('  run `corellia patterns` to list recorded shapes');
    return 2;
  }
  if (args.by === undefined || args.by.length === 0) {
    io.error(`corellia ${verb}: --by <name> is required — trust is a signed human act, not anonymous`);
    return 2;
  }

  const rationale =
    args.rationale ??
    (to === 'trusted'
      ? 'operator promoted via corellia trust'
      : 'operator demoted via corellia distrust');

  const result = await promotePatternTrust({
    patterns,
    store,
    now,
    goalId: OPERATOR_GOAL_ID,
    shape: args.shape,
    to,
    signer: args.by,
    rationale,
  });

  if (!result.ok) {
    io.error(`corellia ${verb}: ${result.reason}`);
    return 1;
  }

  if (!result.changed) {
    io.log(`Memo "${args.shape}" is already ${to} — no change.`);
    return 0;
  }

  const arrow = to === 'trusted' ? 'provisional → trusted' : 'trusted → provisional';
  io.log(`Memo "${args.shape}" ${arrow}, signed off by ${args.by}.`);
  if (to === 'trusted') {
    io.log('The decide path will now walk this memo verbatim, skipping fresh derivation.');
  } else {
    io.log('The decide path will treat this memo as a suggestion again; the split eval judges it.');
  }
  return 0;
}

// ── candidate stat surfacing (reusable projection helper) ───────────────────

/**
 * A provisional memo's promotion-worthiness at a glance: its stats plus a coarse
 * signal an operator weighs (never an auto-promotion). Trusted memos are excluded
 * — they are already promoted.
 */
export interface PromotionCandidate {
  shape: string;
  uses: number;
  successes: number;
  failures: number;
}

/** Provisional memos that have recurred (uses >= 2), the operator's shortlist. */
export function promotionCandidates(memos: readonly SplitMemo[]): PromotionCandidate[] {
  return memos
    .filter((m) => m.status === 'provisional' && m.uses >= 2)
    .map((m) => ({ shape: m.shape, uses: m.uses, successes: m.successes, failures: m.failures }))
    .sort((a, b) => b.uses - a.uses);
}
