/**
 * Static linter for the goal-type library. Enforces structural invariants that
 * cannot be caught by TypeScript alone.
 */

import type { GoalTypeDef } from '../contract/goal-type.js';
import { loadFamilySkill } from './skills.js';

const CORE_TYPES: ReadonlyMap<string, GoalTypeDef['kind']> = new Map([
  ['deliver-intent', 'make'],
  ['judge-split', 'judge'],
  ['judge-integration', 'judge'],
]);

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

  // Build a fast lookup map by name for the judgeType validity check below.
  const byName = new Map<string, GoalTypeDef>(defs.map((d) => [d.name, d]));

  // Duplicate type names
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.name)) {
      violations.push(`Duplicate type name: "${def.name}"`);
    }
    seen.add(def.name);
  }

  for (const def of defs) {
    if (checkSkills && (def.validateInput === undefined || def.inputSchema === undefined)) {
      violations.push(
        `Type "${def.name}" does not declare an input contract`,
      );
    }
    if (def.acceptsFreeText === true && def.name !== 'deliver-intent') {
      violations.push(
        `Type "${def.name}" accepts free-text input — only deliver-intent may accept unparsed intent text`,
      );
    }
    if (checkSkills && def.name === 'deliver-intent' && def.acceptsFreeText !== true) {
      violations.push(
        `Core type "deliver-intent" must accept free-text input`,
      );
    }

    const coreKind = CORE_TYPES.get(def.name);
    if (coreKind !== undefined) {
      if (checkSkills) {
        if (def.core !== true) {
          violations.push(
            `Core type "${def.name}" must declare core: true`,
          );
        }
        if (def.kind !== coreKind) {
          violations.push(
            `Core type "${def.name}" has kind "${def.kind}" (must be "${coreKind}")`,
          );
        }
      }
    } else if (def.core === true) {
      violations.push(
        `Type "${def.name}" declares core: true but is not a recognized core type`,
      );
    }

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

    const grantViolation = kindGrantCeilingViolation(def);
    if (grantViolation !== null) {
      violations.push(grantViolation);
    }

    const touchpointViolation = humanTouchpointViolation(def);
    if (touchpointViolation !== null) {
      violations.push(touchpointViolation);
    }

    // memory.write grants belong only to the curate family
    for (const grant of def.grants) {
      if (grant === 'memory.write' && def.family !== 'curate') {
        violations.push(
          `Type "${def.name}" (family "${def.family}") has a memory.write grant — only the curate family may hold this`,
        );
      }
    }

    // capture.run grants belong only to make-kind types (ADR-042). Running a
    // declared capture starts servers and writes image/response files — side
    // effects above the judge/learn/evolve ceiling. A non-make type must not
    // hold it, the same way a judge type must not hold a write grant.
    for (const grant of def.grants) {
      if (grant === 'capture.run' && def.kind !== 'make') {
        violations.push(
          `Type "${def.name}" (kind "${def.kind}") has a capture.run grant — only make-kind types may hold this`,
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

    // Dangerous grant ceiling: no type may grant merge, approve, deploy, or spend
    // capability — these strings in any grant are above the factory's blast-radius
    // ceiling. This is the single source of truth for the invariant; tests must
    // not duplicate the loop (they should assert this lint rule fires).
    const dangerousGrant = /merge|approve|deploy|spend/;
    for (const grant of def.grants) {
      if (dangerousGrant.test(grant)) {
        violations.push(
          `Type "${def.name}" has a dangerous grant: "${grant}" (matches /merge|approve|deploy|spend/)`,
        );
      }
    }

    // iterative-trait invariants (ADR-031): an iterating type must be a make
    // type, must declare a positive round backstop, and must route its per-round
    // assessment through a registered judge. This forbids a judge/learn/evolve
    // kind from iterating (no recursing judge) and forbids an unbounded loop (the
    // maxRounds floor). The deterministic floor on criteria — every criterion
    // names a runnable, non-judge check — is enforced by criteriaWellFormed at
    // runtime, not here.
    if (def.iterative !== undefined) {
      if (def.kind !== 'make') {
        violations.push(
          `Type "${def.name}" is iterative but kind is "${def.kind}" (must be "make")`,
        );
      }
      if (!Number.isInteger(def.iterative.maxRounds) || def.iterative.maxRounds < 1) {
        violations.push(
          `Type "${def.name}" iterative.maxRounds must be an integer >= 1`,
        );
      }
      const acceptanceJudge = byName.get(def.iterative.acceptanceJudge);
      if (acceptanceJudge === undefined) {
        violations.push(
          `Type "${def.name}" iterative.acceptanceJudge "${def.iterative.acceptanceJudge}" is not registered`,
        );
      } else if (acceptanceJudge.kind !== 'judge') {
        violations.push(
          `Type "${def.name}" iterative.acceptanceJudge "${def.iterative.acceptanceJudge}" has kind "${acceptanceJudge.kind}" (must be "judge")`,
        );
      }
    }

    // mustDecompose invariant: a type that cannot satisfy must be able to spawn
    // (a leaf has nowhere to decompose to) and must hold no artifact-producing
    // grant (declaring "I cannot produce" while granting a producing tool is a
    // contradiction). This keeps the engine's cannot-satisfy guard honest: the
    // claim is structural, not a runtime accident.
    if (def.mustDecompose === true) {
      if (def.leafOnly) {
        violations.push(
          `Type "${def.name}" is mustDecompose but leafOnly — a leaf cannot decompose`,
        );
      }
      const producingGrant = /write/;
      for (const grant of def.grants) {
        if (producingGrant.test(grant)) {
          violations.push(
            `Type "${def.name}" is mustDecompose but holds a producing grant "${grant}" — a type that cannot satisfy must not be able to produce`,
          );
        }
      }
    }

    // judgeType validity: when judgeType is non-null it must name a registered
    // def whose kind === 'judge'. A judgeType pointing at an unknown name or a
    // non-judge kind is a misconfiguration that would produce silent misbehaviour
    // at runtime (enrichRubric would find no skill section for the wrong family).
    if (def.judgeType !== null) {
      const judgeTarget = byName.get(def.judgeType);
      if (judgeTarget === undefined) {
        violations.push(
          `Type "${def.name}" has judgeType "${def.judgeType}" which is not registered`,
        );
      } else if (judgeTarget.kind !== 'judge') {
        violations.push(
          `Type "${def.name}" has judgeType "${def.judgeType}" but that type has kind "${judgeTarget.kind}" (must be "judge")`,
        );
      }
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

function kindGrantCeilingViolation(def: GoalTypeDef): string | null {
  if (def.kind === 'make') return null;

  for (const grant of def.grants) {
    if (grant === 'fs.write' || grant === 'fs.write_test_dirs') {
      return `Type "${def.name}" kind "${def.kind}" exceeds grant ceiling with "${grant}"`;
    }
  }
  return null;
}

function humanTouchpointViolation(def: GoalTypeDef): string | null {
  if (def.humanTouchpoints === undefined) return null;
  if (!Array.isArray(def.humanTouchpoints)) {
    return `Type "${def.name}" humanTouchpoints must be an array`;
  }
  for (const touchpoint of def.humanTouchpoints) {
    if (
      typeof touchpoint.name !== 'string' ||
      !['deny', 'park', 'bounce'].includes(touchpoint.onTimeout)
    ) {
      return `Type "${def.name}" has invalid human touchpoint declaration`;
    }
  }
  return null;
}
