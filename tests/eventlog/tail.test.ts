/**
 * The JSONL tail: offset-tracked incremental reads with partial-line carry.
 *
 * These tests drive readAppendedLines (the pure, offset-advancing read)
 * deterministically — no fs.watch timing — and one end-to-end follow() test on
 * the polling path to prove appends after the follow starts are delivered.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppendedLines, follow } from '../../src/eventlog/tail.js';

const dirs: string[] = [];
function tempFile(name = 'events.jsonl'): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-tail-'));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const evt = (goalId: string) => ({ type: 'goal-received', at: 1, goalId, goal: { title: goalId } });

describe('readAppendedLines', () => {
  it('reads complete lines and advances the offset past them', async () => {
    const path = tempFile();
    await writeFile(path, JSON.stringify(evt('g1')) + '\n' + JSON.stringify(evt('g2')) + '\n');

    const first = await readAppendedLines(path, 0, '');
    expect(first.values).toHaveLength(2);
    expect((first.values[0] as { goalId: string }).goalId).toBe('g1');
    expect(first.carry).toBe('');

    // A second read from the advanced offset sees nothing new.
    const second = await readAppendedLines(path, first.offset, first.carry);
    expect(second.values).toHaveLength(0);
    expect(second.offset).toBe(first.offset);
  });

  it('holds a trailing partial line and reassembles it on the next read', async () => {
    const path = tempFile();
    const line = JSON.stringify(evt('g1'));
    // Write the line WITHOUT its trailing newline — a half-written append.
    const half = line.slice(0, 10);
    await writeFile(path, half);

    const first = await readAppendedLines(path, 0, '');
    expect(first.values).toHaveLength(0); // No complete line yet.
    expect(first.carry).toBe(half);

    // Append the rest plus the newline; the carry completes the line.
    await appendFile(path, line.slice(10) + '\n');
    const second = await readAppendedLines(path, first.offset, first.carry);
    expect(second.values).toHaveLength(1);
    expect((second.values[0] as { goalId: string }).goalId).toBe('g1');
    expect(second.carry).toBe('');
  });

  it('skips a corrupt line without stalling', async () => {
    const path = tempFile();
    await writeFile(path, 'not json\n' + JSON.stringify(evt('g2')) + '\n');
    const { values } = await readAppendedLines(path, 0, '');
    expect(values).toHaveLength(1);
    expect((values[0] as { goalId: string }).goalId).toBe('g2');
  });

  it('resets to offset 0 when the file shrinks (rotation/truncation)', async () => {
    const path = tempFile();
    await writeFile(path, JSON.stringify(evt('g1')) + '\n' + JSON.stringify(evt('g2')) + '\n');
    const first = await readAppendedLines(path, 0, '');
    const staleOffset = first.offset;

    await truncate(path, 0);
    await writeFile(path, JSON.stringify(evt('g3')) + '\n');

    const afterRotate = await readAppendedLines(path, staleOffset, '');
    expect(afterRotate.values).toHaveLength(1);
    expect((afterRotate.values[0] as { goalId: string }).goalId).toBe('g3');
  });
});

describe('follow', () => {
  it('delivers lines appended after the follow starts (polling path)', async () => {
    const path = tempFile();
    await writeFile(path, JSON.stringify(evt('pre')) + '\n');

    const seen: string[] = [];
    const tail = follow(
      path,
      (v) => seen.push((v as { goalId: string }).goalId),
      { from: 'end', pollMs: 10 },
    );

    // Give init() a tick to set the offset to end, then append.
    await delay(30);
    await appendFile(path, JSON.stringify(evt('post')) + '\n');
    await waitFor(() => seen.includes('post'));

    tail.stop();
    await tail.done;

    expect(seen).toContain('post');
    expect(seen).not.toContain('pre'); // from: 'end' skips existing content.
  });

  it('replays existing content first with from: start', async () => {
    const path = tempFile();
    await writeFile(path, JSON.stringify(evt('a')) + '\n' + JSON.stringify(evt('b')) + '\n');

    const seen: string[] = [];
    const tail = follow(path, (v) => seen.push((v as { goalId: string }).goalId), {
      from: 'start',
      pollMs: 10,
    });

    await waitFor(() => seen.length >= 2);
    tail.stop();
    await tail.done;

    expect(seen).toEqual(['a', 'b']);
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
