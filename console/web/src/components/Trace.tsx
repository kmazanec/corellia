/**
 * The live trace: every event as a ruled mono line, newest at the bottom.
 * It follows new events while the reader is at the bottom and stays put when
 * they have scrolled up to read.
 */

import { useLayoutEffect, useRef } from 'react';

import type { StoredEvent } from '../api/live';
import { describeEvent } from '../lib/describe-event';
import { clock } from '../lib/format';

const SHOWN = 600;

export function Trace({ events, caughtUpAt, showGoal, maxHeight = 460 }: { events: StoredEvent[]; caughtUpAt: number; showGoal: boolean; maxHeight?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const shown = events.length > SHOWN ? events.slice(-SHOWN) : events;

  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  if (events.length === 0) return <p className="font-prose text-[13px] italic text-line-soft">No events yet.</p>;

  return (
    <div
      ref={box}
      className="flex flex-col gap-1.5 overflow-y-auto pr-1"
      style={{ maxHeight }}
      role="log"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {events.length > SHOWN ? (
        <p className="annot pb-1">{events.length - SHOWN} earlier events not shown</p>
      ) : null}
      {shown.map(({ seq, event }) => {
        const d = describeEvent(event);
        return (
          <div key={seq} className={`trace-line ${seq > caughtUpAt ? 'fresh' : ''}`} data-tone={d.tone}>
            <span className="t-time">{clock(event.at)}</span>
            <span className="t-text">
              <span className="t-kind">{d.kind}</span>
              {showGoal ? <span className="mr-2 text-line-soft/70">{event.goalId}</span> : null}
              {d.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
