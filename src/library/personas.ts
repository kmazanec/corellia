/**
 * Persona layer: the expert lens a minted subagent wears.
 *
 * Every subagent the factory mints (the brain's decide/produce/judge/repair
 * roles, and the tool-using step-loop leaf) gets a generic factory-role framing
 * plus a per-family craft skill. This module adds the third layer: an expert
 * *domain* persona — "Go judged by the people whose names are the language's
 * idiom" — selected from the goal alone (ADR-038).
 *
 * The selection logic ({@link selectPersonas}) is the single shared core every
 * mint site routes through. It is pure, deterministic, and LLM-free: a goal's
 * scope (file extensions) and type pick an ordered set of persona keys, applying
 * the layering the personas describe (a React goal wears typescript-expert AND
 * react-expert, base language first). The persona files live at
 * `src/library/personas/<key>.md` and are loaded with the same caching,
 * lenient-on-missing discipline as {@link import('./skills.js')}.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import type { Goal } from '../contract/goal.js';

/** The directory that contains the persona markdown files (src/library/personas). */
const PERSONAS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'personas');

/**
 * A persona key is the generic, domain-named stem of a file in
 * {@link PERSONAS_DIR} (e.g. `typescript-expert`, `go-expert`). Never a person's
 * name — the factory depends on the domain, not the individual.
 */
export type PersonaKey =
  | 'typescript-expert'
  | 'react-expert'
  | 'node-expert'
  | 'go-expert'
  | 'rust-expert'
  | 'python-expert'
  | 'ruby-expert'
  | 'swift-expert'
  | 'devops-expert'
  | 'security-expert'
  | 'design-expert'
  | 'pedagogy-expert';

/**
 * File extension → the base language persona it implies. The primary selection
 * signal: the language a goal's scope is written in. Lower-cased, leading dot.
 */
const EXT_TO_BASE: Readonly<Record<string, PersonaKey>> = {
  '.ts': 'typescript-expert',
  '.tsx': 'typescript-expert',
  '.mts': 'typescript-expert',
  '.cts': 'typescript-expert',
  '.js': 'typescript-expert',
  '.jsx': 'typescript-expert',
  '.mjs': 'typescript-expert',
  '.cjs': 'typescript-expert',
  '.go': 'go-expert',
  '.rs': 'rust-expert',
  '.py': 'python-expert',
  '.pyi': 'python-expert',
  '.rb': 'ruby-expert',
  '.rake': 'ruby-expert',
  '.swift': 'swift-expert',
};

/**
 * Extensions that imply a framework/domain persona LAYERED ON TOP of a base
 * language persona (per the personas' own "layers on top of the base panel"
 * rule). `.tsx`/`.jsx` strongly suggest React; the base TS persona is added
 * separately by {@link EXT_TO_BASE}, so the result is ordered base-first.
 */
const EXT_TO_OVERLAY: Readonly<Record<string, PersonaKey>> = {
  '.tsx': 'react-expert',
  '.jsx': 'react-expert',
};

/**
 * Path substrings → an overlay persona, for domains a bare extension cannot
 * reveal. Matched case-insensitively against each scope entry. Deliberately
 * conservative: a false positive wears one extra lens; a miss falls back to the
 * base language persona, which is never wrong.
 */
const PATH_HINT_TO_OVERLAY: ReadonlyArray<readonly [RegExp, PersonaKey]> = [
  // DevOps: a directory/filename hint (Dockerfile, CI workflows, k8s/terraform dirs)…
  [/(^|\/)(dockerfile|\.github\/workflows\/|k8s\/|kubernetes\/|terraform\/)/i, 'devops-expert'],
  // …or a suffix hint (.tf, compose.yml) anchored to the path end.
  [/(\.tf|compose\.ya?ml)$/i, 'devops-expert'],
  [/\.(css|scss|sass|less)$/i, 'design-expert'],
];

/**
 * Goal-type / family substrings → a persona, when the WORK kind (not the file
 * type) names the lens. A security-review goal wears the security expert
 * regardless of language; a curriculum/pedagogy goal wears the pedagogy expert.
 * Matched case-insensitively against the goal's `type`.
 */
