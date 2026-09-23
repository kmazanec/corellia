/**
 * Shape validation for declared-scripts maps that arrive from outside the
 * factory (a commission body, the daemon's CORELLIA_DECLARED_SCRIPTS).
 */

import { describe, it, expect } from 'vitest';
import { declaredScriptsProblem, parseDeclaredScripts } from '../../src/library/declared-scripts.js';

describe('declaredScriptsProblem', () => {
  it('accepts the three runner forms', () => {
    expect(
      declaredScriptsProblem({
        test: 'npm-script:test',
        build: 'make:build',
        smoke: 'checks/word-count-smoke.mjs',
      }),
    ).toBeNull();
  });

  it('rejects a non-object map', () => {
    expect(declaredScriptsProblem(['test'])).toMatch(/object/);
    expect(declaredScriptsProblem(null)).toMatch(/object/);
  });

  it('rejects a name that is not a plain identifier', () => {
    expect(declaredScriptsProblem({ 'a b': 'x.mjs' })).toMatch(/plain identifier/);
  });

  it('rejects a non-string entry point', () => {
    expect(declaredScriptsProblem({ test: 3 })).toMatch(/must be a string/);
  });

  it('rejects out-of-bounds, absolute, and shell-bearing file entries', () => {
    expect(declaredScriptsProblem({ s: '../escape.mjs' })).toMatch(/in-bounds/);
    expect(declaredScriptsProblem({ s: '/etc/passwd' })).toMatch(/in-bounds/);
    expect(declaredScriptsProblem({ s: 'x.mjs; rm -rf /' })).toMatch(/in-bounds/);
  });

  it('rejects runner forms whose target carries shell text', () => {
    expect(declaredScriptsProblem({ t: 'npm-script:test && curl x' })).toMatch(/npm-script target/);
    expect(declaredScriptsProblem({ t: 'make:' })).toMatch(/make target/);
  });
});

describe('parseDeclaredScripts', () => {
  it('reads an absent or blank value as no scripts', () => {
    expect(parseDeclaredScripts(undefined, 'ENV')).toEqual({});
    expect(parseDeclaredScripts('  ', 'ENV')).toEqual({});
  });

  it('parses a valid JSON map', () => {
    expect(parseDeclaredScripts('{"test":"npm-script:test"}', 'ENV')).toEqual({ test: 'npm-script:test' });
  });

  it('throws naming the source on malformed JSON or an invalid entry', () => {
    expect(() => parseDeclaredScripts('{nope', 'ENV')).toThrow(/ENV is not valid JSON/);
    expect(() => parseDeclaredScripts('{"t":"../x.mjs"}', 'ENV')).toThrow(/ENV: .*in-bounds/);
  });
});
