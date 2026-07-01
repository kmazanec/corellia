import { describe, expect, it } from 'vitest';
import { parseFactoryEvent } from '../../src/contract/event-parser.js';

describe('parseFactoryEvent pattern trust event', () => {
  it('accepts pattern-trust-signed events', () => {
    const parsed = parseFactoryEvent({
      type: 'pattern-trust-signed',
      at: 1,
      goalId: 'g1',
      shape: 'shape-a',
      from: 'provisional',
      to: 'trusted',
      signer: 'keith',
      rationale: 'worked repeatedly',
    });

    expect(parsed).toMatchObject({ type: 'pattern-trust-signed', to: 'trusted' });
  });

  it('rejects invalid pattern trust statuses', () => {
    const parsed = parseFactoryEvent({
      type: 'pattern-trust-signed',
      at: 1,
      goalId: 'g1',
      shape: 'shape-a',
      from: 'none',
      to: 'trusted',
      signer: 'keith',
      rationale: 'worked repeatedly',
    });

    expect(parsed).toBeNull();
  });

  it('rejects missing signer or rationale', () => {
    expect(parseFactoryEvent({
      type: 'pattern-trust-signed',
      at: 1,
      goalId: 'g1',
      shape: 'shape-a',
      from: 'provisional',
      to: 'trusted',
      rationale: 'worked repeatedly',
    })).toBeNull();
  });
});
