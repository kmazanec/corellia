/**
 * One job, live: its goal tree on a plate, the trace beneath it, and the
 * inspector for whichever goal is selected (`?goal=` in the URL, so a
 * selection can be linked).
 */

import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ToggleButton } from 'react-aria-components';

import { useJobEvents, type StoredEvent } from '../api/live';
import { Figures, Panel, Plate } from '../components/Frame';
import { GoalTree } from '../components/GoalTree';
import { LinkMark } from '../components/LinkMark';
import { StateMark } from '../components/StateMark';
import { Trace } from '../components/Trace';
import { costSummary, type FactoryEvent, type GoalTreeNode } from '../factory';
import { count, duration, usd } from '../lib/format';
import { useNow } from '../lib/use-now';
import { Inspector } from './Inspector';

export function JobView({ jobId, goal }: { jobId: string; goal: string | undefined }) {
  const live = useJobEvents(jobId);
  const navigate = useNavigate();
  const now = useNow(1_000);
  const [onlySelected, setOnlySelected] = useState(false);

  const spendByGoal = useMemo(() => {
    const by = costSummary(live.events.map((s) => s.event)).byGoal;
    return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.costUsd]));
  }, [live.events]);
  const parkedBrief = useMemo(() => latestBrief(live.events, live.tree), [live.events, live.tree]);

  const select = (goalId: string | undefined) =>
    void navigate({ to: '/jobs/$jobId', params: { jobId }, search: goalId ? { goal: goalId } : {}, replace: true });

  const { tree } = live;
  if (!tree) {
    return (
      <div className="flex flex-col gap-4">
        <Crumbs jobId={jobId} />
        <p className="font-prose italic text-paper-2">{live.link === 'live' ? `No job ${jobId} in the log.` : 'Reading the log…'}</p>
      </div>
    );
  }

  const trace = onlySelected && goal ? live.events.filter((s) => s.event.goalId === goal) : live.events;
  const elapsed = (tree.endedAt ?? now) - tree.startedAt;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Crumbs jobId={jobId} />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="goal-title text-[clamp(20px,2.4vw,28px)] text-paper">{tree.title}</h1>
          <LinkMark state={live.link} />
        </div>
      </div>

      <Figures
        items={[
          { label: 'State', value: <StateMark state={tree.state} /> },
          { label: 'Goals', value: count(countGoals(tree)) },
          { label: 'Events', value: count(live.events.length) },
          { label: 'Spend', value: usd(live.costUsd) },
          { label: tree.endedAt ? 'Took' : 'Elapsed', value: duration(elapsed) },
        ]}
      />

      {parkedBrief ? <ParkedNotice brief={parkedBrief} /> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Plate title="Goal tree" number={`Job · ${jobId}`} caption="Each form is a goal: ( type ⟨title⟩ ⇒ result ). Select one to inspect it.">
            <GoalTree root={tree} spendByGoal={spendByGoal} selected={goal} onSelect={select} />
          </Plate>
          <Panel
            title="Trace"
            aside={
              <ToggleButton
                isSelected={onlySelected}
                onChange={setOnlySelected}
                isDisabled={!goal}
                className="annot cursor-pointer outline-none data-[disabled]:cursor-default data-[disabled]:opacity-40 data-[selected]:text-brass-bright data-[focus-visible]:text-brass"
              >
                {onlySelected ? '◉' : '○'} selected goal only
              </ToggleButton>
            }
          >
            <Trace events={trace} caughtUpAt={live.caughtUpAt} showGoal={!(onlySelected && goal)} />
          </Panel>
        </div>
        <div className="lg:sticky lg:top-5">
          <Inspector jobId={jobId} goalId={goal} tree={tree} events={live.events} caughtUpAt={live.caughtUpAt} />
        </div>
      </div>
    </div>
  );
}

function Crumbs({ jobId }: { jobId: string }) {
  return (
    <nav className="annot" aria-label="Breadcrumb">
      <Link to="/" className="hover:text-brass-bright">
        Jobs
      </Link>
      <span className="mx-2 opacity-50">/</span>
      <span className="text-paper-2">{jobId}</span>
    </nav>
  );
}

type Brief = Extract<FactoryEvent, { type: 'parked' }>['brief'];

function ParkedNotice({ brief }: { brief: Brief }) {
  return (
    <div className="border border-teal/70 bg-teal/10 px-5 py-4" role="status">
      <p className="annot !text-teal-bright">Awaiting operator</p>
      <p className="mt-1.5 font-prose text-[17px] text-paper">{brief.question}</p>
      {brief.options.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {brief.options.map((o) => (
            <li key={o} className="border border-teal/50 px-2 py-0.5 font-mono text-[11px] text-teal-bright">
              {o}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 font-prose text-[13px] italic text-line-soft">
        Answering from the console arrives with the jobs table (ADR-051, phase 2). Until then, answer through the daemon's
        front door: <code className="font-mono not-italic text-paper-2">POST /intents/:id/answer</code>.
      </p>
    </div>
  );
}

/** The brief the job is parked on, if its root is parked. */
function latestBrief(events: StoredEvent[], tree: GoalTreeNode | null): Brief | null {
  if (tree?.state !== 'parked') return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!.event;
    if (e.type === 'parked') return e.brief;
  }
  return null;
}

function countGoals(n: GoalTreeNode): number {
  return 1 + n.children.reduce((s, c) => s + countGoals(c), 0);
}
