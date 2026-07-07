/**
 * Invariant (b) no judge-authored writes: no goal whose type is judge-kind may
 * author a write. Judges grade; they never touch the product (the constitution
 * enforces judge types hold no write GRANT at lint time — this is the runtime
 * dual).
 *
 * Expressibility: a judge does NOT get its own `goal-received` in the current
 * engine — a `judge-verdict` is emitted against the goal being judged, carrying
 * `judgeType`. So the literal "a judge goal wrote" is vacuous today. The honest,
 * still-useful check is: any goal whose `goal-received.goal.type` resolves to
 * judge-kind must have no write-attributable event under its goalId. This catches
 * a future/misconfigured run that DID spawn a judge-kind type as a producing goal
 * — exactly the conduct the invariant forbids. Kind comes from the supplied
 * resolver (registry); with no resolver it falls back to the naming convention
 * and the violation detail flags the fallback.
 */

import type { FactoryEvent } from '../../contract/events.js';
import type { ConformanceViolation, KindResolver } from './types.js';
import { goalTypeIndex } from './types.js';

/**
 * The write-attributable event discriminants: the structural side-effect events
 * whose presence under a goal means that goal *produced a change*. `tool-call` is
 * deliberately excluded — its `tool` field is the raw tool name, not a governed
 * grant, so treating any tool-call as a write would flag a judge that merely read
 * a file. These are the unambiguous "this goal changed the product/repo/memory"
 * signals the log genuinely carries.
 */
const WRITE_ATTRIBUTABLE: ReadonlySet<FactoryEvent['type']> = new Set([
  'files-touched',
  'worktree-collected',
  'branch-pushed',
  'pr-opened',
  'knowledge-written',
  'memory-written',
]);

/** The core judge-kind type names, used when no registry/resolver is supplied. */
const CORE_JUDGE_TYPE_NAMES: ReadonlySet<string> = new Set([
  'judge-split',
  'judge-integration',
  'judge-acceptance',
  'critique-code',
  'critique-doc',
  'critique-ui',
]);

/**
 * Whether a type name looks judge-kind by the library's naming convention, used
 * only when the caller supplies no kind resolver. The convention (GOAL-TYPES.md)
 * is that judge-kind types are named `judge-*` or `critique-*`; this is a
 * best-effort fallback, and a violation found this way says so in its detail.
 */
function isJudgeKindByConvention(typeName: string): boolean {
  return (
    CORE_JUDGE_TYPE_NAMES.has(typeName) ||
    typeName.startsWith('judge-') ||
    typeName.startsWith('critique-')
  );
}

export function checkNoJudgeAuthoredWrites(
  events: FactoryEvent[],
  resolveKind: KindResolver | undefined,
): ConformanceViolation[] {
  const goalType = goalTypeIndex(events);

  const classify = (typeName: string): { judge: boolean; byConvention: boolean } => {
    const kind = resolveKind?.(typeName);
    if (kind !== undefined) return { judge: kind === 'judge', byConvention: false };
    return { judge: isJudgeKindByConvention(typeName), byConvention: true };
  };

  const violations: ConformanceViolation[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (!WRITE_ATTRIBUTABLE.has(e.type)) continue;
    const typeName = goalType.get(e.goalId);
    if (typeName === undefined) continue; // Write for a goal never received — not attributable to a kind.
    const { judge, byConvention } = classify(typeName);
    if (!judge) continue;
    violations.push({
      invariant: 'no-judge-authored-writes',
      goalId: e.goalId,
      indices: [i],
      detail:
        `judge-kind goal "${e.goalId}" (type "${typeName}") authored a write: ${e.type} (index ${i})` +
        (byConvention ? ' [kind inferred from naming convention; supply a registry to confirm]' : ''),
    });
  }
  return violations;
}
