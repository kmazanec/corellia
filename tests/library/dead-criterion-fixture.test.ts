import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { criteriaWellFormed } from '../../src/library/checks.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';

// The criteria-well-formed proof: the SAME criteria set passes when its {script}
// check names a DECLARED script name and fails when it names a raw command line
// the runner will never accept — the "dead on arrival" criterion seen live. The
// two sets differ by exactly that one check. Drives the real check with the
// declared script names in the context, as the milestone ship gate does.

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'dead-criterion');

const { declaredScriptNames } = JSON.parse(
  readFileSync(join(fixtureDir, 'declared-scripts.json'), 'utf8'),
) as { declaredScriptNames: string[] };

const goal = { id: 'g', scope: [] } as unknown as Goal;

function criteriaArtifact(name: string): Artifact {
  return { kind: 'text', text: readFileSync(join(fixtureDir, name), 'utf8') };
}

describe('dead-criterion fixture (criteria-well-formed)', () => {
  it('PASSES when every {script} check names a declared script', async () => {
    const check = criteriaWellFormed();
    const result = await check.run(goal, criteriaArtifact('criteria.clean.json'), { declaredScriptNames });
    expect(result.ok).toBe(true);
  });

  it('FAILS when a {script} check names a raw command line (dead criterion caught)', async () => {
    const check = criteriaWellFormed();
    const result = await check.run(goal, criteriaArtifact('criteria.defect.json'), { declaredScriptNames });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('vitest run --coverage');
    expect(result.detail).toContain('declared set');
  });
});
