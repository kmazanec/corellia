/**
 * Scope watch for the worktree shell (C1).
 *
 * The file tools refuse a write outside the calling goal's declared scope
 * before it happens; a shell cannot be checked that way — `run_command` takes
 * free-form text, and any command may write anywhere in the worktree. So the
 * shell is checked after the fact: the out-of-scope dirty paths are sampled
 * before and after each call, and any path the call newly pushed out of scope
 * is recorded as a `scope-escaped` event and named back to the calling leaf in
 * the tool output, while it can still restore the path itself.
 *
 * Detection, not reversion: sibling leaves run concurrently in one worktree, so
 * the diff across a call cannot be attributed to that call alone, and reverting
 * it could destroy a sibling's in-scope work. The root emission gate remains the
 * backstop that blocks a tree whose diff escapes scope.
 */

import type { EventStore } from '../contract/events.js';
import type { Goal } from '../contract/goal.js';
import type { ToolImpl } from '../contract/tool.js';
import { outOfScopeChanges } from './worktree.js';

/**
 * Wrap a shell tool so every call is followed by a scope check against the
 * calling goal's declared scope.
 */
export function scopeWatchedTool(
  impl: ToolImpl,
  worktreeRoot: string,
  store: EventStore,
  now: () => number,
): ToolImpl {
  return {
    def: impl.def,
    async execute(goal: Goal, args: Record<string, unknown>) {
      const before = new Set(outOfScopeChanges(worktreeRoot, goal.scope));
      const result = await impl.execute(goal, args);
      const escaped = outOfScopeChanges(worktreeRoot, goal.scope).filter((p) => !before.has(p));
      if (escaped.length === 0) return result;

      await store.append({
        type: 'scope-escaped',
        at: now(),
        goalId: goal.id,
        source: 'run_command',
        scope: goal.scope,
        paths: escaped,
      });
      return { ok: result.ok, output: `${scopeEscapeWarning(goal.scope, escaped)}\n\n${result.output}` };
    },
  };
}

function scopeEscapeWarning(scope: string[], escaped: string[]): string {
  return (
    `SCOPE ESCAPE: this command changed ${escaped.length} path(s) outside your declared scope ` +
    `(${scope.join(', ')}): ${escaped.join(', ')}. Out-of-scope changes are never committed and ` +
    `will block the tree at emission. Restore them now (git checkout -- <path> for a tracked ` +
    `file, remove a file you created) and keep all changes inside your scope.`
  );
}
