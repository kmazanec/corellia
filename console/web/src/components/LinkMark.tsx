import type { LinkState } from '../api/sse';

const LABEL: Record<LinkState, string> = { live: 'live', connecting: 'linking', retrying: 'relinking' };

/** Whether a live stream is flowing. */
export function LinkMark({ state }: { state: LinkState }) {
  const tone = state === 'live' ? 'text-moss-pale' : 'text-brass-bright';
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${tone}`} role="status">
      <span aria-hidden className={state === 'live' ? '' : 'animate-flick'}>
        ●
      </span>{' '}
      {LABEL[state]}
    </span>
  );
}
