import { describe, expect, it } from 'vitest';
import { emitSuccessfulArtifact } from '../../src/engine/attempt/success.js';
import { makeGoal, MemoryEventStore, textArtifact } from './stubs.js';

describe('attempt success emission', () => {
  it('persists before appending the emitted report', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal();
    const calls: string[] = [];

    const report = await emitSuccessfulArtifact({
      goal,
      artifact: textArtifact('done'),
      store,
      now: () => 1,
      persist: async (_goal, artifact) => {
        calls.push(`persist:${artifact.kind}`);
      },
    });

    calls.push(...(await store.list()).map((event) => event.type));
    expect(calls).toEqual(['persist:text', 'emitted']);
    expect(report).toMatchObject({
      artifact: textArtifact('done'),
      blockers: [],
    });
  });
});
