import { describe, it, expect } from 'vitest';
import { summarizeToolArgs } from '../../src/engine/tool-call-summary.js';

describe('summarizeToolArgs', () => {
  it('captures read_file path + line range as structured attributes', () => {
    expect(
      summarizeToolArgs({ path: 'src/library/constitution.ts', offset: 400, limit: 200 }),
    ).toEqual({ path: 'src/library/constitution.ts', offset: 400, limit: 200 });
  });

  it('captures search pattern and path', () => {
    expect(summarizeToolArgs({ pattern: 'AcceptanceCheck', path: 'src/library' })).toEqual({
      pattern: 'AcceptanceCheck',
      path: 'src/library',
    });
  });

  it('captures list_dir path', () => {
    expect(summarizeToolArgs({ path: 'src/engine' })).toEqual({ path: 'src/engine' });
  });

  it('reduces write_file content to a length attribute, keeping the path', () => {
    const content = 'x'.repeat(1843);
    expect(summarizeToolArgs({ path: 'src/x.ts', content })).toEqual({
      path: 'src/x.ts',
      content_len: 1843,
    });
  });

  it('reduces a PR body and note text to length attributes', () => {
    expect(summarizeToolArgs({ title: 'Add rung', body: 'long body text' })).toEqual({
      title: 'Add rung',
      body_len: 'long body text'.length,
    });
    expect(summarizeToolArgs({ text: 'a scratchpad note' })).toEqual({
      text_len: 'a scratchpad note'.length,
    });
  });

  it('captures run_script target and run_command command, reducing the script body', () => {
    expect(summarizeToolArgs({ command: 'test', target: 'src/tax' })).toEqual({
      command: 'test',
      target: 'src/tax',
    });
    expect(summarizeToolArgs({ script: 'echo hi' })).toEqual({ script_len: 'echo hi'.length });
  });

  it('bounds an over-long string value', () => {
    const longPath = 'a/'.repeat(300);
    const result = summarizeToolArgs({ path: longPath });
    expect(typeof result?.path).toBe('string');
    expect((result!.path as string).length).toBeLessThanOrEqual(201);
    expect((result!.path as string).endsWith('…')).toBe(true);
  });

  it('drops unknown args and returns undefined when nothing is salient', () => {
    expect(summarizeToolArgs({ someUnknownFlag: true, another: 42 })).toBeUndefined();
    expect(summarizeToolArgs({})).toBeUndefined();
  });

  it('drops empty-string salient values', () => {
    expect(summarizeToolArgs({ path: '' })).toBeUndefined();
  });
});
