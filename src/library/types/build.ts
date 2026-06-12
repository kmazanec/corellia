import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent, filesWithinScope, processClean } from '../checks.js';

export function buildTypes(): GoalTypeDef[] {
  return [
    {
      name: 'freeze-contract',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'high', ladder: ['high'] },
      deterministic: [artifactPresent, filesWithinScope, processClean],
      judgeType: 'critique-code',
      grants: ['fs.read', 'fs.write', 'test.run_scoped'],
    },

    {
      name: 'implement',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [artifactPresent, filesWithinScope, processClean],
      judgeType: 'critique-code',
      grants: [
        'fs.read',
        'fs.write',
        'test.run_impacted',
        'knowledge.find_symbol',
        'knowledge.find_exemplar',
        'knowledge.impact',
        'knowledge.conventions_for',
        'knowledge.stack_versions',
      ],
    },

    {
      name: 'characterize',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [artifactPresent, filesWithinScope],
      judgeType: 'critique-code',
      // Characterize writes only to test directories; no production-code writes.
      grants: ['fs.read', 'fs.write_test_dirs', 'test.run_impacted'],
    },
  ];
}
