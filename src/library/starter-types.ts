/**
 * The starter set of GoalTypeDef objects: a thin slice of the full type table
 * covering the intent → artifact → judge → memory loop end-to-end.
 *
 * Tier ladders read left-to-right: the first element is the default; subsequent
 * elements are the escalation rungs the control loop climbs on eval failure.
 *
 * Grants are descriptive strings (e.g. 'fs.read'); the engine enforces them at
 * runtime; this definition carries the data shape.
 */

import type { GoalTypeDef } from '../contract/goal-type.js';
import { artifactPresent, filesWithinScope, processClean } from './checks.js';

/**
 * The eight starter goal-types. Each corresponds directly to a row in the
 * GOAL-TYPES.md kind tables.
 */
export function starterTypes(): GoalTypeDef[] {
  return [
    // -------------------------------------------------------------------------
    // make / deliver
    // -------------------------------------------------------------------------
    {
      name: 'deliver-intent',
      kind: 'make',
      family: 'deliver',
      leafOnly: false,
      tier: { default: 'opus', ladder: ['opus'] },
      deterministic: [],
      judgeType: 'judge-integration',
      // The root type that commissions intent accepts only spawn + retrieval
      // grants; no code tools, because satisfying intent directly is not its job.
      grants: ['retrieval.api', 'classify_risk', 'spawn'],
    },

    // -------------------------------------------------------------------------
    // make / build
    // -------------------------------------------------------------------------
    {
      name: 'freeze-contract',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'opus', ladder: ['opus'] },
      deterministic: [artifactPresent, filesWithinScope, processClean],
      judgeType: 'critique-code',
      grants: ['fs.read', 'fs.write', 'test.run_scoped'],
    },

    {
      name: 'implement',
      kind: 'make',
      family: 'build',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
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
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [artifactPresent, filesWithinScope],
      judgeType: 'critique-code',
      // Characterize writes only to test directories; no production-code writes.
      grants: ['fs.read', 'fs.write_test_dirs', 'test.run_impacted'],
    },

    // -------------------------------------------------------------------------
    // judge / arbiter
    // -------------------------------------------------------------------------
    {
      name: 'judge-split',
      kind: 'judge',
      family: 'arbiter',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },

    {
      name: 'judge-integration',
      kind: 'judge',
      family: 'arbiter',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },

    {
      name: 'critique-code',
      kind: 'judge',
      family: 'critique',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet', 'opus'] },
      deterministic: [],
      judgeType: null,
      grants: [],
    },

    // -------------------------------------------------------------------------
    // evolve / curate
    // -------------------------------------------------------------------------
    {
      name: 'promote-memory',
      kind: 'evolve',
      family: 'curate',
      leafOnly: true,
      tier: { default: 'sonnet', ladder: ['sonnet'] },
      deterministic: [],
      judgeType: null,
      // The curate family holds the only memory-write grants in the library.
      grants: ['memory.write'],
    },
  ];
}
