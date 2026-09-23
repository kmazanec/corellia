/**
 * Per-tree sandbox resolution: a root goal's commission-declared scripts and
 * captures layer over the engine's default sandbox for that tree only.
 */

import { describe, it, expect } from 'vitest';
import { treeSandboxFor } from '../../src/engine/tree-sandbox.js';
import type { SandboxConfig } from '../../src/engine/assembly.js';
import type { Goal } from '../../src/contract/goal.js';
import type { CaptureDef } from '../../src/contract/capture.js';

const base: SandboxConfig = { repoRoot: '/repo', declaredScripts: { test: 'npm-script:test' } };

function root(extra: Partial<Goal> = {}): Goal {
  return {
    id: 'root-1',
    type: 'deliver-intent',
    parentId: null,
    title: 't',
    spec: {},
    intent: 'production',
    scope: ['out/x/'],
    budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 },
    memories: [],
    ...extra,
  };
}

const endpoint = (startScript: string): CaptureDef => ({
  kind: 'drive-endpoint',
  startScript,
  port: 4173,
  method: 'GET',
  path: '/',
  outputPath: 'out/x/home.json',
});

describe('treeSandboxFor', () => {
  it('returns the engine sandbox untouched when the goal declares nothing', () => {
    expect(treeSandboxFor(base, root())).toBe(base);
  });

  it('layers commission scripts over the defaults, commission winning a shared name', () => {
    const sandbox = treeSandboxFor(
      base,
      root({ declaredScripts: { smoke: 'checks/smoke.mjs', test: 'npm-script:test:unit' } }),
    );
    expect(sandbox.declaredScripts).toEqual({ test: 'npm-script:test:unit', smoke: 'checks/smoke.mjs' });
    expect(base.declaredScripts).toEqual({ test: 'npm-script:test' });
  });

  it('carries commission captures whose start script is a default or commission script', () => {
    const sandbox = treeSandboxFor(
      base,
      root({ declaredScripts: { serve: 'npm-script:serve' }, declaredCaptures: { a: endpoint('serve'), b: endpoint('test') } }),
    );
    expect(Object.keys(sandbox.declaredCaptures ?? {})).toEqual(['a', 'b']);
  });

  it('refuses a capture that names an undeclared script', () => {
    expect(() => treeSandboxFor(base, root({ declaredCaptures: { a: endpoint('serve') } }))).toThrow(
      /root-1.*undeclared script "serve"/,
    );
  });
});
