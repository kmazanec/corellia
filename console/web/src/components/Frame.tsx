import type { ReactNode } from 'react';

/** A paper plate with a drafting grid and corner ticks. */
export function Plate({ title, number, caption, children }: { title: string; number?: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <section className="plate">
      <i className="tick tl" aria-hidden />
      <i className="tick tr" aria-hidden />
      <i className="tick bl" aria-hidden />
      <i className="tick br" aria-hidden />
      <header className="mb-1.5 flex items-baseline justify-between gap-4 border-b border-line-soft pb-2">
        <h2 className="font-crest text-[15px] font-semibold tracking-[0.1em] text-ink">{title}</h2>
        {number ? <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">{number}</span> : null}
      </header>
      {caption ? <p className="mb-3.5 font-mono text-[10.5px] leading-snug tracking-[0.04em] text-ink-soft">{caption}</p> : null}
      {children}
    </section>
  );
}

/** A dark instrument panel with a brass Cinzel title. */
export function Panel({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="panel-title">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** A horizontal strip of ruled figures: the plate's revision block, turned sideways. */
export function Figures({ items }: { items: { label: string; value: ReactNode; tone?: string }[] }) {
  return (
    <dl className="flex flex-wrap border border-line/50 bg-ground-2/60">
      {items.map((it) => (
        <div key={it.label} className="min-w-[110px] flex-1 border-r border-line/30 px-4 py-2.5 last:border-r-0">
          <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-line-soft">{it.label}</dt>
          <dd className={`mt-0.5 font-mono text-[15px] tabular-nums ${it.tone ?? 'text-paper'}`}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
