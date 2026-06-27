import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeCodeShape,
  codeShapeHint,
  renderCodeShapeReport,
} from '../../src/library/code-shape.js';

describe('code-shape analyzer', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function tempRepo(): string {
    const dir = join(tmpdir(), `corellia-code-shape-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    return dir;
  }

  it('reports scoped oversized files', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'src', 'large.ts'), Array.from({ length: 8 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
    writeFileSync(join(root, 'tests', 'ignored.test.ts'), 'x\n'.repeat(20));

    const report = analyzeCodeShape({
      root,
      scope: ['src'],
      fileLineThreshold: 5,
      functionLineThreshold: 50,
    });

    expect(report.filesScanned).toBe(1);
    expect(report.largeFiles).toEqual([{ path: 'src/large.ts', lines: 8 }]);
  });

  it('reports oversized functions and methods with start lines', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src', 'service.ts'),
      [
        'export function compact() {',
        '  return 1;',
        '}',
        '',
        'export function runWorkflow() {',
        '  if (true) {',
        '    return { ok: true };',
        '  }',
        '}',
        '',
        'class Worker {',
        '  async execute() {',
        '    const value = 1;',
        '    if (value) {',
        '      return value;',
        '    }',
        '  }',
        '}',
      ].join('\n'),
    );

    const report = analyzeCodeShape({
      root,
      functionLineThreshold: 4,
      fileLineThreshold: 100,
    });

    expect(report.largeFunctions).toEqual([
      { path: 'src/service.ts', name: 'execute', startLine: 12, lines: 6 },
      { path: 'src/service.ts', name: 'runWorkflow', startLine: 5, lines: 5 },
    ]);
  });

  it('renders an advisory hint with the durable decomposition patterns', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'large.ts'), 'export const x = 1;\n'.repeat(7));

    const hint = codeShapeHint({
      root,
      scope: ['src'],
      fileLineThreshold: 5,
      functionLineThreshold: 50,
    });

    expect(hint).toContain('Code-shape pressure');
    expect(hint).toContain('domain-verb modules');
    expect(hint).toContain('repeated callback wiring with adapters');
  });

  it('renders a clean report when no pressure is found', () => {
    const root = tempRepo();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'small.ts'), 'export const x = 1;\n');

    const report = analyzeCodeShape({
      root,
      fileLineThreshold: 100,
      functionLineThreshold: 50,
    });

    expect(renderCodeShapeReport(report)).toContain('no oversized files or functions found');
  });
});
