import { describe, expect, it } from 'vitest';
import { enterGoal } from '../../src/engine/goal-entry.js';
import {
  buildRegistry,
  leafTypeDef,
  makeGoal,
  MemoryEventStore,
} from './stubs.js';
import { createRegistry } from '../../src/library/registry.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { structuredSpecInput } from '../../src/library/input-contracts.js';

describe('enterGoal', () => {
  it('blocks and emits an unknown goal type without throwing', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({ id: 'root', type: 'unknown-type' });

    const result = await enterGoal({
      goal,
      registry: buildRegistry([]),
      store,
      now: () => 1,
      sensitivity: [],
      onGate: undefined,
      onBrief: undefined,
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      kind: 'emitted',
      report: { blockers: ['Unknown goal type: unknown-type'] },
    });
    expect(store.types()).toEqual(['goal-received', 'blocked', 'emitted']);
  });

  it('records risk and blocks when high-risk authority is denied', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({
      id: 'root',
      type: 'leaf',
      scope: ['src/auth/login.ts'],
    });

    const result = await enterGoal({
      goal,
      registry: buildRegistry([leafTypeDef({ name: 'leaf' })]),
      store,
      now: () => 1,
      sensitivity: [
        {
          pattern: 'auth',
          reason: 'authentication surface',
          risk: 'high',
        },
      ],
      onGate: async () => 'denied',
      onBrief: undefined,
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      kind: 'emitted',
      report: {
        blockers: [
          expect.stringContaining('Authority gate denied'),
        ],
      },
    });
    expect(store.types()).toEqual([
      'goal-received',
      'risk-classified',
      'gate-decision',
      'blocked',
      'emitted',
    ]);
  });

  it('returns type, tier, and risk when the goal may proceed', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({
      id: 'root',
      type: 'leaf',
      budget: { attempts: 1, tokens: 10, toolCalls: 1, wallClockMs: 500 },
    });
    const typeDef = leafTypeDef({ name: 'leaf', tier: { default: 'mid', ladder: ['mid', 'high'] } });

    const result = await enterGoal({
      goal,
      registry: buildRegistry([typeDef]),
      store,
      now: () => 100,
      sensitivity: [],
      onGate: undefined,
      onBrief: undefined,
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      kind: 'ready',
      typeDef,
      tier: 'mid',
      tierIndex: 0,
      tierLadder: ['mid', 'high'],
      entryRisk: 'low',
    });
    // The wall-clock deadline is no longer a per-goal field on goal entry — it is
    // fixed once at the tree root (see TreeState.deadline) and enforced tree-wide.
    expect(result).not.toHaveProperty('deadline');
    expect(store.types()).toEqual(['goal-received', 'risk-classified']);
  });

  it('blocks free-text input for non-deliver goal types with input validators', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({
      id: 'root',
      type: 'leaf',
      spec: 'raw intent belongs at deliver-intent',
    });

    const result = await enterGoal({
      goal,
      registry: buildRegistry([
        leafTypeDef({
          name: 'leaf',
          inputSchema: { type: 'object' },
          validateInput: structuredSpecInput,
        }),
      ]),
      store,
      now: () => 1,
      sensitivity: [],
      onGate: undefined,
      onBrief: undefined,
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({
      kind: 'emitted',
      report: {
        blockers: [expect.stringContaining('only deliver-intent accepts free-text input')],
      },
    });
  });

  it('accepts free-text input for deliver-intent', async () => {
    const store = new MemoryEventStore();
    const goal = makeGoal({
      id: 'root',
      type: 'deliver-intent',
      spec: 'ship the feature',
    });

    const result = await enterGoal({
      goal,
      registry: createRegistry(starterTypes()),
      store,
      now: () => 1,
      sensitivity: [],
      onGate: undefined,
      onBrief: undefined,
      hasReachedCeiling: () => false,
    });

    expect(result).toMatchObject({ kind: 'ready' });
  });
});
