/**
 * The starter set of GoalTypeDef objects: a thin slice of the full type table
 * covering the intent → artifact → judge → memory loop end-to-end.
 *
 * Tier ladders read left-to-right: the first element is the default; subsequent
 * elements are the escalation rungs the control loop climbs on eval failure.
 *
 * Grants are descriptive strings (e.g. 'fs.read'); the engine enforces them at
 * runtime; this definition carries the data shape.
 *
 * Per-family modules own their definitions; this aggregator re-exports the
 * combined starterTypes() surface unchanged.
 */

import type { GoalTypeDef } from '../contract/goal-type.js';
import { deliverTypes } from './types/deliver.js';
import { buildTypes } from './types/build.js';
import { arbiterTypes } from './types/arbiter.js';
import { critiqueTypes } from './types/critique.js';
import { curateTypes } from './types/curate.js';
import { comprehendTypes } from './types/comprehend.js';
import { authorTypes } from './types/author.js';
import { researchTypes } from './types/research.js';
import { diagnoseTypes } from './types/diagnose.js';
import { improveTypes } from './types/improve.js';

/**
 * The starter goal-types — the full GOAL-TYPES.md library. Each entry
 * corresponds directly to a row in the kind tables.
 *
 * The starter goal-types. Each corresponds directly to a row in the
 * GOAL-TYPES.md kind tables. The evolve family's improve types
 * (propose-pattern, improve-factory) and the curate type consolidate-memory
 * complete the evolve family.
 *
 * Tier ladders read left-to-right: the first element is the default; subsequent
 * elements are the escalation rungs the control loop climbs on eval failure.
 *
 * Grants are descriptive strings (e.g. 'fs.read'); the engine enforces them at
 * runtime; this definition carries the data shape.
 *
 * Per-family modules own their definitions; this aggregator re-exports the
 * combined starterTypes() surface unchanged.
 */
export function starterTypes(): GoalTypeDef[] {
  return [
    ...deliverTypes(),
    ...buildTypes(),
    ...arbiterTypes(),
    ...critiqueTypes(),
    ...curateTypes(),
    ...comprehendTypes(),
    ...authorTypes(),
    ...researchTypes(),
    ...diagnoseTypes(),
    ...improveTypes(),
  ];
}
