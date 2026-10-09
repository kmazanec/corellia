/**
 * The goal tree as data: one node per `goal-received`, nested by
 * `goal.parentId`, each carrying the goal's current state.
 *
 * This is the shared projection core behind every tree view — `renderTree`
 * (the CLI's ASCII view) and the operator console's interactive tree both read
 * {@link projectGoalTree}. The projection is a pure fold over the log (ADR-003);
 * it tolerates a log that is still growing (goals in flight are `running`).
 */

import type { FactoryEvent } from '../contract/events.js';

/**
 * A goal's state as the log tells it: the state set by its latest lifecycle
 * event, since a parked goal can be answered and run again.
 *
 * - `done`    — emitted with no blockers.
 * - `failed`  — emitted carrying blockers.
 * - `blocked` — blocked and denied or bounced.
 * - `parked`  — parked on a decision brief, awaiting an answer.
 * - `running` — received or resumed, and nothing since.
 */
export type GoalState = 'done' | 'failed' | 'blocked' | 'parked' | 'running';

export interface GoalTreeNode {
  goalId: string;
  goalType: string;
  title: string;
  parentId: string | null;
  state: GoalState;
  /** `at` of the goal's first `goal-received`. */
  startedAt: number;
  /** `at` of the goal's emission, when it has one. */
  endedAt?: number;
  children: GoalTreeNode[];
}

interface Building {
  node: GoalTreeNode;
  order: number;
}

/**
 * Fold the log into its forest of goal trees. Roots (and children) keep the
 * order of their first `goal-received`, so the output is deterministic. A goal
 * whose parent never appears in the log is treated as a root.
 */
export function projectGoalTree(events: readonly FactoryEvent[]): GoalTreeNode[] {
  const byId = new Map<string, Building>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'goal-received' && !byId.has(e.goalId)) {
      byId.set(e.goalId, {
        node: {
          goalId: e.goalId,
          goalType: e.goal.type,
          title: e.goal.title,
          parentId: e.goal.parentId,
          state: 'running',
          startedAt: e.at,
          children: [],
        },
        order: i,
      });
      continue;
    }
    const b = byId.get(e.goalId);
    if (b) applyLifecycle(b.node, e);
  }

  const roots: Building[] = [];
  const ordered = [...byId.values()].sort((a, b) => a.order - b.order);
  for (const b of ordered) {
    const parent = b.node.parentId === null ? undefined : byId.get(b.node.parentId);
    if (parent) parent.node.children.push(b.node);
    else roots.push(b);
  }
  return roots.map((b) => b.node);
}

/** Move a goal's state on one of its own events; non-lifecycle events leave it. */
function applyLifecycle(node: GoalTreeNode, e: FactoryEvent): void {
  switch (e.type) {
    case 'goal-received':
    case 'resumed':
      node.state = 'running';
      delete node.endedAt;
      return;
    case 'emitted':
      node.state = e.report.blockers.length > 0 ? 'failed' : 'done';
      node.endedAt = e.at;
      return;
    case 'blocked':
      if (e.resolution === 'park') node.state = 'parked';
      else if (e.resolution !== 'answered') node.state = 'blocked';
      return;
    case 'parked':
      node.state = 'parked';
      return;
    default:
      return;
  }
}

const GLYPH: Record<GoalState, string> = {
  done: '✓',
  failed: '✗',
  blocked: '✗',
  parked: '◌',
  running: '◌',
};

/**
 * The ASCII view of {@link projectGoalTree}: one line per goal,
 * `<indent><glyph> [<type>] <title>`, two spaces per depth.
 */
export function renderTree(events: FactoryEvent[]): string {
  const lines: string[] = [];
  const visit = (n: GoalTreeNode, indent: string): void => {
    lines.push(`${indent}${GLYPH[n.state]} [${n.goalType}] ${n.title}`);
    for (const c of n.children) visit(c, indent + '  ');
  };
  for (const root of projectGoalTree(events)) visit(root, '');
  return lines.join('\n');
}
