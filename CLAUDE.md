# For an outer coding harness (Claude Code, etc.) — read this first

**Corellia is a self-contained autonomous coding factory.** It is built to run on
its own in the cloud, as its own process, controlled by no outer harness. If you
are an outer harness (Claude Code, Codex, Cursor, …) editing this repo during
development, that is fine — but **do not let the factory come to depend on you, or
on this file, or on any harness-specific convention.** In production there is no
Claude Code, no `CLAUDE.md` reader, no human in the loop per step. Anything the
factory needs to know must live in the factory's *own* mechanisms, not here.

This file (and `AGENTS.md`) exist **only to redirect you** to those native
mechanisms. They carry no operative instructions of their own.

## Corellia's own config / memory / skills / harness — use these, not a harness's

- **Design & intent (the "config"):** `DESIGN.md`, `GOAL-TYPES.md`, `docs/PRD.md`,
  and the ADRs in `docs/adrs/`. The machine-enforced rules live in
  `src/library/constitution.ts` (the constitution lint), not in prose here.
- **Memory:** the factory has no memory *files*. Project memory is the event log
  (`src/eventlog/`) and verify-on-read knowledge artifacts (ADR-019;
  `src/contract/memory.ts`, `src/contract/knowledge.ts`). Durable findings go
  into the event log / knowledge artifacts or into the repo's docs — never into
  an outer harness's memory.
- **Skills:** the factory's skills are its own per-family skill files in
  `src/library/skills/*.md`, loaded at runtime by the engine. Edit those, not a
  harness skill store.
- **Harness / entrypoint:** the factory's front door is the daemon
  (`src/daemon/daemon.ts`) plus the `live:*` scripts in `package.json`. That is
  the only harness it has or needs. See `README.md`.

## The one rule

Everything that must persist about this repo lives **in this repo** — in the docs
above, in code, in commit messages, in the event log. Never in an outer harness's
config or memory. Record durable findings where the factory itself can read them.

## Bootstrap phase — while the factory is still being built (read if you are a harness)

Corellia is being built *by* sessions like yours. Until it can fully build
itself, the factory legitimately leans on the harness when it stalls — and that
leaning is itself the signal for what to build next. This is bootstrap-only and
does not contradict "production depends on no harness" above; it is how we *reach*
that state. The loop, when Keith hands you a goal:

1. **Prefer the factory.** Where it's the right path, commission the goal through
   Corellia's own front door (`npm run live:self`, env-driven — see
   `examples/live-self.ts` for the strange-loop hygiene rules) rather than
   building it ad hoc. Reason in the factory's terms throughout: `GOAL-TYPES.md`,
   the constitution (`src/library/constitution.ts`), and verify-on-read
   discipline govern *how* you work whether the factory or you are driving.
2. **When the factory stalls, record the stuck point first.** Before hand-building,
   write down *where* and *why* it stuck into the factory's own durable memory —
   the current iteration's `index.md` under `docs/iterations/<YYYY-MM-DD-HH-slug>/`
   (and a one-line entry in `docs/log.md` when it changes the iteration picture; a
   new `docs/issues/<slug>.md` when it is unplanned follow-on work; an ADR when it's
   a design decision; the event log for run-level facts). The stuck point is now
   tracked factory work, not lost context. This is the whole point: hand-building
   is the diagnostic.
3. **Then hand-build the stuck part the Corellia way** — directly on `main` (this
   is interactive build/cleanup work; the primary checkout stays on `main` and
   undisturbed, per the strange-loop hygiene in `examples/live-self.ts`).
   Build it as the factory would have: constitution-compliant, verify-on-read,
   so the artifact is the kind of output the factory itself would produce.
4. **Re-prove through the factory** where feasible, closing the loop (as iteration
   08 did: ADR-029 hand-built on main, then proven via `live:self`).

This section is a redirect, like the rest of this file: the *practice* lives in
the recorded build notes and STATUS, not here. Delete this section once the
factory builds itself without a harness in the loop.

## Code conventions

Cross-cutting code conventions live in `src/library/skills/_shared.md`, read by
the factory at runtime and injected into every code-writing goal's context. Outer
coding agents should read that file before editing code here and treat it as the
source of truth for code shape: small domain-named modules, orchestration as a
table of contents, focused tests at ownership boundaries, and code-shape evidence
from `npm run code-shape -- <scope...>` when touching broad or pressured areas.
