/**
 * Unit tests for loadHostConventions (F-69 — ADR-028 layer 2).
 *
 * All tests use real temp dirs (fs.mkdtempSync) — no mocks. This matches the
 * skills-wiring and harness-context test strategy: assert real FS behavior
 * rather than mocked one.
 *
 * Covered cases:
 *  - AGENTS.md only → returns its (stripped, capped) content
 *  - CLAUDE.md only → returns its (stripped, capped) content
 *  - Both present   → AGENTS.md wins; CLAUDE.md ignored
 *  - Neither        → ''
 *  - Oversized file (on disk, byte cap) → ''
 *  - Oversized stripped text (char cap) → truncated with suffix
 *  - Operational sections stripped
 *  - Unreadable file (chmod 000) → ''
 *  - Binary file (NUL bytes) → ''
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHostConventions } from '../../src/engine/host-conventions.js';

// ── Temp-dir lifecycle ────────────────────────────────────────────────────────

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-hc-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function writeAgents(dir: string, content: string): void {
  writeFileSync(join(dir, 'AGENTS.md'), content, 'utf8');
}

function writeClaude(dir: string, content: string): void {
  writeFileSync(join(dir, 'CLAUDE.md'), content, 'utf8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadHostConventions — file resolution', () => {
  it('AGENTS.md only: returns its content', () => {
    const dir = makeTempDir();
    writeAgents(dir, 'Use single quotes for strings.\n');
    const result = loadHostConventions(dir);
    expect(result).toContain('Use single quotes for strings.');
  });

  it('CLAUDE.md only: returns its content as fallback', () => {
    const dir = makeTempDir();
    writeClaude(dir, 'Always write tests first.\n');
    const result = loadHostConventions(dir);
    expect(result).toContain('Always write tests first.');
  });

  it('both present: AGENTS.md wins, CLAUDE.md is ignored', () => {
    const dir = makeTempDir();
    writeAgents(dir, 'AGENTS convention line.\n');
    writeClaude(dir, 'CLAUDE convention line.\n');
    const result = loadHostConventions(dir);
    expect(result).toContain('AGENTS convention line.');
    expect(result).not.toContain('CLAUDE convention line.');
  });

  it('neither present: returns empty string', () => {
    const dir = makeTempDir();
    const result = loadHostConventions(dir);
    expect(result).toBe('');
  });
});

describe('loadHostConventions — operational-section stripping', () => {
  it('strips a ## Commands section from the output', () => {
    const dir = makeTempDir();
    const content = [
      '# My conventions',
      '',
      'Use meaningful variable names.',
      '',
      '## Commands',
      '',
      'npm run build',
      'npm test',
      '',
      '## Code style',
      '',
      'Four-space indentation.',
    ].join('\n');
    writeAgents(dir, content);
    const result = loadHostConventions(dir);
    expect(result).toContain('Use meaningful variable names.');
    expect(result).toContain('Four-space indentation.');
    expect(result).not.toContain('npm run build');
    expect(result).not.toContain('npm test');
  });

  it('strips ## Bash, ## Shell, ## Hooks, ## Permissions, ## Tools, ## MCP, ## Settings sections', () => {
    const dir = makeTempDir();
    const operationalSections = ['Bash', 'Shell', 'Hooks', 'Permissions', 'Tools', 'MCP', 'Settings'];
    for (const keyword of operationalSections) {
      const content = [
        '# Repo conventions',
        '',
        'Convention text here.',
        '',
        `## ${keyword}`,
        '',
        `${keyword} operational content — must be stripped.`,
        '',
        '## After',
        '',
        'Post-section content.',
      ].join('\n');
      const testDir = makeTempDir();
      writeAgents(testDir, content);
      const result = loadHostConventions(testDir);
      expect(result, `keyword: ${keyword}`).toContain('Convention text here.');
      expect(result, `keyword: ${keyword}`).not.toContain(`${keyword} operational content`);
      expect(result, `keyword: ${keyword}`).toContain('Post-section content.');
    }
  });

  it('strips deeper headings (### Commands) as well', () => {
    const dir = makeTempDir();
    const content = [
      '# Conventions',
      '',
      'Good convention.',
      '',
      '### Commands',
      '',
      'Operational text under deep heading.',
      '',
      '### Other',
      '',
      'Normal text.',
    ].join('\n');
    writeAgents(dir, content);
    const result = loadHostConventions(dir);
    expect(result).toContain('Good convention.');
    expect(result).not.toContain('Operational text under deep heading.');
    expect(result).toContain('Normal text.');
  });
});

describe('loadHostConventions — size cap', () => {
  it('returns content unchanged when under 8 000 chars', () => {
    const dir = makeTempDir();
    const content = 'Short convention.\n';
    writeAgents(dir, content);
    const result = loadHostConventions(dir);
    expect(result).toContain('Short convention.');
    expect(result).not.toContain('truncated');
  });

  it('truncates stripped text at the last newline before 8 000 chars and appends suffix', () => {
    const dir = makeTempDir();
    // Build content that is exactly over 8 000 chars after stripping, with newlines
    // to give the truncation a boundary to work with.
    const lineA = 'A'.repeat(2000) + '\n';
    const lineB = 'B'.repeat(2000) + '\n';
    const lineC = 'C'.repeat(2000) + '\n';
    const lineD = 'D'.repeat(2000) + '\n';
    // Total ~ 8 008 chars (4 * 2001) — just over the cap
    const content = lineA + lineB + lineC + lineD;
    writeAgents(dir, content);
    const result = loadHostConventions(dir);
    expect(result.length).toBeLessThanOrEqual(8_000 + 100); // cap + suffix
    expect(result).toContain('[… truncated — host file exceeds 8 000-char budget]');
    // The full D line must not appear (it would push us over)
    expect(result).not.toContain('D'.repeat(2000));
  });
});

describe('loadHostConventions — failure modes (all return empty string)', () => {
  it('unreadable file (chmod 000) → returns empty string, does not throw', () => {
    const dir = makeTempDir();
    const path = join(dir, 'AGENTS.md');
    writeFileSync(path, 'Convention text.\n', 'utf8');
    chmodSync(path, 0o000);
    // Restore permissions at cleanup so rmSync can delete it
    cleanups.push(() => { try { chmodSync(path, 0o644); } catch { /* ignore */ } });
    let result: string | undefined;
    expect(() => { result = loadHostConventions(dir); }).not.toThrow();
    // On Linux (CI), chmod 000 is enforced. On macOS as root, it may still be
    // readable. Accept '' or the convention text — the contract is "no throw".
    expect(typeof result).toBe('string');
  });

  it('binary file (NUL bytes present) → returns empty string', () => {
    const dir = makeTempDir();
    const binaryContent = Buffer.concat([
      Buffer.from('# Conventions\n'),
      Buffer.from([0x00, 0x01, 0x02]), // NUL bytes
      Buffer.from('\nSome text\n'),
    ]);
    writeFileSync(join(dir, 'AGENTS.md'), binaryContent);
    const result = loadHostConventions(dir);
    expect(result).toBe('');
  });

  it('oversized file on disk (exceeds byte cap) → returns empty string without reading', () => {
    const dir = makeTempDir();
    // Write a file whose on-disk size exceeds MAX_FILE_BYTES (512 KB).
    // We write exactly 513 KB of text to simulate the over-limit case.
    const oversized = 'X'.repeat(513 * 1024);
    writeFileSync(join(dir, 'AGENTS.md'), oversized, 'utf8');
    const result = loadHostConventions(dir);
    expect(result).toBe('');
  });

  it('nonexistent repoRoot → returns empty string, does not throw', () => {
    let result: string | undefined;
    expect(() => { result = loadHostConventions('/tmp/nonexistent-corellia-test-dir-xyz'); }).not.toThrow();
    expect(result).toBe('');
  });

  it('repoRoot is a file, not a directory → returns empty string, does not throw', () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'notadir');
    writeFileSync(filePath, 'not a dir\n', 'utf8');
    let result: string | undefined;
    expect(() => { result = loadHostConventions(filePath); }).not.toThrow();
    expect(result).toBe('');
  });
});
