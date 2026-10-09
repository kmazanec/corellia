/**
 * The span inspector: one goal's spec, state, spend, scope, and its own
 * events, the way a tracing platform shows a span.
 */

import { useMemo } from 'react';

import type { StoredEvent } from '../api/live';
import { Panel } from '../components/Frame';
import { StateMark } from '../components/StateMark';
import { Trace } from '../components/Trace';
import { costSummary, type GoalTreeNode } from '../factory';
import { clock, count, duration, usd } from '../lib/format';

export interface InspectorProps {
  jobId: string;
  goalId: string | undefined;
  tree: GoalTreeNode;
  events: StoredEvent[];
  caughtUpAt: number;
}

export function Inspector({ goalId, tree, events, caughtUpAt }: InspectorProps) {
  const node = goalId ? find(tree, goalId) : undefined;
  const own = useMemo(() => (goalId ? events.filter((s) => s.event.goalId === goalId) : []), [events, goalId]);
  const received = own.find((s) => s.event.type === 'goal-received')?.event;
  const usage = useMemo(() => (goalId ? costSummary(own.map((s) => s.event)).byGoal[goalId] : undefined), [own, goalId]);

  if (!node || received?.type !== 'goal-received') {
    return (
      <Panel title="Inspector">
        <p className="font-prose text-[14px] italic text-line-soft">Select a goal in the tree to inspect its spec, spend, and events.</p>
      </Panel>
    );
  }

  const goal = received.goal;
  const calls = own.filter((s) => s.event.type === 'tool-call').length;

  return (
    <Panel title="Inspector" aside={<StateMark state={node.state} />}>
      <h4 className="goal-title text-[17px] leading-snug text-paper">{goal.title}</h4>
      <dl className="mt-3 grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 font-mono text-[11px]">
        <Row label="goal" value={goal.id} />
        <Row label="type" value={goal.type} />
        <Row label="parent" value={goal.parentId ?? '— root'} />
        <Row label="intent" value={goal.intent} />
        <Row label="received" value={clock(node.startedAt)} />
        <Row label={node.endedAt ? 'took' : 'running'} value={node.endedAt ? duration(node.endedAt - node.startedAt) : '…'} />
        <Row label="spend" value={usd(usage?.costUsd)} strong />
        <Row label="tokens" value={usage ? `${count(usage.promptTokens)} in · ${count(usage.completionTokens)} out` : '—'} />
        <Row label="tool calls" value={count(calls)} />
        <Row label="budget" value={`${goal.budget.attempts} att · ${count(goal.budget.tokens)} tok · ${goal.budget.toolCalls} calls`} />
      </dl>

      <p className="annot mt-4 mb-1.5">Scope</p>
      <ul className="flex flex-wrap gap-1.5">
        {goal.scope.length === 0 ? <li className="font-mono text-[10.5px] text-line-soft">— none declared</li> : null}
        {goal.scope.map((s) => (
          <li key={s} className="rounded-chit border border-line/40 bg-line/15 px-1.5 py-0.5 font-mono text-[10px] text-paper-2">
            {s}
          </li>
        ))}
      </ul>

      <div className="ruleline my-4" />
      <p className="annot mb-2">This goal's events · {own.length}</p>
      <Trace events={own} caughtUpAt={caughtUpAt} showGoal={false} maxHeight={320} />
    </Panel>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className="uppercase tracking-[0.1em] text-line-soft">{label}</dt>
      <dd className={`min-w-0 break-words ${strong ? 'text-brass-bright' : 'text-paper-2'}`}>{value}</dd>
    </>
  );
}

function find(n: GoalTreeNode, id: string): GoalTreeNode | undefined {
  if (n.goalId === id) return n;
  for (const c of n.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
}
