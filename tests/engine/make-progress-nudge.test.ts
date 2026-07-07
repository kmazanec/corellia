import { describe, it, expect } from 'vitest';
import {
  readWithoutEmitSteer,
  shouldNudgeReadWithoutWrite,
  readWithoutWriteNudge,
  READ_WITHOUT_WRITE_THRESHOLD,
} from '../../src/engine/make-progress-nudge.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';

function typeOfKind(kind: GoalTypeDef['kind']): GoalTypeDef {
  return {
    name: 't',
    kind,
    family: 'build',
    leafOnly: true,
    tier: { default: 'mid', ladder: ['mid'] },
    deterministic: [],
    judgeType: null,
    grants: [],
  } as unknown as GoalTypeDef;
}

describe('shouldNudgeReadWithoutWrite', () => {
  const make = typeOfKind('make');

  it('fires for a make goal at the threshold with zero writes', () => {
    expect(
      shouldNudgeReadWithoutWrite({
        typeDef: make,
        readCalls: READ_WITHOUT_WRITE_THRESHOLD,
        writeCalls: 0,
        alreadyNudged: false,
      }),
    ).toBe(true);
  });

  it('does not fire below the threshold', () => {
    expect(
      shouldNudgeReadWithoutWrite({
        typeDef: make,
        readCalls: READ_WITHOUT_WRITE_THRESHOLD - 1,
        writeCalls: 0,
        alreadyNudged: false,
      }),
    ).toBe(false);
  });

  it('does not fire once any file has been written', () => {
    expect(
      shouldNudgeReadWithoutWrite({
        typeDef: make,
        readCalls: READ_WITHOUT_WRITE_THRESHOLD + 20,
        writeCalls: 1,
        alreadyNudged: false,
      }),
    ).toBe(false);
  });

  it('fires only once (alreadyNudged short-circuits)', () => {
    expect(
      shouldNudgeReadWithoutWrite({
        typeDef: make,
        readCalls: READ_WITHOUT_WRITE_THRESHOLD,
        writeCalls: 0,
        alreadyNudged: true,
      }),
    ).toBe(false);
  });

  it('never fires for a non-make goal', () => {
    expect(
      shouldNudgeReadWithoutWrite({
        typeDef: typeOfKind('learn'),
        readCalls: READ_WITHOUT_WRITE_THRESHOLD + 50,
        writeCalls: 0,
        alreadyNudged: false,
      }),
    ).toBe(false);
  });
});

describe('readWithoutWriteNudge', () => {
  it('names the read count and tells the leaf to write or block', () => {
    const text = readWithoutWriteNudge(15);
    expect(text).toContain('15 read-class calls');
    expect(text).toContain('reading is not delivery');
    expect(text.toLowerCase()).toContain('blocker');
  });
});

describe('readWithoutEmitSteer (explore-then-emit read economy)', () => {
  const base = { isExploreThenEmit: true, scope: ['out/cli/'] };

  it('stays silent below the calibration threshold', () => {
    expect(readWithoutEmitSteer({ ...base, exploreReadCalls: 15, nudgesSent: 0 })).toBeNull();
  });

  it('steers once at the threshold, naming the scope', () => {
    const steer = readWithoutEmitSteer({ ...base, exploreReadCalls: 16, nudgesSent: 0 });
    expect(steer).toContain('16 read-class calls');
    expect(steer).toContain('out/cli/');
  });

  it('does not repeat stage one', () => {
    expect(readWithoutEmitSteer({ ...base, exploreReadCalls: 20, nudgesSent: 1 })).toBeNull();
  });

  it('issues the final steer at double the threshold', () => {
    const steer = readWithoutEmitSteer({ ...base, exploreReadCalls: 32, nudgesSent: 1 });
    expect(steer).toContain('final steer');
  });

  it('never fires more than twice or for non-emit shapes', () => {
    expect(readWithoutEmitSteer({ ...base, exploreReadCalls: 200, nudgesSent: 2 })).toBeNull();
    expect(
      readWithoutEmitSteer({ isExploreThenEmit: false, scope: [], exploreReadCalls: 200, nudgesSent: 0 }),
    ).toBeNull();
  });

  it('labels an empty scope honestly', () => {
    const steer = readWithoutEmitSteer({ isExploreThenEmit: true, scope: [], exploreReadCalls: 16, nudgesSent: 0 });
    expect(steer).toContain('(empty scope)');
  });
});
