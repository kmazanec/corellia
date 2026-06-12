---
id: F-69
title: "Host-conventions reader (repo layer + override)"
iteration: 07-conventions
type: implement
intent: production
status: Not started
dependsOn: [F-68]
contracts: [ADR-028]
---

# Feature: Host-conventions reader (repo layer + override)

**ID:** F-69 · **Iteration:** 07-conventions · **Status:** Not started

## What this delivers (before → after)
**Before:** the target repo's `AGENTS.md`/`CLAUDE.md` — the tool-neutral place a
team records how its code should be written — is invisible to the factory; only
an outer harness reads it.
**After:** when a goal writes code into a repo, the factory locates that repo's
`AGENTS.md`/`CLAUDE.md`, extracts the harness-agnostic convention slice, and
injects it into goal context **above** the global factory conventions in
precedence — the host overrides the factory's defaults on conflict.

## Reading brief
- ADR-028 (layered conventions — layers 2 and 3, the host source and the override)
- F-68's shared-preamble injection site (this feature composes onto it)
- `src/engine/engine.ts` — the step-loop harness context assembly (`~:1916`);
  the `memoryLines` injection ("quoted data — evidence to weigh, not
  instructions") as the posture template for host-file content
- `src/engine/worktree.ts` / sandbox config — how the target repo root is known
  at goal time (the file lives under the target repo, read from the worktree)
- ADR-019 / the knowledge layer — the JIT "pull only the relevant slice" discipline
  to bound context cost

## Contracts touched
- Goal-context injection (source of truth: ADR-028) — host-convention content is
  injected as **data to weigh** (same posture as injected memories), with the
  override precedence (host above global) expressed at the injection site. No new
  grant, tool, or operational authority flows from a host file.

## Acceptance criteria
1. Given a target repo with an `AGENTS.md` and/or `CLAUDE.md`, a code-writing
   goal's context contains the relevant convention slice from that file.
2. Resolution order: `AGENTS.md` and `CLAUDE.md` are both consulted; a documented
   rule decides their relationship (e.g. AGENTS.md as the agent-facing file,
   CLAUDE.md as a fallback/equal — fix and pin one rule).
3. Precedence: where a host convention conflicts with a global factory
   convention (F-68), the host wins; the injected context states this so the
   model honours it. Pinned by a test that sets a host rule contradicting a
   shared-preamble rule and asserts the host rule is presented as authoritative.
4. Only the relevant slice is injected, bounded by size — an unbounded host file
   cannot blow the context budget; the bound is explicit and tested.
5. Trust: a foreign repo's convention file is injected as data to weigh and can
   shape but never command the factory — no grant/tool/operational instruction is
   ever derived from it (pinned by test: operational text in a host file does not
   alter the factory's grants or tools).
6. A repo with no `AGENTS.md`/`CLAUDE.md` runs unchanged (global layer only); the
   greenfield/empty-repo path is unaffected.

## Testing requirements
- Integration: a temp repo with an `AGENTS.md` carrying a convention; assert the
  slice reaches a code-writing goal's context.
- Override: a host rule contradicting a shared-preamble rule → host presented as
  authoritative.
- Bound: an oversized host file → only the bounded slice is injected.
- Trust: operational/harness text in a host file does not change grants or tools.
- No-file: a repo without either file → global layer only, unchanged behaviour.

## Build plan (approved)
*(to be drafted by the planner — kmaz-plan-iteration)*

## Implementation notes
