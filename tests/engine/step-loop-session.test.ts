import { describe, expect, it } from 'vitest';
import { createStepLoopSession } from '../../src/engine/step-loop-session.js';
import { buildRegistry, leafTypeDef, makeGoal } from './stubs.js';

describe('step-loop session', () => {
  it('builds tools, transcript, counters, and duplicate-read state for a step loop', () => {
    const typeDef = leafTypeDef({
      name: 'implement',
      grants: ['fs.read'],
      outputSchema: { type: 'object' },
    });
    const registry = buildRegistry([typeDef]);
    const goal = makeGoal({
      type: 'implement',
      budget: { attempts: 1, tokens: 100, toolCalls: 2, wallClockMs: 1_000 },
    });

    const session = createStepLoopSession({
      goal,
      grants: typeDef.grants,
      budget: goal.budget,
      typeDef: registry.get('implement'),
      broker: {
        defs: () => [{
          name: 'read_file',
          description: 'read',
          parameters: { type: 'object', properties: {} },
          grants: ['fs.read'],
        }],
      },
      sandboxRepoRoot: '/tmp/repo',
      priorTranscript: undefined,
    });

    expect(session.tools.map((tool) => tool.name)).toContain('read_file');
    expect(session.tools.at(-1)?.name).toBe('note');
    expect(session.isExploreThenEmit).toBe(true);
    expect(session.hardToolCallCap).toBe(100);
    expect(session.counters).toMatchObject({
      remainingToolCalls: 2,
      toolCallsMade: 0,
      stepIndex: 0,
      exploreReadCalls: 0,
      totalTokensUsed: 0,
      toolBudgetWarned: false,
      forceEmitNext: false,
      malformRecoveryUsed: false,
    });
    expect(session.seenCalls.size).toBe(0);
    expect(session.callKeyByCallId.size).toBe(0);
    expect(session.transcript.at(-1)).toEqual({ role: 'context', content: '2 tool calls remaining' });
  });

  it('threads prior transcript evidence into the initial transcript', () => {
    const typeDef = leafTypeDef({ name: 'implement' });
    const goal = makeGoal({ type: 'implement' });

    const session = createStepLoopSession({
      goal,
      grants: [],
      budget: goal.budget,
      typeDef,
      broker: {},
      sandboxRepoRoot: undefined,
      priorTranscript: [{ role: 'tool', callId: 'r1', content: 'important prior result' }],
    });

    expect(session.transcript[0]?.content).toContain('PRIOR ATTEMPT EVIDENCE');
    expect(session.transcript[0]?.content).toContain('important prior result');
  });
});
