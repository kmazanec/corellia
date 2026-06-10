/**
 * A factory function that turns a flat array of GoalTypeDef objects into the
 * Registry interface. Lookup by name throws a helpful diagnostic if the name
 * is absent so callers get actionable feedback immediately.
 */

import type { GoalTypeDef, Registry } from '../contract/goal-type.js';

/**
 * Build a Registry from an array of GoalTypeDef objects. Names must be unique
 * within the array; duplicates cause the last definition to win silently, which
 * is intentional for override scenarios in tests.
 */
export function createRegistry(defs: GoalTypeDef[]): Registry {
  const map = new Map<string, GoalTypeDef>();
  for (const def of defs) {
    map.set(def.name, def);
  }

  return {
    get(name: string): GoalTypeDef {
      const def = map.get(name);
      if (def === undefined) {
        const known = [...map.keys()].sort().join(', ');
        throw new Error(
          `Unknown goal-type "${name}". Registered types: ${known || '(none)'}`,
        );
      }
      return def;
    },

    has(name: string): boolean {
      return map.has(name);
    },

    names(): string[] {
      return [...map.keys()];
    },
  };
}
