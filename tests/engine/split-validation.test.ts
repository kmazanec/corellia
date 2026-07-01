import { describe, expect, it } from 'vitest';
import type { ChildPlan } from '../../src/contract/decision.js';
import { validateSplit } from '../../src/engine/split-validation.js';
import { leafTypeDef } from './stubs.js';
import { structuredSpecInput } from '../../src/library/input-contracts.js';

function child(spec: unknown): ChildPlan {
  return {
    localId: 'c1',
    type: 'leaf',
    title: 'child',
    spec,
    dependsOn: [],
    scope: ['src/'],
    budgetShare: 1,
  };
}

describe('validateSplit input contracts', () => {
  it('rejects free-text child specs for typed child goal types', () => {
    const def = leafTypeDef({
      name: 'leaf',
      inputSchema: { type: 'object' },
      validateInput: structuredSpecInput,
    });

    const result = validateSplit([child('raw child intent')], (type) =>
      type === 'leaf' ? def : undefined,
    );

    expect(result).toContain('invalid input');
    expect(result).toContain('only deliver-intent accepts free-text input');
  });

  it('accepts structured child specs', () => {
    const def = leafTypeDef({
      name: 'leaf',
      inputSchema: { type: 'object' },
      validateInput: structuredSpecInput,
    });

    const result = validateSplit([child({ objective: 'build typed child' })], (type) =>
      type === 'leaf' ? def : undefined,
    );

    expect(result).toBeNull();
  });
});
