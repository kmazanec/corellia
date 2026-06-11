/**
 * Strict library lint gate — runs lintLibrary with default options (checkSkills
 * enabled) against starterTypes(). Exits non-zero on any violation so the
 * "npm test" chain (npm run lint && vitest run) enforces skill-file coverage as
 * a real gate, not just a unit assertion.
 *
 * Run via:  npm run lint
 * Chained:  npm test  (= npm run lint && vitest run)
 */

import { lintLibrary } from '../src/library/constitution.js';
import { starterTypes } from '../src/library/starter-types.js';

const violations = lintLibrary(starterTypes());

if (violations.length === 0) {
  console.log('library lint: ok');
  process.exit(0);
} else {
  console.error('library lint: FAILED');
  for (const v of violations) {
    console.error(`  • ${v}`);
  }
  process.exit(1);
}
