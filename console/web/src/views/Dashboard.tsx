/**
 * The floor: every job the log and the queue know about, most recently active
 * first, with the totals above and the fleet beside. Live: the list and the
 * fleet patch themselves from the control plane's summary stream.
 */

import { useNavigate } from '@tanstack/react-router';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import { useFloor } from '../api/live';
import { CommissionDialog } from '../components/CommissionDialog';
import { Figures, Panel } from '../components/Frame';
import { LinkMark } from '../components/LinkMark';
import { StateMark } from '../components/StateMark';
import type { Fleet, Job } from '../factory';
import { ago, count, usd } from '../lib/format';
import { useNow } from '../lib/use-now';

export function Dashboard() {
  const { jobs, fleet, error, link } = useFloor();
  const now = useNow(5_000);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-crest text-[22px] font-semibold tracking-[0.12em] text-paper">Jobs</h1>
          <p className="mt-1 max-w-[70ch] font-prose text-[15px] italic text-paper-2">
            Every goal tree in the event log and every commission in the queue. A job is one root goal and everything it spawned.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <LinkMark state={link} />
          <CommissionDialog fleet={fleet} />
        </div>
      </div>

      <Tally jobs={jobs ?? []} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Ledger" aside={<span className="annot">{jobs ? `${jobs.length} jobs` : '…'}</span>}>
          {error ? <p className="font-mono text-[12px] text-oxblood-bright">{error.message}</p> : null}
          {jobs && jobs.length === 0 ? <Empty /> : null}
          {jobs && jobs.length > 0 ? <Ledger jobs={jobs} now={now} /> : null}
        </Panel>
        <FleetPanel fleet={fleet} now={now} />
      </div>
    </div>
  );
}

function Tally({ jobs }: { jobs: Job[] }) {
  const by = (...s: Job['status'][]) => jobs.filter((j) => s.includes(j.status)).length;
  const spend = jobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0);
  return (
    <Figures
      items={[
        { label: 'Queued', value: by('queued'), tone: 'text-paper-2' },
        { label: 'Running', value: by('running'), tone: 'text-brass-bright' },
        { label: 'Awaiting operator', value: by('parked'), tone: 'text-teal-bright' },
        { label: 'Done', value: by('done'), tone: 'text-moss-pale' },
        { label: 'Failed · blocked', value: by('failed', 'blocked', 'interrupted'), tone: 'text-oxblood-bright' },
        { label: 'Spend, all jobs', value: usd(spend) },
      ]}
    />
  );
}

function Ledger({ jobs, now }: { jobs: Job[]; now: number }) {
  const navigate = useNavigate();
  return (
    <div className="-mx-1 overflow-x-auto">
      <Table
        aria-label="Jobs"
        className="ledger min-w-[820px]"
        onRowAction={(key) => void navigate({ to: '/jobs/$jobId', params: { jobId: String(key) } })}
      >
        <TableHeader>
          <Column isRowHeader>Job</Column>
          <Column>State</Column>
          <Column>Worker</Column>
          <Column className="num">Goals</Column>
          <Column className="num">Spend</Column>
          <Column>Last activity</Column>
        </TableHeader>
        <TableBody items={jobs}>
          {(job) => (
            <Row id={job.jobId} data-state={job.status} data-href>
              <Cell>
                <span className="goal-title block text-[15px] text-paper">{job.title}</span>
                <span className="mt-0.5 block text-[10.5px] text-line-soft/80">
                  {job.queue ? `${job.queue.repo} · ` : ''}
                  {job.jobId}
                </span>
              </Cell>
              <Cell>
                <StateMark state={job.status} />
              </Cell>
              <Cell className="text-line-soft">{workerLabel(job)}</Cell>
              <Cell className="num">{job.goalCount ? count(job.goalCount) : '—'}</Cell>
              <Cell className="num text-paper">{usd(job.costUsd)}</Cell>
              <Cell className="text-line-soft">{ago(job.lastEventAt, now)}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function workerLabel(job: Job): string {
  const q = job.queue;
  if (!q) return 'local run';
  if (job.status === 'running') return q.workerId ?? '—';
  if (job.status === 'parked' || (job.status === 'queued' && q.affinityWorkerId)) return `held by ${q.affinityWorkerId ?? q.workerId}`;
  if (job.status === 'queued') return 'waiting';
  return q.workerId ?? '—';
}

function FleetPanel({ fleet, now }: { fleet: Fleet | undefined; now: number }) {
  const workers = fleet?.workers ?? [];
  return (
    <Panel title="Fleet" aside={<span className="annot">{`${workers.filter((w) => w.alive).length}/${workers.length} alive`}</span>}>
      {workers.length === 0 ? (
        <p className="font-prose text-[14px] italic text-line-soft">
          No worker has registered. Each runs one job at a time:{' '}
          <code className="font-mono text-[11.5px] not-italic text-brass">npm run worker</code>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {workers.map((w) => (
            <li key={w.id} className={`border-l-2 py-1 pl-3 ${w.alive ? (w.currentJobId ? 'border-brass' : 'border-moss') : 'border-line/40 opacity-60'}`}>
              <div className="flex items-baseline justify-between gap-3 font-mono text-[11.5px]">
                <span className="truncate text-paper">{w.id}</span>
                <span className={w.alive ? (w.currentJobId ? 'text-brass-bright' : 'text-moss-pale') : 'text-line-soft'}>
                  {w.alive ? (w.currentJobId ? 'busy' : 'idle') : 'silent'}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-line-soft">
                {w.repos.join(', ')} · seen {ago(w.lastSeenAt, now)}
              </div>
              {w.currentJobId ? <div className="mt-0.5 truncate font-mono text-[10px] text-paper-2">⇒ {w.currentJobId}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Empty() {
  return (
    <div className="py-10 text-center">
      <p className="font-prose text-[16px] italic text-paper-2">Nothing yet. Commission a job, or point the console at a log.</p>
      <p className="mt-2 font-mono text-[11px] text-line-soft">
        For a synthetic floor: <code className="text-brass">npm run console:simulate</code>
      </p>
    </div>
  );
}
