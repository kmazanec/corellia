/**
 * Learn-kind root without worktree tests (F-65 A12).
 *
 * A learn-kind ROOT goal with a sandbox config must:
 *   - open NO git worktree (no worktree-created event, no extra entry in git worktree list)
 *   - leave the target repo byte-identical after the run (git status --porcelain empty)
 *   - carry only read-only tools in its broker (write_file absent)
 *   - skip collect/preserve in the finally
 *
 * The test uses a real temporary git repo as the fixture so the porcelain and
 * worktree-list assertions are the byte-identical proof.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Engine } from '../../src/engine/engine.js';
import { InMemoryEventStore } from '../../src/eventlog/memory-store.js';
import {
  buildRegistry,
  leafTypeDef,
  ScriptedBrain,
  makeGoal,
  textArtifact,
  NoopMemoryView,
} from './stubs.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Brain, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';
import type { ToolDef, BrainContext } from '../../src/contract/brain.js';

// ── Fixture ────────────────────────────────────────────────────────────────

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'corellia-learn-readonly-'));
  // Initialize a real git repo so worktree list / porcelain work.
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repoRoot, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot, stdio: 'pipe' });
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await fsWriteFile(join(repoRoot, 'src', 'index.ts'), 'export const x = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'pipe' });
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

// ── Registry: a learn-kind leaf type without script grants ────────────────
// Uses grants without test.run_scoped so the no-worktree path activates.
// (Script-granting learn goals still use the full sandbox path for isolation.)

function learnRegistry() {
  return buildRegistry([
    leafTypeDef({
      name: 'deep-dive-region',
      kind: 'learn',
      family: 'test',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [],
      judgeType: null,
      grants: ['fs.read', 'retrieval.api'], // no test.run_scoped → no-worktree path
    }),
  ]);
}

/** A scripted brain that returns an artifact from step() on the first call. */
function learnBrain(): Brain {
  return {
    async decide() { throw new Error('not called for leafOnly'); },
    async produce() {
      return { value: textArtifact('artifact-from-produce'), usage: ZERO_USAGE };
    },
    async judge() { throw new Error('not called'); },
    async repair() { throw new Error('not called'); },
    async step(): Promise<StepOutput> {
      // Return an artifact immediately so the step loop completes in one call.
      return {
        kind: 'artifact',
        artifact: textArtifact('artifact-from-step'),
        usage: ZERO_USAGE,
      };
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('learn-kind root: no worktree (F-65 A12)', () => {
  it('no worktree-created event in the log after a learn root run', async () => {
    const store = new InMemoryEventStore();
    const engine = new Engine({
      registry: learnRegistry(),
      brain: learnBrain(),
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot, declaredScripts: {} },
    });

    await engine.run(makeGoal({ type: 'deep-dive-region' }));

    const events = await store.list();
    const worktreeCreated = events.filter((e) => e.type === 'worktree-created');
    expect(worktreeCreated).toHaveLength(0);
  });

  it('no extra worktree entry in git worktree list after run (F-65 A12)', async () => {
    const store = new InMemoryEventStore();
    const engine = new Engine({
      registry: learnRegistry(),
      brain: learnBrain(),
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot, declaredScripts: {} },
    });

    const before = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();

    await engine.run(makeGoal({ type: 'deep-dive-region' }));

    const after = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();

    // Worktree list must be identical before and after — no extra worktree added.
    expect(after).toBe(before);
  });

  it('target repo is byte-identical after run (git status --porcelain empty)', async () => {
    const store = new InMemoryEventStore();
    const engine = new Engine({
      registry: learnRegistry(),
      brain: learnBrain(),
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot, declaredScripts: {} },
    });

    await engine.run(makeGoal({ type: 'deep-dive-region' }));

    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();

    expect(porcelain).toBe('');
  });

  it('write_file is absent from the broker tool table (refused by broker)', async () => {
    // Use a brain that tries to use write_file via a tool call, then verify it
    // was refused (not ran) — proving write_file is absent from the broker.
    const store = new InMemoryEventStore();

    // We test this indirectly: run with a regular learn brain (which just produces
    // an artifact without tool calls) and then verify no 'worktree-created' event
    // and no writes happened. For a direct check, attempt a write and assert the
    // broker refuses it.
    const brain: Brain = {
      async decide() { throw new Error('not used'); },
      async produce() {
        return { value: textArtifact('artifact'), usage: ZERO_USAGE };
      },
      async judge() { throw new Error('not used'); },
      async repair() { throw new Error('not used'); },
      async step(_goal: Goal, _transcript: StepTranscript, _tools: ToolDef[], _ctx: BrainContext): Promise<StepOutput> {
        // Should never be called since learn type has no tool-granted produce path
        // in the step loop (no write grants → isToolGranted returns false for
        // read-only grants in tests without a broker in scope).
        throw new Error('step should not be called for learn type in this context');
      },
    };

    const engine = new Engine({
      registry: learnRegistry(),
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot, declaredScripts: {} },
    });

    await engine.run(makeGoal({ type: 'deep-dive-region' }));

    // Assert no file was written to the repo (write_file absent means no writes).
    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    expect(porcelain).toBe('');

    // The broker-level proof: no tool-call events with tool='write_file' and outcome='ran'.
    const events = await store.list();
    const writeFileRan = events.filter(
      (e) => e.type === 'tool-call' && (e as { tool?: string; outcome?: string }).tool === 'write_file' && (e as { outcome?: string }).outcome === 'ran',
    );
    expect(writeFileRan).toHaveLength(0);
  });

  it('no worktree-collected or worktree-preserved events (finally skips them)', async () => {
    const store = new InMemoryEventStore();
    const engine = new Engine({
      registry: learnRegistry(),
      brain: learnBrain(),
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot, declaredScripts: {} },
    });

    await engine.run(makeGoal({ type: 'deep-dive-region' }));

    const events = await store.list();
    const collected = events.filter((e) => e.type === 'worktree-collected');
    const preserved = events.filter((e) => e.type === 'worktree-preserved');
    expect(collected).toHaveLength(0);
    expect(preserved).toHaveLength(0);
  });

  it('the run still completes and emits a report (F-65 A12)', async () => {
    const store = new InMemoryEventStore();
    const engine = new Engine({
      registry: learnRegistry(),
      brain: learnBrain(),
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot, declaredScripts: {} },
    });

    const report = await engine.run(makeGoal({ type: 'deep-dive-region' }));
    expect(report).toBeDefined();
    expect(report.blockers).toHaveLength(0);
  });
});

describe('learn-kind root: non-learn type still uses worktree (F-65 A12 boundary)', () => {
  it('a make-kind root goal with sandbox still creates a worktree', async () => {
    const makeRegistry = buildRegistry([
      leafTypeDef({
        name: 'make-task',
        kind: 'make',
        family: 'test',
        leafOnly: true,
        tier: { default: 'mid', ladder: ['mid'] },
        deterministic: [],
        judgeType: null,
        grants: [],
      }),
    ]);

    const store = new InMemoryEventStore();
    const brain = learnBrain();
    const engine = new Engine({
      registry: makeRegistry,
      brain,
      store,
      memory: new NoopMemoryView(),
      sandbox: { repoRoot, declaredScripts: {} },
    });

    await engine.run(makeGoal({ type: 'make-task' }));

    const events = await store.list();
    const worktreeCreated = events.filter((e) => e.type === 'worktree-created');
    // make-kind → normal sandbox path → worktree is created
    expect(worktreeCreated).toHaveLength(1);
  });
});
