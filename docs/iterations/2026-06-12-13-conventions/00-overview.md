# Iteration 07 — Layered conventions: the factory honours how each repo wants its code

**Status:** Draft (brief) · **Iteration slug:** `07-conventions`

## Why

The factory writes code into repos — its own and foreign — but cannot yet honour
either kind of convention that governs how that code should read. Global factory
taste lives only in per-family skills with no shared slot; repo-specific
conventions live in the host repo's `AGENTS.md`/`CLAUDE.md`, which the factory
never reads. A convention recorded in `CLAUDE.md` is, today, invisible to the
factory that is meant to follow it.

ADR-028 settles the model: a three-layer resolution, lowest precedence first —

1. **Global factory conventions** — the skills, plus a new shared preamble every
   code-writing family inherits (advisory; the machine-enforced subset stays in
   the constitution lint).
2. **Host repo conventions** — the target repo's `AGENTS.md`/`CLAUDE.md`, read by
   the factory-as-harness and injected as the relevant convention slice.
3. **Override** — on conflict, the host wins. The repo being edited is the
   authority on how its own code should read.

## Done when

A goal that writes code into a repo has, in its context, the factory's global
conventions AND the relevant slice of that repo's `AGENTS.md`/`CLAUDE.md`, with
the host-overrides-global precedence stated; "comments are timeless" lives in the
shared factory preamble (read by the factory at runtime), no longer only in the
outer-harness redirect file; and a foreign repo's convention file shapes the
factory's output without ever commanding it (data, not instructions).

## Features

| ID | Feature | Spec | Delivers |
|----|---------|------|----------|
| F-68 | Shared skill preamble (global layer) | [01](01-shared-preamble.md) | A `_shared` skill slot every code-writing family inherits; "comments are timeless" moves into it |
| F-69 | Host-conventions reader (repo layer + override) | [02](02-host-conventions.md) | Locate/parse/slice the target repo's `AGENTS.md`/`CLAUDE.md`; inject the relevant convention slice into goal context with host-overrides-global precedence |

Build order: F-68 first (the global layer + injection slot it shares with F-69),
then F-69 (the host layer + override, which composes onto F-68's injection site).

## Source of truth

ADR-028 (layered conventions). The injection posture follows the existing rule
that injected context is **data to weigh, not instructions to obey** — the
override rule makes precedence explicit without granting a host file any
operational authority.

## Sibling candidate for this iteration (not yet scoped in)

A second structural thread surfaced from the same self-hosting work and is
recorded in `docs/prototype-build-notes.md` (the AC-2 eyes-on-cats result):
**comprehension must recurse** — `map-repo`/`deep-dive-region` are wrongly
`leafOnly`, so comprehension cannot split and exhausts on real repos. It is an
independent structural fix, not part of the conventions model. Whether it rides
in iteration 07 alongside conventions, or becomes its own iteration, is an open
scope decision for the human before planning.
