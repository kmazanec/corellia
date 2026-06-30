import { describe, it, expect } from 'vitest';
import { summarizeJudgeSubject, JUDGE_SUBJECT_BYTE_BUDGET } from '../../src/brains/judge-subject-summary.js';
import type { Artifact } from '../../src/contract/report.js';

describe('summarizeJudgeSubject', () => {
  it('renders a small files artifact in full (unchanged from inlining every file)', () => {
    const subject: Artifact = {
      kind: 'files',
      files: [
        { path: 'a.ts', content: 'export const a = 1;' },
        { path: 'b.ts', content: 'export const b = 2;' },
      ],
    };
    const out = summarizeJudgeSubject(subject);
    expect(out).toContain('File: a.ts');
    expect(out).toContain('export const a = 1;');
    expect(out).toContain('File: b.ts');
    expect(out).toContain('export const b = 2;');
    expect(out).not.toContain('elided');
  });

  it('lists EVERY file path even when content is elided past the budget', () => {
    const big = 'x'.repeat(50_000);
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.ts`, content: big }));
    const out = summarizeJudgeSubject({ kind: 'files', files }, 100_000);
    for (let i = 0; i < 20; i++) {
      expect(out).toContain(`File: f${i}.ts`);
    }
    expect(out).toContain('elided');
  });

  it('keeps the whole summary within a bounded multiple of the budget', () => {
    const big = 'y'.repeat(50_000);
    const files = Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.ts`, content: big }));
    const budget = 100_000;
    const out = summarizeJudgeSubject({ kind: 'files', files }, budget);
    // Full inlining would be ~2 MB; the bound keeps it far smaller — generous
    // ceiling accounts for the per-file head excerpts and path lines.
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThan(budget + 40 * 5_000);
  });

  it('truncates an oversized text artifact with an elision marker', () => {
    const text = 'z'.repeat(JUDGE_SUBJECT_BYTE_BUDGET + 10_000);
    const out = summarizeJudgeSubject({ kind: 'text', text });
    expect(out).toContain('truncated to fit');
    expect(out).toContain('elided');
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThan(JUDGE_SUBJECT_BYTE_BUDGET);
  });

  it('renders a small text artifact in full', () => {
    const out = summarizeJudgeSubject({ kind: 'text', text: 'hello world' });
    expect(out).toBe('Text body:\nhello world');
  });

  it('handles empty artifacts without throwing', () => {
    expect(summarizeJudgeSubject({ kind: 'text', text: '' })).toContain('(empty)');
    expect(summarizeJudgeSubject({ kind: 'files', files: [] })).toContain('(empty files artifact)');
  });
});
