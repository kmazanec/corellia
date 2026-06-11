/**
 * Static linter for the goal-type library. Enforces structural invariants that
 * cannot be caught by TypeScript alone.
 */

import type { GoalTypeDef } from '../contract/goal-type.js';
import { loadFamilySkill } from './skills.js';

/**
 * Options for lintLibrary.
 */
export interface LintOptions {
  /**
   * When true (the default), verify that each type's family skill file exists
   * and contains a section for the type name. Set to false when linting stub
   * or synthetic type registries that are not backed by real skill files (e.g.
   * engine test doubles). The engine constructor uses false so that test types
   * with synthetic families do not fail the structural guard.
   */
  checkSkills?: boolean;
}

/**
 * Lint a set of GoalTypeDef objects and return a list of human-readable
 * violation strings. An empty array means the library is well-formed.
 */
export function lintLibrary(defs: GoalTypeDef[], opts: LintOptions = {}): string[] {
  const checkSkills = opts.checkSkills !== false;
  const violations: string[] = [];

  // Duplicate type names
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.name)) {
      violations.push(`Duplicate type name: "${def.name}"`);
    }
    seen.add(def.name);
  }

  for (const def of defs) {
    // Judge-kind types must not carry write grants or spawn non-leaf trees
    if (def.kind === 'judge') {
      for (const grant of def.grants) {
        if (grant.includes('write')) {
          violations.push(
            `Judge type "${def.name}" has a write grant: "${grant}"`,
          );
        }
      }
      if (!def.leafOnly) {
        violations.push(
          `Judge type "${def.name}" has leafOnly: false — judge types must be leaf-only`,
        );
      }
    }

    // memory.write grants belong only to the curate family
    for (const grant of def.grants) {
      if (grant === 'memory.write' && def.family !== 'curate') {
        violations.push(
          `Type "${def.name}" (family "${def.family}") has a memory.write grant — only the curate family may hold this`,
        );
      }
    }

    // Tier ladder must not be empty
    if (def.tier.ladder.length === 0) {
      violations.push(
        `Type "${def.name}" has an empty tier ladder`,
      );
    }

    // Tier ladder must start at the default tier
    if (def.tier.ladder.length > 0 && def.tier.ladder[0] !== def.tier.default) {
      violations.push(
        `Type "${def.name}" tier ladder does not start at default tier "${def.tier.default}" (starts at "${def.tier.ladder[0]}")`,
      );
    }

    // Family skill file must exist and contain a section for this type.
    // Skipped when opts.checkSkills is false (engine constructor, synthetic stubs).
    if (checkSkills) {
      const skill = loadFamilySkill(def.family);
      if (skill === null) {
        violations.push(
          `Type "${def.name}" family skill file missing: src/library/skills/${def.family}.md`,
        );
      } else if (skill.sectionFor(def.name) === null) {
        violations.push(
          `Type "${def.name}" has no section in src/library/skills/${def.family}.md (add ## ${def.name})`,
        );
      }
    }
  }

  return violations;
}