const TYPE_HINT_TO_PERSONA: ReadonlyArray<readonly [RegExp, PersonaKey]> = [
  [/secur|vuln|threat|authz|authn/i, 'security-expert'],
  [/pedagog|curricul|lesson|tutor|learn/i, 'pedagogy-expert'],
  [/design|ux|a11y|accessib/i, 'design-expert'],
  [/devops|infra|deploy|pipeline|observab/i, 'devops-expert'],
];

/**
 * Select the ordered set of persona keys a goal's minted subagent should wear.
 *
 * THE SHARED CORE — every subagent mint site calls this and nothing else to
 * decide its persona(s). Pure, deterministic, LLM-free.
 *
 * Ordering contract: base language persona(s) FIRST, then overlays, then
 * type/work-derived personas — so the assembled prompt reads "TypeScript panel,
 * then the React lens on top," matching how the personas describe themselves.
 * De-duplicated, order-stable. Returns `[]` when no signal matches (the caller
 * falls back to the generic prompt, exactly as before this layer existed).
 */
export function selectPersonas(goal: Pick<Goal, 'scope' | 'type'>): PersonaKey[] {
  const bases: PersonaKey[] = [];
  const overlays: PersonaKey[] = [];

  for (const entry of goal.scope) {
    const ext = extname(entry).toLowerCase();
    const base = EXT_TO_BASE[ext];
    if (base) bases.push(base);
    const overlay = EXT_TO_OVERLAY[ext];
    if (overlay) overlays.push(overlay);
    for (const [pattern, persona] of PATH_HINT_TO_OVERLAY) {
      if (pattern.test(entry)) overlays.push(persona);
    }
  }

  const typeDerived: PersonaKey[] = [];
  for (const [pattern, persona] of TYPE_HINT_TO_PERSONA) {
    if (pattern.test(goal.type)) typeDerived.push(persona);
  }

  // base-first, then overlays, then work-derived; de-duplicated, order-stable.
  const ordered = [...bases, ...overlays, ...typeDerived];
  return [...new Set(ordered)];
}

/** A loaded persona: its key and the full markdown body (frontmatter stripped). */
export interface Persona {
  key: PersonaKey;
  /** The persona body — the embodied-expert prose, frontmatter removed. */
  body: string;
}

/** In-memory cache: persona key → loaded Persona (null = file absent). */
const cache = new Map<string, Persona | null>();

/**
 * Load one persona by key. Returns the {@link Persona} when the file exists, or
 * null when absent (lenient, like the family-skill loader — a missing persona is
 * never fatal; the subagent simply wears one fewer lens). Cached after first load.
 */
export function loadPersona(key: PersonaKey): Persona | null {
  if (cache.has(key)) return cache.get(key) ?? null;

  const filePath = join(PERSONAS_DIR, `${key}.md`);
  if (!existsSync(filePath)) {
    cache.set(key, null);
    return null;
  }

  const raw = readFileSync(filePath, 'utf8');
  const persona: Persona = { key, body: stripFrontmatter(raw).trim() };
  cache.set(key, persona);
  return persona;
}

/** Remove a leading `---\n…\n---\n` YAML frontmatter block, if present. */
function stripFrontmatter(markdown: string): string {
  const m = markdown.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1]! : markdown;
}

/**
 * Render the persona block for a goal: select the persona(s), load them, and
 * assemble a single prompt fragment in base-first order. Returns '' when no
 * persona applies (the caller appends nothing — identical to pre-persona
 * behaviour). This is what mint sites concatenate into their system prompt /
 * harness framing.
 */
export function renderPersonaBlock(goal: Pick<Goal, 'scope' | 'type'>): string {
  const keys = selectPersonas(goal);
  if (keys.length === 0) return '';

  const sections: string[] = [];
  for (const key of keys) {
    const persona = loadPersona(key);
    if (persona) sections.push(persona.body);
  }
  if (sections.length === 0) return '';

  return (
    `EXPERT LENS — adopt the following expert persona(s) for this work ` +
    `(base language panel first, framework/domain lenses layered on top). ` +
    `This shapes HOW you reason about the code; it never overrides the goal, ` +
    `the family skill, or the factory's rules:\n\n` +
    sections.join('\n\n---\n\n')
  );
}

/**
 * Clear the loader cache. For tests that need isolated loader state. Not part of
 * the production surface.
 */
export function _clearPersonaCache(): void {
  cache.clear();
}
