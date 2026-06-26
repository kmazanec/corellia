/**
 * Tests for the persona layer: the shared, deterministic selector
 * (selectPersonas), the lenient cached loader (loadPersona), and the assembled
 * prompt fragment (renderPersonaBlock). The selector is the single core every
 * subagent mint site routes through, so it is exercised exhaustively here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  selectPersonas,
  loadPersona,
  renderPersonaBlock,
  _clearPersonaCache,
  type PersonaKey,
} from '../../src/library/personas.js';

const PERSONAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/library/personas');

/** A minimal goal-shaped object — the selector reads only scope + type. */
const goal = (scope: string[], type = 'implement'): { scope: string[]; type: string } => ({
  scope,
  type,
});

beforeEach(() => {
  _clearPersonaCache();
});

// ── selectPersonas: base language by extension ────────────────────────────────

describe('selectPersonas — base language from scope extensions', () => {
  it('maps .ts/.js to typescript-expert', () => {
    expect(selectPersonas(goal(['src/index.ts']))).toEqual(['typescript-expert']);
    expect(selectPersonas(goal(['lib/util.js']))).toEqual(['typescript-expert']);
  });

  it('maps .go to go-expert', () => {
    expect(selectPersonas(goal(['cmd/main.go']))).toEqual(['go-expert']);
  });

  it('maps .rs to rust-expert', () => {
    expect(selectPersonas(goal(['src/lib.rs']))).toEqual(['rust-expert']);
  });

  it('maps .py to python-expert', () => {
    expect(selectPersonas(goal(['app/main.py']))).toEqual(['python-expert']);
  });

  it('maps .rb to ruby-expert', () => {
    expect(selectPersonas(goal(['app/models/user.rb']))).toEqual(['ruby-expert']);
  });

  it('maps .swift to swift-expert', () => {
    expect(selectPersonas(goal(['Sources/App.swift']))).toEqual(['swift-expert']);
  });
});

// ── selectPersonas: framework overlay, base-first ─────────────────────────────

describe('selectPersonas — framework overlay layered on the base panel', () => {
  it('a .tsx file wears typescript-expert THEN react-expert (base first)', () => {
    expect(selectPersonas(goal(['src/App.tsx']))).toEqual(['typescript-expert', 'react-expert']);
  });

  it('a .jsx file wears typescript-expert then react-expert', () => {
    expect(selectPersonas(goal(['src/App.jsx']))).toEqual(['typescript-expert', 'react-expert']);
  });
});

// ── selectPersonas: path-hint overlays ────────────────────────────────────────

describe('selectPersonas — path hints for non-extension domains', () => {
  it('a Dockerfile wears devops-expert', () => {
    expect(selectPersonas(goal(['Dockerfile']))).toContain('devops-expert');
  });

  it('a terraform file wears devops-expert', () => {
    expect(selectPersonas(goal(['infra/main.tf']))).toContain('devops-expert');
  });

  it('a .css file wears design-expert', () => {
    expect(selectPersonas(goal(['styles/app.css']))).toContain('design-expert');
  });
});

// ── selectPersonas: work-kind from goal type ──────────────────────────────────

describe('selectPersonas — persona from the goal type (work kind)', () => {
  it('a security-review goal wears security-expert regardless of language', () => {
    expect(selectPersonas(goal(['src/auth.go'], 'security-review'))).toEqual([
      'go-expert',
      'security-expert',
    ]);
  });

  it('a curriculum goal wears pedagogy-expert', () => {
    expect(selectPersonas(goal([], 'author-curriculum-lesson'))).toEqual(['pedagogy-expert']);
  });
});

// ── selectPersonas: dedup, multi-file, empty ──────────────────────────────────

describe('selectPersonas — de-duplication and empties', () => {
  it('de-duplicates across many same-language files, order-stable', () => {
    expect(selectPersonas(goal(['a.ts', 'b.ts', 'c.tsx']))).toEqual([
      'typescript-expert',
      'react-expert',
    ]);
  });

  it('returns [] when nothing matches (caller falls back to the generic prompt)', () => {
    expect(selectPersonas(goal(['notes/README.md'], 'comprehend'))).toEqual([]);
    expect(selectPersonas(goal([], 'map-repo'))).toEqual([]);
  });

  it('is deterministic — same input, same output across calls', () => {
    const input = goal(['src/App.tsx', 'src/api.go'], 'implement');
    expect(selectPersonas(input)).toEqual(selectPersonas(input));
  });
});

// ── loadPersona: resolution, caching, frontmatter strip ───────────────────────

describe('loadPersona', () => {
  it('loads each known persona with frontmatter stripped', () => {
    const persona = loadPersona('go-expert');
    expect(persona).not.toBeNull();
    expect(persona!.key).toBe('go-expert');
    // Frontmatter removed: body must not start with the YAML fence.
    expect(persona!.body.startsWith('---')).toBe(false);
    expect(persona!.body.length).toBeGreaterThan(0);
  });

  it('caches: repeated calls return the same object', () => {
    expect(loadPersona('typescript-expert')).toBe(loadPersona('typescript-expert'));
  });

  it('is lenient — an absent persona key returns null, never throws', () => {
    // Cast through unknown: exercising the missing-file branch with a key the
    // union does not contain is the point of the lenient contract.
    const ghost = loadPersona('ghost-expert' as unknown as PersonaKey);
    expect(ghost).toBeNull();
  });
});

// ── renderPersonaBlock: assembly ──────────────────────────────────────────────

describe('renderPersonaBlock', () => {
  it('returns empty string when no persona applies', () => {
    expect(renderPersonaBlock(goal([], 'map-repo'))).toBe('');
  });

  it('includes the lens framing and the selected persona bodies, base first', () => {
    const block = renderPersonaBlock(goal(['src/App.tsx']));
    expect(block).toContain('EXPERT LENS');
    // base-first ordering: the TS body appears before the React body
    const tsBody = loadPersona('typescript-expert')!.body;
    const reactBody = loadPersona('react-expert')!.body;
    expect(block).toContain(tsBody);
    expect(block).toContain(reactBody);
    expect(block.indexOf(tsBody)).toBeLessThan(block.indexOf(reactBody));
  });
});

// ── coverage: every selectable key has a real file on disk ────────────────────

describe('persona coverage', () => {
  it('every PersonaKey the selector can emit resolves to a real file', () => {
    // The full set of keys the selector can produce (mirrors the union).
    const allKeys: PersonaKey[] = [
      'typescript-expert',
      'react-expert',
      'node-expert',
      'go-expert',
      'rust-expert',
      'python-expert',
      'ruby-expert',
      'swift-expert',
      'devops-expert',
      'security-expert',
      'design-expert',
      'pedagogy-expert',
    ];
    for (const key of allKeys) {
      expect(loadPersona(key), `persona file for ${key} must exist`).not.toBeNull();
    }
  });

  it('the personas directory contains exactly the expected expert files', () => {
    const files = readdirSync(PERSONAS_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort();
    expect(files).toEqual(
      [
        'design-expert.md',
        'devops-expert.md',
        'go-expert.md',
        'node-expert.md',
        'pedagogy-expert.md',
        'python-expert.md',
        'react-expert.md',
        'ruby-expert.md',
        'rust-expert.md',
        'security-expert.md',
        'swift-expert.md',
        'typescript-expert.md',
      ].sort(),
    );
  });
});
