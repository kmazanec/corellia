# For an outer coding agent (Codex, etc.) — read this first

**Corellia is a self-contained autonomous coding factory.** It runs on its own in
the cloud, controlled by no outer harness. If you are an outer agent (Codex,
Claude Code, Cursor, …) editing this repo during development, do not let the
factory come to depend on you or on any harness-specific convention — in
production there is no outer agent and no human in the loop per step.

This file exists **only to redirect you** to the factory's own mechanisms. It
carries no operative instructions of its own. The full version of this guidance,
including the pointers to Corellia's native config / memory / skills / harness,
is in **`CLAUDE.md`** — read that. (Same content; one source of truth.)

**The one rule:** everything that must persist about this repo lives **in this
repo** — `DESIGN.md`, `GOAL-TYPES.md`, `docs/` (PRD + ADRs), `src/` (incl. the
constitution lint in `src/library/constitution.ts` and the skills in
`src/library/skills/`), the event log (`src/eventlog/`), and commit messages —
never in an outer harness's config or memory.
