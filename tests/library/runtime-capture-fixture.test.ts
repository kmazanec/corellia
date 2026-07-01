import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScriptRunner } from '../../src/library/script-runner.js';
import { createCaptureRunner } from '../../src/library/capture-runner.js';
import { captureSucceeded } from '../../src/library/checks.js';
import type { DeclaredCaptures } from '../../src/contract/capture.js';
import type { Goal } from '../../src/contract/goal.js';

// The done-condition proof for ADR-042: the SAME { capture } criterion passes on a
// correctly-placed value and fails on a deliberately transposed one — the kind of
// error no unit test catches — with no human eyeball. Drives the real capture
// runner + the deterministic floor (captureSucceeded) end to end.

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'runtime-capture');

const goal = { id: 'g', scope: ['fixtures/'] } as unknown as Goal;

function makeWorktree(invoiceKind: 'correct' | 'defect'): string {
  const root = mkdtempSync(join(tmpdir(), 'runtime-capture-'));
  mkdirSync(join(root, 'fixtures', 'runtime-capture'), { recursive: true });
  // Copy the render script and the chosen invoice into the worktree.
  copyFileSync(join(fixtureDir, 'render-invoice.mjs'), join(root, 'fixtures', 'runtime-capture', 'render-invoice.mjs'));
  copyFileSync(
    join(fixtureDir, `invoice.${invoiceKind}.json`),
    join(root, 'fixtures', 'runtime-capture', 'invoice.json'),
  );
  return root;
}

function buildRunCapture(root: string) {
  // The render script reads INVOICE_PATH/OUTPUT_PATH from the env — the fixture's
  // stand-in for a real renderer's declared inputs. The declared-script runner
  // gets an env carrying those paths (worktree-relative resolved to absolute).
  const env = {
    ...process.env,
    INVOICE_PATH: join(root, 'fixtures', 'runtime-capture', 'invoice.json'),
    OUTPUT_PATH: join(root, 'fixtures', 'runtime-capture', 'rendered.txt'),
  };
  const scriptRunner = createScriptRunner(
    root,
    { 'render-invoice': 'fixtures/runtime-capture/render-invoice.mjs' },
    env,
  );
  const declaredCaptures: DeclaredCaptures = {
    'invoice-total': {
      kind: 'render-document',
      file: 'fixtures/runtime-capture/invoice.json',
      renderScript: 'render-invoice',
      outputPath: 'fixtures/runtime-capture/rendered.txt',
      timeoutMs: 10_000,
    },
  };
  return {
    runCapture: createCaptureRunner(root, declaredCaptures, scriptRunner),
    declaredCaptures,
  };
}

describe('runtime-capture done-condition fixture (ADR-042)', () => {
  it('the { capture } criterion PASSES when the value is in the correct place', async () => {
    const root = makeWorktree('correct');
    try {
      const { runCapture } = buildRunCapture(root);
      const check = captureSucceeded('invoice-total');
      const result = await check.run(goal, null, { sandboxRoot: root, runCapture });
      expect(result.ok).toBe(true);
      expect(existsSync(join(root, 'fixtures', 'runtime-capture', 'rendered.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the SAME criterion FAILS on a deliberately transposed value (defect caught automatically)', async () => {
    const root = makeWorktree('defect');
    try {
      const { runCapture } = buildRunCapture(root);
      const check = captureSucceeded('invoice-total');
      const result = await check.run(goal, null, { sandboxRoot: root, runCapture });
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('did not produce output');
      // The defect produced no rendered document — the floor caught it.
      expect(existsSync(join(root, 'fixtures', 'runtime-capture', 'rendered.txt'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
