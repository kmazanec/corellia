---
type: adr
title: "ADR-028: Layered conventions — global skills, host AGENTS/CLAUDE files, repo override"
description: Code conventions reach a running goal in layers — global factory skills, the target repo's harness-agnostic AGENTS/CLAUDE files, then repo overrides.
tags: [adr, conventions, skills, agents-md, layering]
timestamp: 2026-06-12T13:59:00-05:00
---

# ADR-028: Layered conventions — global skills, host AGENTS/CLAUDE files, repo override

**Status:** Accepted · **Date:** 2026-06-12 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

The factory writes code into a target repo (its own, or a foreign one such as
cats). The code it writes must honour two kinds of convention:

- **Global factory conventions** — how the factory writes code regardless of
  which repo it is working on (e.g. "comments are timeless"; error-handling
  idioms; the constitution's hard ceilings). These are the factory's own taste.
- **Repo-specific, harness-agnostic conventions** — how *this particular repo*
  wants code written, independent of which agent is writing it. A repo's
  `AGENTS.md` / `CLAUDE.md` is the established, tool-neutral place teams already
  record this. cats may want one comment style; corellia another.

Today neither reaches a running goal correctly. Global conventions live only in
per-family skill files (`src/library/skills/<family>.md`), injected by
`loadFamilySkill` at the step loop — but there is no *shared* slot, so a
cross-cutting rule would have to be copied into every family. Repo-specific
conventions live in the host repo's `AGENTS.md` / `CLAUDE.md`, which **the
factory never reads** — those files are consumed only by an outer harness. The
factory's own `CLAUDE.md` is, today, a redirect for outer harnesses; the factory
working on itself cannot see it.

The consequence: a convention recorded in `CLAUDE.md` is invisible to the factory
that is supposed to follow it. "Comments are timeless" works right now only
because an outer harness happens to read it — not because the factory does.

## Options considered

- **Put every convention in skills** — rejected: conflates global factory taste
  with repo-specific wishes, and forces the factory to carry every target repo's
  preferences in its own library. A repo's conventions belong to the repo.
- **Put every convention in host `AGENTS.md`/`CLAUDE.md` only** — rejected: the
  factory's own cross-cutting taste (its constitution-adjacent conventions) is
  not repo-specific and must travel with the factory to every repo, including
  empty/greenfield ones with no such file.
- **Two sources with a precedence order** — chosen. The factory behaves like any
  competent coding harness: it carries its own conventions *and* reads the host
  repo's `AGENTS.md`/`CLAUDE.md`, with the host overriding on conflict.

## Decision

Conventions resolve in three layers, lowest precedence first:

1. **Global factory conventions — the skills (+ a shared preamble).** Add a
   shared skill slot (a `_shared` preamble / mixin) that every code-writing
   family inherits at runtime, so a cross-cutting rule is written once and
   injected into every relevant goal's context. `loadFamilySkill` prepends the
   shared preamble to the family preamble. The machine-enforced subset stays in
   the constitution lint (`src/library/constitution.ts`); the shared preamble is
   the *advisory* global layer.

2. **Host repo conventions — the target repo's `AGENTS.md` / `CLAUDE.md`.** When
   a goal runs against a repo, the factory locates that repo's `AGENTS.md` (and
   `CLAUDE.md`), extracts the **harness-agnostic** convention content, and
   injects the relevant slice into goal context — exactly as any coding harness
   already treats those files. The factory reads them as *data* (conventions to
   follow), never as instructions about the factory's own operation.

3. **Override.** Where a host convention conflicts with a global factory
   convention, **the host wins.** The repo being edited is the authority on how
   its own code should read; the factory's global taste is the default that a
   repo may override.

`AGENTS.md` / `CLAUDE.md` therefore do double duty, correctly: a redirect for any
outer harness (ADR-noted elsewhere — these files tell an outer harness not to
make the factory depend on it) *and* the repo-specific, harness-agnostic
convention source that the factory-as-harness consumes. corellia's own
`CLAUDE.md` thus becomes a real input when the factory builds corellia.

Injection respects the existing posture (ADR — memories are quoted as data, not
obeyed as instructions): host-file conventions are weighed, with the override
rule making their precedence explicit. Only the relevant slice is pulled — not
the whole file — so an unbounded host file cannot blow the context budget (the
same JIT discipline the comprehension layer uses).

## Tradeoffs & risks

- **Slice selection is a judgment call.** Pulling "the relevant slice" of a host
  `CLAUDE.md` is itself a retrieval problem; a crude pull injects noise, a narrow
  pull misses a rule. v1 may start coarse (inject the convention sections whole,
  bounded by size) and refine toward scoped selection.
- **Conflict detection is advisory, not mechanical.** The override rule is
  expressed in the injected context; the model honours it. A hard,
  constitution-style enforcement of host overrides is out of scope for v1.
- **Host files can carry outer-harness cruft.** A host `CLAUDE.md` may contain
  harness-operational text (not repo conventions). The reader must extract
  convention content and ignore operational redirects — imperfectly at first.
- **Trust.** A foreign repo's `AGENTS.md` is untrusted input; it is injected as
  data to weigh, and it can shape but never command the factory (no grant, no
  tool, no operational authority flows from it).

## Consequences for the build

- A shared skill preamble mechanism: a `_shared` slot and a `loadFamilySkill`
  change to prepend it; move cross-cutting conventions (starting with "comments
  are timeless") out of the outer-harness `CLAUDE.md` and into it.
- A host-conventions reader: locate + parse + slice the target repo's
  `AGENTS.md`/`CLAUDE.md` and inject the relevant convention slice into goal
  context, with the host-overrides-global precedence expressed at the injection
  site.
- Builds in iteration 07 (host-conventions). No contract barrier change beyond
  the skill-bundle shape and the goal-context injection seam.
