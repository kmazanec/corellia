/**
 * Tests for the per-target-repo default event-log path (issue D3).
 *
 * When CORELLIA_EVENTS_PATH is unset, buildStore()/defaultEventsPath() namespace
 * the JSONL log by the target repo's sanitized basename so concurrent runs
 * against different target repos do not clobber each other. An explicit env
 * always wins; when no target repo is discernible, the flat legacy default
 * (<cwd>/out/events.jsonl) is kept.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStore, buildPatternStore, defaultEventsPath } from '../../src/daemon/config.js';
import { JsonlEventStore } from '../../src/eventlog/jsonl-store.js';
import { runTrust, runPatternsList } from '../../src/eventlog/patterns-cli.js';
import type { Decision } from '../../src/contract/decision.js';
import type { LogsConsole } from '../../src/eventlog/logs-cli.js';

const SAVED = {
  events: process.env['CORELLIA_EVENTS_PATH'],
  repoRoot: process.env['CORELLIA_REPO_ROOT'],
  dbUrl: process.env['DATABASE_URL'],
};

function clearEnv(): void {
  delete process.env['CORELLIA_EVENTS_PATH'];
  delete process.env['CORELLIA_REPO_ROOT'];
  delete process.env['DATABASE_URL'];
}

describe('defaultEventsPath — per-target-repo namespacing', () => {
  beforeEach(clearEnv);
  afterEach(() => {
    clearEnv();
    if (SAVED.events !== undefined) process.env['CORELLIA_EVENTS_PATH'] = SAVED.events;
    if (SAVED.repoRoot !== undefined) process.env['CORELLIA_REPO_ROOT'] = SAVED.repoRoot;
    if (SAVED.dbUrl !== undefined) process.env['DATABASE_URL'] = SAVED.dbUrl;
  });

  it('namespaces by the target repo basename when a repo root is passed', () => {
    expect(defaultEventsPath('/home/user/dev/My-Repo')).toBe(
      join(process.cwd(), 'out', 'my-repo', 'events.jsonl'),
    );
  });

  it('collapses non-alphanumeric runs and trailing slashes in the basename', () => {
    expect(defaultEventsPath('/srv/repos/tiutni_1040.ez/')).toBe(
      join(process.cwd(), 'out', 'tiutni-1040-ez', 'events.jsonl'),
    );
  });

  it('two different target repos map to distinct paths', () => {
    const a = defaultEventsPath('/a/openemr');
    const b = defaultEventsPath('/b/rooftrace');
    expect(a).not.toBe(b);
    expect(a).toContain(join('out', 'openemr'));
    expect(b).toContain(join('out', 'rooftrace'));
  });

  it('falls back to CORELLIA_REPO_ROOT when no explicit target repo is given', () => {
    process.env['CORELLIA_REPO_ROOT'] = '/work/foreign-repo';
    expect(defaultEventsPath()).toBe(join(process.cwd(), 'out', 'foreign-repo', 'events.jsonl'));
  });

  it('keeps the flat legacy default when no target repo is discernible', () => {
    expect(defaultEventsPath()).toBe(join(process.cwd(), 'out', 'events.jsonl'));
  });
});

describe('buildStore — CORELLIA_EVENTS_PATH precedence', () => {
  let tmp: string;

  beforeEach(() => {
    clearEnv();
    tmp = mkdtempSync(join(tmpdir(), 'corellia-config-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    clearEnv();
    if (SAVED.events !== undefined) process.env['CORELLIA_EVENTS_PATH'] = SAVED.events;
    if (SAVED.repoRoot !== undefined) process.env['CORELLIA_REPO_ROOT'] = SAVED.repoRoot;
    if (SAVED.dbUrl !== undefined) process.env['DATABASE_URL'] = SAVED.dbUrl;
  });

  it('explicit CORELLIA_EVENTS_PATH wins over the per-repo default and is where events land', async () => {
    const pinned = join(tmp, 'pinned', 'events.jsonl');
    process.env['CORELLIA_EVENTS_PATH'] = pinned;
    const { store } = buildStore({ targetRepoRoot: '/a/some-repo' });
    await store.append({ type: 'tick', at: 1 } as never);
    expect(existsSync(pinned)).toBe(true);
  });

  it('returns a JSONL store (not pg) when DATABASE_URL is unset', () => {
    const { store } = buildStore({ targetRepoRoot: '/a/some-repo' });
    expect(store).toBeInstanceOf(JsonlEventStore);
  });
});

describe('buildPatternStore — the flywheel wired to the daemon substrate', () => {
  let tmp: string;
  const split: Extract<Decision, { kind: 'split' }> = { kind: 'split', children: [] };

  beforeEach(() => {
    clearEnv();
    tmp = mkdtempSync(join(tmpdir(), 'corellia-patterns-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    clearEnv();
    if (SAVED.events !== undefined) process.env['CORELLIA_EVENTS_PATH'] = SAVED.events;
    if (SAVED.repoRoot !== undefined) process.env['CORELLIA_REPO_ROOT'] = SAVED.repoRoot;
    if (SAVED.dbUrl !== undefined) process.env['DATABASE_URL'] = SAVED.dbUrl;
  });

  function silentIo(): LogsConsole {
    return { log: () => {}, error: () => {} };
  }

  it('rehydrates memos from the JSONL event log so a fresh process sees prior splits', async () => {
    process.env['CORELLIA_EVENTS_PATH'] = join(tmp, 'events.jsonl');

    // A run recorded a split for shape-a via the two events the engine emits.
    const first = buildStore();
    await first.store.append({ type: 'decided', at: 1, goalId: 'g1', decision: split });
    await first.store.append({ type: 'pattern-recorded', at: 2, goalId: 'g1', shape: 'shape-a', outcome: 'success' });

    // A fresh process (new store handle) rehydrates the memo from that same log.
    const fresh = buildStore();
    const { patterns } = await buildPatternStore(fresh.store);
    const memo = await patterns.match('shape-a');
    expect(memo?.uses).toBe(1);
    expect(memo?.status).toBe('provisional');
    expect(memo?.decision).toEqual(split);
  });

  it('operator flow: CLI trust appends to the log, and a restarted daemon reads it as trusted', async () => {
    process.env['CORELLIA_EVENTS_PATH'] = join(tmp, 'events.jsonl');

    // 1. A run records the split.
    const run = buildStore();
    await run.store.append({ type: 'decided', at: 1, goalId: 'g1', decision: split });
    await run.store.append({ type: 'pattern-recorded', at: 2, goalId: 'g1', shape: 'shape-a', outcome: 'success' });

    // 2. The operator opens the store like the CLI does, and trusts the memo.
    const cli = buildStore();
    const cliPatterns = await buildPatternStore(cli.store);
    const code = await runTrust(
      'trusted',
      { shape: 'shape-a', by: 'keith', rationale: 'proved out' },
      cliPatterns.patterns,
      cli.store,
      silentIo(),
    );
    expect(code).toBe(0);

    // 3. A restarted daemon rehydrates from the shared log and sees trusted.
    const restarted = buildStore();
    const daemonPatterns = await buildPatternStore(restarted.store);
    expect((await daemonPatterns.patterns.match('shape-a'))?.status).toBe('trusted');
  });

  it('patterns list surfaces the rehydrated memo as a candidate', async () => {
    process.env['CORELLIA_EVENTS_PATH'] = join(tmp, 'events.jsonl');
    const run = buildStore();
    await run.store.append({ type: 'decided', at: 1, goalId: 'g1', decision: split });
    await run.store.append({ type: 'pattern-recorded', at: 2, goalId: 'g1', shape: 'shape-a', outcome: 'success' });

    const fresh = buildStore();
    const { patterns } = await buildPatternStore(fresh.store);
    const out: string[] = [];
    await runPatternsList(patterns, { log: (l) => out.push(l), error: () => {} });
    expect(out.join('\n')).toContain('shape-a');
  });
});
