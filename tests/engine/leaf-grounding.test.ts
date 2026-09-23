import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkVocabularyBlock,
  checkVocabularyFrom,
  greenfieldScopeBlock,
  groundScope,
} from '../../src/engine/leaf-grounding.js';

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'leaf-grounding-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), 'export {};\n');
  mkdirSync(join(root, 'empty'));
  mkdirSync(join(root, 'kept'));
  writeFileSync(join(root, 'kept', '.gitkeep'), '');
  return root;
}

describe('groundScope', () => {
  it('is greenfield when every scope entry is absent', () => {
    expect(groundScope(repo(), ['examples/word-count/', 'examples/word-count/wc.mjs'])).toEqual({
      kind: 'greenfield',
      absent: ['examples/word-count/', 'examples/word-count/wc.mjs'],
    });
  });

  it('treats an empty or placeholder-only directory as not yet built', () => {
    expect(groundScope(repo(), ['empty', 'kept/']).kind).toBe('greenfield');
  });

  it('is grounded when any scope entry has content', () => {
    expect(groundScope(repo(), ['examples/new/', 'src/'])).toEqual({ kind: 'grounded' });
    expect(groundScope(repo(), ['src/index.ts'])).toEqual({ kind: 'grounded' });
  });

  it('is grounded when nothing can be observed', () => {
    expect(groundScope(undefined, ['examples/new/'])).toEqual({ kind: 'grounded' });
    expect(groundScope(repo(), [])).toEqual({ kind: 'grounded' });
  });

  it('never classifies a scope that escapes the sandbox root', () => {
    expect(groundScope(repo(), ['../elsewhere'])).toEqual({ kind: 'grounded' });
  });
});

describe('check vocabulary', () => {
  it('derives script and capture names from the check context', () => {
    expect(
      checkVocabularyFrom({
        declaredScriptNames: ['test', 'typecheck'],
        declaredCaptures: {
          home: { kind: 'drive-endpoint', startScript: 'serve', port: 3000, method: 'GET', path: '/', outputPath: 'out/home.html' },
        },
      }),
    ).toEqual({ scriptNames: ['test', 'typecheck'], captureNames: ['home'] });
    expect(checkVocabularyFrom({})).toEqual({ scriptNames: [], captureNames: [] });
    expect(checkVocabularyFrom(undefined)).toBeUndefined();
  });

  it('names the declared set, or forbids a shape when nothing is declared', () => {
    const declared = checkVocabularyBlock({ scriptNames: ['test'], captureNames: [] });
    expect(declared).toContain('ONLY these declared scripts: test');
    expect(declared).toContain('do NOT emit any { capture } check');
    expect(checkVocabularyBlock({ scriptNames: [], captureNames: [] })).toContain(
      'do NOT emit any { script } check',
    );
    expect(checkVocabularyBlock(undefined)).toBe('');
  });
});

describe('greenfieldScopeBlock', () => {
  it('re-grounds a greenfield leaf in its spec and is silent otherwise', () => {
    const block = greenfieldScopeBlock({ kind: 'greenfield', absent: ['examples/wc/'] });
    expect(block).toContain('examples/wc/');
    expect(block).toContain('SPEC above is your only ground truth');
    expect(greenfieldScopeBlock({ kind: 'grounded' })).toBe('');
  });
});
