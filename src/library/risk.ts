/**
 * Risk classification: computes the blast-radius band for a goal instance from
 * its declared scope crossed with sensitivity facts drawn from project knowledge.
 *
 * Risk is an instance property, not a type property. `modify-code` touching
 * `auth.py` is not the same goal as `modify-code` touching a README — only the
 * instance knows its actual reach.
 */

import type { RiskClass, SensitivityFact } from '../contract/risk.js';

/**
 * Classify the highest risk among all sensitivity facts whose pattern overlaps
 * any path in `paths`. A path intersects a pattern when the path starts with the
 * pattern or contains it as a substring — both directions of containment are
 * intentional: `src/auth/login.ts` matches pattern `auth`; `auth.ts` also matches.
 *
 * Empty `paths` or no matching fact → `'low'` (fail-safe: absent scope is not
 * high-risk, it is unknown scope).
 */
export function classifyRisk(paths: string[], facts: SensitivityFact[]): RiskClass {
  if (paths.length === 0 || facts.length === 0) return 'low';

  const riskOrder: Record<RiskClass, number> = { low: 0, medium: 1, high: 2 };
  let highest: RiskClass = 'low';

  for (const fact of facts) {
    for (const path of paths) {
      if (pathMatchesPattern(path, fact.pattern)) {
        if (riskOrder[fact.risk] > riskOrder[highest]) {
          highest = fact.risk;
        }
        // Short-circuit: already at the ceiling
        if (highest === 'high') return 'high';
      }
    }
  }

  return highest;
}

/**
 * A path matches a pattern when the path starts with the pattern or contains
 * it as a substring. Case-sensitive; forward-slash normalised paths assumed.
 */
function pathMatchesPattern(path: string, pattern: string): boolean {
  return path.startsWith(pattern) || path.includes(pattern);
}

/**
 * Sensible project-agnostic defaults covering the surfaces most likely to carry
 * authority-gap risk. Projects supply their own facts on top of these; these
 * cover the common cases that every project inherits unless overridden.
 */
export const DEFAULT_SENSITIVITY: SensitivityFact[] = [
  {
    pattern: 'auth',
    reason: 'Authentication paths carry identity and session risk.',
    risk: 'high',
  },
  {
    pattern: '.env',
    reason: 'Environment files routinely contain live secrets.',
    risk: 'high',
  },
  {
    pattern: 'secret',
    reason: 'Paths containing "secret" are presumed to carry credentials.',
    risk: 'high',
  },
  {
    pattern: 'credential',
    reason: 'Credential files carry authentication material.',
    risk: 'high',
  },
  {
    pattern: 'key',
    reason: 'Paths containing "key" may hold API keys or private keys.',
    risk: 'high',
  },
  {
    pattern: 'migration',
    reason: 'Database migrations are irreversible and affect shared data.',
    risk: 'high',
  },
  {
    pattern: '.github/',
    reason: 'CI/CD workflows control deployment pipelines.',
    risk: 'medium',
  },
  {
    pattern: 'deploy',
    reason: 'Deployment configuration controls production environments.',
    risk: 'medium',
  },
];
