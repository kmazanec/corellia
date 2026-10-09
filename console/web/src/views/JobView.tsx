/**
 * One job, live: its goal tree on a plate, the trace beneath it, and the
 * inspector for whichever goal is selected (`?goal=` in the URL, so a
 * selection can be linked).
 */

import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button, Form, Label, TextArea, TextField, ToggleButton } from 'react-aria-components';

import { useAnswer, useCancel } from '../api/commands';
import { useJobEvents, type StoredEvent } from '../api/live';
import { Figures, Panel, Plate } from '../components/Frame';
import { GoalTree } from '../components/GoalTree';
import { LinkMark } from '../components/LinkMark';
import { StateMark } from '../components/StateMark';
import { Trace } from '../components/Trace';
import { costSummary, type FactoryEvent, type GoalTreeNode, type Job } from '../factory';
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
  const eventBrief = useMemo(() => latestBrief(live.events, live.tree), [live.events, live.tree]);

  const select = (goalId: string | undefined) =>
    void navigate({ to: '/jobs/$jobId', params: { jobId }, search: goalId ? { goal: goalId } : {}, replace: true });

  const { tree, job } = live;
  const status = job?.status ?? tree?.state;
  if (!status) {
    return (
      <div className="flex flex-col gap-4">
        <Crumbs jobId={jobId} />
        <p className="font-prose italic text-paper-2">{live.missing ? `No job ${jobId} in the log or the queue.` : 'Reading the log…'}</p>
      </div>
    );
  }

  const title = tree?.title ?? job?.title ?? jobId;
  const startedAt = tree?.startedAt ?? job?.startedAt ?? now;
  const endedAt = tree?.endedAt ?? job?.endedAt ?? null;
  const elapsed = (endedAt ?? now) - startedAt;
  const brief = job?.queue?.brief ?? eventBrief;

  const trace = onlySelected && goal ? live.events.filter((s) => s.event.goalId === goal) : live.events;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Crumbs jobId={jobId} />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="goal-title text-[clamp(20px,2.4vw,28px)] text-paper">{title}</h1>
          <LinkMark state={live.link} />
        </div>
      </div>

      <Figures
        items={[
          { label: 'State', value: <StateMark state={status} /> },
          { label: 'Worker', value: <span className="text-[12.5px]">{job?.queue ? (job.queue.workerId ?? job.queue.affinityWorkerId ?? '—') : 'local run'}</span> },
          { label: 'Goals', value: tree ? count(countGoals(tree)) : '—' },
          { label: 'Events', value: count(live.events.length) },
          { label: 'Spend', value: usd(live.costUsd) },
          { label: endedAt ? 'Took' : 'Elapsed', value: duration(elapsed) },
        ]}
      />

      <QueueNotice jobId={jobId} job={job} status={status} brief={brief} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Plate title="Goal tree" number={`Job · ${jobId}`} caption="Each form is a goal: ( type ⟨title⟩ ⇒ result ). Select one to inspect it.">
            {tree ? (
              <GoalTree root={tree} spendByGoal={spendByGoal} selected={goal} onSelect={select} />
            ) : (
              <p className="py-6 text-center font-prose text-[15px] italic text-ink-soft">
                {status === 'queued' ? 'No goal received yet. The tree grows here once a worker takes the job.' : 'This job never started a tree.'}
              </p>
            )}
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
          {tree ? <Inspector jobId={jobId} goalId={goal} tree={tree} events={live.events} caughtUpAt={live.caughtUpAt} /> : null}
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

type Brief = { question: string; options: string[] };

/**
 * What the operator can do or needs to know about the job's place in the
 * queue: answer a park, cancel a queued job, see an answer waiting to resume,
 * or read why a job stopped.
 */
