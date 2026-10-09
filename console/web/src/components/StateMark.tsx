import type { GoalState, JobStatus } from '../factory';

const MARK: Record<JobStatus | GoalState, { glyph: string; label: string; className: string }> = {
  queued: { glyph: '◇', label: 'queued', className: 'text-paper-2' },
  running: { glyph: '◌', label: 'running', className: 'text-brass-bright [&>span:first-child]:animate-flick' },
  parked: { glyph: '◈', label: 'awaiting operator', className: 'text-teal-bright' },
  done: { glyph: '✓', label: 'done', className: 'text-moss-pale' },
  failed: { glyph: '✗', label: 'failed', className: 'text-oxblood-bright' },
  blocked: { glyph: '✗', label: 'blocked', className: 'text-oxblood-bright' },
  interrupted: { glyph: '⊘', label: 'interrupted', className: 'text-brass' },
  cancelled: { glyph: '—', label: 'cancelled', className: 'text-line-soft' },
};

/** A job or goal state as glyph + mono label, in the Plate legend's colours. */
export function StateMark({ state, bare = false }: { state: JobStatus | GoalState; bare?: boolean }) {
  const m = MARK[state];
  return (
    <span className={`inline-flex items-baseline gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] ${m.className}`}>
      <span aria-hidden>{m.glyph}</span>
      {bare ? <span className="sr-only">{m.label}</span> : <span>{m.label}</span>}
    </span>
  );
}
