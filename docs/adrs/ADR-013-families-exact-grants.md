# ADR-013: Families with exact static grants (kinds as lint ceilings)

**Status:** Accepted · **Date:** 2026-06-10 (decided during GOAL-TYPES design session; recorded retroactively) · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

The goal-type library needed a grant model. The assistant initially proposed
ceiling-and-narrow (each *kind* defines a tool ceiling; types narrow at
runtime); the operator pushed back — "I lean toward exact grant per type…
sell it to me, or think through yet another alternative" — and a synthesis
was reached.

## Options considered

- **Families with exact static grants, kinds as lint-time ceilings** — chosen
  (the synthesis).
- Ceiling-and-narrow (kind ceiling, runtime narrowing) — rejected: "read a
  type and know its blast radius" fails if the real grant is computed at
  runtime.
- Pure exact grants with no kind structure — rejected: loses the cheap
  lint-time invariant ("no learn-kind type may write product files") that
  kinds provide.

## Decision

Every goal-type declares its **exact** tool grant, statically, in its
definition — what you read is what it gets. The four kinds (make / learn /
judge / evolve) act as **lint-time ceilings**: the constitution lint rejects
any type whose grant exceeds its kind's ceiling. Scope is the only runtime
narrowing (which files, never which tools). Families share contract skeletons
and skills through factory code — never through memory.

## Rationale

Static grants make the blast radius a read-time property — auditable by
grep, enforceable by lint, reviewable in a PR diff. The kind ceiling keeps
the per-type freedom from eroding the class invariants. This is
"the contract is the capability" in its strongest enforceable form.

## Tradeoffs & risks

- More declaration verbosity: 19 types each spell out grants a ceiling would
  have implied. Accepted — the verbosity *is* the audit surface.
- A type needing a one-off extra tool requires a type change (PR), not a
  runtime exception. That friction is the feature.

## Consequences for the build

- **Source of truth:** GOAL-TYPES.md (the rule and the library),
  `src/library/starter-types.ts` (definitions),
  `src/library/constitution.ts` (ceiling lints).
- Iteration 3's tool broker must enforce these grants at runtime exactly as
  declared — the broker reads the type definition, no side channel.
