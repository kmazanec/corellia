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
import { buildStore, defaultEventsPath } from '../../src/daemon/config.js';
import { JsonlEventStore } from '../../src/eventlog/jsonl-store.js';

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
