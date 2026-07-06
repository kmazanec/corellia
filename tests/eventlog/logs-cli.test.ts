/**
 * The `corellia logs` command: arg parsing, path resolution honoring
 * CORELLIA_EVENTS_PATH, replay output, the DATABASE_URL-follow refusal, and a
 * live follow that streams an appended event. Env and console are injected so
 * the test is hermetic (a developer's real .env cannot leak in).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseLogsArgs,
  resolveEventsPath,
  runLogs,
  type LogsConsole,
} from '../../src/eventlog/logs-cli.js';

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-logs-'));
  dirs.push(dir);
  return join(dir, 'events.jsonl');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function capture(): LogsConsole & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (l) => out.push(l), error: (l) => err.push(l) };
}

const received = (goalId: string, title: string) =>
  JSON.stringify({
    type: 'goal-received',
    at: 1,
    goalId,
    goal: { id: goalId, type: 'write-code', parentId: null, title, spec: 's', intent: 'production', scope: [], budget: { attempts: 1, tokens: 1, toolCalls: 1, wallClockMs: 1 }, memories: [] },
  });

describe('parseLogsArgs', () => {
  it('parses flags, filters, and the positional path', () => {
    const args = parseLogsArgs(['run.jsonl', '--follow', '--tree', '--cost', '--goal', 'auth', '--type', 'tool-call']);
    expect(args).toEqual({ path: 'run.jsonl', follow: true, tree: true, cost: true, goal: 'auth', type: 'tool-call' });
  });

  it('accepts the -f short form and defaults the rest', () => {
    const args = parseLogsArgs(['-f']);
    expect(args.follow).toBe(true);
    expect(args.path).toBeUndefined();
    expect(args.cost).toBe(false);
  });
});

describe('resolveEventsPath', () => {
  it('prefers an explicit path over the env', () => {
    expect(resolveEventsPath('x.jsonl', { CORELLIA_EVENTS_PATH: 'env.jsonl' })).toBe('x.jsonl');
  });
  it('honors CORELLIA_EVENTS_PATH when no explicit path', () => {
    expect(resolveEventsPath(undefined, { CORELLIA_EVENTS_PATH: 'env.jsonl' })).toBe('env.jsonl');
  });
});

describe('runLogs replay', () => {
  it('renders the goal tree and per-goal detail for a finished log', async () => {
    const path = tempFile();
    await writeFile(path, received('g1', 'root goal') + '\n');
    const io = capture();

    const { code } = await runLogs(parseLogsArgs([path]), io, {});
    expect(code).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('goal tree');
    expect(text).toContain('root goal');
    expect(text).toContain('1 events');
  });

  it('reports a clear error and exit 1 for a missing log', async () => {
    const io = capture();
    const { code } = await runLogs(parseLogsArgs(['/no/such/log.jsonl']), io, {});
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('cannot read');
  });
});

describe('runLogs follow', () => {
  it('refuses --follow when DATABASE_URL is set', async () => {
    const io = capture();
    const { code, stop } = await runLogs(parseLogsArgs(['-f']), io, { DATABASE_URL: 'postgres://x' });
    expect(code).toBe(2);
    expect(stop).toBeUndefined();
    expect(io.err.join('\n')).toContain('requires the JSONL store');
  });

  it('streams an event appended after follow starts', async () => {
    const path = tempFile();
    await writeFile(path, received('pre', 'existing') + '\n');
    const io = capture();

    const { code, stop } = await runLogs(parseLogsArgs([path, '-f']), io, {});
    expect(code).toBe(0);
    expect(stop).toBeDefined();

    // from: 'start' replays existing content, so the first goal shows first.
    await waitFor(() => io.out.some((l) => l.includes('existing')));

    await appendFile(path, received('post', 'new goal') + '\n');
    await waitFor(() => io.out.some((l) => l.includes('new goal')));

    stop!();
    expect(io.out.some((l) => l.includes('post') && l.includes('new goal'))).toBe(true);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await delay(10);
  }
}
