/**
 * Skill loader: resolves family skill markdown files and exposes per-type
 * sections. Files live at src/library/skills/<family>.md relative to this
 * module. The loader caches parsed results so repeated calls for the same
 * family are free.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** The directory that contains this file (src/library). */
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills');

/**
 * The resolved skill bundle for a family: the full markdown text, the family
 * name, and a helper to extract a named type's section.
 */
export interface FamilySkill {
  /** The family name (e.g. 'build', 'comprehend'). */
  family: string;
  /** The complete markdown content of the family skill file. */
  full: string;
  /**
   * Extract the `## <typeName>` section from the markdown. Returns the section
   * text (heading + body) when found, null when the section is absent.
   */
  sectionFor(typeName: string): string | null;
}

/** In-memory cache: family name → parsed FamilySkill. */
const cache = new Map<string, FamilySkill | null>();

/** In-memory cache for the shared preamble (undefined = not yet loaded). */
let sharedPreambleCache: string | undefined = undefined;

/**
 * Load the skill bundle for a family. Returns a {@link FamilySkill} when the
 * file exists, or null when it is absent (the constitution lint catches real
 * gaps; the engine stays lenient).
 *
 * The result is cached after the first load — repeated calls are free.
 */
export function loadFamilySkill(family: string): FamilySkill | null {
  if (cache.has(family)) {
    return cache.get(family) ?? null;
  }

  const filePath = join(SKILLS_DIR, `${family}.md`);
  if (!existsSync(filePath)) {
    cache.set(family, null);
    return null;
  }

  const full = readFileSync(filePath, 'utf8');
  const skill: FamilySkill = {
    family,
    full,
    sectionFor(typeName: string): string | null {
      return extractSection(full, typeName);
    },
  };

  cache.set(family, skill);
  return skill;
}

/**
 * Extract the `## <typeName>` section from markdown. The section spans from
 * the heading line to the next `##`-level heading (or end of file).
 */
function extractSection(markdown: string, typeName: string): string | null {
  const lines = markdown.split('\n');
  const headingPattern = `## ${typeName}`;
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimEnd() === headingPattern) {
      start = i;
      break;
    }
  }

  if (start === -1) return null;

  // Collect until the next ## heading or EOF
  const sectionLines: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (i > start && line.startsWith('## ')) break;
    sectionLines.push(line);
  }

  return sectionLines.join('\n');
}

/**
 * Load the shared preamble from `_shared.md`. Returns the full file text when
 * the file exists, or an empty string when it is absent (the engine stays
 * lenient). The result is cached after the first load — repeated calls are free.
 */
export function loadSharedPreamble(): string {
  if (sharedPreambleCache !== undefined) {
    return sharedPreambleCache;
  }

  const filePath = join(SKILLS_DIR, '_shared.md');
  if (!existsSync(filePath)) {
    sharedPreambleCache = '';
    return '';
  }

  sharedPreambleCache = readFileSync(filePath, 'utf8');
  return sharedPreambleCache;
}

/**
 * Clear the loader cache. Intended for tests that need isolated loader state.
 * Not part of the production surface.
 */
export function _clearSkillCache(): void {
  cache.clear();
  sharedPreambleCache = undefined;
}
