import { describe, it, expect } from 'vitest';
import {
  isDeliveryRefusal,
  deliveryRefusalVerdict,
} from '../../src/engine/attempt/delivery-refusal.js';
import type { Artifact } from '../../src/contract/report.js';

describe('isDeliveryRefusal', () => {
  it('flags a text artifact that states it cannot deliver', () => {
    const artifact: Artifact = {
      kind: 'text',
      text:
        'The current artifact is correct, and I cannot deliver the goal without ' +
        'read access to the codebase. I have no file access.',
    };
    expect(isDeliveryRefusal(artifact)).toBe(true);
  });

  it('flags the "would be fabrication" refusal shape', () => {
    const artifact: Artifact = {
      kind: 'text',
      text: 'Producing fenced code blocks now would be fabrication, not delivery.',
    };
    expect(isDeliveryRefusal(artifact)).toBe(true);
  });

  it('does not flag a genuine text deliverable that happens to contain "cannot"', () => {
    const artifact: Artifact = {
      kind: 'text',
      text:
        'The summary: users cannot reset their password without an email. ' +
        'This document delivers the requested behavioral spec in full.',
    };
    expect(isDeliveryRefusal(artifact)).toBe(false);
  });

  it('never flags a file artifact — a real file set is delivery', () => {
    const artifact: Artifact = {
      kind: 'files',
      files: [{ path: 'src/x.ts', content: '// I cannot deliver — but this is a file' }],
    };
    expect(isDeliveryRefusal(artifact)).toBe(false);
  });

  it('does not flag empty or whitespace-only text', () => {
    expect(isDeliveryRefusal({ kind: 'text', text: '' })).toBe(false);
    expect(isDeliveryRefusal({ kind: 'text', text: '   \n  ' })).toBe(false);
    expect(isDeliveryRefusal({ kind: 'text' })).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(
      isDeliveryRefusal({ kind: 'text', text: 'I CANNOT DELIVER this goal.' }),
    ).toBe(true);
  });
});

describe('deliveryRefusalVerdict', () => {
  it('is a gating, non-passing spec failure with a refusal signature', () => {
    const verdict = deliveryRefusalVerdict();
    expect(verdict.pass).toBe(false);
    expect(verdict.failureSignature).toBe('delivery-refusal');
    expect(verdict.findings).toHaveLength(1);
    const [finding] = verdict.findings;
    expect(finding!.gating).toBe(true);
    expect(finding!.dimension).toBe('spec');
    expect(finding!.severity).toBe('high');
    expect(finding!.prescription).toBeDefined();
  });
});
