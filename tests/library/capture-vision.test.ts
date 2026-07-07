/**
 * The image-judge predicate (ADR-042 × ADR-044): a `{ capture }` criterion whose
 * declared capture produces an image forces a vision-capable judge; text-body
 * captures and pure script/file criteria do not.
 */

import { describe, expect, it } from 'vitest';
import type { DeclaredCaptures } from '../../src/contract/capture.js';
import type { AcceptanceCriterion } from '../../src/library/acceptance-criteria.js';
import { captureProducesImage, criteriaNeedVision } from '../../src/library/capture-vision.js';

const captures: DeclaredCaptures = {
  shot: { kind: 'screenshot-ui', startScript: 's', port: 3000, route: '/', outputPath: 'o.png' },
  doc: { kind: 'render-document', file: 'a.pdf', renderScript: 'r', outputPath: 'o.png' },
  api: { kind: 'drive-endpoint', startScript: 's', port: 3000, method: 'GET', path: '/', outputPath: 'o.json' },
};

function criterion(check: AcceptanceCriterion['check']): AcceptanceCriterion {
  return { id: 'c', claim: 'claim', check };
}

describe('captureProducesImage', () => {
  it('flags render-document and screenshot-ui as image, drive-endpoint as not', () => {
    expect(captureProducesImage(captures['shot']!)).toBe(true);
    expect(captureProducesImage(captures['doc']!)).toBe(true);
    expect(captureProducesImage(captures['api']!)).toBe(false);
  });
});

describe('criteriaNeedVision', () => {
  it('is true when a criterion names an image-producing capture', () => {
    expect(criteriaNeedVision([criterion({ capture: 'shot' })], captures)).toBe(true);
    expect(criteriaNeedVision([criterion({ capture: 'doc' })], captures)).toBe(true);
  });

  it('is false for a text-body capture', () => {
    expect(criteriaNeedVision([criterion({ capture: 'api' })], captures)).toBe(false);
  });

  it('is false for pure script/file criteria', () => {
    expect(criteriaNeedVision([criterion({ script: 'test' })], captures)).toBe(false);
    expect(criteriaNeedVision([criterion({ file: 'x.ts', anchor: 'DONE' })], captures)).toBe(false);
  });

  it('is false when no captures are declared, even for a capture-named criterion', () => {
    expect(criteriaNeedVision([criterion({ capture: 'shot' })], undefined)).toBe(false);
  });

  it('is false for a criterion naming an undeclared capture', () => {
    expect(criteriaNeedVision([criterion({ capture: 'unknown' })], captures)).toBe(false);
  });

  it('is true when at least one of several criteria demands an image', () => {
    const criteria = [criterion({ script: 'test' }), criterion({ capture: 'shot' })];
    expect(criteriaNeedVision(criteria, captures)).toBe(true);
  });
});
