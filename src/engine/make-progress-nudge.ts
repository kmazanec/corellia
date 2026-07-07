import type { GoalTypeDef } from '../contract/goal-type.js';

/**
 * The read-without-write nudge for make goals.
 *
 * A make goal's deliverable is the files it writes. A leaf that keeps reading and
 * never writes is the failure mode behind the freeze-contract stall: it explores
 * the codebase, emits a description of what it found, and produces no files. The
 * preamble steers against this up front; this is the in-loop backstop — once a
 * make leaf has made many read-class calls with zero successful writes, inject a
 * one-time reminder that reading is not delivery.
 *
 * Fires once per attempt (the loop tracks `nudged`), only for make goals, and
 * only when reads cross the threshold with no write yet — so a leaf that writes
 * early, or reads modestly, never sees it.
 */

export const READ_WITHOUT_WRITE_THRESHOLD = 12;

export function shouldNudgeReadWithoutWrite(params: {
  typeDef: GoalTypeDef;
  readCalls: number;
  writeCalls: number;
  alreadyNudged: boolean;
}): boolean {
  return (
    params.typeDef.kind === 'make' &&
    !params.alreadyNudged &&
    params.writeCalls === 0 &&
    params.readCalls >= READ_WITHOUT_WRITE_THRESHOLD
  );
}

export function readWithoutWriteNudge(readCalls: number): string {
  return (
    `You have made ${readCalls} read-class calls and written no files yet. ` +
    `This is a make goal: reading is not delivery — the artifact is the files you ` +
    `create or modify, emitted as fenced file blocks. Stop exploring and write the ` +
    `file(s) the spec names now, from what you have already read. If the work ` +
    `genuinely cannot be done, raise a blocker instead of reading further.`
  );
}

/**
 * The read-without-emit steer for explore-then-emit goals (ADR-039 shape:
 * structured output, no write grant).
 *
 * ADR-041 removed the hard read-count force-emit — it force-emitted broken
 * partials — and left read economy to skill guidance plus the working-memory
 * bound. Daemon proof run 5b (2026-07-07) showed the failure mode that leaves
 * open: an author-acceptance-criteria leaf with a tiny, empty scope surveyed
 * the host repo for 50+ read steps across 32 minutes, never emitting, until
 * the tree deadline killed it. The guidance said stop; nothing mechanical
 * seconded it.
 *
 * This is the soft middle ground: two context STEERS, never a forced emit —
 * the model keeps full control of when it emits, but the harness voices the
 * economy discipline at escalating strength. Stage 1 at the calibration
 * threshold; stage 2, sterner, at double it. Both fire at most once.
 */
export const READ_WITHOUT_EMIT_THRESHOLD = 16;

/**
 * Return the steer to inject for an explore-then-emit leaf, or null when none
 * is due. `nudgesSent` counts prior injections (0, 1, or 2).
 */
export function readWithoutEmitSteer(params: {
  isExploreThenEmit: boolean;
  exploreReadCalls: number;
  nudgesSent: number;
  scope: string[];
}): string | null {
  if (!params.isExploreThenEmit) return null;
  const scope = params.scope.length > 0 ? params.scope.join(', ') : '(empty scope)';
  if (params.nudgesSent === 0 && params.exploreReadCalls >= READ_WITHOUT_EMIT_THRESHOLD) {
    return (
      `You have made ${params.exploreReadCalls} read-class calls without emitting. ` +
      `Your declared scope is: ${scope}. Reading beyond what that scope requires is ` +
      `waste — if further reading has stopped changing your answer, your next ` +
      `message should be the final artifact.`
    );
  }
  if (params.nudgesSent === 1 && params.exploreReadCalls >= READ_WITHOUT_EMIT_THRESHOLD * 2) {
    return (
      `You have now made ${params.exploreReadCalls} read-class calls without emitting — ` +
      `twice the calibration budget for this goal's scope (${scope}). This is the final ` +
      `steer: emit the artifact from what you already know, or raise a blocker if the ` +
      `work genuinely cannot be done. Do not keep reading.`
    );
  }
  return null;
}
