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
