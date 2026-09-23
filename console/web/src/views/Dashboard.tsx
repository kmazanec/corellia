/**
 * Every job the log knows about, most recently active first, with the
 * floor's totals above it. Live: the list patches itself from the control
 * plane's summary stream.
 */

import { useNavigate } from '@tanstack/react-router';
import { Cell, Column, Row, Table, TableBody, TableHeader } from 'react-aria-components';

import { useJobs } from '../api/live';
import { Figures, Panel } from '../components/Frame';
import { LinkMark } from '../components/LinkMark';
import { StateMark } from '../components/StateMark';
import type { JobSummary } from '../factory';
import { ago, count, usd } from '../lib/format';
import { useNow } from '../lib/use-now';

export function Dashboard() {
  const { jobs, error, link } = useJobs();
  const now = useNow(5_000);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-crest text-[22px] font-semibold tracking-[0.12em] text-paper">Jobs</h1>
          <p className="mt-1 max-w-[70ch] font-prose text-[15px] italic text-paper-2">
            Every goal tree in the event log. A job is one root goal and everything it spawned.
          </p>
        </div>
        <LinkMark state={link} />
      </div>

      <Tally jobs={jobs ?? []} />

      <Panel title="Ledger" aside={<span className="annot">{jobs ? `${jobs.length} jobs` : '…'}</span>}>
        {error ? <p className="font-mono text-[12px] text-oxblood-bright">{error.message}</p> : null}
        {jobs && jobs.length === 0 ? <Empty /> : null}
        {jobs && jobs.length > 0 ? <Ledger jobs={jobs} now={now} /> : null}
      </Panel>
    </div>
  );
}

function Tally({ jobs }: { jobs: JobSummary[] }) {
  const by = (s: JobSummary['state']) => jobs.filter((j) => j.state === s).length;
  const spend = jobs.reduce((sum, j) => sum + (j.costUsd ?? 0), 0);
  return (
    <Figures
      items={[
        { label: 'Running', value: by('running'), tone: 'text-brass-bright' },
        { label: 'Awaiting operator', value: by('parked'), tone: 'text-teal-bright' },
        { label: 'Done', value: by('done'), tone: 'text-moss-pale' },
        { label: 'Failed · blocked', value: by('failed') + by('blocked'), tone: 'text-oxblood-bright' },
        { label: 'Spend, all jobs', value: usd(spend) },
      ]}
    />
  );
}

function Ledger({ jobs, now }: { jobs: JobSummary[]; now: number }) {
  const navigate = useNavigate();
  return (
    <div className="-mx-1 overflow-x-auto">
      <Table
        aria-label="Jobs"
        className="ledger min-w-[760px]"
        onRowAction={(key) => void navigate({ to: '/jobs/$jobId', params: { jobId: String(key) } })}
      >
        <TableHeader>
          <Column isRowHeader>Job</Column>
          <Column>State</Column>
          <Column className="num">Goals</Column>
          <Column className="num">Events</Column>
          <Column className="num">Spend</Column>
          <Column>Last activity</Column>
        </TableHeader>
        <TableBody items={jobs}>
          {(job) => (
            <Row id={job.jobId} data-state={job.state} data-href>
              <Cell>
                <span className="goal-title block text-[15px] text-paper">{job.title}</span>
                <span className="mt-0.5 block text-[10.5px] text-line-soft/80">
                  {job.goalType} · {job.jobId}
                </span>
              </Cell>
              <Cell>
                <StateMark state={job.state} />
              </Cell>
              <Cell className="num">{count(job.goalCount)}</Cell>
              <Cell className="num">{count(job.eventCount)}</Cell>
              <Cell className="num text-paper">{usd(job.costUsd)}</Cell>
              <Cell className="text-line-soft">{ago(job.lastEventAt, now)}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function Empty() {
  return (
    <div className="py-10 text-center">
      <p className="font-prose text-[16px] italic text-paper-2">The log is empty. No job has been received yet.</p>
      <p className="mt-2 font-mono text-[11px] text-line-soft">
        For a synthetic floor: <code className="text-brass">npm run console:simulate</code>
      </p>
    </div>
  );
}
