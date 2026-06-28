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
