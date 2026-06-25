# Commissions — reviewed human→factory artifacts

A **commission** is the artifact a human produces to hand Corellia an intent. It is
the typed input the factory's front door (`listener.commission()`) consumes — see
`CommissionInput` in `src/contract/brief.ts:23` (frozen by ADR-026).

This directory holds those artifacts, one `.ts` file per commission. They are
produced by the **`commission` skill** (`.claude/skills/commission/`) — the
interactive front door — and they are **reviewed before they run**. Producing the
artifact and running it are deliberately decoupled: the skill plans, a human
reviews, and a separate explicit step builds.

## The artifact shape

Each file `export default`s a `CommissionDoc`:

```ts
import type { CommissionInput } from '../src/contract/brief.js';

export interface CommissionDoc {
  /** The frozen front-door input the factory consumes. */
  commission: CommissionInput;
  /**
   * Per-tree dollar ceiling (the PRIMARY budget bound). NOTE: the listener mints
   * the root goal without a ceiling today, so a commission run through the real
   * front door uses the engine default ($15, DEFAULT_SPEND_CEILING_USD). Record
   * the intended ceiling here for review; the runner warns if it differs from the
   * effective default. A per-commission ceiling override is a separate
   * engine/listener feature (not yet built).
   */
  ceilingUsd: number;
  /** Repo root for the declared-scripts capability check, if used. */
  repoRoot?: string;
  /** One-line human note on intent/why — for the review gate, not consumed by the factory. */
  note?: string;
}
```

## Template

```ts
// commissions/<id>.ts
import type { CommissionDoc } from './README.js'; // (type only; see the interface above)

const doc = {
  commission: {
    id: '<kebab-id>',                 // doubles as the filename stem
    title: '<human one-liner>',
    spec: {
      description: '<what should exist when done — behavior, not implementation>',
      // scope: [...],                // optional; usually duplicates commission.scope
      constraints: [
        // hard rules: 'open a PR when done', 'must not touch X', test-first, ...
      ],
    },
    scope: ['<path/prefix/>'],         // path prefixes this intent OWNS (tight!)
    budget: {
      attempts: 3,
      tokens: 200_000,
      toolCalls: 200,
      wallClockMs: 600_000,
    },
    intent: 'production',              // 'production' | 'spike' | 'characterization'
  },
  ceilingUsd: 5,
  note: '<why this commission exists>',
} satisfies import('./README.js').CommissionDoc;

export default doc;
```

## Running a commission (the separate, explicit step)

```bash
npm run commission:run -- <id>      # loads commissions/<id>.ts → listener.commission()
```

This is a **live LLM run with real cost.** Review the artifact first. The runner
prints the goal tree, blockers, and a cost summary, and writes events under
`out/commission-<id>/`.

## Conventions

- `id` is kebab-case and matches the filename stem (`commissions/<id>.ts`).
- **Scope tightly.** Scope is an admission lock (overlapping intents queue) and a
  blast-radius bound — never widen to the whole repo "to be safe".
- The `spec` for `deliver-intent` uses the proven `{ description, scope?,
  constraints? }` convention. Do **not** invent other `spec` fields.
- Acceptance criteria live as prose in `description`/`constraints` for now;
  structured acceptance-criteria-in-spec is the milestone-loop bridge
  (ADR-031/032, `docs/iterations/2026-06-24-03-milestone-loop/spec.md`), added when
  the engine grows the `iterative` trait.
