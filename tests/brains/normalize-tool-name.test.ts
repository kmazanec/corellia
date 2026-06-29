import { describe, it, expect } from 'vitest';
import { normalizeToolName } from '../../src/brains/llm.js';

describe('normalizeToolName', () => {
  it('returns a well-formed name unchanged', () => {
    expect(normalizeToolName('read_file')).toBe('read_file');
    expect(normalizeToolName('find_symbol')).toBe('find_symbol');
  });

  it('strips args and stray markup baked into the name', () => {
    expect(normalizeToolName('read_file("src/x.ts")</arg_value>')).toBe('read_file');
    expect(normalizeToolName('list_dir(".")</arg_value>')).toBe('list_dir');
  });

  it('trims leading whitespace before extracting', () => {
    expect(normalizeToolName('  write_file ')).toBe('write_file');
  });

  it('returns the raw value when no identifier prefix exists', () => {
    expect(normalizeToolName('(broken)')).toBe('(broken)');
  });
});
