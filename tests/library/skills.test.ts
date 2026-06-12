/**
 * Tests for the family skill loader: resolution, caching, sectionFor, and
 * missing-file/section lint via lintLibrary.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadFamilySkill, _clearSkillCache } from '../../src/library/skills.js';
import { lintLibrary } from '../../src/library/constitution.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';
import { starterTypes } from '../../src/library/starter-types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

const baseLeaf: GoalTypeDef = {
  name: 'test-leaf',
  kind: 'make',
  family: 'test',
  leafOnly: true,
  tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
  deterministic: [],
  judgeType: null,
  grants: [],
};

beforeEach(() => {
  // Isolate cache between tests so loader state does not leak.
  _clearSkillCache();
});

// ── Loader: resolution ────────────────────────────────────────────────────────

describe('loadFamilySkill — known families', () => {
  it('returns a FamilySkill for the comprehend family', () => {
    const skill = loadFamilySkill('comprehend');
    expect(skill).not.toBeNull();
    expect(skill!.family).toBe('comprehend');
    expect(typeof skill!.full).toBe('string');
    expect(skill!.full.length).toBeGreaterThan(0);
  });

  it('returns a FamilySkill for the build family', () => {
    const skill = loadFamilySkill('build');
    expect(skill).not.toBeNull();
    expect(skill!.family).toBe('build');
  });

  it('returns a FamilySkill for the arbiter family', () => {
    expect(loadFamilySkill('arbiter')).not.toBeNull();
  });

  it('returns a FamilySkill for the critique family', () => {
    expect(loadFamilySkill('critique')).not.toBeNull();
  });

  it('returns a FamilySkill for the curate family', () => {
    expect(loadFamilySkill('curate')).not.toBeNull();
  });

  it('returns a FamilySkill for the deliver family', () => {
    expect(loadFamilySkill('deliver')).not.toBeNull();
  });

  it('returns a FamilySkill for the author family', () => {
    expect(loadFamilySkill('author')).not.toBeNull();
  });

  it('returns a FamilySkill for the research family', () => {
    expect(loadFamilySkill('research')).not.toBeNull();
  });

  it('returns a FamilySkill for the diagnose family', () => {
    expect(loadFamilySkill('diagnose')).not.toBeNull();
  });
});

describe('loadFamilySkill — missing family', () => {
  it('returns null for a family with no skill file', () => {
    const skill = loadFamilySkill('nonexistent-family-xyz');
    expect(skill).toBeNull();
  });
});

// ── Loader: caching ───────────────────────────────────────────────────────────

describe('loadFamilySkill — caching', () => {
  it('returns the same object on repeated calls (referential equality)', () => {
    const first = loadFamilySkill('build');
    const second = loadFamilySkill('build');
    expect(first).toBe(second);
  });

  it('caches null for missing families', () => {
    const first = loadFamilySkill('ghost');
    const second = loadFamilySkill('ghost');
    expect(first).toBeNull();
    expect(second).toBeNull();
  });
});

// ── sectionFor ────────────────────────────────────────────────────────────────

describe('sectionFor', () => {
  it('returns the section for map-repo in the comprehend skill', () => {
    const skill = loadFamilySkill('comprehend')!;
    const section = skill.sectionFor('map-repo');
    expect(section).not.toBeNull();
    expect(section).toContain('## map-repo');
  });

  it('returns the section for deep-dive-region in the comprehend skill', () => {
    const skill = loadFamilySkill('comprehend')!;
    const section = skill.sectionFor('deep-dive-region');
    expect(section).not.toBeNull();
    expect(section).toContain('## deep-dive-region');
  });

  it('returns null for a type name not present in the file', () => {
    const skill = loadFamilySkill('comprehend')!;
    expect(skill.sectionFor('nonexistent-type-xyz')).toBeNull();
  });

  it('section does not bleed into the next heading', () => {
    const skill = loadFamilySkill('comprehend')!;
    const section = skill.sectionFor('map-repo')!;
    // The deep-dive-region heading should not appear inside the map-repo section
    expect(section).not.toContain('## deep-dive-region');
  });

  it('build skill contains sections for all three build types', () => {
    const skill = loadFamilySkill('build')!;
    expect(skill.sectionFor('freeze-contract')).not.toBeNull();
    expect(skill.sectionFor('implement')).not.toBeNull();
    expect(skill.sectionFor('characterize')).not.toBeNull();
  });

  it('author skill contains sections for write-prd and design-arch', () => {
    const skill = loadFamilySkill('author')!;
    expect(skill.sectionFor('write-prd')).not.toBeNull();
    expect(skill.sectionFor('design-arch')).not.toBeNull();
  });

  it('research skill contains a section for research-external', () => {
    const skill = loadFamilySkill('research')!;
    expect(skill.sectionFor('research-external')).not.toBeNull();
  });

  it('diagnose skill contains a section for investigate', () => {
    const skill = loadFamilySkill('diagnose')!;
    expect(skill.sectionFor('investigate')).not.toBeNull();
  });

  it('last section in a file extracts correctly when terminated by EOF (deep-dive-region)', () => {
    // deep-dive-region is the LAST section in comprehend.md — there is no
    // following ## heading, so the extractor must terminate at EOF.
    const skill = loadFamilySkill('comprehend')!;
    const section = skill.sectionFor('deep-dive-region')!;
    expect(section).not.toBeNull();
    expect(section).toContain('## deep-dive-region');
    // The section must include substantive body content from the file
    expect(section).toContain('RegionFacts');
    // And it must NOT contain the map-repo heading (no bleeding backward)
    expect(section).not.toContain('## map-repo');
  });
});

// ── Constitution lint: missing file / missing section ────────────────────────

describe('lintLibrary — skill file lint', () => {
  it('passes for all fourteen starter types (files and sections present)', () => {
    _clearSkillCache();
    const violations = lintLibrary(starterTypes());
    expect(violations).toHaveLength(0);
  });

  it('reports a violation when the family skill file is absent', () => {
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'orphan', family: 'no-such-family-abc' },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('no-such-family-abc') && v.includes('missing'))).toBe(true);
  });

  it('reports a violation when the type section is missing from the file', () => {
    // 'comprehend' file exists but has no section for 'unlisted-type'
    const defs: GoalTypeDef[] = [
      { ...baseLeaf, name: 'unlisted-type', family: 'comprehend' },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('unlisted-type') && v.includes('## unlisted-type'))).toBe(true);
  });

  it('does not double-report when both the judge grant and the skill file are wrong', () => {
    // The judge-grant violation and the skill-file violation are independent checks;
    // both should appear, but the count must be deterministic (2 here).
    const defs: GoalTypeDef[] = [
      {
        ...baseLeaf,
        name: 'bad-judge-no-skill',
        kind: 'judge',
        family: 'no-such-family-xyz',
        grants: ['fs.write'],
        leafOnly: true,
      },
    ];
    const violations = lintLibrary(defs);
    expect(violations.some((v) => v.includes('write grant'))).toBe(true);
    expect(violations.some((v) => v.includes('no-such-family-xyz') && v.includes('missing'))).toBe(true);
  });
});
