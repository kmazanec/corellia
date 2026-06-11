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

/**
 * The ten starter goal-types. Each corresponds directly to a row in the
 * GOAL-TYPES.md kind tables. The two `learn`-kind types (`map-repo` and
 * `deep-dive-region`) are appended after the original eight.
 */
export function starterTypes(): GoalTypeDef[] {
  return [
    ...deliverTypes(),
    ...buildTypes(),
    ...arbiterTypes(),
    ...critiqueTypes(),
    ...curateTypes(),
    ...comprehendTypes(),
  ];
}
