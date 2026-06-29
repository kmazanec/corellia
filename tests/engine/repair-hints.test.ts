import { describe, it, expect } from 'vitest';
import { repairHintsFor } from '../../src/engine/attempt/repair-hints.js';

describe('repairHintsFor', () => {
  it('maps a missing-vitest-import error to the import fix', () => {
    const hints = repairHintsFor(['Step loop failed: ReferenceError: it is not defined']);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("import { describe, it, expect } from 'vitest'");
  });

  it('maps __dirname-in-ESM to the import.meta.url fix', () => {
    const hints = repairHintsFor(['__dirname is not defined in ES module scope']);
    expect(hints[0]).toContain('import.meta.url');
  });

  it('maps require-in-ESM to the import fix', () => {
    const hints = repairHintsFor(['ReferenceError: require is not defined']);
    expect(hints[0]).toContain('import');
  });

  it('maps a missing TS name to the missing-import fix', () => {
    const hints = repairHintsFor(["Cannot find name 'Foo'."]);
    expect(hints[0]).toContain('import');
  });

  it('deduplicates when several texts hit the same signature', () => {
    const hints = repairHintsFor([
      'it is not defined',
      'describe is not defined',
    ]);
    expect(hints).toHaveLength(1);
  });

  it('returns nothing for an unrecognized failure', () => {
    expect(repairHintsFor(['Some bespoke domain assertion failed'])).toEqual([]);
    expect(repairHintsFor([])).toEqual([]);
  });
});