function QueueNotice({ jobId, job, status, brief }: { jobId: string; job: Job | undefined; status: string; brief: Brief | null }) {
  const q = job?.queue;
  if (status === 'parked' && brief) {
    return (
      <Notice tone="teal" label="Awaiting operator">
        <p className="mt-1.5 font-prose text-[17px] text-paper">{brief.question}</p>
        {q ? (
          <AnswerForm jobId={jobId} options={brief.options} />
        ) : (
          <p className="mt-3 font-prose text-[13px] italic text-line-soft">
            This run came from the single-process daemon, not the queue. Answer it through the daemon's front door:{' '}
            <code className="font-mono not-italic text-paper-2">POST /intents/:id/answer</code>.
          </p>
        )}
      </Notice>
    );
  }
  if (status === 'queued' && q?.answer) {
    return (
      <Notice tone="teal" label="Answer sent">
        <p className="mt-1.5 font-prose text-[15px] text-paper-2">
          “{q.answer}” — resumes on <span className="font-mono text-[12.5px] text-teal-bright">{q.affinityWorkerId ?? 'the next free worker'}</span>, which holds its worktree, as soon as it is free.
        </p>
      </Notice>
    );
  }
  if (status === 'queued' && q) return <QueuedNotice jobId={jobId} repo={q.repo} />;
  if (q?.detail && (status === 'failed' || status === 'blocked' || status === 'interrupted' || status === 'cancelled')) {
    return (
      <Notice tone={status === 'cancelled' ? 'line' : 'oxblood'} label={status}>
        <p className="mt-1.5 font-prose text-[15px] text-paper-2">{q.detail}</p>
      </Notice>
    );
  }
  return null;
}

const TONES = {
  teal: { box: 'border-teal/70 bg-teal/10', label: '!text-teal-bright' },
  oxblood: { box: 'border-oxblood/70 bg-oxblood/10', label: '!text-oxblood-bright' },
  line: { box: 'border-line/50 bg-ground-2/60', label: '' },
} as const;

function Notice({ tone, label, children }: { tone: keyof typeof TONES; label: string; children: React.ReactNode }) {
  return (
    <div className={`border px-5 py-4 ${TONES[tone].box}`} role="status">
      <p className={`annot ${TONES[tone].label}`}>{label}</p>
      {children}
    </div>
  );
}

function AnswerForm({ jobId, options }: { jobId: string; options: string[] }) {
  const [text, setText] = useState('');
  const answer = useAnswer(jobId);
  return (
    <Form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) answer.mutate(text.trim());
      }}
    >
      {options.length ? (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <Button
              key={o}
              onPress={() => setText(o)}
              className={`border px-2.5 py-1 font-mono text-[11.5px] outline-none transition-colors data-[focus-visible]:outline-1 data-[focus-visible]:outline-teal-bright ${
                text === o ? 'border-teal-bright bg-teal/25 text-paper' : 'border-teal/50 text-teal-bright data-[hovered]:bg-teal/15'
              }`}
            >
              {o}
            </Button>
          ))}
        </div>
      ) : null}
      <TextField value={text} onChange={setText} aria-label="Answer">
        <Label className="annot mb-1.5 block">Answer</Label>
        <TextArea
          rows={2}
          className="w-full border border-teal/50 bg-ground/60 px-3 py-2 font-prose text-[15px] text-paper outline-none placeholder:text-line-soft/60 data-[focused]:border-teal-bright"
          placeholder="Pick an option above or write your own."
        />
      </TextField>
      {answer.error ? <p className="font-mono text-[12px] text-oxblood-bright" role="alert">{answer.error.message}</p> : null}
      <Button type="submit" className="btn primary self-start" isDisabled={!text.trim() || answer.isPending}>
        {answer.isPending ? 'Sending…' : 'Send answer'}
      </Button>
    </Form>
  );
}

function QueuedNotice({ jobId, repo }: { jobId: string; repo: string }) {
  const cancel = useCancel(jobId);
  return (
    <Notice tone="line" label="Queued">
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
        <p className="font-prose text-[15px] text-paper-2">
          Waiting for a free worker serving <span className="font-mono text-[12.5px] text-paper">{repo}</span>.
        </p>
        <Button className="btn" onPress={() => cancel.mutate()} isDisabled={cancel.isPending}>
          {cancel.isPending ? 'Cancelling…' : 'Cancel job'}
        </Button>
      </div>
      {cancel.error ? <p className="mt-2 font-mono text-[12px] text-oxblood-bright" role="alert">{cancel.error.message}</p> : null}
    </Notice>
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
